"""Trust-anchor regression tests.

The verifier must authenticate the AUTHORIZED signer, not the key embedded in
the receipt, and must fail closed when no anchor is supplied. These lock in the
fixes for the receipt-verification trust-root findings.
"""
import json
import tempfile

from nobulex.chain import ReceiptChain, verify_audit_trail
from nobulex.crypto import sha256_hex, compute_action_ref


def _genuine_chain():
    chain = ReceiptChain(agent_id="alice")
    r = chain.append("send_email", scope="user@example.com")
    chain.append("api_call", scope="stripe.com")
    return chain, r.signer_public_key


def _export(chain):
    path = tempfile.mktemp(suffix=".json")
    chain.export(path)
    return path


def test_genuine_trail_authenticates_with_authorized_key():
    chain, legit = _genuine_chain()
    report = verify_audit_trail(_export(chain), authorized_keys=legit)
    assert report["chain_intact"] is True
    assert report["authenticated"] is True


def test_trail_fails_closed_without_anchor():
    chain, _ = _genuine_chain()
    report = verify_audit_trail(_export(chain))
    assert report["chain_intact"] is False


def test_forged_unsigned_trail_is_rejected():
    chain, legit = _genuine_chain()

    def fake(i, prev, atype, scope, ts):
        ar = compute_action_ref("alice", atype, scope, ts)
        ch = sha256_hex(prev + ar)
        entry = {
            "index": i,
            "receipt": {
                "agent_id": "alice", "action_type": atype, "scope": scope,
                "timestamp_ms": ts, "verdict": "ALLOW", "action_ref": ar,
                "version": "nobulex-receipt-v0.1",
            },
            "prev_hash": prev, "chain_hash": ch,
        }
        return entry, ch

    e0, h0 = fake(0, "0" * 64, "exfiltrate", "secrets.db", 1700000000000)
    e1, _ = fake(1, h0, "wire_transfer", "attacker", 1700000001000)
    path = tempfile.mktemp(suffix=".json")
    json.dump({"agent_id": "alice", "entries": [e0, e1]}, open(path, "w"))
    report = verify_audit_trail(path, authorized_keys=legit)
    assert report["chain_intact"] is False


def test_attacker_signed_trail_rejected_under_legit_key():
    chain, legit = _genuine_chain()
    attacker = ReceiptChain(agent_id="alice")
    attacker.append("exfiltrate", scope="secrets.db")
    report = verify_audit_trail(_export(attacker), authorized_keys=legit)
    assert report["chain_intact"] is False


def test_receipt_verify_enforces_authorized_key():
    chain, legit = _genuine_chain()
    receipt = chain._chain[0]["receipt"]
    attacker_key = ReceiptChain(agent_id="alice").append("x", "y").signer_public_key
    assert receipt.verify(legit) is True
    assert receipt.verify(attacker_key) is False
    # Backward compatible: with no anchor, still proves self-consistency.
    assert receipt.verify() is True
