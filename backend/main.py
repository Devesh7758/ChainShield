"""
ChainShield backend — invoice risk triage + restricted chain-record writer.

Read docs/ORACLE_TRUST.md (and the README "Oracle / trust assumption" section)
before touching AUTO_APPROVE_RISK_THRESHOLD or write_chain_record(). This
service — specifically whatever key backs ATTESTOR_SECRET — is the actual
trust root for every decision record. The chain does not independently verify
risk scores; it faithfully timestamps whatever this service (or a human
reviewer through it) submits. That is a tamper-evident audit trail, not a
trustless oracle.
"""
import difflib
import hashlib
import io
import os
import re
import sqlite3
import time
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Form, HTTPException, UploadFile, File, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover - degrade gracefully if not installed
    PdfReader = None

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:  # pragma: no cover
    pass

from ai_forensic import ForensicReport, run_forensic_analysis

app = FastAPI(title="ChainShield Risk Triage")
DB = Path(__file__).with_name("chainshield.db")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Configurable thresholds — no magic numbers. Mirrors the pattern used for
# risk-score bands so all of these can be tuned (or overridden via env vars)
# in one place instead of scattered through the code.
# ---------------------------------------------------------------------------
AUTO_APPROVE_RISK_THRESHOLD = int(os.getenv("AUTO_APPROVE_RISK_THRESHOLD", "25"))  # risk < this => LOW, no human required
HIGH_RISK_THRESHOLD = int(os.getenv("HIGH_RISK_THRESHOLD", "50"))                  # risk >= this => HIGH

DUPLICATE_VENDOR_SIMILARITY_THRESHOLD = float(os.getenv("DUP_VENDOR_SIM", "0.82"))   # fuzzy vendor-name match, 0-1
DUPLICATE_AMOUNT_TOLERANCE_PCT = float(os.getenv("DUP_AMOUNT_PCT", "0.02"))          # amounts within 2% count as "same"
DUPLICATE_LINE_ITEM_JACCARD_THRESHOLD = float(os.getenv("DUP_ITEM_JACCARD", "0.6"))  # set-similarity on line-item text
DUPLICATE_MIN_SIGNALS = int(os.getenv("DUP_MIN_SIGNALS", "2"))                       # how many of the 3 signals must agree

SYSTEM_ACTOR = "system:auto"  # writes pending_review only — never allowed to finalize a decision, see write_chain_record

# Manual-audit baseline used only for the "time saved" estimate on the impact
# panel. This is a stated assumption, not a measured figure — see README.
MANUAL_AUDIT_BASELINE_MINUTES = float(os.getenv("MANUAL_AUDIT_BASELINE_MINUTES", "45"))


def connection():
    db = sqlite3.connect(DB)
    db.execute("""
        CREATE TABLE IF NOT EXISTS claims (
            hash TEXT PRIMARY KEY,
            ngo_id TEXT,
            vendor TEXT,
            amount REAL,
            line_items TEXT,      -- '|'-joined, raw extraction only, never exposed publicly
            risk_score INTEGER,
            issues TEXT,
            submitted_at REAL
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS chain_records (
            invoice_hash TEXT PRIMARY KEY,
            ngo_id TEXT NOT NULL,
            risk_score INTEGER NOT NULL,
            decision TEXT NOT NULL,           -- pending_review | deferred_for_team_review | cleared_for_disbursement | rejected
            reviewer_or_auto TEXT NOT NULL,   -- SYSTEM_ACTOR, or a human reviewer id
            decided_at REAL NOT NULL,
            written_at REAL NOT NULL
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS forensic_reports (
            invoice_hash TEXT PRIMARY KEY,
            ngo_id TEXT,
            source TEXT,           -- 'ai' or 'rule_based_fallback'
            available INTEGER,     -- 1 if the AI actually produced a report
            error TEXT,
            reasoning TEXT,
            issues TEXT,           -- '|'-joined
            risk_score INTEGER,
            created_at REAL
        )
    """)
    return db


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class AuditResult(BaseModel):
    status: str
    invoice_hash: str
    ngo_id: str
    claimed_amount: float
    allocated_limit: float
    risk_score: int
    risk_level: str
    anomaly_detected: bool
    issues: list[str]                 # exact-hash duplicate + rule-based flags live here
    near_duplicate_issues: list[str]  # structural near-duplicate flags, kept separate on purpose
    disbursement_status: str          # status flag only — see note below
    requires_human_review: bool
    extraction_source: str            # 'ai_forensic' or 'rule_based_fallback' — see note below
    ai_available: bool
    ai_reasoning: str = ""
    ai_error: Optional[str] = None


