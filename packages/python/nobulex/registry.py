"""Operator registry: binding agent keys to accountable legal entities.

The Sybil problem this solves:

An agent's key is just a public key. Anyone can generate one in
microseconds. If the trust score attaches to the key, the score is
worthless: an agent with a bad score deletes the key, generates a new
one, and starts clean. Thirty seconds, no history.

A human cannot do this with a credit score. The SSN is scarce, issued
by an authority, and expensive to replace. That scarcity is what makes
the score mean anything.

So the score cannot live on the key. It lives on the OPERATOR: the
legal entity accountable for the agent. Agents inherit trust from their
operator the way a corporate card inherits its limit from the company,
not from the plastic.

    registry = OperatorRegistry()
    registry.register("acme-corp", "Acme Corporation",
                      VerificationLevel.KYB)
    registry.bind_agent("acme-corp", agent.public_key)

    # New agent from a verified operator inherits trust
    registry.starting_score("acme-corp")   # inherits, not zero

    # Spinning up a fresh key does not escape the history
    registry.operator_score("acme-corp")   # includes abandoned agents

Verification levels exist because "who is accountable" is a spectrum,
not a boolean. An email-verified operator is weak evidence. A KYB-
verified legal entity is strong. The relying party decides what
threshold it requires; the registry only reports what was verified and
how.
"""

from __future__ import annotations

import time
from enum import IntEnum
from typing import Dict, List, Optional, Set


class VerificationLevel(IntEnum):
    """How strongly an operator identity has been established.

    Ordered: a relying party can require `level >= DOMAIN` and the
    comparison means what it looks like it means.
    """

    UNVERIFIED = 0  # self-asserted. Anyone can claim this. Worth nothing.
    EMAIL = 1       # controls an email address
    DOMAIN = 2      # controls a domain (DNS TXT proof)
    KYB = 3         # legal entity verified against registry documents

    @property
    def label(self) -> str:
        return {
            VerificationLevel.UNVERIFIED: "unverified",
            VerificationLevel.EMAIL: "email-verified",
            VerificationLevel.DOMAIN: "domain-verified",
            VerificationLevel.KYB: "kyb-verified",
        }[self]


# How much of an operator's score a newly bound agent inherits.
# An unverified operator confers nothing: otherwise the Sybil attack
# just moves up one level (spin up fake operators instead of fake keys).
_INHERITANCE = {
    VerificationLevel.UNVERIFIED: 0.0,
    VerificationLevel.EMAIL: 0.25,
    VerificationLevel.DOMAIN: 0.50,
    VerificationLevel.KYB: 0.80,
}

# Never inherit a perfect record. A new agent is a new agent, however
# good its operator. Inheritance is a starting position, not a pass.
_INHERITANCE_CEILING = 60.0


class Operator:
    """A legal entity accountable for one or more agents."""

    def __init__(
        self,
        operator_id: str,
        legal_name: str,
        verification: VerificationLevel = VerificationLevel.UNVERIFIED,
    ):
        self.operator_id = operator_id
        self.legal_name = legal_name
        self.verification = verification
        self.verified_at_ms: Optional[int] = (
            int(time.time() * 1000) if verification > VerificationLevel.UNVERIFIED else None
        )
        # Every key ever bound. Never removed. This is the point.
        self.agent_keys: Set[str] = set()
        self.abandoned_keys: Set[str] = set()

    @property
    def active_agents(self) -> int:
        return len(self.agent_keys)

    @property
    def total_agents_ever(self) -> int:
        return len(self.agent_keys) + len(self.abandoned_keys)

    @property
    def churn_ratio(self) -> float:
        """Fraction of this operator's agents that were abandoned.

        High churn is itself a signal. An operator that repeatedly spins
        up agents and abandons them is exhibiting exactly the behavior
        the key-level score failed to catch.
        """
        total = self.total_agents_ever
        if total == 0:
            return 0.0
        return len(self.abandoned_keys) / total

    def __repr__(self) -> str:
        return (
            f"Operator({self.operator_id!r}, {self.verification.label}, "
            f"agents={self.active_agents}, abandoned={len(self.abandoned_keys)})"
        )


