# STELE

**The accountability primitive for AI agents.**

![Tests](https://img.shields.io/badge/tests-4%2C709%20passing-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-74%20suites-blue)
![Packages](https://img.shields.io/badge/packages-25-orange)
![License](https://img.shields.io/badge/license-MIT-green)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![Node](https://img.shields.io/badge/node-18%20%7C%2020%20%7C%2022-green)

## What Stele Does

Agents publish signed **Covenants** -- cryptographic behavioral commitments declaring
what they will do, what they will not do, and what happens when they violate.
Every action is evaluated against constraints written in CCL (Covenant Constraint
Language) in real-time. Anyone can verify compliance independently using Ed25519
signatures and SHA-256 content addressing. No trusted third party required.

## Quick Start

```bash
npm install @stele/sdk
```

```typescript
import { SteleClient } from '@stele/sdk';

const client = new SteleClient();
await client.generateKeyPair();

// Create a covenant
const covenant = await client.createCovenant({
  issuer: { id: 'operator-1', publicKey: client.keyPair!.publicKeyHex, role: 'issuer' },
  beneficiary: { id: 'user-1', publicKey: '...', role: 'beneficiary' },
  constraints: "permit read on '/data/**'\ndeny write on '/system/**'",
});

// Verify
const result = await client.verifyCovenant(covenant);
console.log(result.valid); // true

// Evaluate an action
const eval = await client.evaluateAction(covenant, 'read', '/data/file.txt');
console.log(eval.permitted); // true
```

## The Protocol

Stele works in three steps:

1. **Inscribe** -- An agent publishes a signed Covenant: a cryptographic document
   specifying behavioral constraints, the issuer who operates the agent, and the
   beneficiary whose interests are protected.

2. **Operate** -- Every action the agent takes is evaluated against its covenant
   constraints in real-time. The enforcement monitor gates execution, checks rate
   limits, and produces a hash-chained audit trail.

3. **Verify** -- Anyone can verify compliance independently. Verification runs 11
   specification checks (signature validity, expiration, CCL parsing, chain depth,
   document size, nonce presence, and more) using only the public key and the
   document itself.

## Packages

### Foundation

| Package | Description |
|---------|-------------|
| `@stele/types` | Error hierarchy, validation guards, logging, tracing, retry utilities |
| `@stele/crypto` | Ed25519 signing, SHA-256 hashing, JCS canonicalization |
| `@stele/ccl` | Covenant Constraint Language parser & evaluator |
| `@stele/core` | Covenant build, verify, chain, serialize, countersign |
| `@stele/store` | MemoryStore + FileStore pluggable persistence |
| `@stele/verifier` | Stateful verification engine with 11 specification checks |
| `@stele/identity` | Agent identity creation, evolution & lineage tracking |

### SDK

| Package | Description |
|---------|-------------|
| `@stele/sdk` | SteleClient unified API, QuickCovenant builders, event system |

### Enforcement

| Package | Description |
|---------|-------------|
| `@stele/enforcement` | Runtime enforcement monitor with audit trail |
| `@stele/proof` | Poseidon-based compliance proof generation |
| `@stele/breach` | Breach detection, attestation & trust graph propagation |
| `@stele/reputation` | Trust scoring with decay and stake-weighted reputation |
| `@stele/mcp` | MCP middleware guard for tool-call enforcement |

### Protocol

| Package | Description |
|---------|-------------|
| `@stele/attestation` | External attestation reconciliation |
| `@stele/canary` | Canary testing framework for constraint validation |
| `@stele/gametheory` | Game-theoretic honesty proofs and incentive analysis |
| `@stele/composition` | Formal constraint composition and verification |
| `@stele/antifragile` | Breach-to-improvement antifragility engine |
| `@stele/negotiation` | Multi-party covenant negotiation sessions |
| `@stele/consensus` | Accountability-based consensus protocol |
| `@stele/robustness` | Formal robustness and coverage analysis |
| `@stele/temporal` | Temporal evolution, triggers & scheduled transitions |
| `@stele/recursive` | Meta-covenants and recursive verification |
| `@stele/alignment` | AI alignment property verification |
| `@stele/norms` | Emergent norm discovery from behavioral patterns |
| `@stele/substrate` | Cross-substrate constraint translation |
| `@stele/derivatives` | Trust futures, insurance & derivative instruments |
| `@stele/legal` | Legal compliance mapping and audit trails |

### Platform

| Package | Description |
|---------|-------------|
| `@stele/react` | Reactive UI primitives (Observable, CovenantState) |
| `@stele/evm` | EVM anchoring, ABI encoding & on-chain registry |
| `@stele/mcp-server` | JSON-RPC 2.0 MCP server exposing Stele tools |
| `@stele/cli` | Command-line interface for the Stele protocol |

## CCL (Covenant Constraint Language)

CCL is a declarative rule language purpose-built for expressing behavioral constraints.
It supports four statement types: `permit`, `deny`, `require`, and `limit`.

```ccl
# Allow read access to the data directory
permit read on '/data/**'

# Block all writes to system paths
deny write on '/system/**'

# Conditional: allow API calls under a token budget
permit api.call on 'openai.com/**' when request.token_count < 10000

# Mandatory logging on all resources
require audit.log on '**'

# Rate limiting
limit api.call 500 per 3600 seconds
```

**Evaluation rules:**
- **Deny wins** -- if both a `permit` and a `deny` match, the `deny` takes precedence
- **Specificity tie-breaking** -- among same-type statements, the most specific match wins
- **Default deny** -- if no statement matches, the action is denied
- **Resource globs** -- `*` matches one level, `**` matches recursively

## Architecture

The monorepo is organized into five layers. Each layer depends only on the
layers below it:

```
+-----------------------------------------------------+
|                      Platform                        |
|        react  .  evm  .  mcp-server  .  cli          |
+-----------------------------------------------------+
|                        SDK                           |
|           sdk (SteleClient, QuickCovenant)            |
+-----------------------------------------------------+
|                      Protocol                        |
|    attestation . canary . gametheory . composition    |
|    antifragile . negotiation . consensus . robustness |
|    temporal . recursive . alignment . norms           |
|    substrate . derivatives . legal                    |
+-----------------------------------------------------+
|                    Enforcement                       |
|     enforcement . proof . breach . reputation . mcp   |
+-----------------------------------------------------+
|                    Foundation                        |
|    types . crypto . ccl . core . store . verifier .   |
|    identity                                          |
+-----------------------------------------------------+
```

**Foundation** provides cryptographic primitives, the type system, CCL, document
lifecycle, storage, verification, and identity management.

**Enforcement** provides runtime constraint enforcement: the Monitor that gates
agent actions, Poseidon-based compliance proofs, breach attestation, reputation
scoring, and MCP server wrapping.

**Protocol** contains advanced protocol features combining Foundation and
Enforcement primitives: attestation, canary testing, game theory, formal
composition, antifragility, negotiation, consensus, robustness, temporal
evolution, recursive meta-covenants, alignment verification, emergent norms,
cross-substrate translation, trust derivatives, and legal compliance.

**SDK** is a thin unification layer (`SteleClient`) that wraps Foundation
packages into a single ergonomic API with a typed event system.

**Platform** provides integration adapters: reactive UI primitives, EVM
blockchain anchoring, a JSON-RPC MCP server, and a CLI.

## Development

```bash
# Clone the repository
git clone https://github.com/agbusiness195/stele.git
cd stele

# Install all dependencies (npm workspaces)
npm install

# Build all packages (declarations + bundles)
npm run build

# Run the full test suite -- 4,327 tests across 66 suites
npx vitest run

# Type-check the entire project
npm run typecheck

# Run tests for a single package
npx vitest run packages/core

# Watch mode
npx vitest
```

**Prerequisites:** Node.js 18+ and npm 9+.

The project uses [Vitest](https://vitest.dev/) for testing, [tsup](https://tsup.egoist.dev/)
for bundling (ESM output), and `tsc --build` for type-checking and declaration generation.
All packages enforce TypeScript strict mode with no `any` types.

## Examples

Runnable examples live in the `examples/` directory:

| # | File | Description |
|---|------|-------------|
| 01 | `basic-covenant.ts` | Create, sign, verify, and evaluate a covenant |
| 02 | `delegation-chain.ts` | Chain delegation with narrowing constraints |
| 03 | `identity-lifecycle.ts` | Agent identity creation, evolution & lineage |
| 04 | `ccl-patterns.ts` | CCL patterns: conditions, rate limits, wildcards, merging |
| 05 | `store-and-query.ts` | Storage backends, filtering, batch ops, events |
| 06 | `multi-party-audit.ts` | Countersignatures and third-party verification |
| 07 | `advanced-enforcement.ts` | Enforcement, reputation, and breach tracking |

```bash
npx tsx examples/01-basic-covenant.ts
```

## Security

All covenant documents are signed with Ed25519 and content-addressed with SHA-256.
Signature comparisons use constant-time equality to prevent timing side-channel
attacks. Each document includes a 32-byte cryptographic nonce from a CSPRNG to
prevent replay attacks and ID prediction.

For responsible disclosure of security vulnerabilities, see [SECURITY.md](./SECURITY.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, code style
guidelines, CCL gotchas, and the pull request process.

## License

MIT
