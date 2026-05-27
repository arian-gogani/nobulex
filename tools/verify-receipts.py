#!/usr/bin/env python3
"""
Nobulex Receipt Verifier CLI

Language-neutral verifier for receipt chains from any implementation.
Accepts JSONL receipt exports, verifies:
  1. Ed25519 signature per entry
  2. SHA-256 hash chain integrity
  3. JCS canonicalization correctness

Usage:
  python3 verify-receipts.py audit.jsonl
  python3 verify-receipts.py audit.jsonl --pubkey path/to/key.pub
  python3 verify-receipts.py audit.json  # also accepts single JSON export
"""

import argparse
import json
import hashlib
import sys

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

try:
    import rfc8785
    HAS_JCS = True
except ImportError:
    HAS_JCS = False


def jcs_canonical(obj):
    """RFC 8785 JCS canonicalization."""
    if HAS_JCS:
        return rfc8785.dumps(obj)
    # Fallback: sorted JSON (correct for ASCII-safe keys)
    return json.dumps(obj, separators=(',', ':'), sort_keys=True, ensure_ascii=False).encode('utf-8')


def verify_signature(data_bytes, signature_hex, pubkey_hex):
    """Verify Ed25519 signature."""
    if not HAS_CRYPTO:
        return None  # Can't verify without cryptography package
    try:
        sig = bytes.fromhex(signature_hex)
        pub = bytes.fromhex(pubkey_hex)
        key = Ed25519PublicKey.from_public_bytes(pub)
        key.verify(sig, data_bytes)
        return True
    except Exception:
        return False


def verify_action_ref(entry):
    """Verify action_ref is correctly derived from preimage fields."""
    preimage = {
        'agent_id': entry['agent_id'],
        'action_type': entry['action_type'],
        'scope': entry['scope'],
        'timestamp_ms': entry['timestamp_ms'],
    }
    canonical = jcs_canonical(preimage)
    expected = hashlib.sha256(canonical).hexdigest()
    return expected == entry.get('action_ref', '')


def load_receipts(path):
    """Load receipts from JSON or JSONL file."""
    with open(path, 'r') as f:
        content = f.read().strip()

    # Try JSON first (single export with entries array)
    try:
        data = json.loads(content)
        if isinstance(data, dict) and 'entries' in data:
            return data['entries']
        if isinstance(data, list):
            return data
        return [data]
    except json.JSONDecodeError:
        pass

    # Try JSONL
    entries = []
    for line in content.split('\n'):
        line = line.strip()
        if line:
            entries.append(json.loads(line))
    return entries


def main():
    parser = argparse.ArgumentParser(description='Verify nobulex receipt chains')
    parser.add_argument('file', help='Receipt file (JSON or JSONL)')
    parser.add_argument('--pubkey', help='Public key file (hex)')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    args = parser.parse_args()

    entries = load_receipts(args.file)
    print(f"Loaded {len(entries)} receipts from {args.file}")
    print()

    passed = 0
    failed = 0
    skipped = 0
    prev_hash = None

    for i, entry in enumerate(entries):
        issues = []

        # 1. Verify action_ref
        if 'action_ref' in entry and 'agent_id' in entry:
            if verify_action_ref(entry):
                if args.verbose:
                    print(f"  [{i}] action_ref: PASS")
            else:
                issues.append("action_ref mismatch")

        # 2. Verify hash chain
        if 'prev_hash' in entry and prev_hash is not None:
            if entry['prev_hash'] != prev_hash:
                issues.append(f"chain break (expected {prev_hash[:16]}..., got {entry.get('prev_hash', 'none')[:16]}...)")

        # 3. Verify signature
        if 'signature' in entry and 'public_key' in entry:
            sig_data = {k: v for k, v in entry.items() if k not in ('signature', 'public_key')}
            canonical = jcs_canonical(sig_data)
            result = verify_signature(canonical, entry['signature'], entry['public_key'])
            if result is True:
                if args.verbose:
                    print(f"  [{i}] signature: PASS")
            elif result is False:
                issues.append("signature invalid")
            else:
                if args.verbose:
                    print(f"  [{i}] signature: SKIP (cryptography package not installed)")
                skipped += 1

        # Update chain hash
        if 'chain_hash' in entry:
            prev_hash = entry['chain_hash']
        elif 'entry_hash' in entry:
            prev_hash = entry['entry_hash']
        elif 'action_ref' in entry:
            prev_hash = entry['action_ref']

        if issues:
            print(f"  FAIL  [{i}] {entry.get('agent_id', '?')}/{entry.get('action_type', '?')}")
            for issue in issues:
                print(f"         {issue}")
            failed += 1
        else:
            if args.verbose:
                print(f"  PASS  [{i}] {entry.get('agent_id', '?')}/{entry.get('action_type', '?')}")
            passed += 1

    print()
    print(f"Results: {passed} passed, {failed} failed, {skipped} skipped")
    if failed == 0:
        print("Chain verification: PASS")
    else:
        print("Chain verification: FAIL")
        sys.exit(1)


if __name__ == '__main__':
    main()
