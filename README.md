# STELE

**The accountability primitive for AI agents.**

Every AI agent running today operates on implicit trust. Stele makes that trust
explicit, cryptographic, and verifiable.

## What Stele Does

Agents publish **Covenants** — signed behavioral commitments declaring what they
WILL do, what they WON'T do, and what happens if they violate. Anyone can verify
compliance independently, using math alone. No trusted third party required.

## Quick Start

```bash
npm install @stele/core @stele/mcp
```

```typescript
import { SteleGuard } from '@stele/mcp';

// Wrap any MCP server in 2 lines
const server = await SteleGuard.wrap(myMCPServer, {
  constraints: 'standard:data-isolation'
});

// Every tool call is now:
// - Evaluated against behavioral constraints
// - Logged to a tamper-evident audit trail
// - Producing verifiable execution receipts
```

## The Protocol

**Inscribe** — Agent publishes a signed Covenant
**Operate** — Actions enforced against constraints in real-time
**Verify** — Anyone verifies compliance with zero trust assumptions

## Why This Matters

By 2027, autonomous AI agents will manage trillions in economic activity.
No infrastructure exists to hold them accountable. Stele is that infrastructure.

## Packages

| Package | Description |
|---------|-------------|
| `@stele/core` | Covenant lifecycle (build, sign, verify) |
| `@stele/crypto` | Ed25519, hashing, canonicalization |
| `@stele/ccl` | Constraint language parser & evaluator |
| `@stele/enforcement` | Runtime enforcement (Monitor + CapabilityGate) |
| `@stele/identity` | Composite agent identity & lineage |
| `@stele/reputation` | Execution receipts & trust scoring |
| `@stele/proof` | ZK proof generation & verification |
| `@stele/breach` | Breach attestation & trust graph |
| `@stele/mcp` | MCP server middleware |
| `@stele/cli` | Command-line tool |

## Architecture

```
stele/
├── packages/
│   ├── crypto/          # Cryptographic primitives (Ed25519, SHA-256, JCS)
│   ├── ccl/             # Covenant Constraint Language (lexer, parser, evaluator)
│   ├── core/            # Covenant lifecycle (build, sign, verify, chain)
│   ├── identity/        # Composite agent identity & lineage tracking
│   ├── enforcement/     # Runtime enforcement (Monitor + CapabilityGate)
│   ├── proof/           # ZK proof generation & verification (Poseidon)
│   ├── reputation/      # Execution receipts & trust scoring
│   ├── breach/          # Breach attestation & trust graph propagation
│   ├── mcp/             # MCP middleware integration
│   └── cli/             # Command-line developer tool
├── tests/               # Integration & e2e tests
└── examples/            # Usage examples
```

## Development

```bash
# Install dependencies
npm install

# Build all packages (declarations + bundles)
npm run build

# Run tests (521 tests across 9 suites)
npm test

# Type check
npm run typecheck

# Watch mode
npm run test:watch
```

## Build Order

Packages are built in dependency order:

1. `@stele/crypto` — zero internal dependencies
2. `@stele/ccl` — depends on crypto
3. `@stele/core` — depends on crypto, ccl
4. `@stele/identity` — depends on crypto
5. `@stele/enforcement` — depends on crypto, ccl, core
6. `@stele/proof` — depends on crypto, ccl
7. `@stele/reputation` — depends on crypto, core, identity
8. `@stele/breach` — depends on crypto, core
9. `@stele/mcp` — depends on all above
10. `@stele/cli` — depends on all above

## CCL (Covenant Constraint Language)

```ccl
# Permissions
permit file.read on '/data/**'
deny file.write on '/system/**' severity critical

# Conditions
permit api.call on 'openai.com/**' when request.token_count < 10000
deny network.send on '**' when payload.contains_pii = true severity critical

# Obligations
require audit.log on '**' severity critical

# Rate limits
limit api.call 500 per 3600 seconds
```

## License

MIT
