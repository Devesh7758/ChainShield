# ChainShield

A Web3-enabled AI-driven NGO fund auditing platform designed to prevent fund leakage and ensure transparent resource distribution.

## Project Demo
![Demo 1](./demo-assets/demo-1.png)
![Demo 2](./demo-assets/demo-2.png)
![Demo 3](./demo-assets/demo-3.png)
![Demo 4](./demo-assets/demo-4.png)
![Demo 5](./demo-assets/demo-5.png)
![Demo 6](./demo-assets/demo-6.png)
![Demo 7](./demo-assets/demo-7.png)
![Demo 8](./demo-assets/demo-8.png)

## What changed

ChainShield is for corporate CSR teams and foundations—not donor dashboards. It
uses a global, on-chain invoice-hash registry to catch the same document claimed
against different funders without exposing either funder's books. Risk scoring
triages audit attention; it does not claim to verify that spending happened.

Every claim — regardless of risk score, including a risk score of 0 — requires a
human reviewer before it can be marked cleared for disbursement or rejected. There
is no auto-approve path. This is enforced server-side, not just hidden behind a UI
button: `write_chain_record` rejects any attempt by the system actor to finalize a
decision, and this is independently re-checked at the `/review` route itself (see
[backend/main.py](backend/main.py)).

## What's real vs. simulated

| Piece | Status |
|---|---|
| SHA-256 hashing of raw invoice bytes | Real |
| Risk-score triage (budget check, round-number check, duplicate checks) | Real, computed live from submitted data |
| Structural near-duplicate detection (vendor + amount + line-item overlap) | Real, independent of exact-hash matching — see below |
| Human-in-the-loop enforcement above the risk threshold | Real, enforced server-side at two independent points |
| Restricted chain-record write boundary (5 fields only) | Real — [backend/main.py](backend/main.py) `write_chain_record` |
| Public transparency ledger (`/public/claims`) | Real, reads only from the restricted chain-record table |
| Impact metrics (`/impact`) | Real, computed live from actual submitted claims — nothing hardcoded |
| Soroban contract token custody (`create_grant`/`settle`) | Real Stellar Asset Contract transfers, on testnet, when deployed |
| Live backend → deployed-contract anchoring | **Not yet wired end-to-end** — [backend/chain_client.py](backend/chain_client.py) has the real call shape but needs a grant/milestone lookup completed and a deployed `CHAINSHIELD_CONTRACT_ID` + funded attestor key before it does anything beyond writing to the local restricted-fields table. Until then, the SQLite `chain_records` table is the source of truth for the demo UI. |

## Oracle / trust assumption

**Read [docs/ORACLE_TRUST.md](docs/ORACLE_TRUST.md) before presenting this to judges.**
Short version: the backend's `attestor` key is what actually signs every
decision written toward the chain. The chain does not independently verify a
risk score — it makes the resulting record tamper-evident and publicly
checkable after the fact. That's the real value prop: an audit trail you
can't quietly edit, plus a hard human-review gate above a configurable
threshold — not an autonomous, trustless fund release.

## Impact metrics — how they're computed

`GET /impact` ([backend/main.py](backend/main.py)) computes, live, from
whatever claims have actually been submitted (seed data or real
submissions — nothing is hardcoded):

- **Fraud/anomaly catch rate** — % of processed claims scored at/above
  `HIGH_RISK_THRESHOLD`.
- **On-chain audit trail coverage** — % of claims that have a corresponding
  row in the restricted `chain_records` table (should always be 100% for
  anything that went through `/invoice`; a gap is flagged if it's ever not).
- **Auto-cleared vs. human-reviewed** — count of decisions written by the
  system actor vs. by a named human reviewer.
- **Estimated time saved** — `auto_cleared_claims × MANUAL_AUDIT_BASELINE_MINUTES`.
  The baseline (default **45 minutes per invoice**, override via
  `MANUAL_AUDIT_BASELINE_MINUTES` env var) is a **stated assumption**, not a
  measured figure — sanity-check it before quoting it as a real number to
  judges. It's meant to represent a fully manual line-by-line invoice review
  against a budget, done by a person with no tooling.

## Tech Stack
* **Frontend:** React + Vite
* **Backend:** FastAPI risk-triage + restricted chain-write API
* **Smart contracts:** Rust/Soroban on Stellar testnet — see [contracts/README.md](contracts/README.md)
* **Integrity:** SHA-256 over raw invoice bytes; hash committed on-chain

## Configurable thresholds

All in [backend/main.py](backend/main.py), overridable via env vars, no magic numbers:

| Threshold | Env var | Default |
|---|---|---|
| LOW/MEDIUM risk display boundary — no longer gates auto-approve, since every claim requires human review | `AUTO_APPROVE_RISK_THRESHOLD` | 25 |
| High-risk floor | `HIGH_RISK_THRESHOLD` | 50 |
| Near-dup vendor-name similarity | `DUP_VENDOR_SIM` | 0.82 |
| Near-dup amount tolerance | `DUP_AMOUNT_PCT` | 0.02 (2%) |
| Near-dup line-item Jaccard similarity | `DUP_ITEM_JACCARD` | 0.6 |
| Near-dup signals required to flag | `DUP_MIN_SIGNALS` | 2 of 3 |
| Manual-audit baseline (impact metric) | `MANUAL_AUDIT_BASELINE_MINUTES` | 45 |

## Local Setup
1. Build contract: `cd contracts && stellar contract build`
2. Test contract: `cargo test -p chainshield`
3. Start backend: `cd backend && pip install -r requirements.txt && python -m uvicorn main:app --reload --port 8000`
4. Start frontend: `cd frontend && npm install && npm run dev`

Backend routes: `POST /invoice` (submit + triage), `POST /review` (human
decision, requires `X-Reviewer-Id` header), `GET /claims` (internal/NGO
view — has private fields), `GET /public/claims` (public transparency feed),
`GET /impact` (live metrics).
