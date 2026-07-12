"""
Nobulex conformance driver for agent-governance-testvectors.

Produces v1 flat receipts from the test fixtures, signed with Ed25519
over JCS-canonical bytes. Chain linked via parent_receipt_hash.

Usage:
    cd /path/to/agent-governance-testvectors
    PYTHONPATH=/path/to/nobulex/packages/python python implementations/nobulex/driver.py
"""

import json
import hashlib
import os
import sys
import time
from pathlib import Path


NOBULEX_PYTHON = os.environ.get(
    "NOBULEX_PYTHON",
    str(Path.home() / "github" / "nobulex" / "packages" / "python")
)
sys.path.insert(0, NOBULEX_PYTHON)

from nobulex.crypto import KeyPair


def jcs_canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_hex(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return "sha256:" + hashlib.sha256(data).hexdigest()


def load_keypair_from_seed():
    seed = bytes(31) + b"\x01"
    return KeyPair.from_seed(seed)


def build_receipt(seq, tool_name, tool_input, decision, policy_id,
                  parent_hash, keypair):
    receipt_id = f"rcpt-nobulex-{seq:04d}"

    payload = {
        "receipt_id": receipt_id,
        "receipt_version": "1.0",
        "issuer_id": "nobulex",
        "tool_name": tool_name,
        "tool_input": tool_input,
        "input_hash": sha256_hex(jcs_canonical(tool_input)),
        "decision": decision,
        "policy_id": policy_id,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sequence": seq,
        "parent_receipt_hash": parent_hash,
        "public_key": keypair.public_hex,
    }

    canonical = jcs_canonical(payload)
    signature = keypair.sign_hex(canonical.encode("utf-8"))
    payload["signature"] = signature
    return payload, canonical


def main():
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parents[1]
    inputs_dir = repo_root / "fixtures" / "inputs"
    output_dir = script_dir / "output"
    output_dir.mkdir(exist_ok=True)

    keypair = load_keypair_from_seed()
    print(f"Public key: {keypair.public_hex[:32]}...")

    input_files = sorted(inputs_dir.glob("*.json"))
    parent_hash = None
    policy_id = "autoresearch-safe"

    for f in input_files:
        with open(f) as fh:
            inp = json.load(fh)

        receipt, canonical = build_receipt(
            seq=inp["sequence"],
            tool_name=inp["tool_name"],
            tool_input=inp["tool_input"],
            decision=inp["expected_decision"],
            policy_id=policy_id,
            parent_hash=parent_hash,
            keypair=keypair,
        )

        out_file = output_dir / f"receipt-{inp['sequence']:04d}.json"
        with open(out_file, "w") as fh:
            json.dump(receipt, fh, indent=2)

        sig_ok = KeyPair.verify_signature(
            keypair.public_bytes,
            bytes.fromhex(receipt["signature"]),
            canonical.encode("utf-8"),
        )

        print(f"  [{inp['sequence']}] {inp['tool_name']:10s} -> {receipt['decision']:5s}  "
              f"sig={sig_ok}  hash={receipt['input_hash'][:30]}...")

        parent_hash = sha256_hex(canonical)

    print(f"\n{len(input_files)} receipts written to {output_dir}")


if __name__ == "__main__":
    main()
