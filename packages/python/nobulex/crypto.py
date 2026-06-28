"""Cryptographic primitives for Nobulex receipts."""

import hashlib
import json
from typing import Optional, Union

import rfc8785
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.asymmetric.ec import (
    ECDSA,
    EllipticCurvePrivateKey,
    EllipticCurvePublicKey,
    SECP256R1,
    generate_private_key,
)
from cryptography.hazmat.primitives import hashes, serialization


class KeyPair:
    """Ed25519 key pair for signing and verifying receipts."""

    algorithm = "ed25519"

    def __init__(self, private_key: Optional[Ed25519PrivateKey] = None):
        if private_key is None:
            private_key = Ed25519PrivateKey.generate()
        self._private = private_key
        self._public = private_key.public_key()

    @property
    def public_bytes(self) -> bytes:
        return self._public.public_bytes(
            serialization.Encoding.Raw,
            serialization.PublicFormat.Raw,
        )

    @property
    def public_hex(self) -> str:
        return self.public_bytes.hex()

    def sign(self, data: bytes) -> bytes:
        return self._private.sign(data)

    def sign_hex(self, data: bytes) -> str:
        return self.sign(data).hex()

    @staticmethod
    def verify_signature(
        public_bytes: bytes, signature: bytes, data: bytes
    ) -> bool:
        try:
            pub = Ed25519PublicKey.from_public_bytes(public_bytes)
            pub.verify(signature, data)
            return True
        except Exception:
            return False

    @classmethod
    def from_seed(cls, seed: bytes) -> "KeyPair":
        """Create a key pair from a 32-byte seed (deterministic)."""
        private_key = Ed25519PrivateKey.from_private_bytes(seed)
        return cls(private_key)


class ES256KeyPair:
    """ECDSA P-256 (ES256) key pair for x402-compatible receipts."""

    algorithm = "es256"

    def __init__(self, private_key: Optional[EllipticCurvePrivateKey] = None):
        if private_key is None:
            private_key = generate_private_key(SECP256R1())
        self._private = private_key
        self._public = private_key.public_key()

    @property
    def public_bytes(self) -> bytes:
        return self._public.public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )

    @property
    def public_hex(self) -> str:
        return self.public_bytes.hex()

    def sign(self, data: bytes) -> bytes:
        return self._private.sign(data, ECDSA(hashes.SHA256()))

    def sign_hex(self, data: bytes) -> str:
        return self.sign(data).hex()

    @staticmethod
    def verify_signature(
        public_bytes: bytes, signature: bytes, data: bytes
    ) -> bool:
        try:
            from cryptography.hazmat.primitives.asymmetric.ec import (
                EllipticCurvePublicKey,
            )
            from cryptography.hazmat.primitives.asymmetric.utils import (
                decode_dss_signature,
            )
            pub = EllipticCurvePublicKey.from_encoded_point(
                SECP256R1(), public_bytes
            )
            pub.verify(signature, data, ECDSA(hashes.SHA256()))
            return True
        except Exception:
            return False

    @classmethod
    def from_pem(cls, pem_data: bytes) -> "ES256KeyPair":
        """Load from PEM-encoded private key."""
        private_key = serialization.load_pem_private_key(pem_data, password=None)
        return cls(private_key)


def jcs_canonicalize(obj: dict) -> str:
    """
    JSON Canonicalization Scheme (RFC 8785).
    Uses the rfc8785 package for strict conformance.
    """
    return rfc8785.dumps(obj).decode("utf-8")


def sha256_hex(data: str) -> str:
    """SHA-256 hash of a string, returned as lowercase hex."""
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def compute_action_ref(
    agent_id: str, action_type: str, scope: str, timestamp_ms: int
) -> str:
    """
    Compute the action_ref hash from receipt preimage fields.
    action_ref = SHA-256(JCS({agent_id, action_type, scope, timestamp_ms}))
    """
    preimage = {
        "agent_id": agent_id,
        "action_type": action_type,
        "scope": scope,
        "timestamp_ms": timestamp_ms,
    }
    canonical = jcs_canonicalize(preimage)
    return sha256_hex(canonical)
