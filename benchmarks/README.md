# Nobulex benchmarks

A self-contained performance suite for the Nobulex protocol surface. No
external benchmarking libraries — just Node's `perf_hooks.performance.now()`
and the workspace packages.

## Run

From the repo root:

```bash
npx tsx benchmarks/bench.ts
```

The workspace packages need to be built first (same as running the demo):

```bash
pnpm build
npx tsx benchmarks/bench.ts
```

## What it measures

| name              | workload                                                    |
|-------------------|-------------------------------------------------------------|
| keygen            | `generateKeyPair()` — Ed25519 key pair generation           |
| sha256-1kb        | `sha256()` over a 1 KB buffer                               |
| sha256-10kb       | `sha256()` over a 10 KB buffer                              |
| sha256-100kb      | `sha256()` over a 100 KB buffer                             |
| sign              | Ed25519 `sign()` of a 32-byte digest                        |
| verify            | Ed25519 `verify()` of a valid signature                     |
| covenant-eval-3   | compiled enforcement fn against a 3-rule covenant           |
| covenant-eval-50  | compiled enforcement fn against a 50-rule generated covenant |
| handshake-N       | full `verifyCounterparty()` over a proof of N action-log entries |
| chain-build-1000  | `ActionLogBuilder.append` x 1000 + `toLog()`                |
| chain-verify-1000 | `verifyIntegrity()` over a 1000-entry action log            |

### Methodology

- Every benchmark runs a **warm-up** equal to 5% of its iteration count
  before taking measurements, so the JIT has time to settle. Warmup samples
  are discarded.
- Each iteration is timed individually. After the loop the samples are
  sorted once and `mean`, `p50`, `p95`, `p99` are computed inline.
- `ops/sec` is reported for the fast benches (keygen, sha256, sign, verify,
  covenant-eval). For the handshake / chain benchmarks — where the workload
  itself is a pipeline — the `ops/sec` column shows `—` and the user should
  read `mean` as milliseconds-per-operation.
- The covenant evaluator path is the real one users take: `parseSource()`
  to build a `CovenantSpec`, then `compile(spec)` to get an `EnforcementFn`
  which is invoked per iteration. The large covenant is a programmatically
  generated 50-rule document using the same permit/forbid/amount-guard
  shapes the demo uses.
- For the handshake benchmarks the valid log is built once via
  `EnforcementMiddleware` (same path as `examples/demo.ts`) and wrapped in
  a proof via `generateProof()`. Only `verifyCounterparty()` is timed.

### Iteration counts

| bench             | iters |
|-------------------|-------|
| keygen            | 1000  |
| sha256-1kb        | 5000  |
| sha256-10kb       | 3000  |
| sha256-100kb      | 1000  |
| sign              | 1000  |
| verify            | 1000  |
| covenant-eval-3   | 10000 |
| covenant-eval-50  | 10000 |
| handshake-10      | 200   |
| handshake-100     | 100   |
| handshake-1000    | 50    |
| handshake-10000   | 50    |
| chain-build-1000  | 50    |
| chain-verify-1000 | 100   |

## Latest run

Date: 2026-04-15T06:23:20.519Z
Host: Apple M4 Max · arm64 · Node v25.1.0

```
Node v25.1.0 · arm64 · Apple M4 Max

name              | iters | mean(ms) | p50(ms) | p95(ms) | p99(ms) | ops/sec
------------------+-------+----------+---------+---------+---------+--------
keygen            |  1000 |   0.1544 |  0.1509 |  0.1749 |  0.2086 |    6.5k
sha256-1kb        |  5000 |  0.00687 | 0.00671 | 0.00725 | 0.00917 |  145.6k
sha256-10kb       |  3000 |   0.0531 |  0.0525 |  0.0565 |  0.0586 |   18.8k
sha256-100kb      |  1000 |   0.5170 |  0.5117 |  0.5534 |  0.5561 |    1.9k
sign              |  1000 |   0.3626 |  0.3189 |  0.4397 |  0.5925 |    2.8k
verify            |  1000 |    1.230 |   1.203 |   1.310 |   1.783 |     813
covenant-eval-3   | 10000 |  0.00094 | 0.00088 | 0.00108 | 0.00175 |   1.06M
covenant-eval-50  | 10000 |  0.00134 | 0.00137 | 0.00146 | 0.00162 |  747.2k
handshake-10      |   200 |    2.651 |   2.629 |   2.811 |   2.967 |       —
handshake-100     |   100 |    3.671 |   3.668 |   3.790 |   3.855 |       —
handshake-1000    |    50 |    14.43 |   14.43 |   14.63 |   14.67 |       —
handshake-10000   |    50 |   123.66 |  123.20 |  125.80 |  141.53 |       —
chain-build-1000  |    50 |    5.377 |   5.356 |   5.557 |   5.689 |       —
chain-verify-1000 |   100 |    4.249 |   4.226 |   4.401 |   4.599 |       —
```

### Reading the numbers

- **keygen / sign / verify** track ed25519 via `@noble/ed25519`. Verify is
  ~4x slower than sign, as expected.
- **covenant-eval-3 vs covenant-eval-50** shows the compiled enforcement
  function scales sub-linearly in rule count — going from 3 to 50 rules
  only ~1.4x'd the per-eval cost. Most of the overhead is in matching the
  action name, not in walking condition lists.
- **handshake** is dominated by signature verification + hash-chain
  integrity. The ~120ms figure at 10k entries corresponds to roughly
  12 µs/entry, which is consistent with the `sha256-1kb` number above
  once you account for canonicalization.
- **chain-build-1000** (~5.4 ms) and **chain-verify-1000** (~4.2 ms) are
  both comfortably in the "fine for per-request work" range.
