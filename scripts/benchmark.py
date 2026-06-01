#!/usr/bin/env python3
"""
Real performance benchmarks for the nobulex Python SDK.

Measures the actual hot path:
  receipt generation, JCS canonicalization, Ed25519 sign, action_ref compute,
  receipt verification, hash chain append + verify.

Run from repo root: python3 scripts/benchmark.py
"""
import sys, time, statistics, json, os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "packages" / "python"))

from nobulex.agent import Agent
from nobulex.chain import ReceiptChain
from nobulex.crypto import (
    KeyPair, jcs_canonicalize, sha256_hex, compute_action_ref,
)


def bench(label, fn, n=10_000, warmup=100):
    """Run fn() n times, return p50, p95, p99 in microseconds."""
    for _ in range(warmup):
        fn()
    samples = []
    for _ in range(n):
        t0 = time.perf_counter_ns()
        fn()
        samples.append((time.perf_counter_ns() - t0) / 1000)  # microseconds
    samples.sort()
    p50 = samples[n // 2]
    p95 = samples[int(n * 0.95)]
    p99 = samples[int(n * 0.99)]
    mean = statistics.mean(samples)
    return {"label": label, "n": n, "p50_us": p50, "p95_us": p95, "p99_us": p99, "mean_us": mean}


def main():
    print("=" * 64)
    print("nobulex SDK benchmarks (Python)")
    print("=" * 64)
    print()

    agent = Agent("bench-agent-001")
    preimage = {
        "agent_id": "bench-agent-001",
        "action_type": "transfer_funds",
        "scope": "100_USDC_to_acme",
        "timestamp_ms": 1748769600000,
    }
    canonical_preimage = jcs_canonicalize(preimage)
    key = KeyPair()

    results = []

    # 1. JCS canonicalization (RFC 8785)
    results.append(bench("JCS canonicalize (4-field preimage)", lambda: jcs_canonicalize(preimage)))

    # 2. action_ref compute (JCS + SHA-256)
    results.append(bench("action_ref compute (JCS + SHA-256)",
                         lambda: compute_action_ref(**preimage)))

    # 3. Ed25519 sign (the actual signature operation)
    results.append(bench("Ed25519 sign (over canonical preimage)",
                         lambda: key.sign(canonical_preimage.encode())))

    # Pre-generate one signature to benchmark verify
    sig = key.sign(canonical_preimage.encode())
    pub = key.public_bytes

    # 4. Ed25519 verify
    results.append(bench("Ed25519 verify",
                         lambda: KeyPair.verify_signature(pub, sig, canonical_preimage.encode())))

    # 5. Full receipt generation (agent.act)
    results.append(bench("agent.act (full signed receipt end-to-end)",
                         lambda: agent.act("transfer_funds", scope="100_USDC_to_acme"),
                         n=2000))

    # 6. Receipt verify (full signature check)
    receipt = agent.act("transfer_funds", scope="100_USDC_to_acme")
    results.append(bench("receipt.verify() (full verification)",
                         lambda: receipt.verify(),
                         n=5000))

    # 7. Hash chain append
    chain = ReceiptChain(agent_id="bench-chain")
    results.append(bench("ReceiptChain.append (signed + hash linked)",
                         lambda: chain.append("transfer_funds", scope="acme"),
                         n=2000))

    print(f"{'operation':50s} {'p50 (us)':>12s} {'p95 (us)':>12s} {'p99 (us)':>12s}")
    print("-" * 90)
    for r in results:
        print(f"{r['label']:50s} {r['p50_us']:>10.2f}   {r['p95_us']:>10.2f}   {r['p99_us']:>10.2f}")
    print()

    # Throughput summary for the headline number
    act_p50_us = next(r["p50_us"] for r in results if r["label"].startswith("agent.act"))
    receipts_per_sec = 1_000_000 / act_p50_us
    print(f"Headline: ~{int(receipts_per_sec):,} signed receipts/sec at the p50 hot path.")
    print()

    out_path = Path(__file__).parent.parent / "fixtures" / "benchmarks.json"
    out_path.write_text(json.dumps({
        "sdk": "nobulex-python-0.1.0",
        "python": sys.version.split()[0],
        "platform": sys.platform,
        "results": results,
        "throughput_signed_receipts_per_sec": int(receipts_per_sec),
    }, indent=2))
    print(f"Saved: {out_path}")


if __name__ == "__main__":
    main()
