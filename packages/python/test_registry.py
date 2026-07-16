"""Tests for the operator registry (Sybil resistance)."""
import pytest

from nobulex.registry import (
    OperatorRegistry,
    Operator,
    VerificationLevel,
)


def keys(*names):
    """Deterministic fake public keys for tests."""
    return [f"{n}{'0' * (64 - len(n))}" for n in names]


# --- registration ---

def test_register_and_lookup():
    r = OperatorRegistry()
    op = r.register("acme", "Acme Corp", VerificationLevel.KYB)
    assert op.operator_id == "acme"
    assert op.verification == VerificationLevel.KYB
    assert len(r) == 1


def test_duplicate_registration_rejected():
    r = OperatorRegistry()
    r.register("acme", "Acme Corp")
    with pytest.raises(ValueError, match="already registered"):
        r.register("acme", "Acme Corp Again")


def test_unregistered_operator_raises():
    r = OperatorRegistry()
    with pytest.raises(KeyError, match="not registered"):
        r.keys_for("ghost")


def test_verification_can_be_upgraded_and_downgraded():
    r = OperatorRegistry()
    r.register("acme", "Acme Corp", VerificationLevel.EMAIL)
    r.verify("acme", VerificationLevel.KYB)
    assert r.report("acme", {})["verification"] == "kyb-verified"
    # Revocation is real: a domain lapses, a registration is withdrawn
    r.verify("acme", VerificationLevel.UNVERIFIED)
    assert r.report("acme", {})["verification"] == "unverified"
    assert r.report("acme", {})["verified_at_ms"] is None


def test_verification_levels_are_ordered():
    assert VerificationLevel.UNVERIFIED < VerificationLevel.EMAIL
    assert VerificationLevel.EMAIL < VerificationLevel.DOMAIN
    assert VerificationLevel.DOMAIN < VerificationLevel.KYB


# --- binding ---

def test_bind_and_resolve_key_to_operator():
    r = OperatorRegistry()
    r.register("acme", "Acme Corp", VerificationLevel.KYB)
    (k,) = keys("a")
    r.bind_agent("acme", k)
    assert r.operator_for(k).operator_id == "acme"


def test_unbound_key_has_no_operator():
    r = OperatorRegistry()
    (k,) = keys("orphan")
    assert r.operator_for(k) is None


def test_key_cannot_be_rebound_to_another_operator():
    """The Sybil move wearing a suit: move the key, not the score."""
    r = OperatorRegistry()
    r.register("acme", "Acme Corp", VerificationLevel.KYB)
    r.register("shady", "Shady LLC", VerificationLevel.KYB)
    (k,) = keys("a")
    r.bind_agent("acme", k)
    with pytest.raises(ValueError, match="cannot be rebound"):
        r.bind_agent("shady", k)


def test_rebinding_to_same_operator_is_idempotent():
    r = OperatorRegistry()
    r.register("acme", "Acme Corp")
    (k,) = keys("a")
    r.bind_agent("acme", k)
    r.bind_agent("acme", k)
    assert r._operators["acme"].active_agents == 1


def test_abandoning_unbound_key_raises():
    r = OperatorRegistry()
    (k,) = keys("orphan")
    with pytest.raises(KeyError):
        r.abandon_agent(k)


# --- accountability (the question a relying party actually asks) ---

def test_is_accountable_requires_verification_threshold():
    r = OperatorRegistry()
    r.register("weak", "Weak Co", VerificationLevel.EMAIL)
    (k,) = keys("a")
    r.bind_agent("weak", k)

    assert r.is_accountable(k, VerificationLevel.EMAIL)
    assert not r.is_accountable(k, VerificationLevel.KYB)


def test_unbound_key_is_never_accountable():
    r = OperatorRegistry()
    (k,) = keys("orphan")
    assert not r.is_accountable(k, VerificationLevel.UNVERIFIED)


# --- THE SYBIL ATTACK ---

def test_abandoned_agent_still_counts_against_operator():
    """Burn the key, keep the record. This is the whole mechanism."""
    r = OperatorRegistry()
    r.register("shady", "Shady LLC", VerificationLevel.KYB)
    bad, fresh = keys("bad", "fresh")

    r.bind_agent("shady", bad)
    scores = {bad: 8.0}
    assert r.operator_score("shady", scores) == 8.0

    # The attack: abandon the poisoned key, bind a clean one
    r.abandon_agent(bad)
    r.bind_agent("shady", fresh)
    scores[fresh] = 0.0

    # The fresh key's own score is clean, but the operator's is not
    after = r.operator_score("shady", scores)
    assert after < 8.0, "churn penalty should apply"
    assert after > 0.0, "history must survive the burn"