class ReviewDecision(BaseModel):
    invoice_hash: str
    ngo_id: str
    risk_score: int
    # deferred_for_team_review = a human looked at it and explicitly chose
    # to defer rather than decide now — distinct from pending_review (which
    # means no human has acted yet). Still not a final decision.
    decision: str = Field(pattern="^(cleared_for_disbursement|rejected|deferred_for_team_review)$")
    reviewer_id: str


# ---------------------------------------------------------------------------
# The single restricted write boundary. This is the ONLY function in the
# codebase allowed to write a chain record. It accepts exactly the five
# allowed fields, strips everything else, and independently re-enforces the
# human-in-the-loop rule server-side (never trust the caller to have done it).
# ---------------------------------------------------------------------------
class ChainWriteRejected(Exception):
    pass


def write_chain_record(*, invoice_hash: str, ngo_id: str, risk_score: int, decision: str, reviewer_or_auto: str) -> dict:
    """
    The only path allowed to touch the chain/ledger record. Accepts exactly:
    invoice_hash, ngo_id, risk_score, decision, reviewer_or_auto (+ a server
    -assigned timestamp). Vendor name, amount, line items, and any raw file
    content/URL are never accepted here — there is no parameter for them, so
    a caller cannot smuggle them through even by accident.

    Every claim requires a human reviewer, full stop — there is no risk
    score, including 0, at which the system actor (SYSTEM_ACTOR) is allowed
    to write a final cleared_for_disbursement/rejected decision. AUTO_APPROVE
    _RISK_THRESHOLD still exists to distinguish LOW/MEDIUM/HIGH for display
    and for the "awaiting review" framing, but it no longer gates who's
    allowed to finalize a decision — only pending_review may be written by
    SYSTEM_ACTOR now.
    """
    if not invoice_hash or not invoice_hash.strip():
        raise ChainWriteRejected("invoice_hash must be a non-empty value")
    if not ngo_id or not ngo_id.strip():
        raise ChainWriteRejected("ngo_id must be a non-empty value")
    if decision not in ("cleared_for_disbursement", "rejected", "pending_review", "deferred_for_team_review"):
        raise ChainWriteRejected(f"unknown decision '{decision}'")

    if decision == "deferred_for_team_review" and (reviewer_or_auto == SYSTEM_ACTOR or not reviewer_or_auto.strip()):
        raise ChainWriteRejected("deferring to team review still requires a real reviewer_id — the system actor cannot defer on a human's behalf")

    if decision not in ("pending_review", "deferred_for_team_review") and (reviewer_or_auto == SYSTEM_ACTOR or not reviewer_or_auto.strip()):
        raise ChainWriteRejected(
            "every claim requires human review regardless of risk score; a non-system reviewer_id is required to write a final decision"
        )

    record = {
        "invoice_hash": invoice_hash,
        "ngo_id": ngo_id,
        "risk_score": int(risk_score),
        "decision": decision,
        "reviewer_or_auto": reviewer_or_auto,
        "decided_at": time.time(),
        "written_at": time.time(),
    }
    with connection() as db:
        db.execute(
            """INSERT INTO chain_records
               (invoice_hash, ngo_id, risk_score, decision, reviewer_or_auto, decided_at, written_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(invoice_hash) DO UPDATE SET
                 risk_score=excluded.risk_score, decision=excluded.decision,
                 reviewer_or_auto=excluded.reviewer_or_auto, decided_at=excluded.decided_at,
                 written_at=excluded.written_at""",
            (record["invoice_hash"], record["ngo_id"], record["risk_score"], record["decision"],
             record["reviewer_or_auto"], record["decided_at"], record["written_at"]),
        )

    _anchor_on_chain(record)
    return record


