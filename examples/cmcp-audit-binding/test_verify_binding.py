from __future__ import annotations

import json
import unittest

from verify_binding import cmcp_entry_hash, load_fixture, verify_binding


class ReceiptBindingTests(unittest.TestCase):
    def test_pinned_cMCP_chain_and_receipt_verify(self) -> None:
        ok, reason = verify_binding(load_fixture())
        self.assertTrue(ok, reason)
        self.assertEqual(reason, "BOUND_AND_VERIFIED")

    def test_changed_call_with_recomputed_cMCP_hash_is_rejected_by_receipt(self) -> None:
        document = json.loads(json.dumps(load_fixture()))
        call_entry = next(
            entry for entry in document["cmcp_audit_entries"]
            if entry["entry_type"] == "tool_call"
        )
        call_entry["call_id"] = "00000000-0000-4000-8000-000000000001"
        call_entry["entry_hash"] = cmcp_entry_hash(call_entry)
        ok, reason = verify_binding(document)
        self.assertFalse(ok)
        self.assertEqual(reason, "RECEIPT_ENTRY_HASH_MISMATCH")

    def test_changed_audit_entry_with_recomputed_hash_is_not_the_signed_entry(self) -> None:
        document = json.loads(json.dumps(load_fixture()))
        call_entry = next(
            entry for entry in document["cmcp_audit_entries"]
            if entry["entry_type"] == "tool_call"
        )
        call_entry["policy_rule_matched"] = "different-rule"
        call_entry["entry_hash"] = cmcp_entry_hash(call_entry)
        ok, reason = verify_binding(document)
        self.assertFalse(ok)
        self.assertEqual(reason, "RECEIPT_ENTRY_HASH_MISMATCH")

    def test_changed_entry_without_rehash_is_rejected_by_cMCP_chain_check(self) -> None:
        document = json.loads(json.dumps(load_fixture()))
        call_entry = next(
            entry for entry in document["cmcp_audit_entries"]
            if entry["entry_type"] == "tool_call"
        )
        call_entry["call_id"] = "00000000-0000-4000-8000-000000000001"
        ok, reason = verify_binding(document)
        self.assertFalse(ok)
        self.assertEqual(reason, "CMCP_ENTRY_HASH_MISMATCH")

    def test_modified_receipt_metadata_breaks_signature(self) -> None:
        document = json.loads(json.dumps(load_fixture()))
        document["nobulex_receipt"]["metadata"]["cmcp_call_id"] = (
            "00000000-0000-4000-8000-000000000001"
        )
        ok, reason = verify_binding(document)
        self.assertFalse(ok)
        self.assertEqual(reason, "NOBULEX_SIGNATURE_INVALID")


if __name__ == "__main__":
    unittest.main()
