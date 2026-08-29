# ChainShield facts

Verified 2026-08-29. Build Soroban contracts with `stellar contract build` for
`wasm32v1-none`; do not use `cargo build`. The project pins `soroban-sdk` 26.1.1.

The token argument is a Stellar Asset Contract address, not a `G...` issuer.
Derive it with `stellar contract id asset --network testnet --asset USDC:<issuer>`.

Before frontend integration: build the Wasm, deploy to testnet, and verify a grant,
a payout, and a cross-funder duplicate rejection in Stellar Expert.
