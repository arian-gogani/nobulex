# Nobulex SDK Examples

Runnable TypeScript examples demonstrating the Nobulex protocol SDK.

## Running

```bash
npx tsx examples/01-basic-covenant.ts
```

## Examples

| # | File | Description |
|---|------|-------------|
|  - | demo.ts | **Start here**  - end-to-end interactive demo: two agents verify each other over the Nobulex protocol, including a tampered-log failure case. See below. |
| 01 | basic-covenant.ts | Create, sign, verify, and evaluate a covenant |
| 02 | delegation-chain.ts | Chain delegation with narrowing constraints |
| 03 | identity-lifecycle.ts | Agent identity creation, evolution, and lineage |
| 04 | ccl-patterns.ts | CCL constraint patterns: conditions, rate limits, wildcards, merging |
| 05 | store-and-query.ts | Storage backends, filtering, batch ops, events |
| 06 | multi-party-audit.ts | Countersignatures and third-party verification |
| 07 | advanced-enforcement.ts | Enforcement, reputation, and breach tracking |
| 08 | covenant-with-when.ts | Covenant with conditional `when` clauses and context evaluation |
| 09 | kova-audit-report.ts | Generate EU AI Act compliance report with computeEUCompliance |
| 10 | mcp-custom-covenant.ts | MCP server wrapped with custom CCL (not preset) |
| 11 | identity-evolution-lineage.ts | Identity evolution and lineage chain inspection |

## End-to-end demo (`demo.ts`)

A colorful, standalone walkthrough of the full proof-of-behavior protocol: two
autonomous agents, real DID key pairs, a real enforcement middleware, real
hash-chained action logs, and the real 8-step `verifyCounterparty()` handshake
from `@nobulex/sdk`.

### Run it

```bash
npx tsx examples/demo.ts
```

No flags, no env vars, no network, no files written. `tsx` is not installed at
the repo root; `npx tsx` will fetch it on first run. If you prefer, you can
also use any other TypeScript runner (`ts-node`, `bun examples/demo.ts`, etc.)
 - the file has no runtime dependencies beyond the `@nobulex/*` workspace
packages.

### Prerequisites

All workspace packages must be built once so that their `dist/` folders exist
(the demo imports `@nobulex/sdk`, `@nobulex/middleware`, `@nobulex/identity`,
and `@nobulex/covenant-lang` via workspace resolution):

```bash
npm run build
```

### What you'll see

1. **Scenario 1  - honest agent.** Agent A declares a `SafeTrader` covenant
   (`permit read; permit transfer (amount <= 500); forbid transfer (amount > 500); forbid delete;`),
   runs 5 actions through `EnforcementMiddleware` (4 allowed, 1 blocked at
   runtime), builds a proof via `generateProof()`, and Agent B runs
   `verifyCounterparty()` against it. You'll see each of the 8 handshake
   checks printed with a green ✓, followed by **"Agent B trusts Agent A"**.

2. **Scenario 2  - tampered log.** Agent C builds the same valid history, then
   the demo directly mutates the `hash` field of one `ActionLogEntry` in its
   log before calling `generateProof()`. When Agent B runs the handshake, the
   real `verifyIntegrity()` call inside step 3 catches the broken hash chain,
   the handshake short-circuits, later steps are shown as skipped, and the
   demo prints **"Agent B refuses Agent C"** in red along with the real error
   message from `@nobulex/action-log`.

### Step labels

The 8 step labels printed by the demo are copied verbatim from the source
comments inside `packages/sdk/src/handshake.ts`  - they match the actual order
and semantics of the checks inside `verifyCounterparty()`.