class OperatorRegistry:
    """Binds agent keys to accountable operators, and scores the operator.

    This is the layer a competitor cannot fork. They can copy the
    action_ref formula in an afternoon and scrape the receipt corpus in a
    day. They cannot copy the verification relationships, because those
    are attestations, not data.
    """

    def __init__(self):
        self._operators: Dict[str, Operator] = {}
        self._key_to_operator: Dict[str, str] = {}

    # --- registration ---

    def register(
        self,
        operator_id: str,
        legal_name: str,
        verification: VerificationLevel = VerificationLevel.UNVERIFIED,
    ) -> Operator:
        """Register an operator. Re-registering does not silently upgrade."""
        if operator_id in self._operators:
            raise ValueError(f"operator {operator_id!r} already registered")
        op = Operator(operator_id, legal_name, verification)
        self._operators[operator_id] = op
        return op

    def verify(self, operator_id: str, level: VerificationLevel) -> Operator:
        """Raise an operator's verification level.

        Downgrades are allowed (revocation is real: a domain lapses, a
        registration is withdrawn), but they are explicit, not accidental.
        """
        op = self._require(operator_id)
        op.verification = level
        op.verified_at_ms = (
            int(time.time() * 1000) if level > VerificationLevel.UNVERIFIED else None
        )
        return op

    def bind_agent(self, operator_id: str, public_key: str) -> None:
        """Bind an agent's public key to an operator.

        A key binds to exactly one operator. Rebinding to a different
        operator is refused: that is the Sybil move wearing a suit.
        """
        op = self._require(operator_id)
        existing = self._key_to_operator.get(public_key)
        if existing is not None and existing != operator_id:
            raise ValueError(
                f"key already bound to operator {existing!r}; "
                "keys cannot be rebound to a different operator"
            )
        op.agent_keys.add(public_key)
        op.abandoned_keys.discard(public_key)
        self._key_to_operator[public_key] = operator_id

    def abandon_agent(self, public_key: str) -> None:
        """Mark an agent key as abandoned.

        The key leaves active service. It does NOT leave the operator's
        file. That is the entire mechanism: you can retire a key, you
        cannot retire the history.
        """
        operator_id = self._key_to_operator.get(public_key)
        if operator_id is None:
            raise KeyError(f"key {public_key[:16]}... is not bound to any operator")
        op = self._operators[operator_id]
        op.agent_keys.discard(public_key)
        op.abandoned_keys.add(public_key)

    # --- lookup ---

    def operator_for(self, public_key: str) -> Optional[Operator]:
        """Who is legally accountable for this key? None = nobody."""
        operator_id = self._key_to_operator.get(public_key)
        return self._operators.get(operator_id) if operator_id else None

    def is_accountable(self, public_key: str, minimum: VerificationLevel) -> bool:
        """Does this key trace to an operator verified to at least `minimum`?

        This is the question a relying party actually asks. Not "does this
        key have receipts" but "is anyone answerable for it."
        """
        op = self.operator_for(public_key)
        return op is not None and op.verification >= minimum

    def keys_for(self, operator_id: str) -> List[str]:
        return sorted(self._require(operator_id).agent_keys)

    # --- scoring ---

    def starting_score(self, operator_id: str, operator_score: float = 0.0) -> float:
        """Trust a newly bound agent starts with, inherited from its operator.

        An unverified operator confers nothing, so registering fake
        operators to farm inherited trust does not work either.
        """
        op = self._require(operator_id)
        inherited = operator_score * _INHERITANCE[op.verification]
        return round(min(inherited, _INHERITANCE_CEILING), 2)

    def operator_score(self, operator_id: str, agent_scores: Dict[str, float]) -> float:
        """Score for the operator, over every agent it has EVER run.

        Two properties that make this Sybil-resistant:

        1. Abandoned agents still count. Deleting the key that earned a
           bad record does not delete the record.
        2. Churn is penalized. An operator that cycles through agents is
           doing the thing key-level scoring failed to catch, and the
           churn ratio makes it visible.
        """
        op = self._require(operator_id)
        relevant = op.agent_keys | op.abandoned_keys
        scores = [agent_scores[k] for k in relevant if k in agent_scores]
        if not scores:
            return 0.0

        base = sum(scores) / len(scores)
        # Churn penalty: up to 30% off for an operator that abandons agents.
        penalty = 1.0 - (op.churn_ratio * 0.3)
        return round(max(0.0, min(100.0, base * penalty)), 2)

    def report(self, operator_id: str, agent_scores: Dict[str, float]) -> dict:
        """Everything a relying party needs to decide, in one object."""
        op = self._require(operator_id)
        return {
            "operator_id": op.operator_id,
            "legal_name": op.legal_name,
            "verification": op.verification.label,
            "verification_level": int(op.verification),
            "verified_at_ms": op.verified_at_ms,
            "active_agents": op.active_agents,
            "total_agents_ever": op.total_agents_ever,
            "abandoned_agents": len(op.abandoned_keys),
            "churn_ratio": round(op.churn_ratio, 3),
            "operator_score": self.operator_score(operator_id, agent_scores),
            "inheritance_factor": _INHERITANCE[op.verification],
        }

    def _require(self, operator_id: str) -> Operator:
        op = self._operators.get(operator_id)
        if op is None:
            raise KeyError(f"operator {operator_id!r} is not registered")
        return op

    def __len__(self) -> int:
        return len(self._operators)

    def __repr__(self) -> str:
        return f"OperatorRegistry({len(self._operators)} operators, {len(self._key_to_operator)} keys)"
