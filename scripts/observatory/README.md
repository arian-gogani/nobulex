# scripts/observatory

**The measurement harness for the Agent Reliability Index.**

This directory contains the code that runs the weekly methodology described in [`docs/AGENT-RELIABILITY-INDEX.md`](../../docs/AGENT-RELIABILITY-INDEX.md). The Charter Issue and subsequent weekly issues are produced by running this harness against the standardized prompt set, scoring the results, and rendering the output into the `observatory/` directory.

## Layout

| File | Purpose |
|---|---|
| `types.ts` | TypeScript schema for vendors, prompts, raw runs, per-prompt scores, weekly aggregates, and the published `Issue` artifact |
| `scoring.ts` | Pure scoring functions: statistical helpers, composite stability, CVRI formula, drift detection thresholds, vendor rollup |
| `scoring.test.ts` | Vitest tests for the scoring math (runs in the standard `npm test` pipeline) |
| `smoke-test.mjs` | Plain-Node smoke test mirroring the scoring functions; runs with `node scripts/observatory/smoke-test.mjs` and has no dependencies. Useful for verifying the math without the test framework. |

## Verifying the scoring math

The fastest way to verify the methodology code is correct:

```bash
node scripts/observatory/smoke-test.mjs
```

Expected output:

```
Agent Reliability Index  - scoring smoke tests
[…]
29 passed, 0 failed
```

The smoke test verifies:

- `mean`, `stddev` (sample, n-1 denominator), `zscore` on hand-computed inputs
- `compositeStability` weight allocation (0.30 lexical, 0.50 semantic, 0.20 structural)
- `computeCvri` formula with the v0.1 methodology weights
- CVRI status bands (≥95 ok, ≥85 advisory, ≥70 regression, else critical)
- Vendor-level drift detection thresholds (≥15% drifted prompts AND ≥5-point CVRI delta)

## What this directory does NOT contain

- **The actual 100-prompt set.** The standardized prompts are held privately to prevent vendors from training on them, which would defeat the measurement. The *shape* of the prompts (task class, expected format, prompt hash) is public via `PromptDescriptor` in `types.ts`.
- **The vendor API integration code.** Each vendor's API client lives in `packages/sdk` or vendor-specific package adapters. The observatory harness composes those clients.
- **The renderer for the weekly markdown issue.** That's intentionally not yet built  - the Charter Issue and `_template.md` in the `observatory/` directory are hand-written for now. A `render-issue.ts` script will be added in Issue 003+ once the format has stabilized.

## Methodology versioning

The current methodology is `v0.1`, defined in the `METHODOLOGY_V0_1` constant in `scoring.ts`. Per the editorial policy, methodology changes:

1. Are 12-week back-tested before going live
2. Are announced in the issue immediately preceding the change
3. Take effect with a clearly-marked version bump
4. Have the prior version archived (`METHODOLOGY_V0_1` is preserved; `METHODOLOGY_V0_2` is added)

This is a deliberate defense against the failure mode where a low-scoring vendor lobbies for retroactive methodology rehabilitation.

## Related

- Strategic rationale: [`docs/OBSERVATORY-VISION.md`](../../docs/OBSERVATORY-VISION.md)
- Full methodology spec: [`docs/AGENT-RELIABILITY-INDEX.md`](../../docs/AGENT-RELIABILITY-INDEX.md)
- Charter Issue: [`observatory/issue-001-charter.md`](../../observatory/issue-001-charter.md)
- Public landing page: [`website/observatory.html`](../../website/observatory.html)
