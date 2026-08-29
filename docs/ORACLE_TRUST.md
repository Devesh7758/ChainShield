# Oracle / trust assumption

Read this before presenting ChainShield. It is the single most important
thing to get right in front of judges, because the honest answer is more
interesting than the inflated one.

## Who actually signs the decision record?

**This backend service** — specifically, whichever private key is loaded as
`CHAINSHIELD_ATTESTOR_SECRET` and set as `attestor` in the contract's
`init()` call ([contracts/src/lib.rs](../contracts/src/lib.rs)). Every
`submit_claim` call on-chain requires `attestor.require_auth()`. The
contract has no way to independently verify a risk score is accurate — it
trusts whatever the attestor key submits, the same way any oracle-fed
contract trusts its oracle.

Concretely: whoever controls that one key can submit any risk score for any
document hash, and the chain will faithfully record it. That's not a flaw
unique to ChainShield — it's true of every "AI decision + blockchain" system
that doesn't run the AI model inside a TEE or a verifiable-compute setup
(neither of which this MVP does). We're naming it instead of hiding it.

## Why doesn't the chain make this "trustless"?

Putting a decision on-chain makes it **tamper-evident after the fact** — once
written, nobody (including us) can quietly edit a past decision or delete an
inconvenient one, and anyone can independently verify the record hasn't
changed. It does **not** make the original decision trustworthy on its own.
Trustlessness would require the risk-scoring logic itself to run somewhere
the chain (or a verifier) can check without trusting us — that's a
meaningfully harder system than an MVP built for a hackathon, and we didn't
build it.

## What's the actual value prop, then?

1. **A tamper-evident audit trail**, not autonomous fund release. Every
   decision — auto-cleared or human-reviewed — gets a permanent, publicly
   checkable record of `{invoice_hash, ngo_id, risk_score, decision,
   reviewer_or_auto, timestamp}` (see [../backend/main.py](../backend/main.py)'s
   `write_chain_record`, the single function allowed to write it).
2. **A cross-funder duplicate registry.** The contract's `DocSeen` map is
   global — a document hash submitted against one funder's grant is visible
   to every other funder's grant, without either funder's books (vendor,
   amount, line items) ever being exposed to the other.
3. **A hard human-in-the-loop gate above a configurable risk threshold.**
   The backend enforces, server-side, that no medium/high-risk claim can be
   marked `cleared_for_disbursement` without a real (non-system) reviewer
   ID — checked at the API route and again independently inside the write
   boundary function itself, so it can't be bypassed by calling the API
   directly.
4. **Real, non-fabricated fund custody in the demo grant mechanism** — the
   Soroban contract's `create_grant`/`settle` calls do move real SAC tokens
   on testnet when actually invoked. What ChainShield does *not* claim is
   that its AI risk score is a trustless, autonomous authority to move that
   money — a human always sits above the auto-approve threshold, and the
   attestor key is a named, documented trust point, not an invisible one.

If a judge asks "so what stops the person who holds that key from just
approving fraud?" — the honest answer is: nothing at the smart-contract
layer. What we've built is the audit trail and the human gate around that
key's use, not a replacement for trusting the organization that holds it.
That's the same trust model most real-world attestation systems (KYC
providers, credit bureaus, notaries) actually run on — we're just making the
resulting record tamper-evident and publicly checkable.
