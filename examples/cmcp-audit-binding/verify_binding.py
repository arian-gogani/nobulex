#!/usr/bin/env python3
"""Verify a Nobulex receipt's signed reference to a cMCP audit-chain entry."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from nobulex.receipt import Receipt


FIXTURE = Path(__file__).with_name("fixture.json")
# Public key for this public, deterministic demo specimen. It is a fixture key,
# not a production trust root.
TRUSTED_NOBULEX_KEY = "00e3c56b91ab0a017174b96645eaf928366cdbae1e87fd21bf86661d86f3e7ef"


def cmcp_entry_hash(entry: dict[str, Any]) -> str:
    """Match cMCP AuditEntry.compute_hash() at the fixture's pinned revision."""
    body = {key: value for key, value in entry.items() if key != "entry_hash"}
    canonical = json.dumps(
        body, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def verify_binding(document: dict[str, Any]) -> tuple[bool, str]:
    """Return an explicit result, rejecting malformed or mismatched evidence."""
    try:
        entries = document["cmcp_audit_entries"]
        if not isinstance(entries, list) or not entries:
            return False, "CMCP_CHAIN_MISSING"

        previous_hash = "genesis"
        for sequence, entry in enumerate(entries):
            if not isinstance(entry, dict):
                return False, "CMCP_ENTRY_MALFORMED"
            if entry.get("sequence_number") != sequence:
                return False, "CMCP_SEQUENCE_MISMATCH"
            if entry.get("prev_entry_hash") != previous_hash:
                return False, "CMCP_PREVIOUS_HASH_MISMATCH"
            if entry.get("entry_hash") != cmcp_entry_hash(entry):
                return False, "CMCP_ENTRY_HASH_MISMATCH"
            previous_hash = entry["entry_hash"]

        call_entries = [entry for entry in entries if entry.get("entry_type") == "tool_call"]
        if len(call_entries) != 1:
            return False, "CMCP_TOOL_CALL_COUNT"
        entry = call_entries[0]

        receipt = Receipt.from_dict(document["nobulex_receipt"])
        if not receipt.verify(authorized_keys=TRUSTED_NOBULEX_KEY):
            return False, "NOBULEX_SIGNATURE_INVALID"

        metadata = receipt.metadata
        if metadata.get("cmcp_entry_hash") != entry.get("entry_hash"):
            return False, "RECEIPT_ENTRY_HASH_MISMATCH"
        if metadata.get("cmcp_entry_id") != entry.get("entry_id"):
            return False, "RECEIPT_ENTRY_ID_MISMATCH"
        if metadata.get("cmcp_call_id") != entry.get("call_id"):
            return False, "RECEIPT_CALL_ID_MISMATCH"
        if metadata.get("cmcp_session_id") != entry.get("session_id"):
            return False, "RECEIPT_SESSION_ID_MISMATCH"
        if receipt.action_type != entry.get("tool_name"):
            return False, "RECEIPT_ACTION_MISMATCH"
        expected_scope = f"cmcp://session/{entry['session_id']}/call/{entry['call_id']}"
        if receipt.scope != expected_scope:
            return False, "RECEIPT_SCOPE_MISMATCH"
        expected_verdict = {"allow": "ALLOW", "deny": "DENY"}.get(
            entry.get("policy_decision")
        )
        if expected_verdict is None or receipt.verdict != expected_verdict:
            return False, "RECEIPT_VERDICT_MISMATCH"
        return True, "BOUND_AND_VERIFIED"
    except (KeyError, TypeError, ValueError):
        return False, "EVIDENCE_MALFORMED"


def load_fixture() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def main() -> int:
    document = load_fixture()
    valid, reason = verify_binding(document)
    print(f"control: {'PASS' if valid else 'FAIL'} ({reason})")

    mutated = json.loads(json.dumps(document))
    call_entry = next(
        entry for entry in mutated["cmcp_audit_entries"]
        if entry.get("entry_type") == "tool_call"
    )
    call_entry["call_id"] = "00000000-0000-4000-8000-000000000001"
    # Recompute the cMCP entry hash to model a self-consistent but different
    # audit entry. The already-signed Nobulex receipt still pins the old hash.
    call_entry["entry_hash"] = cmcp_entry_hash(call_entry)
    valid, reason = verify_binding(mutated)
    print(f"mismatched call: {'PASS' if not valid else 'FAIL'} ({reason})")

    return 0 if reason == "RECEIPT_ENTRY_HASH_MISMATCH" else 1


if __name__ == "__main__":
    raise SystemExit(main())
