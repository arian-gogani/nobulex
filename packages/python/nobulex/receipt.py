"""Receipt generation and verification for Nobulex."""

import time
from dataclasses import dataclass, field, asdict
from typing import Optional, Literal

from nobulex.crypto import (
    KeyPair,
    jcs_canonicalize,
    sha256_hex,
    compute_action_ref,
)


@dataclass
class Receipt:
    """
    A tamper-proof cryptographic receipt for an AI agent action.
    
    Every receipt proves:
    - WHO acted (agent_id)
    - WHAT they did (action_type)  
    - ON WHAT (scope)
    - WHEN (timestamp_ms)
    - WHETHER it was allowed (verdict)
    - WHO verified it (signer)
    """

    agent_id: str
    action_type: str
    scope: str
    timestamp_ms: int
    verdict: Literal["ALLOW", "DENY"] = "ALLOW"
    action_ref: str = ""
    signature: str = ""
    signer_public_key: str = ""
    version: str = "nobulex-receipt-v0.1"
    policy_version: str = ""
    attempt_id: str = ""
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Convert receipt to dictionary (excludes empty fields)."""
        d = asdict(self)
        return {k: v for k, v in d.items() if v != "" and v != {}}

    def to_canonical(self) -> str:
        """JCS-canonical JSON representation (for hashing/signing)."""
        signable = {
            "agent_id": self.agent_id,
            "action_type": self.action_type,
            "scope": self.scope,
            "timestamp_ms": self.timestamp_ms,
            "verdict": self.verdict,
            "action_ref": self.action_ref,
            "version": self.version,
        }
        if self.policy_version:
            signable["policy_version"] = self.policy_version
        if self.attempt_id:
            signable["attempt_id"] = self.attempt_id
        if self.metadata:
            signable["metadata"] = self.metadata
        return jcs_canonicalize(signable)

    def verify(self, authorized_keys=None) -> bool:
        """Verify the receipt's cryptographic signature.

        If authorized_keys is supplied (a hex public key or a list of them), the
        signature is checked against those PINNED keys and a receipt whose
        signer_public_key is not among them is rejected. This is the trust-root
        check: it proves the receipt was signed by an authorized key, not merely
        that it is internally self-consistent.

        With no authorized_keys, this only confirms the signature is consistent
        with the embedded signer_public_key (self-consistency, not authority).
        Pass authorized_keys wherever the legitimate signer key is known.
        """
        if not self.signature or not self.signer_public_key:
            return False
        if authorized_keys is not None:
            allowed = (
                {authorized_keys}
                if isinstance(authorized_keys, str)
                else set(authorized_keys)
            )
            if self.signer_public_key not in allowed:
                return False
        try:
            canonical = self.to_canonical()
            return KeyPair.verify_signature(
                bytes.fromhex(self.signer_public_key),
                bytes.fromhex(self.signature),
                canonical.encode("utf-8"),
            )
        except Exception:
            return False

    def to_json(self) -> str:
        """Serialize receipt to JSON string."""
        import json
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_dict(cls, data: dict) -> "Receipt":
        """Create a Receipt from a dictionary."""
        return cls(
            agent_id=data["agent_id"],
            action_type=data["action_type"],
            scope=data.get("scope", ""),
            timestamp_ms=data["timestamp_ms"],
            verdict=data.get("verdict", "ALLOW"),
            action_ref=data.get("action_ref", ""),
            signature=data.get("signature", ""),
            signer_public_key=data.get("signer_public_key", ""),
            version=data.get("version", "nobulex-receipt-v0.1"),
            policy_version=data.get("policy_version", ""),
            attempt_id=data.get("attempt_id", ""),
            metadata=data.get("metadata", {}),
        )

    @classmethod
    def create(
        cls,
        agent_id: str,
        action_type: str,
        scope: str,
        keys: KeyPair,
        verdict: str = "ALLOW",
        timestamp_ms: Optional[int] = None,
        metadata: Optional[dict] = None,
        policy_version: str = "",
        attempt_id: str = "",
    ) -> "Receipt":
        """
        Create and sign a new receipt.

        Args:
            agent_id: The agent's identifier
            action_type: What the agent did (e.g., "send_email", "api_call")
            scope: What resource was acted on
            keys: KeyPair used to sign the receipt
            verdict: "ALLOW" or "DENY"
            timestamp_ms: Unix epoch milliseconds (auto-generated if omitted)
            metadata: Optional additional data

        Returns:
            A signed Receipt
        """
        if timestamp_ms is None:
            timestamp_ms = int(time.time() * 1000)

        action_ref = compute_action_ref(
            agent_id, action_type, scope, timestamp_ms
        )

        receipt = cls(
            agent_id=agent_id,
            action_type=action_type,
            scope=scope,
            timestamp_ms=timestamp_ms,
            verdict=verdict,
            action_ref=action_ref,
            signer_public_key=keys.public_hex,
            policy_version=policy_version,
            attempt_id=attempt_id,
            metadata=metadata or {},
        )

        canonical = receipt.to_canonical()
        receipt.signature = keys.sign_hex(canonical.encode("utf-8"))
        return receipt

    def __repr__(self) -> str:
        status = "verified" if self.verify() else "unverified"
        return (
            f"Receipt(agent={self.agent_id!r}, "
            f"action={self.action_type!r}, "
            f"verdict={self.verdict}, "
            f"status={status})"
        )
