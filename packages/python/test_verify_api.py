"""Tests for the hosted verification API."""
import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from nobulex import Agent


@pytest.fixture
def client():
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "verify-api"))
    from server import app
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture
def agent():
    return Agent("test-agent")


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    d = r.get_json()
    assert d["status"] == "ok"


def test_verify_valid_receipt(client, agent):
    receipt = agent.act(action_type="tool:search", scope="query=test")
    r = client.post("/verify", json=receipt.to_dict())
    d = r.get_json()
    assert d["verdict"] == "VALID"
    assert d["action_ref_match"] is True
    assert d["signature_valid"] is True
    assert d["tier"] == "free"


def test_verify_pro_tier(client, agent):
    receipt = agent.act(action_type="tool:x", scope="y")
    r = client.post("/verify", json=receipt.to_dict(),
                     headers={"X-API-Key": "nbx_pro_test"})
    d = r.get_json()
    assert d["verdict"] == "VALID"
    assert d["tier"] == "pro"


def test_score_accumulates(client):
    a = Agent("score-test-agent")
    for i in range(3):
        receipt = a.act(action_type=f"tool:a{i}", scope=f"s{i}")
        client.post("/verify", json=receipt.to_dict())

    r = client.get("/agent/score-test-agent/score")
    d = r.get_json()
    assert d["score"] > 0
    assert d["receipts_verified"] == 3
    assert d["grade"] in ("A", "B", "C", "D", "F")


def test_deny_lowers_score(client, agent):
    for i in range(3):
        receipt = agent.act(action_type=f"tool:ok{i}", scope=f"s{i}")
        client.post("/verify", json=receipt.to_dict())

    deny = agent.deny(action_type="tool:bad", scope="danger")
    client.post("/verify", json=deny.to_dict())

    r = client.get("/agent/test-agent/score")
    d = r.get_json()
    assert d["deny_count"] >= 1


def test_chain_blocked_for_free(client, agent):
    r = client.post("/verify/chain", json={"receipts": [], "public_key": ""})
    assert r.status_code == 403
    assert "Pro tier" in r.get_json()["error"]


def test_bundle_blocked_for_free(client, agent):
    r = client.post("/verify/bundle", json={"receipts": []})
    assert r.status_code == 403
    assert "Pro tier" in r.get_json()["error"]


def test_bundle_works_for_pro(client, agent):
    receipts = []
    for i in range(3):
        receipt = agent.act(action_type=f"tool:b{i}", scope=f"s{i}")
        receipts.append(receipt.to_dict())

    r = client.post("/verify/bundle",
                     json={"receipts": receipts, "bundle_id": "test-bundle"},
                     headers={"X-API-Key": "nbx_pro_test"})
    assert r.status_code == 200
    d = r.get_json()
    assert d["bundle_id"] == "test-bundle"
    assert d["summary"]["verified"] == 3
    assert d["summary"]["failed"] == 0
    assert d["summary"]["grade"] in ("A", "B", "C", "D", "F")