def _anchor_on_chain(record: dict) -> None:
    """
    Best-effort call into the real Soroban contract (contracts/src/lib.rs).
    Gated behind env vars so this never silently pretends to succeed: if the
    contract isn't deployed yet / no attestor key is configured, we say so
    plainly rather than fabricating a fake tx hash.
    """
    contract_id = os.getenv("CHAINSHIELD_CONTRACT_ID")
    attestor_secret = os.getenv("CHAINSHIELD_ATTESTOR_SECRET")
    if not contract_id or not attestor_secret:
        record["chain_anchor"] = "not_configured"
        return
    try:
        from chain_client import submit_decision_to_chain  # local module, see chain_client.py
        tx_hash = submit_decision_to_chain(
            contract_id=contract_id,
            attestor_secret=attestor_secret,
            invoice_hash=record["invoice_hash"],
            risk_score=record["risk_score"],
            decision=record["decision"],
        )
        record["chain_anchor"] = tx_hash
    except Exception as exc:  # pragma: no cover - network/contract dependent
        record["chain_anchor"] = f"error: {exc}"


# ---------------------------------------------------------------------------
# Text extraction — PDFs are the expected real-world upload, plain text is
# supported for demo/test files. A blind content.decode("utf-8") on PDF
# bytes silently produces near-garbage text (PDF is a binary format), which
# makes AMOUNT_RE find nothing and score every claim as risk-free — that's
# a false "everything looks fine" bug, not a fraud problem, so it's handled
# explicitly here rather than left to fail silently.
# ---------------------------------------------------------------------------
def extract_text_from_upload(content: bytes, filename: str) -> str:
    looks_like_pdf = filename.lower().endswith(".pdf") or content[:5] == b"%PDF-"
    if looks_like_pdf:
        if PdfReader is None:
            raise HTTPException(status_code=500, detail="PDF support unavailable: pypdf is not installed on the server")
        try:
            reader = PdfReader(io.BytesIO(content))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not read PDF: {exc}")
    return content.decode("utf-8", errors="ignore")


# ---------------------------------------------------------------------------
# Extraction + risk scoring
# ---------------------------------------------------------------------------
# Matches ₹/INR/Rs-prefixed amounts, plain $-prefixed amounts, and bare
# "Amount/Total/Claimed: 90,000"-style numbers with no currency symbol at
# all — real invoices don't reliably include a currency marker next to the
# figure the extractor needs.
AMOUNT_RE = re.compile(
    r"(?:₹|INR|Rs\.?|\$|(?:amount|total|claimed)\s*[:\-]\s*)[ ]*([0-9][0-9,]*(?:\.[0-9]{1,2})?)",
    re.I,
)
VENDOR_RE = re.compile(r"(?:vendor|payee|bill(?:ed)? to|supplier)\s*[:\-]\s*(.+)", re.I)
LINE_ITEM_RE = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s*(.+)$", re.M)


def extract_fields(text: str) -> dict:
    amounts = [float(x.replace(",", "")) for x in AMOUNT_RE.findall(text)]
    vendor_match = VENDOR_RE.search(text)
    vendor = vendor_match.group(1).strip()[:120] if vendor_match else ""
    line_items = [m.strip() for m in LINE_ITEM_RE.findall(text) if m.strip()][:50]
    return {
        "amount": max(amounts, default=0.0),
        "vendor": vendor,
        "line_items": line_items,
    }


def _jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    return len(a & b) / len(a | b)


