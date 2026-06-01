# Nobulex Performance Benchmarks

Real numbers from the Python SDK. Reproducible with `python3 scripts/benchmark.py` from the repo root. The benchmark machine is a developer laptop, not a tuned server.

## Headline

**~13,683 signed receipts/sec** at p50. A full signed and hash-chained receipt — including JCS canonicalization (RFC 8785), SHA-256 hash, Ed25519 signature, and chain-link computation — takes about 73 microseconds end-to-end.

That means a single nobulex instance can audit an agent that takes 10,000 actions per second without becoming the bottleneck.

## Per-operation breakdown

| Operation | p50 (μs) | p95 (μs) | p99 (μs) |
|-----------|---------:|---------:|---------:|
| JCS canonicalize (4-field preimage) | 3.50 | 4.62 | 4.92 |
| `action_ref` compute (JCS + SHA-256) | 4.00 | 4.54 | 10.71 |
| Ed25519 sign (over canonical preimage) | 67.88 | 77.25 | 122.67 |
| Ed25519 verify | 136.21 | 165.33 | 185.42 |
| `agent.act` (full signed receipt end-to-end) | 73.08 | 94.54 | 115.33 |
| `receipt.verify()` (full verification) | 143.12 | 169.79 | 185.75 |
| `ReceiptChain.append` (signed + hash-linked) | 73.92 | 91.75 | 103.67 |

Sample size: 10,000 iterations per operation (2,000 for `agent.act` and `chain.append`, 5,000 for `receipt.verify`). Each measurement is wall-clock time via `time.perf_counter_ns`. Warm-up of 100 iterations before measurement to settle CPU caches.

## What this means in practice

**Signing is fast, verification is slower (as expected).** Ed25519 verify is roughly 2× sign cost. This is the standard Ed25519 asymmetry. Verification still completes in ~140 microseconds, so a verifier can process ~7,000 receipts per second per core.

**Canonicalization is not the bottleneck.** JCS canonicalization runs in under 5 microseconds for the 4-field preimage. Most of the wall-clock budget is in the elliptic curve operations, not the JSON serialization.

**The chain primitive adds essentially no overhead.** `ReceiptChain.append` measures 73.92 μs versus `agent.act` at 73.08 μs. The hash-linking is a single SHA-256 on top of the already-signed receipt, which adds well under a microsecond.

## Comparison to alternatives

| Approach | Throughput (signed/sec) | Tamper detection | Independent verification |
|----------|------------------------:|:----------------:|:-----------------------:|
| Plain log file (e.g. JSON Lines) | 100,000+ | ❌ | ❌ |
| Database INSERT (Postgres + audit table) | 5,000-20,000 | partial (DB-trusted) | ❌ (requires DB access) |
| **Nobulex (Ed25519 + JCS hash chain)** | **13,683** | ✅ | ✅ |
| HSM-signed records | 100-1,000 | ✅ | ✅ (slower) |
| Blockchain anchor (Ethereum/L2) | 1-10 | ✅ | ✅ (much slower, costs gas) |

Nobulex sits in the sweet spot: cryptographically tamper-evident and independently verifiable, at a throughput that does not bottleneck a typical agent workload. For workloads that need extra non-repudiation guarantees (e.g. payment receipts), anchoring nobulex digests on-chain via AgentAudit adds blockchain durability without changing the hot-path throughput.

## Reproducing

```bash
git clone https://github.com/arian-gogani/nobulex.git
cd nobulex
pip install -e packages/python
python3 scripts/benchmark.py
```

The script writes raw results to `fixtures/benchmarks.json` so you can graph them or diff against future runs.

## Methodology notes

- Single-threaded Python on a 2024-era developer laptop (Apple Silicon). No GPU or HSM.
- Each measurement is end-to-end wall-clock from inside Python, including any allocation.
- Warm-up iterations are not counted toward statistics.
- p50/p95/p99 are computed from the sorted sample array, not a streaming estimator.

If you reproduce these on different hardware and the numbers differ materially, open an issue. Performance regressions in this SDK should fail the next CI run.
