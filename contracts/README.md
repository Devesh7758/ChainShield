# ChainShield contract (Soroban / Stellar)

The real on-chain component. See [src/lib.rs](src/lib.rs). Read
[../docs/ORACLE_TRUST.md](../docs/ORACLE_TRUST.md) before presenting this —
it explains what the `attestor` key does and does not guarantee.

## What it does

- `create_grant` — a funder deposits real tokens (a Stellar Asset Contract)
  into escrow against a named set of milestones. This is real custody, not
  simulated.
- `submit_claim` — the configured `attestor` submits a claim's document hash,
  amount, and risk score for a milestone. Requires `attestor.require_auth()`
  — see the trust-assumption doc. Duplicate document hashes are blocked
  globally (`DocSeen`), across grants/funders, without exposing either
  funder's claim details to the other.
- Claims at or above `risk_threshold` get a `challenge_secs` window during
  which the funder may `freeze` them; below it, they become settleable
  immediately. `settle` pays the milestone amount to the NGO once the window
  has passed and the claim hasn't been frozen.
- `get_stats` returns aggregate counters (grants, escrowed, released,
  auto-released, flagged, duplicates blocked, frozen) for a dashboard.

## Build & test

```sh
stellar contract build      # NOT `cargo build` — see docs/FACTS.md
cargo test -p chainshield
```

## Deploying to testnet

1. Build the Wasm (`stellar contract build`).
2. Deploy: `stellar contract deploy --wasm target/wasm32v1-none/release/chainshield.wasm --network testnet`
3. Derive the SAC token address for the asset you're testing with:
   `stellar contract id asset --network testnet --asset USDC:<issuer>`
   (the `token` argument to `create_grant` is this contract address, not a
   `G...` issuer account).
4. `init` with your attestor address, a `risk_threshold`, and
   `challenge_secs` (use a short value like 45s for demos; production should
   use something like 259200 = 72h, per [scripts/demo.sh](scripts/demo.sh)).
5. Verify a grant creation, a settlement, and a cross-funder duplicate
   rejection in Stellar Expert before wiring the frontend/backend to a live
   contract ID.

## Backend wiring

[../backend/chain_client.py](../backend/chain_client.py) is the only backend
module that talks to this contract. It's inert until
`CHAINSHIELD_CONTRACT_ID` and `CHAINSHIELD_ATTESTOR_SECRET` are set — see
that file's docstring for what's left to wire (grant/milestone lookup) before
enabling live anchoring end-to-end.