def find_near_duplicates(db, ngo_id: str, vendor: str, amount: float, line_items: list[str], exclude_hash: str) -> list[str]:
    """
    Structural near-duplicate detection, independent of file hash: fuzzy
    vendor match + amount-within-tolerance + line-item set overlap, scoped to
    the same NGO. Fires when at least DUPLICATE_MIN_SIGNALS of the 3 signals
    agree with a prior claim — this catches "same invoice, re-scanned/edited
    so the hash differs" cases that exact hashing misses entirely.
    """
    if not vendor and not amount and not line_items:
        return []
    item_set = set(i.lower() for i in line_items)
    issues = []
    rows = db.execute(
        "SELECT hash, vendor, amount, line_items FROM claims WHERE ngo_id=? AND hash<>?",
        (ngo_id, exclude_hash),
    ).fetchall()
    for other_hash, other_vendor, other_amount, other_items_raw in rows:
        signals = 0
        if vendor and other_vendor:
            ratio = difflib.SequenceMatcher(None, vendor.lower(), other_vendor.lower()).ratio()
            if ratio >= DUPLICATE_VENDOR_SIMILARITY_THRESHOLD:
                signals += 1
        if amount and other_amount:
            if abs(amount - other_amount) <= DUPLICATE_AMOUNT_TOLERANCE_PCT * max(amount, other_amount):
                signals += 1
        other_items = set((other_items_raw or "").split("|")) - {""}
        if item_set and other_items:
            if _jaccard(item_set, other_items) >= DUPLICATE_LINE_ITEM_JACCARD_THRESHOLD:
                signals += 1
        if signals >= DUPLICATE_MIN_SIGNALS:
            issues.append(f"Structurally similar to prior claim {other_hash[:10]}… ({signals}/3 signals: vendor/amount/line-items)")
    return issues


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
def health_check():
    return {"status": "online", "service": "ChainShield Engine v1.0"}


