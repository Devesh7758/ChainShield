# Sample invoices for manual testing

Plain-text stand-ins for PDFs — the backend's extractor just reads text, so
`.txt` works fine for demo purposes. Upload these through the frontend's
"Submit invoice" tab (or via `curl -F file=@...` directly to `/invoice`).

Suggested walkthrough, all against the same `ngo_id` (e.g. `ngo_alpha`)
unless noted:

Verified against a clean database — actual output shown, not just predicted:

| # | File | budget_limit | Actual result |
|---|---|---|---|
| 1 | `01-clean-low-risk.txt` | 200000 | risk 0, LOW → auto `cleared_for_disbursement`, no review needed |
| 2 | `02-over-budget-round-number.txt` | 40000 | risk 40, MEDIUM (over-budget +25, round-number +15) → `pending`, human review box appears |
| 3 | `03-near-duplicate-of-02-rescan.txt` | 40000 | Different file hash than #2, but `near_duplicate_issues` fires (2/3 signals: vendor + amount matched, line-item wording differed just enough to miss the 3rd) — its own `issues` list (budget/round-number) stays separate from `near_duplicate_issues`, as required |
| 2 again | `02-over-budget-round-number.txt` (resubmit) | 40000 | Exact-hash duplicate — `issues` gains "Exact-hash duplicate…", risk forced to 100 |
| 4 | `04-medium-risk-slightly-over.txt` | 40000 | risk 25, MEDIUM (over-budget only, not round-number) — right at the auto-approve threshold, good for showing the review gate without maxing risk out |
| 5 | `05-different-ngo-same-vendor.txt` | 200000 | Submit under a **different** `ngo_id` (e.g. `ngo_beta`) — risk 15, LOW, `near_duplicate_issues: []` even though the vendor name matches #2 — confirms the check is scoped per-NGO and doesn't cross projects |

After running a few of these, check:
- **Public ledger tab** — should show only claim ID / NGO / decision / risk / timestamp / reason, never vendor or amount.
- **Impact tab** — catch rate, auto vs. human-reviewed counts, and awaiting-review count should all reflect exactly what you just submitted.

To try the human-in-the-loop bypass check (server-side, not just UI):
```sh
# Copy an invoice_hash from a MEDIUM/HIGH result, then:
curl -i -X POST http://localhost:8000/review \
  -H "Content-Type: application/json" \
  -d '{"invoice_hash":"<hash>","ngo_id":"ngo_alpha","risk_score":50,"decision":"cleared_for_disbursement","reviewer_id":"x"}'
# -> 401, no X-Reviewer-Id header

curl -i -X POST http://localhost:8000/review \
  -H "Content-Type: application/json" -H "X-Reviewer-Id: system:auto" \
  -d '{"invoice_hash":"<hash>","ngo_id":"ngo_alpha","risk_score":50,"decision":"cleared_for_disbursement","reviewer_id":"system:auto"}'
# -> 401, system actor can't self-clear a flagged claim

curl -i -X POST http://localhost:8000/review \
  -H "Content-Type: application/json" -H "X-Reviewer-Id: a_real_reviewer" \
  -d '{"invoice_hash":"<hash>","ngo_id":"ngo_alpha","risk_score":50,"decision":"cleared_for_disbursement","reviewer_id":"a_real_reviewer"}'
# -> 200, recorded
```
