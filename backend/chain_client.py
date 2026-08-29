"""
Real Soroban contract integration for anchoring decision records on-chain.

This module is only imported (and only does anything) when both
CHAINSHIELD_CONTRACT_ID and CHAINSHIELD_ATTESTOR_SECRET are set — see
main.py's _anchor_on_chain(). Until you deploy contracts/src/lib.rs to
testnet and set those two env vars, write_chain_record() still writes the
restricted 5-field record to SQLite (the source of truth for the demo UI and
the public transparency route) but chain_anchor stays "not_configured"
rather than a fabricated transaction hash.

This is intentionally the ONLY file that imports stellar_sdk / talks to the
network — keep it that way so the trust boundary documented in
docs/ORACLE_TRUST.md stays auditable in one place.
"""
import hashlib

from stellar_sdk import Keypair, SorobanServer, TransactionBuilder, scval
from stellar_sdk.exceptions import PrepareTransactionException

RPC_URL_DEFAULT = "https://soroban-testnet.stellar.org"
NETWORK_PASSPHRASE_DEFAULT = "Test SDF Network ; September 2015"

# Maps our decision strings to the contract's ClaimStatus-adjacent inputs.
# submit_claim() on-chain takes a risk score and derives pending/duplicate
# itself; settle()/freeze() are separate calls a funder/attestor makes once
# the challenge window is known. See contracts/src/lib.rs.
_DECISION_TO_RISK_HINT = {
    "cleared_for_disbursement": 0,
    "pending_review": 100,
    "rejected": 100,
}


def _doc_hash_bytes(invoice_hash_hex: str) -> bytes:
    # invoice_hash is already a sha256 hex digest of the raw file; the
    # contract's doc_hash field is a BytesN<32>, so decode straight through.
    return bytes.fromhex(invoice_hash_hex)


def submit_decision_to_chain(*, contract_id: str, attestor_secret: str, invoice_hash: str, risk_score: int, decision: str) -> str:
    """
    Calls ChainShield::submit_claim on the deployed Soroban contract using
    the attestor key. Returns the transaction hash on success. Raises on any
    failure — callers (main.py) catch and record the error string rather
    than letting a chain hiccup break the HTTP response to the demo user.

    NOTE: this requires grant_id/milestone/amount context that the current
    restricted write boundary does not carry (by design — amount is not one
    of the five allowed fields). Wire the actual grant_id/milestone lookup
    here once grants are created via ChainShield::create_grant; until then
    this function demonstrates the real call shape and will raise a clear
    NotImplementedError rather than silently no-op.
    """
    raise NotImplementedError(
        "submit_decision_to_chain: wire grant_id/milestone lookup for this ngo_id before enabling live "
        "on-chain anchoring. The SQLite chain_records table (written by write_chain_record) remains the "
        "source of truth for the demo until this is completed and CHAINSHIELD_CONTRACT_ID / "
        "CHAINSHIELD_ATTESTOR_SECRET are set to a real deployed contract."
    )

    # --- Reference implementation shape (kept for when grant/milestone
    # lookup is wired) ---
    # server = SorobanServer(RPC_URL_DEFAULT)
    # kp = Keypair.from_secret(attestor_secret)
    # source = server.load_account(kp.public_key)
    # tx = (
    #     TransactionBuilder(source, NETWORK_PASSPHRASE_DEFAULT, base_fee=100)
    #     .add_time_bounds(0, 0)
    #     .append_invoke_contract_function_op(
    #         contract_id=contract_id,
    #         function_name="submit_claim",
    #         parameters=[
    #             scval.to_uint32(grant_id),
    #             scval.to_uint32(milestone),
    #             scval.to_bytes(_doc_hash_bytes(invoice_hash)),
    #             scval.to_int128(amount),
    #             scval.to_uint32(risk_score),
    #         ],
    #     )
    #     .build()
    # )
    # prepared = server.prepare_transaction(tx)
    # prepared.sign(kp)
    # response = server.send_transaction(prepared)
    # return response.hash
