"""Tests for signed operator attestations."""
import copy
import time

import pytest

from nobulex.attestation import (
    OperatorAttestation,
    compute_attestation_ref,
    DEFAULT_VALIDITY_MS,
)
from nobulex.crypto import KeyPair
from nobulex.registry import VerificationLevel


@pytest.fixture
def authority():
    return KeyPair()


@pytest.fixture
def att(authority):
    return OperatorAttestation.issue(
        "acme", "Acme Corporation", VerificationLevel.KYB, authority
    )


# --- issuance ---

def test_issue_produces_valid_attestation(authority, att):
    r = att.verify(trusted_signer=authority.public_hex)
    assert r["valid"]
    assert all(v for v in r["checks"].values())


def test_refuses_to_attest_to_unverified(authority):
    """Signing 'I checked nothing' lends weight the check never earned."""
    with pytest.raises(ValueError, match="cannot attest to UNVERIFIED"):
        OperatorAttestation.issue("x", "X", VerificationLevel.UNVERIFIED, authority)


def test_validity_window_scales_with_level(authority):
    """Weaker checks decay faster: an email changes hands more easily."""
    windows = [
        OperatorAttestation.issue(
            "x", "X", lvl, authority, verified_at_ms=0
        ).expires_at_ms
        for lvl in (
            VerificationLevel.EMAIL,
            VerificationLevel.DOMAIN,
            VerificationLevel.KYB,
        )
    ]
    assert windows == sorted(windows)
    assert len(set(windows)) == 3


def test_custom_validity_window(authority):
    a = OperatorAttestation.issue(
        "x", "X", VerificationLevel.KYB, authority,
        validity_ms=1000, verified_at_ms=0,
    )
    assert a.expires_at_ms == 1000


# --- content-derived ref ---

def test_ref_is_deterministic():
    a = compute_attestation_ref("acme", "Acme Corp", 3, 1000, 2000)
    b = compute_attestation_ref("acme", "Acme Corp", 3, 1000, 2000)
    assert a == b
    assert len(a) == 64


def test_ref_changes_with_every_field():
    base = ("acme", "Acme Corp", 3, 1000, 2000)
    ref = compute_attestation_ref(*base)
    variants = [
        ("shady", "Acme Corp", 3, 1000, 2000),
        ("acme", "Shady LLC", 3, 1000, 2000),
        ("acme", "Acme Corp", 2, 1000, 2000),
        ("acme", "Acme Corp", 3, 1001, 2000),
        ("acme", "Acme Corp", 3, 1000, 2001),
    ]
    for v in variants:
        assert compute_attestation_ref(*v) != ref


# --- tamper detection ---

def test_edited_legal_name_rejected(authority, att):
    forged = copy.deepcopy(att)
    forged.legal_name = "Shady LLC"
    r = forged.verify(trusted_signer=authority.public_hex)
    assert not r["valid"]
    assert not r["checks"]["ref_matches"]
    assert not r["checks"]["signature_valid"]


def test_self_upgraded_verification_level_rejected(authority, att):
    forged = copy.deepcopy(att)
    forged.verification_level = int(VerificationLevel.KYB)
    forged.operator_id = "anon"
    assert not forged.verify(trusted_signer=authority.public_hex)["valid"]


def test_extended_expiry_rejected(authority, att):
    """Can't grant yourself a longer window: expiry is in the preimage."""
    forged = copy.deepcopy(att)
    forged.expires_at_ms = 99_999_999_999_999
    r = forged.verify(trusted_signer=authority.public_hex)
    assert not r["checks"]["ref_matches"]


def test_swapped_signature_rejected(authority):
    a = OperatorAttestation.issue("acme", "Acme", VerificationLevel.KYB, authority)
    b = OperatorAttestation.issue("shady", "Shady", VerificationLevel.KYB, authority)
    forged = copy.deepcopy(b)
    forged.signature = a.signature
    assert not forged.signature_valid()


def test_missing_signature_is_invalid(att):
    att.signature = ""
    assert not att.signature_valid()


def test_garbage_signature_does_not_raise(att):
    att.signature = "not-hex"
    assert att.signature_valid() is False


# --- the check that makes it a moat ---

def test_self_signed_attestation_is_internally_consistent(authority):
    """This is the whole point of trusted_signer.

    An attacker signs their own attestation. ref_matches and
    signature_valid both PASS: the document is internally consistent.
    Only checking WHO signed it catches this.
    """
    attacker = KeyPair()
    forged = OperatorAttestation.issue(
        "shady", "Shady LLC", VerificationLevel.KYB, attacker
    )

    assert forged.ref_matches()
    assert forged.signature_valid()

    r = forged.verify(trusted_signer=authority.public_hex)
    assert not r["checks"]["trusted_signer"]
    assert not r["valid"]


def test_without_trusted_signer_self_signed_passes(authority):
    """Not a bug: without a trust anchor, you only get integrity."""
    attacker = KeyPair()
    forged = OperatorAttestation.issue(
        "shady", "Shady", VerificationLevel.KYB, attacker
    )
    r = forged.verify()  # no trust anchor supplied
    assert r["valid"]
    assert r["checks"]["trusted_signer"] is None


# --- freshness (a different failure from forgery) ---

def test_expired_attestation_is_invalid_but_not_forged(authority):
    old = OperatorAttestation.issue(
        "acme", "Acme", VerificationLevel.EMAIL, authority, verified_at_ms=1000
    )
    r = old.verify(trusted_signer=authority.public_hex)
    assert not r["valid"]
    assert not r["checks"]["fresh"]
    # The distinction that matters to an incident responder:
    assert r["checks"]["signature_valid"]
    assert r["checks"]["ref_matches"]


def test_freshness_boundary(authority):
    a = OperatorAttestation.issue(
        "acme", "Acme", VerificationLevel.KYB, authority,
        validity_ms=1000, verified_at_ms=0,
    )
    assert a.is_fresh(now_ms=999)
    assert not a.is_fresh(now_ms=1000)
    assert not a.is_fresh(now_ms=1001)


# --- round trip ---

def test_dict_round_trip_preserves_validity(authority, att):
    restored = OperatorAttestation.from_dict(att.to_dict())
    assert restored.verify(trusted_signer=authority.public_hex)["valid"]
    assert restored.attestation_ref == att.attestation_ref


def test_to_dict_carries_every_field(att):
    d = att.to_dict()
    for f in (
        "operator_id", "legal_name", "verification_level", "verified_at_ms",
        "expires_at_ms", "attestation_ref", "signature", "signer_public_key",
        "version",
    ):
        assert f in d


def test_level_property(att):
    assert att.level == VerificationLevel.KYB
    assert att.level.label == "kyb-verified"
