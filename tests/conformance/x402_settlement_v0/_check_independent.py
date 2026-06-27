#!/usr/bin/env python3
"""Independent checker for the x402 <-> Vaara accountability mapping, across an
action lifecycle, on two rails (generic and Sui exact-scheme).

Imports only the standard library plus ``cryptography`` and ``rfc8785``. It does
not import Vaara. For each rail it reads the committed step0 (in-progress) and
step1 (terminal) fixtures and reproduces, per step, three verdicts a third party
can confirm with only the settlement and the receipt in hand:

  action_ref_recomputes        sha256 over the JCS-canonical action tuple
                               (agentId, actionType, scope, timestampMs, seq,
                               terminal) equals settlement.actionRef, the join
                               key. Nothing rail-specific enters the tuple.
  settlement_binding_resolves  sha256 over the JCS-canonical settlement record
                               equals the receipt's evidenceRef.digest.
  receipt_signature_ok         the ES256 signature verifies over the canonical
                               (version, alg, backLink, decisionDerived,
                               issuerAsserted) blocks against the public key.

And one cross-step verdict per rail:

  lifecycle_distinguishes_terminal
                               the in-progress and terminal steps have distinct
                               action_refs, carry terminal=false / terminal=true,
                               and the in-progress receipt does not resolve
                               against the terminal settlement. A mid-task
                               receipt cannot be passed off as the final one.

The Sui rail binds the facilitator's verified settlement result (the Sui tx
digest plus value/recipient asserted from the net balance change to payTo), not
a re-derivation from the transaction, so the same recompute holds without the
join key reaching into the PTB.

Run: python tests/vectors/x402_settlement_v0/_check_independent.py
Exit 0 means every verdict matched expected.json.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import rfc8785
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

HERE = Path(__file__).resolve().parent
KEYS = HERE / "keys"
_DECISION_BLOCKS = ("version", "alg", "backLink", "decisionDerived",
                    "issuerAsserted")
_ACTION_KEYS = ("agentId", "actionType", "scope", "timestampMs", "seq",
                "terminal")
_RAILS = ("generic", "sui")


def _jcs(obj) -> bytes:
    return rfc8785.dumps(obj)


def _sha256_hex(content: bytes) -> str:
    return "sha256:" + hashlib.sha256(content).hexdigest()


def action_ref_recomputes(settlement: dict) -> bool:
    action = {k: settlement[k] for k in _ACTION_KEYS}
    return _sha256_hex(_jcs(action)) == settlement["actionRef"]


def settlement_binding_resolves(receipt: dict, settlement: dict) -> bool:
    ref = receipt.get("decisionDerived", {}).get("evidenceRef")
    if not isinstance(ref, dict) or ref.get("canonicalization") != "JCS":
        return False
    return _sha256_hex(_jcs(settlement)) == ref.get("digest")


def receipt_signature_ok(receipt: dict) -> bool:
    if receipt.get("alg") != "ES256":
        return False
    sig = receipt.get("signature", "")
    if len(sig) != 128:
        return False
    payload = _jcs({k: receipt[k] for k in _DECISION_BLOCKS})
    pub = serialization.load_pem_public_key(
        (KEYS / "es256_public.pem").read_bytes())
    raw = bytes.fromhex(sig)
    der = encode_dss_signature(
        int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    try:
        pub.verify(der, payload, ec.ECDSA(hashes.SHA256()))
        return True
    except InvalidSignature:
        return False


def _step_verdicts(settlement: dict, receipt: dict) -> dict:
    return {
        "action_ref_recomputes": action_ref_recomputes(settlement),
        "settlement_binding_resolves": settlement_binding_resolves(
            receipt, settlement),
        "receipt_signature_ok": receipt_signature_ok(receipt),
    }


def lifecycle_distinguishes_terminal(s0: dict, r0: dict, s1: dict) -> bool:
    # distinct join keys for the two lifecycle points
    if s0["actionRef"] == s1["actionRef"]:
        return False
    # the tuple carries an explicit, opposite terminal flag
    if s0.get("terminal") is not False or s1.get("terminal") is not True:
        return False
    # the in-progress receipt does not resolve against the terminal settlement:
    # a mid-task receipt cannot be presented where the final one is required
    ref0 = r0.get("decisionDerived", {}).get("evidenceRef", {})
    return _sha256_hex(_jcs(s1)) != ref0.get("digest")


def _load(rail: str, step: str, name: str) -> dict:
    return json.loads((HERE / rail / step / name).read_text())


def _rail_verdicts(rail: str) -> dict:
    s0 = _load(rail, "step0", "settlement.json")
    r0 = _load(rail, "step0", "receipt.json")
    s1 = _load(rail, "step1", "settlement.json")
    r1 = _load(rail, "step1", "receipt.json")
    return {
        "step0": _step_verdicts(s0, r0),
        "step1": _step_verdicts(s1, r1),
        "lifecycle_distinguishes_terminal": lifecycle_distinguishes_terminal(
            s0, r0, s1),
    }


def main() -> int:
    expected = json.loads((HERE / "expected.json").read_text())
    got = {rail: _rail_verdicts(rail) for rail in _RAILS}
    ok = got == expected
    for rail in _RAILS:
        for step in ("step0", "step1"):
            for k, v in got[rail][step].items():
                print(f"[{'OK' if v else 'FAIL'}] {rail}.{step}.{k}: {v}")
        lv = got[rail]["lifecycle_distinguishes_terminal"]
        print(f"[{'OK' if lv else 'FAIL'}] {rail}.lifecycle_distinguishes_terminal: {lv}")
    print(f"\n{'all verdicts matched expected' if ok else 'MISMATCH vs expected'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