@app.post("/invoice", response_model=AuditResult)
async def audit_invoice(
    file: UploadFile = File(...),
    budget_limit: float = Form(40000.0),
    ngo_id: str = Form(...),
):
    content = await file.read()
    file_hash = hashlib.sha256(content).hexdigest()
    text = extract_text_from_upload(content, file.filename or "")

    # AI Invoice Forensic step: Gemini reads the document and PROPOSES
    # vendor/amount/line-items/risk_score + reasoning. This is a proposal,
    # not a decision — anything at/above AUTO_APPROVE_RISK_THRESHOLD still
    # requires a human reviewer through /review regardless of what the AI
    # says (write_chain_record enforces this independently). If no
    # GEMINI_API_KEY is configured, we fall back to the deterministic
    # rule-based extractor rather than silently pretending the AI ran.
    report = run_forensic_analysis(text, budget_limit)
    if report.available:
        extraction_source = "ai_forensic"
        extracted_amount, vendor, line_items = report.claimed_amount, report.vendor, report.line_items
        ai_issues, ai_risk = list(report.issues), report.risk_score
    else:
        extraction_source = "rule_based_fallback"
        fields = extract_fields(text)
        extracted_amount, vendor, line_items = fields["amount"], fields["vendor"], fields["line_items"]
        ai_issues, ai_risk = [], 0

    issues, near_dup_issues, risk = list(ai_issues), [], ai_risk
    if extraction_source == "rule_based_fallback":
        # These two deterministic checks are the fallback's own scoring
        # logic — when the AI ran successfully it already reasoned about
        # budget overage and round numbers itself (see the prompt in
        # ai_forensic.py), so re-running them here would double-count the
        # same signal under different wording rather than add anything new.
        if extracted_amount > budget_limit:
            risk += 25
            issues.append("Amount exceeds milestone budget")
        if extracted_amount and extracted_amount % 1000 == 0:
            risk += 15
            issues.append("Round-number amount")
    risk = max(0, min(100, risk))

    dup_note = ""
    with connection() as db:
        exact_dup = db.execute("SELECT 1 FROM claims WHERE hash=?", (file_hash,)).fetchone()
        if exact_dup:
            risk = 100
            issues.append("Exact-hash duplicate: this raw invoice file was already submitted")
            dup_note = "This exact file (identical bytes/hash) was already submitted previously — flagged as an exact-hash duplicate regardless of what the AI's own read of the document content found."

        # Structural near-duplicate check runs independently of the exact-hash
        # check above, and is surfaced as its own list so the two signals
        # never get collapsed into one flag.
        near_dup_issues = find_near_duplicates(db, ngo_id, vendor, extracted_amount, line_items, file_hash)
        if near_dup_issues:
            risk = max(risk, HIGH_RISK_THRESHOLD)
            if not dup_note:
                dup_note = "This invoice is structurally similar to a prior claim for the same NGO (matching vendor/amount/line-items) even though the file itself differs — flagged as a near-duplicate."

        # The forensic report's stored issues/reasoning must reflect the
        # FINAL risk assessment (including duplicate checks, which the AI
        # prompt has no visibility into), not just the AI's own pre-dedup
        # read of the document — otherwise the Forensic page shows a risk
        # score of 100 next to reasoning that never mentions why.
        full_issues = issues + near_dup_issues
        full_reasoning = f"{report.reasoning} {dup_note}".strip() if dup_note else report.reasoning

        db.execute(
            "INSERT OR REPLACE INTO claims (hash, ngo_id, vendor, amount, line_items, risk_score, issues, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (file_hash, ngo_id, vendor, extracted_amount, "|".join(line_items), risk, "; ".join(full_issues), time.time()),
        )
        db.execute(
            """INSERT OR REPLACE INTO forensic_reports
               (invoice_hash, ngo_id, source, available, error, reasoning, issues, risk_score, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (file_hash, ngo_id, extraction_source, int(report.available), report.error,
             full_reasoning, "|".join(full_issues), risk, time.time()),
        )

    level = "HIGH" if risk >= HIGH_RISK_THRESHOLD else "MEDIUM" if risk >= AUTO_APPROVE_RISK_THRESHOLD else "LOW"
    # Every claim requires human review — no risk score, including 0, lets a
    # claim skip straight to cleared_for_disbursement. AUTO_APPROVE_RISK_
    # THRESHOLD still drives the LOW/MEDIUM/HIGH label above, but no longer
    # gates whether a human is required; write_chain_record() enforces this
    # independently so this isn't just a UI/route convention.
    requires_review = True

    write_chain_record(
        invoice_hash=file_hash, ngo_id=ngo_id, risk_score=risk,
        decision="pending_review", reviewer_or_auto=SYSTEM_ACTOR,
    )
    disbursement_status = "pending"

    return AuditResult(
        status="TRIAGED", invoice_hash=file_hash, ngo_id=ngo_id,
        claimed_amount=extracted_amount, allocated_limit=budget_limit,
        risk_score=risk, risk_level=level, anomaly_detected=bool(issues or near_dup_issues),
        issues=issues, near_duplicate_issues=near_dup_issues,
        disbursement_status=disbursement_status,  # a status flag only — no payment logic is triggered by this value
        requires_human_review=requires_review,
        extraction_source=extraction_source,
        ai_available=report.available,
        ai_reasoning=report.reasoning,
        ai_error=report.error,
    )


@app.get("/forensic/{invoice_hash}")
def get_forensic_report(invoice_hash: str):
    """
    Full AI Invoice Forensic report for a given claim — the "AI Invoice
    Forensic" page reads from here. This is the AI's proposal for a human
    reviewer to read before deciding via POST /review; it is never itself a
    disbursement decision.
    """
    with connection() as db:
        row = db.execute(
            "SELECT invoice_hash, ngo_id, source, available, error, reasoning, issues, risk_score, created_at FROM forensic_reports WHERE invoice_hash=?",
            (invoice_hash,),
        ).fetchone()
        claim_row = db.execute(
            "SELECT vendor, amount, line_items FROM claims WHERE hash=?", (invoice_hash,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No forensic report found for this invoice hash")
    _, ngo_id, source, available, error, reasoning, issues_raw, risk_score, created_at = row
    vendor, amount, line_items_raw = claim_row if claim_row else ("", 0.0, "")
    return {
        "invoice_hash": invoice_hash,
        "ngo_id": ngo_id,
        "extraction_source": source,
        "ai_available": bool(available),
        "ai_error": error,
        "reasoning": reasoning,
        "issues": [i for i in (issues_raw or "").split("|") if i],
        "risk_score": risk_score,
        "vendor": vendor,
        "claimed_amount": amount,
        "line_items": [i for i in (line_items_raw or "").split("|") if i],
        "created_at": created_at,
    }


def require_reviewer(x_reviewer_id: Optional[str] = Header(default=None)) -> str:
    """
    Real auth is out of scope for this pass (see docs/ORACLE_TRUST.md), but
    this dependency is where a real auth/role check plugs in — it is
    enforced on the route itself, not just hidden by a frontend button, and
    write_chain_record() re-checks the same rule independently below.
    """
    if not x_reviewer_id or x_reviewer_id.strip() in ("", SYSTEM_ACTOR):
        raise HTTPException(status_code=401, detail="A reviewer identity (X-Reviewer-Id header) is required for this action")
    return x_reviewer_id.strip()


@app.post("/review")
def submit_review(body: ReviewDecision, reviewer_id: str = Depends(require_reviewer)):
    """
    The only route that can move a medium/high-risk claim out of
    pending_review. Requires a real reviewer identity via the X-Reviewer-Id
    header (checked by require_reviewer) — hitting this route directly
    without that header is rejected with 401 before write_chain_record even
    runs, and write_chain_record enforces the same rule again independently.
    """
    if body.reviewer_id != reviewer_id:
        raise HTTPException(status_code=400, detail="reviewer_id in body must match X-Reviewer-Id header")
    try:
        record = write_chain_record(
            invoice_hash=body.invoice_hash, ngo_id=body.ngo_id, risk_score=body.risk_score,
            decision=body.decision, reviewer_or_auto=reviewer_id,
        )
    except ChainWriteRejected as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "recorded", "record": record}


@app.get("/claims")
def claims():
    """Internal/NGO-facing view — includes private fields. Not for public use."""
    with connection() as db:
        return [
            {"invoice_hash": h, "ngo_id": n, "vendor": v, "claimed_amount": a, "risk_score": r, "issues": i}
            for h, n, v, a, r, i in db.execute(
                "SELECT hash, ngo_id, vendor, amount, risk_score, issues FROM claims ORDER BY submitted_at DESC"
            )
        ]


@app.get("/public/claims")
def public_claims(ngo_id: Optional[str] = None, q: Optional[str] = None):
    """
    Public transparency feed. Reads ONLY from chain_records (the restricted
    5-field table written exclusively by write_chain_record) — never from
    the claims table, so there is no way for vendor/amount/line-items to
    leak through this route even by future accident.
    """
    with connection() as db:
        rows = db.execute(
            "SELECT invoice_hash, ngo_id, risk_score, decision, reviewer_or_auto, decided_at FROM chain_records ORDER BY decided_at DESC"
        ).fetchall()
    out = []
    for h, ngo, risk, decision, reviewer, decided_at in rows:
        if ngo_id and ngo != ngo_id:
            continue
        short_id = h[:10] + "…"
        if q and q.lower() not in ngo.lower() and q.lower() not in h.lower():
            continue
        out.append({
            "claim_id": short_id,
            "ngo_id": ngo,
            "decision": decision,
            "risk_score": risk,
            "risk_level": "HIGH" if risk >= HIGH_RISK_THRESHOLD else "MEDIUM" if risk >= AUTO_APPROVE_RISK_THRESHOLD else "LOW",
            "reviewed_by": "Automated system check" if reviewer == SYSTEM_ACTOR else reviewer,  # real reviewer_id shown per user request
            "timestamp": decided_at,
            "reason_summary": _plain_language_summary(decision, risk),
        })
    return out


def _plain_language_summary(decision: str, risk: int) -> str:
    if decision == "pending_review":
        return f"Flagged (risk {risk}) and awaiting human reviewer."
    if decision == "deferred_for_team_review":
        return f"Reviewed and deferred for team discussion (risk score {risk})."
    if decision == "cleared_for_disbursement":
        return f"Approved by human reviewer after manual review (risk score {risk})."
    if decision == "rejected":
        return f"Rejected by human reviewer (risk score {risk})."
    return "Status unavailable."


@app.get("/impact")
def impact_metrics():
    """
    Live-computed impact panel — nothing here is hardcoded. See README for
    the stated manual-audit baseline assumption behind the time-saved figure.
    """
    with connection() as db:
        total_claims, flagged = db.execute(
            "SELECT count(*), count(*) FILTER (WHERE risk_score >= ?) FROM claims",
            (HIGH_RISK_THRESHOLD,),
        ).fetchone()
        chain_rows = db.execute(
            "SELECT decision, reviewer_or_auto FROM chain_records"
        ).fetchall()

    claims_with_chain_record = len(chain_rows)
    # Every claim now requires human review — SYSTEM_ACTOR is never allowed
    # to write a final cleared_for_disbursement/rejected decision (see
    # write_chain_record), so this should always compute to 0 going forward.
    # Kept as a live computation rather than hardcoded so a regression here
    # (or historical pre-policy-change rows) would visibly show up as
    # nonzero instead of being silently hidden.
    decisions = [d for d, _r in chain_rows]
    auto_decided = sum(1 for d, r in chain_rows if r == SYSTEM_ACTOR and d != "pending_review")
    approved_count = decisions.count("cleared_for_disbursement")
    rejected_count = decisions.count("rejected")
    # human_decided counts only FINAL decisions (approve/reject) — a
    # deferral is a real human action but not a decision, so it's tracked
    # separately and must not inflate this count.
    human_decided = approved_count + rejected_count
    deferred_count = decisions.count("deferred_for_team_review")
    awaiting_review = decisions.count("pending_review")
    audit_trail_pct = (claims_with_chain_record / total_claims * 100) if total_claims else 0.0

    fraud_catch_rate_pct = (flagged / total_claims * 100) if total_claims else 0.0

    # "Time saved" estimate: manual baseline minus what an auto-cleared claim
    # actually costs in wall-clock triage time here (near-zero, it's
    # synchronous scoring). Clearly labeled as an estimate, not a measurement.
    estimated_minutes_saved = auto_decided * MANUAL_AUDIT_BASELINE_MINUTES

    return {
        "total_claims_processed": total_claims,
        "fraud_or_anomaly_catch_rate_pct": round(fraud_catch_rate_pct, 1),
        "claims_with_full_onchain_audit_trail_pct": round(audit_trail_pct, 1),
        "audit_trail_gap_flag": total_claims > claims_with_chain_record,
        "auto_cleared_claims": auto_decided,
        "human_reviewed_claims": human_decided,
        "approved_claims": approved_count,
        "rejected_claims": rejected_count,
        "deferred_claims": deferred_count,
        "awaiting_human_review": awaiting_review,
        "manual_audit_baseline_minutes_per_claim": MANUAL_AUDIT_BASELINE_MINUTES,
        "estimated_minutes_saved": estimated_minutes_saved,
        "estimated_minutes_saved_note": (
            f"Estimate = auto_cleared_claims × {MANUAL_AUDIT_BASELINE_MINUTES} min "
            "(a stated assumption for a fully manual per-invoice review, not a measured figure — sanity-check before presenting)."
        ),
    }


@app.get("/stats")
def stats():
    with connection() as db:
        total, flagged = db.execute(
            "SELECT count(*), count(*) FILTER (WHERE risk_score >= ?) FROM claims", (HIGH_RISK_THRESHOLD,)
        ).fetchone()
    return {"claims": total, "flagged": flagged, "note": "See /impact for the full metrics panel."}
