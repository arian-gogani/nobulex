# Nobulex benchmarks

A self-contained performance suite for the Nobulex protocol surface. No
external benchmarking libraries  - just Node's `perf_hooks.performance.now()`
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
| keygen            | `generateKeyPair()`  - Ed25519 key pair generation           |
| sha256-1kb        | `sha256()` over a 1 KB buffer                               |
| sha256-10kb       | `sha256()` over a 10 KB buffer                              |
| sha256-100kb      | `sha256()` over a 100 KB buffer                             |
| sign              | Ed25519 `sign()` of a 32-byte digest                        |
| verify            | Ed25519 `verify()` of a valid signature                     |
| covenant-eval-3   | compiled enforcement fn against a 3-rule covenant           |
| covenant-eval-50  | compiled enforcement fn against a 50-rule generated covenant |
| handshake-N       | full `verifyCounterparty()` over a proof of N action-log entries |
| chain-build-1000  | `ActionLogBuilder.append` x 1000 + `toLog()`                |
| chain-verify-1000 | `verifyIntegrity()` over a 10 000-entry action log          |
| chain-verify-partial-100 | `verifyPartial(log, 100)` over the same 10 000-entry log |

### Methodology

- Every benchmark runs a **warm-up** equal to 5% of its iteration count
  before taking measurements, so the JIT has time to settle. Warmup samples
  are discarded.
- Each iteration is timed individually. After the loop the samples are
  sorted once and `mean`, `p50`, `p95`, `p99` are computed inline.
- `ops/sec` is reported for the fast benches (keygen, sha256, sign, verify,
  covenant-eval). For the handshake / chain benchmarks  - where the workload
  itself is a pipeline  - the `ops/sec` column shows ` -` and the user should
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
| chain-verify-1000 | 50    |
| chain-verify-partial-100 | 50 |

## Latest run

Date: 2026-04-14T07:56:46.964Z
Host: Apple M4 Max · arm64 · Node v25.1.0

```
Node v25.1.0 · arm64 · Apple M4 Max

name                     | iters | mean(ms) | p50(ms) | p95(ms) | p99(ms) | ops/sec
-------------------------+-------+----------+---------+---------+---------+--------
keygen                   |  1000 |   0.1174 |  0.1148 |  0.1363 |  0.1687 |    8.5k
sha256-1kb               |  5000 |  0.00487 | 0.00479 | 0.00521 | 0.00687 |  205.3k
sha256-10kb              |  3000 |   0.0372 |  0.0375 |  0.0410 |  0.0469 |   26.9k
sha256-100kb             |  1000 |   0.3586 |  0.3562 |  0.3874 |  0.4030 |    2.8k
sign                     |  1000 |   0.2129 |  0.2117 |  0.2420 |  0.2553 |    4.7k
verify                   |  1000 |   0.8128 |  0.8085 |  0.8565 |  0.9064 |    1.2k
covenant-eval-3          | 10000 |  0.00067 | 0.00062 | 0.00079 | 0.00133 |   1.50M
covenant-eval-50         | 10000 |  0.00095 | 0.00100 | 0.00108 | 0.00129 |   1.06M
handshake-10             |   200 |    1.841 |   1.829 |   1.949 |   2.028 |        -
handshake-100            |   100 |    2.590 |   2.584 |   2.695 |   2.984 |        -
handshake-1000           |    50 |    10.23 |   10.14 |   11.26 |   11.69 |        -
handshake-10000          |    50 |    86.39 |   86.56 |   88.23 |   93.56 |        -
chain-build-1000         |    50 |    3.738 |   3.732 |   3.925 |   3.988 |        -
chain-verify-1000        |    50 |    31.38 |   30.94 |   32.26 |   53.92 |        -
chain-verify-partial-100 |    50 |   0.2897 |  0.2870 |  0.3138 |  0.3287 |        -
```

Note: `chain-verify-1000` now runs over a 10 000-entry log (same chain as
`chain-verify-partial-100`), so the two rows are directly comparable  -
partial verification of the last 100 entries is roughly 100× faster than
re-hashing the full 10 000 entry chain.

### Reading the numbers

- **keygen / sign / verify** track ed25519 via `@noble/ed25519`. Verify is
  ~4x slower than sign, as expected.
- **covenant-eval-3 vs covenant-eval-50** shows the compiled enforcement
  function scales sub-linearly in rule count  - going from 3 to 50 rules
  only ~1.4x'd the per-eval cost. Most of the overhead is in matching the
  action name, not in walking condition lists.
- **handshake** is dominated by signature verification + hash-chain
  integrity. The ~120ms figure at 10k entries corresponds to roughly
  12 µs/entry, which is consistent with the `sha256-1kb` number above
  once you account for canonicalization.
- **chain-build-1000** (~5.4 ms) and **chain-verify-1000** (~4.2 ms) are
  both comfortably in the "fine for per-request work" range.
