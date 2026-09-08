"""The verifier must reach its verdict with the signer's own functions.

server.py used to define a local `jcs_canonical`:

    json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)

RFC 8785 does not escape non-ASCII. It emits raw UTF-8. So for any receipt whose
agent_id, action_type or scope contained a non-ASCII character, the service
recomputed a different action_ref than the signer had computed and answered
INVALID for a correctly signed, genuinely valid receipt.

A non-ASCII scope alone was enough, with a plain ASCII agent id, and scope is
the field most likely to carry a tenant-supplied string: an account name, a
resource path, a filename.

A false INVALID is the worst verdict this service can return. A false VALID
lets one bad receipt through; a false INVALID tells a relying party that a
compliant agent forged its evidence.

Every test below fails against the local implementation and passes against the
SDK's, which is the bar THESIS.md sets.
"""
import hashlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from nobulex import Agent, Receipt
from nobulex.crypto import compute_action_ref


def _old_local_jcs(obj):
    """What server.py used to do. Kept only so the tests can discriminate."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _old_recompute(r):
    pre = _old_local_jcs({
        "agent_id": r.agent_id, "action_type": r.action_type,
        "scope": r.scope, "timestamp_ms": r.timestamp_ms,
    })
    return hashlib.sha256(pre.encode("utf-8")).hexdigest()


def _new_recompute(r):
    return compute_action_ref(r.agent_id, r.action_type, r.scope, r.timestamp_ms)


NON_ASCII_IDS = [
    pytest.param("did:web:café.example", id="accented"),
    pytest.param("did:web:例え.example", id="cjk"),
    pytest.param("did:web:a\U0001F510.example", id="emoji"),
]


@pytest.mark.parametrize("agent_id", NON_ASCII_IDS)
def test_non_ascii_agent_id_verifies(agent_id):
    r = Agent(agent_id).act("transfer", "acct:123")
    assert r.verify(), "the receipt really is validly signed"
    assert _new_recompute(r) == r.action_ref
    assert _old_recompute(r) != r.action_ref, (
        "guard: if this ever matches, the test has stopped discriminating"
    )


def test_non_ascii_scope_alone_is_enough():
    """Plain ASCII agent id. Only the scope carries a non-ASCII character."""
    r = Agent("did:web:agent.example").act("transfer", "acct:café")
    assert r.verify()
    assert _new_recompute(r) == r.action_ref
    assert _old_recompute(r) != r.action_ref


def test_non_ascii_action_type_alone_is_enough():
    r = Agent("did:web:agent.example").act("prüfen", "acct:123")
    assert r.verify()
    assert _new_recompute(r) == r.action_ref
    assert _old_recompute(r) != r.action_ref


def test_ascii_is_unaffected():
    """Must-not-fire. The common path was always correct and must stay identical."""
    r = Agent("did:web:agent.example").act("transfer", "acct:123")
    assert _new_recompute(r) == r.action_ref
    assert _old_recompute(r) == r.action_ref, (
        "ASCII was the one case both implementations agreed on"
    )


def test_tampered_scope_is_still_rejected():
    """Must-not-fire. Fixing false INVALIDs must not create false VALIDs."""
    r = Agent("did:web:café.example").act("transfer", "amount=500")
    d = r.to_dict()
    d["scope"] = "amount=50000,to=attacker"
    t = Receipt.from_dict(d)
    assert _new_recompute(t) != t.action_ref
    assert not t.verify()


def test_tampered_timestamp_is_still_rejected():
    r = Agent("did:web:café.example").act("transfer", "amount=500")
    d = r.to_dict()
    d["timestamp_ms"] += 1
    t = Receipt.from_dict(d)
    assert _new_recompute(t) != t.action_ref


def test_server_defines_no_canonicalizer_of_its_own():
    """The structural guarantee, not just the behavioural one.

    The defect class is a second implementation existing at all. This fails if
    anyone reintroduces one.
    """
    src = (Path(__file__).parent / "server.py").read_text(encoding="utf-8")
    code = "\n".join(
        line for line in src.splitlines() if not line.lstrip().startswith("#")
    )
    assert "def jcs_canonical" not in code, (
        "server.py must import canonicalization from nobulex.crypto, not define it"
    )
    assert "ensure_ascii" not in code, (
        "ensure_ascii has no place in an RFC 8785 canonicalization"
    )
    assert "def sha256_hex" not in code
