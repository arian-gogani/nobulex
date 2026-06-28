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



def cmd_verify_chain(filepath, authorized_key=None):
    """Verify an exported receipt chain (audit trail)."""
    from nobulex.chain import verify_audit_trail
    try:
        report = verify_audit_trail(filepath, authorized_keys=authorized_key)
        n = report.get("receipt_count", 0)
        intact = report.get("chain_intact", False)
        auth = report.get("authenticated", False)
        print(f"chain: {filepath}")
        print(f"  receipts:      {n}")
        print(f"  chain_intact:  {intact}")
        print(f"  authenticated: {auth}")
        if not intact:
            print(f"  FAIL: hash chain broken")
        if not auth:
            print(f"  FAIL: signature verification failed")
        if intact and auth:
            print(f"  PASS: all {n} receipts verified")
        sys.exit(0 if (intact and auth) else 1)
    except Exception as e:
        print(f"error: {e}")
        sys.exit(1)


def cmd_es256_keygen():
    """Generate a new ES256 (ECDSA P-256) key pair."""
    from nobulex.crypto import ES256KeyPair
    keys = ES256KeyPair()
    print(f"algorithm: es256")
    print(f"public_key: {keys.public_hex}")
    print("(private key held in memory only)")


def main():
    if len(sys.argv) < 2:
        print("usage: python -m nobulex [demo|verify|verify-chain|keygen|es256-keygen]")
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "demo":
        cmd_demo()
    elif cmd == "verify" and len(sys.argv) >= 3:
        cmd_verify(sys.argv[2])
    elif cmd == "keygen":
        cmd_keygen()
    elif cmd == "es256-keygen":
        cmd_es256_keygen()
    elif cmd == "verify-chain" and len(sys.argv) >= 3:
        key = sys.argv[3] if len(sys.argv) >= 4 else None
        cmd_verify_chain(sys.argv[2], key)
    else:
        print(f"unknown command: {cmd}")
        print("usage: python -m nobulex [demo|verify|verify-chain|keygen|es256-keygen]")
        sys.exit(1)


if __name__ == "__main__":
    main()
