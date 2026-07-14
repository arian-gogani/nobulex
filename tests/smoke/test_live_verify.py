#!/usr/bin/env python3
"""
Smoke test: generate a receipt locally, verify against the live API.

Proves end-to-end that the SDK and hosted verification layer agree.

Usage:
    PYTHONPATH=packages/python python3 tests/smoke/test_live_verify.py
"""

import json
import sys
import urllib.request

sys.path.insert(0, "packages/python")
from nobulex import Agent


API_URL = "https://nobulex.com/api/verify"


def test_valid_receipt():
    a = Agent("smoke-test-agent")
    r = a.act(action_type="tool:search", scope="query=smoke_test")
    payload = r.to_dict()

    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    resp = urllib.request.urlopen(req, timeout=10)
    result = json.loads(resp.read())

    assert result["verdict"] == "VALID", f"Expected VALID, got {result['verdict']}"
    assert result["action_ref_match"] is True
    print(f"  PASS: valid receipt verified ({result['action_ref_recomputed'][:16]}...)")


def test_tampered_receipt():
    a = Agent("smoke-test-agent")
    r = a.act(action_type="tool:transfer", scope="amount=100")
    payload = r.to_dict()
    payload["scope"] = "amount=999999"

    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    resp = urllib.request.urlopen(req, timeout=10)
    result = json.loads(resp.read())

    assert result["verdict"] == "INVALID", f"Expected INVALID, got {result['verdict']}"
    assert result["action_ref_match"] is False
    print("  PASS: tampered receipt rejected")


def test_demo_endpoint():
    req = urllib.request.Request(f"{API_URL}?action=demo")
    resp = urllib.request.urlopen(req, timeout=10)
    result = json.loads(resp.read())

    assert result["original"]["verdict"] == "VALID"
    assert "INVALID" in result["tampered"]["verdict"]
    assert result["tampered"]["match"] is False
    print("  PASS: demo endpoint working")


if __name__ == "__main__":
    print("Nobulex live API smoke test")
    print(f"  endpoint: {API_URL}\n")
    try:
        test_valid_receipt()
        test_tampered_receipt()
        test_demo_endpoint()
        print("\nAll 3 smoke tests passed.")
    except Exception as e:
        print(f"\nFAILED: {e}")
        sys.exit(1)
