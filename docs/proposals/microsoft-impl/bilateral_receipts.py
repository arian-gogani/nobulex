# Bilateral Receipt Extension for AGT
# This file contains the functions to add to sb_runtime_agentmesh/receipts.py
# for the scoping PR to microsoft/agent-governance-toolkit
#
# These functions extend the existing sign_receipt/verify_receipt with
# bilateral signing: authorization (pre-execution) + result (post-execution)

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Mapping, Optional

# These would be imported from the existing receipts.py in the actual PR:
# from sb_runtime_agentmesh.receipts import (
#     Signer, _canonicalize, _b64url, _b64url_decode,
#     sign_receipt, verify_receipt, receipt_hash,
# )


def _canonicalize(obj: Any) -> bytes:
    """RFC 8785 JCS canonical form. Copied from existing receipts.py."""
    return json.dumps(
        obj,
        sort_keys=True,
        ensure_ascii=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


# ------------------------------------------------------------------ #
# Bilateral receipt functions (NEW)                                    #
# ------------------------------------------------------------------ #

def sign_authorization(
    payload: Mapping[str, Any],
    signer: "Signer",
    previous_receipt_hash: Optional[str] = None,
) -> dict:
    """Sign a pre-execution authorization receipt.

    Identical to sign_receipt() but marks the envelope as phase="authorization".
    The authorization proves the policy was evaluated BEFORE the action ran.

    Returns a bilateral envelope that can be sealed with seal_result() after
    the tool call completes.
    """
    final_payload = dict(payload)
    final_payload["phase"] = "authorization"
    final_payload.setdefault(
        "issued_at",
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    )
    if previous_receipt_hash is not None:
        final_payload["previousReceiptHash"] = previous_receipt_hash

    canonical = _canonicalize(final_payload)
    authorization_hash = hashlib.sha256(canonical).hexdigest()

    signature = signer.private_key.sign(canonical)

    return {
        "payload": final_payload,
        "authorization": {
            "hash": "sha256:" + authorization_hash,
            "sig": _b64url(signature),
        },
        "signature": {
            "alg": "EdDSA",
            "kid": signer.kid,
            "sig": _b64url(signature),
        },
        "bilateral": True,
        "result": None,  # sealed after execution
    }


def seal_result(
    envelope: dict,
    signer: "Signer",
    result_data: Mapping[str, Any],
) -> dict:
    """Seal a bilateral receipt with post-execution result data.

    Called after the tool call completes. Binds the actual outcome to the
    authorization that preceded it.

    The result_signature covers both the authorization_hash and the
    result_hash, proving that:
      1. The authorization existed before execution
      2. The result was produced after execution
      3. Both were signed by the same key

    Args:
        envelope: The bilateral envelope from sign_authorization()
        signer: The same Signer used for authorization
        result_data: The tool call result (output, status, metadata)

    Returns:
        The sealed bilateral envelope with both signatures
    """
    if not envelope.get("bilateral"):
        raise ValueError("Cannot seal a non-bilateral receipt")
    if envelope.get("result") is not None:
        raise ValueError("Receipt already sealed")

    result_canonical = _canonicalize(result_data)
    result_hash = "sha256:" + hashlib.sha256(result_canonical).hexdigest()

    auth_hash = envelope["authorization"]["hash"]

    # Sign over the binding: authorization_hash || result_hash
    binding = f"{auth_hash}:{result_hash}".encode("utf-8")
    result_signature = signer.private_key.sign(binding)

    sealed_at = (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )

    envelope["result"] = {
        "hash": result_hash,
        "sig": _b64url(result_signature),
        "sealed_at": sealed_at,
        "data": result_data,
    }

    return envelope


def verify_bilateral_receipt(
    envelope: Mapping[str, Any],
    public_key: "Ed25519PublicKey",
) -> dict:
    """Verify a bilateral receipt: both authorization and result signatures.

    Returns a dict with verification status for each phase:
        {
            "valid": True/False,
            "authorization_valid": True/False,
            "result_valid": True/False (or None if not yet sealed),
            "bilateral": True/False,
        }

    Falls back to standard verify_receipt() for non-bilateral envelopes.
    """
    from cryptography.exceptions import InvalidSignature

    if not envelope.get("bilateral"):
        # Fallback: standard single-signature verification
        std_valid = verify_receipt(envelope, public_key)
        return {
            "valid": std_valid,
            "authorization_valid": std_valid,
            "result_valid": None,
            "bilateral": False,
        }

    # Phase 1: verify authorization signature
    auth_valid = False
    payload = envelope.get("payload")
    auth = envelope.get("authorization", {})
    sig_section = envelope.get("signature", {})

    if payload and sig_section.get("sig"):
        canonical = _canonicalize(payload)
        try:
            public_key.verify(
                _b64url_decode(sig_section["sig"]),
                canonical,
            )
            auth_valid = True
        except InvalidSignature:
            auth_valid = False

    # Phase 2: verify result signature (if sealed)
    result = envelope.get("result")
    result_valid = None

    if result is not None and result.get("sig"):
        auth_hash = auth.get("hash", "")
        result_hash = result.get("hash", "")
        binding = f"{auth_hash}:{result_hash}".encode("utf-8")
        try:
            public_key.verify(
                _b64url_decode(result["sig"]),
                binding,
            )
            result_valid = True
        except InvalidSignature:
            result_valid = False

    overall = auth_valid and (result_valid is not False)

    return {
        "valid": overall,
        "authorization_valid": auth_valid,
        "result_valid": result_valid,
        "bilateral": True,
    }


# ------------------------------------------------------------------ #
# Helper for _b64url (duplicated here for standalone testing;         #
# in the actual PR these come from the existing receipts.py)          #
# ------------------------------------------------------------------ #

import base64

def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def _b64url_decode(s: str) -> bytes:
    pad = 4 - (len(s) % 4)
    if pad != 4:
        s = s + ("=" * pad)
    return base64.urlsafe_b64decode(s)