def test_fresh_key_inherits_poisoned_operator_score():
    """A new agent from a bad operator does NOT start clean."""
    r = OperatorRegistry()
    r.register("shady", "Shady LLC", VerificationLevel.KYB)
    bad, fresh = keys("bad", "fresh")

    r.bind_agent("shady", bad)
    r.abandon_agent(bad)
    r.bind_agent("shady", fresh)

    scores = {bad: 8.0, fresh: 0.0}
    op_score = r.operator_score("shady", scores)
    assert r.starting_score("shady", op_score) > 0.0  # inherits the stain


def test_churn_ratio_exposes_key_cycling():
    r = OperatorRegistry()
    r.register("shady", "Shady LLC", VerificationLevel.KYB)
    burned = keys("b1", "b2", "b3")
    for k in burned:
        r.bind_agent("shady", k)
        r.abandon_agent(k)
    (survivor,) = keys("s")
    r.bind_agent("shady", survivor)

    report = r.report("shady", {k: 10.0 for k in burned + [survivor]})
    assert report["abandoned_agents"] == 3
    assert report["total_agents_ever"] == 4
    assert report["churn_ratio"] == 0.75


def test_unverified_operator_confers_no_inheritance():
    """Sybil moves up a level (fake operators) and still fails."""
    r = OperatorRegistry()
    r.register("anon", "Anonymous", VerificationLevel.UNVERIFIED)
    assert r.starting_score("anon", 99.0) == 0.0


def test_inheritance_scales_with_verification():
    r = OperatorRegistry()
    for name, level in [
        ("e", VerificationLevel.EMAIL),
        ("d", VerificationLevel.DOMAIN),
        ("k", VerificationLevel.KYB),
    ]:
        r.register(name, name, level)

    e = r.starting_score("e", 100.0)
    d = r.starting_score("d", 100.0)
    k = r.starting_score("k", 100.0)
    assert 0 < e < d < k


def test_inheritance_is_capped_below_perfect():
    """However good the operator, a new agent is still a new agent."""
    r = OperatorRegistry()
    r.register("acme", "Acme Corp", VerificationLevel.KYB)
    assert r.starting_score("acme", 100.0) <= 60.0


# --- honest operator ---

def test_clean_operator_scores_well_and_passes_inheritance():
    r = OperatorRegistry()
    r.register("acme", "Acme Corp", VerificationLevel.KYB)
    a, b = keys("a", "b")
    r.bind_agent("acme", a)
    r.bind_agent("acme", b)

    scores = {a: 88.0, b: 92.0}
    assert r.operator_score("acme", scores) == 90.0  # no churn penalty
    assert r.report("acme", scores)["churn_ratio"] == 0.0
    assert r.starting_score("acme", 90.0) > 0.0


def test_operator_with_no_receipts_scores_zero():
    r = OperatorRegistry()
    r.register("new", "New Co", VerificationLevel.KYB)
    assert r.operator_score("new", {}) == 0.0


def test_score_is_bounded():
    r = OperatorRegistry()
    r.register("acme", "Acme Corp", VerificationLevel.KYB)
    (k,) = keys("a")
    r.bind_agent("acme", k)
    assert r.operator_score("acme", {k: 10_000.0}) <= 100.0
    assert r.operator_score("acme", {k: -500.0}) >= 0.0


# --- report ---

def test_report_carries_what_a_relying_party_needs():
    r = OperatorRegistry()
    r.register("acme", "Acme Corporation", VerificationLevel.DOMAIN)
    (k,) = keys("a")
    r.bind_agent("acme", k)

    rep = r.report("acme", {k: 75.0})
    for field in (
        "operator_id", "legal_name", "verification", "verification_level",
        "active_agents", "total_agents_ever", "abandoned_agents",
        "churn_ratio", "operator_score", "inheritance_factor",
    ):
        assert field in rep
    assert rep["legal_name"] == "Acme Corporation"
    assert rep["verification"] == "domain-verified"
