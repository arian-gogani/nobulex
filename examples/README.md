# Nobulex SDK Examples

Runnable TypeScript examples demonstrating the Nobulex protocol SDK.

## Running

```bash
npx tsx examples/01-basic-covenant.ts
```

## Examples

| # | File | Description |
|---|------|-------------|
| — | get-started-with-nobulex.ts | **Start here** — 3 lines: wrap MCP server with Nobulex |
| 01 | basic-covenant.ts | Create, sign, verify, and evaluate a covenant |
| 02 | delegation-chain.ts | Chain delegation with narrowing constraints |
| 03 | identity-lifecycle.ts | Agent identity creation, evolution, and lineage |
| 04 | ccl-patterns.ts | CCL constraint patterns: conditions, rate limits, wildcards, merging |
| 05 | store-and-query.ts | Storage backends, filtering, batch ops, events |
| 06 | multi-party-audit.ts | Countersignatures and third-party verification |
| 07 | advanced-enforcement.ts | Enforcement, reputation, and breach tracking |
| 08 | covenant-with-when.ts | Covenant with conditional `when` clauses and context evaluation |
| 09 | nobulex-audit-report.ts | Generate EU AI Act compliance report with computeEUCompliance |
| 10 | mcp-custom-covenant.ts | MCP server wrapped with custom CCL (not preset) |
| 11 | identity-evolution-lineage.ts | Identity evolution and lineage chain inspection |
