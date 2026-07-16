"""Signed operator attestations.

The registry claims to be the layer a competitor cannot fork. As plain
data, that claim is empty: anyone can construct an OperatorRegistry and
declare that Shady LLC is KYB-verified. A dict asserts nothing.

What makes a Nobulex registry entry mean more than a random dict is a
signature over it. The attestation says:

    "Nobulex verified that operator X is legal entity Y, to level Z,
     at time T, and that verification expires at E."

A relying party checks that against Nobulex's published key. The data
structure is trivially copied. The signature is not, and that is the
whole moat: attestations, not records.

Two properties worth being explicit about:

**Content-derived.** attestation_ref = SHA-256(JCS({operator_id,
legal_name, verification_level, verified_at_ms, expires_at_ms})). Same
construction as action_ref, for the same reason: any third party
recomputes it from the fields and confirms nothing was edited. Change the
legal name and the ref changes and the signature breaks.

**Expiring.** Verification goes stale. A domain lapses, a registration is
withdrawn, a company is acquired. A KYB check from three years ago is
weaker evidence than one from last month, and an attestation that never
expires is a lie with a long fuse. So expiry is mandatory, not optional,
and a verifier checks freshness separately from validity: those are
different failure modes and collapsing them hides which one broke.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

from nobulex.crypto import KeyPair, jcs_canonicalize, sha256_hex
from nobulex.registry import VerificationLevel

# How long a verification stays fresh, by level. Weaker checks decay
# faster: an email address changes hands more easily than a legal entity.
DEFAULT_VALIDITY_MS = {
    VerificationLevel.UNVERIFIED: 0,
    VerificationLevel.EMAIL: 90 * 24 * 60 * 60 * 1000,        # 90 days
    VerificationLevel.DOMAIN: 180 * 24 * 60 * 60 * 1000,      # 180 days
    VerificationLevel.KYB: 365 * 24 * 60 * 60 * 1000,         # 1 year
}


def compute_attestation_ref(
    operator_id: str,
    legal_name: str,
    verification_level: int,
    verified_at_ms: int,
    expires_at_ms: int,
) -> str:
    """Content-derived identifier for an attestation.

    Deliberately mirrors compute_action_ref: JCS-canonical preimage,
    SHA-256, hex. A verifier who has never talked to us recomputes it
    from the attestation fields alone.
    """
    preimage = jcs_canonicalize(
        {
            "operator_id": operator_id,
            "legal_name": legal_name,
            "verification_level": verification_level,
            "verified_at_ms": verified_at_ms,
            "expires_at_ms": expires_at_ms,
        }
    )
    return sha256_hex(preimage)


@dataclass
class OperatorAttestation:
    """A signed statement that an operator was verified to some level.

    This is what a relying party actually checks. Not "does the registry
    say Acme is verified" but "can I confirm, from bytes alone, that the
    registry authority signed that claim and that it hasn't expired."
    """

    operator_id: str
    legal_name: str
    verification_level: int
    verified_at_ms: int
    expires_at_ms: int
    attestation_ref: str = ""
    signature: str = ""
    signer_public_key: str = ""
    version: str = "nobulex-operator-attestation-v0.1"

    # --- construction ---

    @classmethod
    def issue(
        cls,
        operator_id: str,
        legal_name: str,
        verification: VerificationLevel,
        keys: KeyPair,
        validity_ms: Optional[int] = None,
        verified_at_ms: Optional[int] = None,
    ) -> "OperatorAttestation":
        """Issue a signed attestation. Only a registry authority should call this.

        An UNVERIFIED attestation is refused rather than issued with zero
        validity: signing "I checked nothing" is worse than not signing,
        because the signature lends it weight it has not earned.
        """
        if verification == VerificationLevel.UNVERIFIED:
            raise ValueError(
                "cannot attest to UNVERIFIED: a signature over 'I checked "
                "nothing' implies a check that did not happen"
            )

        now = verified_at_ms if verified_at_ms is not None else int(time.time() * 1000)
        window = validity_ms if validity_ms is not None else DEFAULT_VALIDITY_MS[verification]
        expires = now + window

        ref = compute_attestation_ref(
            operator_id, legal_name, int(verification), now, expires
        )
        att = cls(
            operator_id=operator_id,
            legal_name=legal_name,
            verification_level=int(verification),
            verified_at_ms=now,
            expires_at_ms=expires,
            attestation_ref=ref,
            signer_public_key=keys.public_hex,
        )
        att.signature = keys.sign_hex(att.to_canonical().encode("utf-8"))
        return att

    # --- serialization ---

    def to_canonical(self) -> str:
        """JCS-canonical bytes that get signed."""
        return jcs_canonicalize(
            {
                "operator_id": self.operator_id,
                "legal_name": self.legal_name,
                "verification_level": self.verification_level,
                "verified_at_ms": self.verified_at_ms,
                "expires_at_ms": self.expires_at_ms,
                "attestation_ref": self.attestation_ref,
                "version": self.version,
            }
        )

    def to_dict(self) -> dict:
        return {
            "operator_id": self.operator_id,
            "legal_name": self.legal_name,
            "verification_level": self.verification_level,
            "verified_at_ms": self.verified_at_ms,
            "expires_at_ms": self.expires_at_ms,
            "attestation_ref": self.attestation_ref,
            "signature": self.signature,
            "signer_public_key": self.signer_public_key,
            "version": self.version,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "OperatorAttestation":
        return cls(
            operator_id=d["operator_id"],
            legal_name=d["legal_name"],
            verification_level=d["verification_level"],
            verified_at_ms=d["verified_at_ms"],
            expires_at_ms=d["expires_at_ms"],
            attestation_ref=d.get("attestation_ref", ""),
            signature=d.get("signature", ""),
            signer_public_key=d.get("signer_public_key", ""),
            version=d.get("version", "nobulex-operator-attestation-v0.1"),
        )

    # --- verification ---

    @property
    def level(self) -> VerificationLevel:
        return VerificationLevel(self.verification_level)

    def ref_matches(self) -> bool:
        """Was any field edited after issuance?"""
        return self.attestation_ref == compute_attestation_ref(
            self.operator_id,
            self.legal_name,
            self.verification_level,
            self.verified_at_ms,
            self.expires_at_ms,
        )

    def signature_valid(self) -> bool:
        """Did the claimed signer actually sign these bytes?"""
        if not self.signature or not self.signer_public_key:
            return False
        try:
            return KeyPair.verify_signature(
                bytes.fromhex(self.signer_public_key),
                bytes.fromhex(self.signature),
                self.to_canonical().encode("utf-8"),
            )
        except Exception:
            return False

    def is_fresh(self, now_ms: Optional[int] = None) -> bool:
        """Is the verification still within its validity window?"""
        now = now_ms if now_ms is not None else int(time.time() * 1000)
        return now < self.expires_at_ms

    def verify(
        self,
        trusted_signer: Optional[str] = None,
        now_ms: Optional[int] = None,
    ) -> dict:
        """Full check, reporting each failure mode separately.

        A verifier that collapses these into one boolean cannot tell an
        auditor whether the attestation was forged, edited, expired, or
        issued by someone they don't trust. Those have different incident
        responses, so they get different fields.
        """
        checks = {
            "ref_matches": self.ref_matches(),
            "signature_valid": self.signature_valid(),
            "fresh": self.is_fresh(now_ms),
            "trusted_signer": (
                self.signer_public_key == trusted_signer
                if trusted_signer is not None
                else None
            ),
        }
        required = [checks["ref_matches"], checks["signature_valid"], checks["fresh"]]
        if trusted_signer is not None:
            required.append(checks["trusted_signer"])

        return {
            "valid": all(required),
            "checks": checks,
            "operator_id": self.operator_id,
            "legal_name": self.legal_name,
            "verification": self.level.label,
        }

    def __repr__(self) -> str:
        state = "fresh" if self.is_fresh() else "EXPIRED"
        return (
            f"OperatorAttestation({self.operator_id!r}, "
            f"{self.level.label}, {state})"
        )
