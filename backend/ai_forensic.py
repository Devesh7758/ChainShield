"""
AI Invoice Forensic step — calls Gemini to read the raw invoice and produce a
structured forensic report: extracted vendor/amount/line-items, a proposed
risk score, and a plain-language reasoning trail.

This is a PROPOSAL, not a decision. The AI's risk_score feeds the same
threshold logic as before (AUTO_APPROVE_RISK_THRESHOLD / HIGH_RISK_THRESHOLD
in main.py), and anything at/above that threshold still requires a human
reviewer via POST /review — write_chain_record() enforces that server-side
regardless of what the AI proposed. The AI never writes a chain record and
never sets disbursement_status itself; see docs/ORACLE_TRUST.md.

Gated behind GEMINI_API_KEY. If it's not set, callers get a clear
"ai_unavailable" result instead of a silent fake report.

Retry policy: Gemini's free tier enforces both a short per-minute rate limit
and a hard daily cap (the exact numbers vary by model/key), both surfaced as
HTTP 429 / ResourceExhausted. Only the per-minute kind is worth retrying — it
clears in seconds. The daily cap does not clear until the quota window
resets, so retrying it just adds latency for the same guaranteed failure; we
detect it from the error body (quota_id contains "PerDay") and fail fast
instead.

Model note: gemini-2.5-flash returns 404 "no longer available to new users"
for some newer API keys/projects, which is why the default here is
gemini-3.6-flash — override with GEMINI_MODEL if your key needs something
else.
"""
import json
import os
import re
import time
from typing import Optional

from pydantic import BaseModel

MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
MAX_RETRIES = int(os.getenv("GEMINI_MAX_RETRIES", "2"))          # attempts after the first, for transient 429s only
MAX_RETRY_DELAY_SECONDS = float(os.getenv("GEMINI_MAX_RETRY_DELAY_SECONDS", "15"))  # cap per-attempt wait

_PROMPT_TEMPLATE = """You are a financial-document forensic analyst reviewing an NGO/CSR
expense claim against an allocated milestone budget of {budget_limit}.

From the invoice text below, extract:
- vendor: the vendor/payee/supplier name (best guess, empty string if unclear)
- claimed_amount: the total amount being claimed, as a number (0 if you can't find one)
- line_items: a list of distinct line items/goods/services billed (short strings)
- risk_score: your own integer risk assessment from 0-100, considering: does the
  amount exceed the budget, are there round-number or suspiciously vague amounts,
  inconsistent math, missing vendor details, or other red flags typical of
  invoice fraud or padding
- issues: a list of short plain-language strings explaining each risk factor you found
  (empty list if none)
- reasoning: 2-4 sentences explaining your overall assessment, written for a
  human reviewer who will make the final call — you are proposing, not deciding

Do NOT attempt to judge whether this invoice is a duplicate or resubmission of
a previous claim — you only see this one document in isolation and have no
visibility into other submissions. Exact-hash and structural near-duplicate
detection are handled separately by the system after your analysis and will
be combined with your risk_score; just assess this document on its own merits.

Respond with ONLY a JSON object, no markdown fences, matching exactly:
{{"vendor": "string", "claimed_amount": 0.0, "line_items": ["string"], "risk_score": 0, "issues": ["string"], "reasoning": "string"}}

--- INVOICE TEXT ---
{invoice_text}
"""


class ForensicReport(BaseModel):
    available: bool
    vendor: str = ""
    claimed_amount: float = 0.0
    line_items: list[str] = []
    risk_score: int = 0
    issues: list[str] = []
    reasoning: str = ""
    error: Optional[str] = None


def _is_daily_quota_exhausted(exc: Exception) -> bool:
    # Google's quota_id for the free-tier daily cap looks like
    # "GenerateRequestsPerDayPerProjectPerModel-FreeTier" — anything with
    # "PerDay" in the quota_id is a cap that won't clear before tomorrow.
    return "PerDay" in str(exc)


def _extract_retry_delay_seconds(exc: Exception) -> Optional[float]:
    # The SDK's ResourceExhausted error embeds "retry_delay { seconds: N }"
    # in its string form — pull it out so we wait exactly as long as Google
    # told us to, rather than guessing.
    match = re.search(r"retry_delay\s*\{\s*seconds:\s*(\d+)", str(exc))
    return float(match.group(1)) if match else None


def _call_gemini(api_key: str, prompt: str):
    import google.generativeai as genai
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(MODEL_NAME)
    return model.generate_content(prompt)


def run_forensic_analysis(invoice_text: str, budget_limit: float) -> ForensicReport:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return ForensicReport(available=False, error="GEMINI_API_KEY is not set on the server")

    try:
        import google.api_core.exceptions as gexc
    except ImportError:
        return ForensicReport(available=False, error="google-generativeai is not installed on the server")

    prompt = _PROMPT_TEMPLATE.format(budget_limit=budget_limit, invoice_text=invoice_text[:20000])

    last_error: Optional[Exception] = None
    attempt = 0
    while attempt <= MAX_RETRIES:
        try:
            response = _call_gemini(api_key, prompt)
            raw = (response.text or "").strip()
            if raw.startswith("```"):
                raw = raw.strip("`")
                if raw.lower().startswith("json"):
                    raw = raw[4:]
            data = json.loads(raw)
            return ForensicReport(
                available=True,
                vendor=str(data.get("vendor", ""))[:200],
                claimed_amount=float(data.get("claimed_amount", 0.0) or 0.0),
                line_items=[str(i)[:200] for i in (data.get("line_items") or [])][:50],
                risk_score=max(0, min(100, int(data.get("risk_score", 0)))),
                issues=[str(i) for i in (data.get("issues") or [])],
                reasoning=str(data.get("reasoning", "")),
            )
        except gexc.ResourceExhausted as exc:
            last_error = exc
            if _is_daily_quota_exhausted(exc):
                # Fail fast — retrying a per-day cap wastes latency on a
                # guaranteed failure and doesn't help tomorrow's quota.
                return ForensicReport(available=False, error=f"AI forensic analysis failed: {exc}")
            if attempt >= MAX_RETRIES:
                break
            delay = min(_extract_retry_delay_seconds(exc) or (2 ** attempt), MAX_RETRY_DELAY_SECONDS)
            time.sleep(delay)
            attempt += 1
        except Exception as exc:
            # Non-429 failures (bad JSON, network error, etc.) aren't
            # retried — they're not going to succeed on the same input.
            return ForensicReport(available=False, error=f"AI forensic analysis failed: {exc}")

    return ForensicReport(available=False, error=f"AI forensic analysis failed after {MAX_RETRIES + 1} attempts: {last_error}")
