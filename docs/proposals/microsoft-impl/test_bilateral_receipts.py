"""Tests for bilateral receipt extension.

Tests the three new functions: sign_authorization, seal_result,
verify_bilateral_receipt. Uses the same Ed25519 + JCS pattern
as the existing receipt tests in AGT.
"""
import hashlib
import json
from datetime import datetime, timezone

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


# Minimal Signer for standalone testing (mirrors AGT's Signer)
class Signer:
    def __init__(self):
        self.private_key = Ed25519PrivateKey.generate()
        self.kid = "test-key-001"

    def public_key(self):
        return self.private_key.public_key()


# Import the bilateral functions
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from bilateral_receipts import (
    sign_authorization,
    seal_result,
    verify_bilateral_receipt,
)


class TestSignAuthorization:
    """Pre-execution authorization receipts."""

    def test_creates_bilateral_envelope(self):
        signer = Signer()
        payload = {
            "type": "sb-runtime:decision",
            "agent_id": "agent-001",
            "action": "file_system:read_file",
            "decision": "allow",
            "policy_id": "autoresearch-safe",
        }
        envelope = sign_authorization(payload, signer)

        assert envelope["bilateral"] is True
        assert envelope["payload"]["phase"] == "authorization"
        assert envelope["authorization"]["hash"].startswith("sha256:")
        assert envelope["signature"]["alg"] == "EdDSA"
        assert envelope["signature"]["kid"] == "test-key-001"
        assert envelope["result"] is None  # not yet sealed

    def test_chain_linkage(self):
        signer = Signer()
        payload = {"action": "web_search", "decision": "allow"}
        prev_hash = "sha256:abc123"
        envelope = sign_authorization(payload, signer, prev_hash)

        assert envelope["payload"]["previousReceiptHash"] == prev_hash


class TestSealResult:
    """Post-execution result sealing."""

    def test_seals_with_result_data(self):
        signer = Signer()
        payload = {"action": "file_system:read_file", "decision": "allow"}
        envelope = sign_authorization(payload, signer)

        result_data = {
            "status": "success",
            "output_hash": "sha256:deadbeef",
            "bytes_read": 1024,
        }
        sealed = seal_result(envelope, signer, result_data)

        assert sealed["result"] is not None
        assert sealed["result"]["hash"].startswith("sha256:")
        assert sealed["result"]["sig"] is not None
        assert sealed["result"]["sealed_at"] is not None
        assert sealed["result"]["data"] == result_data

    def test_cannot_seal_non_bilateral(self):
        with pytest.raises(ValueError, match="non-bilateral"):
            seal_result({"payload": {}}, Signer(), {})

    def test_cannot_seal_twice(self):
        signer = Signer()
        envelope = sign_authorization(
            {"action": "test", "decision": "allow"}, signer
        )
        sealed = seal_result(envelope, signer, {"status": "ok"})
        with pytest.raises(ValueError, match="already sealed"):
            seal_result(sealed, signer, {"status": "ok again"})


class TestVerifyBilateralReceipt:
    """Verification of both authorization and result signatures."""

    def test_verify_authorization_only(self):
        signer = Signer()
        envelope = sign_authorization(
            {"action": "test", "decision": "allow"}, signer
        )
        result = verify_bilateral_receipt(envelope, signer.public_key())

        assert result["valid"] is True
        assert result["authorization_valid"] is True
        assert result["result_valid"] is None  # not yet sealed
        assert result["bilateral"] is True

    def test_verify_full_bilateral(self):
        signer = Signer()
        envelope = sign_authorization(
            {"action": "web_search", "decision": "allow"}, signer
        )
        sealed = seal_result(envelope, signer, {"status": "success"})
        result = verify_bilateral_receipt(sealed, signer.public_key())

        assert result["valid"] is True
        assert result["authorization_valid"] is True
        assert result["result_valid"] is True
        assert result["bilateral"] is True

    def test_tamper_detection_payload(self):
        """Modifying the payload after signing breaks authorization."""
        signer = Signer()
        envelope = sign_authorization(
            {"action": "shell_exec", "decision": "deny"}, signer
        )
        # Tamper: change deny to allow
        envelope["payload"]["decision"] = "allow"
        result = verify_bilateral_receipt(envelope, signer.public_key())

        assert result["authorization_valid"] is False
        assert result["valid"] is False

    def test_tamper_detection_result(self):
        """Modifying result data after sealing breaks result sig."""
        signer = Signer()
        envelope = sign_authorization(
            {"action": "test", "decision": "allow"}, signer
        )
        sealed = seal_result(envelope, signer, {"output": "real data"})
        # Tamper: change the result data
        sealed["result"]["data"] = {"output": "forged data"}
        # Recompute hash to try to cover tracks
        forged_hash = hashlib.sha256(
            json.dumps({"output": "forged data"},
                       sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        sealed["result"]["hash"] = "sha256:" + forged_hash

        result = verify_bilateral_receipt(sealed, signer.public_key())

        # Authorization still valid (payload unchanged)
        assert result["authorization_valid"] is True
        # Result signature invalid (hash changed, sig doesn't match)
        assert result["result_valid"] is False
        assert result["valid"] is False

    def test_wrong_key_fails(self):
        """Verification with a different key fails."""
        signer1 = Signer()
        signer2 = Signer()
        envelope = sign_authorization(
            {"action": "test", "decision": "allow"}, signer1
        )
        sealed = seal_result(envelope, signer1, {"status": "ok"})
        # Verify with wrong key
        result = verify_bilateral_receipt(sealed, signer2.public_key())

        assert result["authorization_valid"] is False
        assert result["valid"] is False

    def test_deny_receipt(self):
        """Denied actions produce valid bilateral receipts too."""
        signer = Signer()
        envelope = sign_authorization(
            {"action": "delete_file", "decision": "deny"}, signer
        )
        # Deny means no execution, so result is empty
        sealed = seal_result(envelope, signer, {
            "status": "blocked",
            "reason": "policy_deny",
        })
        result = verify_bilateral_receipt(sealed, signer.public_key())
        assert result["valid"] is True
