"""Tests for Nobulex Python SDK."""

from nobulex import Agent, Receipt, KeyPair


def test_agent_create():
    agent = Agent("test-agent")
    assert agent.agent_id == "test-agent"
    assert agent.trust_score == 0.0
    assert len(agent.receipts) == 0


def test_receipt_create_and_verify():
    keys = KeyPair()
    receipt = Receipt.create(
        agent_id="test",
        action_type="send_email",
        scope="user@example.com",
        keys=keys,
    )
    assert receipt.verify()
    assert receipt.agent_id == "test"
    assert receipt.action_type == "send_email"
    assert receipt.verdict == "ALLOW"
    assert len(receipt.action_ref) == 64  # SHA-256 hex


def test_receipt_tamper_detection():
    keys = KeyPair()
    receipt = Receipt.create(
        agent_id="test",
        action_type="send_email",
        scope="user@example.com",
        keys=keys,
    )
    assert receipt.verify()
    # Tamper with the receipt
    receipt.scope = "TAMPERED"
    assert not receipt.verify()  # Signature no longer valid


def test_trust_score_increases():
    agent = Agent("scorer")
    assert agent.trust_score == 0.0
    agent.act("action_1", scope="s1")
    score1 = agent.trust_score
    assert score1 > 0
    agent.act("action_2", scope="s2")
    score2 = agent.trust_score
    assert score2 > score1


def test_deny_receipt():
    agent = Agent("denier")
    receipt = agent.deny("bad_action", scope="admin")
    assert receipt.verdict == "DENY"
    assert receipt.verify()
    assert agent.trust_score > 0  # Deny still adds some trust


def test_receipt_json_roundtrip():
    import json
    keys = KeyPair()
    receipt = Receipt.create(
        agent_id="test",
        action_type="api_call",
        scope="stripe.com",
        keys=keys,
    )
    data = json.loads(receipt.to_json())
    restored = Receipt.from_dict(data)
    assert restored.verify()
    assert restored.action_ref == receipt.action_ref


def test_langchain_integration():
    from nobulex.langchain import NobuReceipts

    tracker = NobuReceipts("lc-agent")
    r = tracker.on_tool_start("search", {"q": "test"})
    assert r.verify()
    assert tracker.trust_score > 0


def test_crewai_tracker():
    from nobulex.crewai import NobuCrewTracker

    crew = NobuCrewTracker("test-crew")
    crew.on_task_start("agent-a", "research")
    crew.on_task_complete("agent-a", "research", result="done")
    crew.on_task_fail("agent-b", "write", error="timeout")

    assert len(crew.receipts) == 3
    assert len(crew.agent_names) == 2
    scores = crew.trust_scores
    assert scores["agent-a"] > 0
    assert scores["agent-b"] > 0


def test_different_keys_cant_verify():
    keys1 = KeyPair()
    keys2 = KeyPair()
    receipt = Receipt.create(
        agent_id="a", action_type="x", scope="s", keys=keys1
    )
    receipt.signer_public_key = keys2.public_hex
    assert not receipt.verify()


if __name__ == "__main__":
    tests = [
        test_agent_create,
        test_receipt_create_and_verify,
        test_receipt_tamper_detection,
        test_trust_score_increases,
        test_deny_receipt,
        test_receipt_json_roundtrip,
        test_langchain_integration,
        test_crewai_tracker,
        test_different_keys_cant_verify,
    ]
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
        except Exception as e:
            print(f"  FAIL  {t.__name__}: {e}")

    print(f"\n{len(tests)} tests complete.")
