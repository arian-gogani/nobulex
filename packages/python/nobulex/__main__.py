#!/usr/bin/env python3
"""
Nobulex CLI - Verify receipts from the command line.

Usage:
    python -m nobulex verify receipt.json
    python -m nobulex demo
    python -m nobulex keygen
"""

import sys
import json
from nobulex import Agent, Receipt, KeyPair
from nobulex.chain import ReceiptChain


def cmd_demo():
    """Run a quick demo showing receipt generation and verification."""
    print("nobulex demo")
    print("=" * 40)
    agent = Agent("demo-agent")
    r1 = agent.act("send_email", scope="user@example.com")
    r2 = agent.act("api_call", scope="stripe.com")
    r3 = agent.deny("delete_db", scope="production")
    print(f"generated 3 receipts")
    print(f"  allow: {r1.action_ref[:24]}... verified={r1.verify()}")
    print(f"  allow: {r2.action_ref[:24]}... verified={r2.verify()}")
    print(f"  deny:  {r3.action_ref[:24]}... verified={r3.verify()}")
    print(f"trust score: {agent.trust_score}")
    print(f"\ntamper test:")
    r1.scope = "TAMPERED"
    print(f"  modified receipt verified={r1.verify()} (tamper detected)")


def cmd_verify(filepath):
    """Verify a receipt JSON file."""
    try:
        with open(filepath) as f:
            data = json.load(f)
        receipt = Receipt.from_dict(data)
        ok = receipt.verify()
        print(f"receipt: {filepath}")
        print(f"  agent:  {receipt.agent_id}")
        print(f"  action: {receipt.action_type}")
        print(f"  scope:  {receipt.scope}")
        print(f"  verdict: {receipt.verdict}")
        print(f"  action_ref: {receipt.action_ref[:32]}...")
        print(f"  verified: {ok}")
        sys.exit(0 if ok else 1)
    except Exception as e:
        print(f"error: {e}")
        sys.exit(1)


def cmd_keygen():
    """Generate a new Ed25519 key pair."""
    keys = KeyPair()
    print(f"public_key: {keys.public_hex}")
    print("(private key held in memory only)")


def main():
    if len(sys.argv) < 2:
        print("usage: python -m nobulex [demo|verify|keygen]")
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "demo":
        cmd_demo()
    elif cmd == "verify" and len(sys.argv) >= 3:
        cmd_verify(sys.argv[2])
    elif cmd == "keygen":
        cmd_keygen()
    else:
        print(f"unknown command: {cmd}")
        print("usage: python -m nobulex [demo|verify|keygen]")
        sys.exit(1)


if __name__ == "__main__":
    main()
