# Nobulex

**The accountability primitive for AI agents. Cryptographic behavioral commitments with trustless verification.**

Nobulex is an open protocol (MIT license) that enables autonomous AI agents to declare what they will and won't do, prove they followed through, and face economic consequences if they didn't. The way HTTPS enabled e-commerce by making connections trustworthy, Nobulex enables the agent economy by making behavior trustworthy.

![CI](https://github.com/agbusiness195/NOBULEX/actions/workflows/ci.yml/badge.svg)
![Packages](https://img.shields.io/badge/core%20packages-14-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)

## The Core Insight

You can't audit a neural network. But you **can** audit actions against stated commitments.

```
verify(covenant, actionLog) → { compliant: boolean, violations: Violation[] }
```

This is always decidable, always deterministic, always efficient.

## Quick Start

```bash
npm install @nobulex/identity @nobulex/covenant-lang @nobulex/middleware @nobulex/verification
```

```typescript
import { createDID } from '@nobulex/identity';
import { parseSource } from '@nobulex/covenant-lang';
import { EnforcementMiddleware } from '@nobulex/middleware';
import { verify } from '@nobulex/verification';

// 1. Create an agent identity
const agent = await createDID();

// 2. Write a covenant in the DSL
const spec = parseSource(`
  covenant SafeTrader {
    permit read;
    permit transfer (amount <= 500);
    forbid transfer (amount > 500);
    forbid delete;
  }
`);

// 3. Enforce with middleware
const mw = new EnforcementMiddleware({ agentDid: agent.did, spec });

// $300 transfer — allowed
await mw.execute(
  { action: 'transfer', params: { amount: 300 } },
  async () => ({ success: true }),
);

// $600 transfer — BLOCKED by covenant
await mw.execute(
  { action: 'transfer', params: { amount: 600 } },
  async () => ({ success: true }),  // never executes
);

// 4. Verify compliance
const result = verify(spec, mw.getLog());
console.log(result.compliant);    // true
console.log(result.violations);   // []
```

## The Six Primitives

| # | Primitive | What It Does | Package |
|---|-----------|-------------|---------|
| 1 | **Identity** | W3C DID for every agent (`did:nobulex:`) with Ed25519 keys | `@nobulex/identity` |
| 2 | **Covenant** | Cedar-inspired DSL: `permit`, `forbid`, `require` with conditions | `@nobulex/covenant-lang` |
| 3 | **Attestation** | W3C Verifiable Credential binding agent to covenant | `@nobulex/core-types` |
| 4 | **Action Log** | SHA-256 hash-chained tamper-evident record with Merkle proofs | `@nobulex/action-log` |
| 5 | **Verification** | Deterministic `verify(covenant, log)` with violation proofs | `@nobulex/verification` |
| 6 | **Enforcement** | On-chain staking/slashing with escalation | `@nobulex/contracts` |

## Two-Tier Guarantee Model

| Tier | Mechanism | Guarantee | When to Use |
|------|-----------|-----------|-------------|
| **Tier 1** | TEE Middleware (Intel SGX / AMD SEV) | Forbidden actions **physically cannot execute** | High-stakes: financial, medical, legal |
| **Tier 2** | Staking / Slashing (on-chain) | Violations are **economically irrational** | General purpose: commerce, data access |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Platform                              │
│          cli  ·  sdk  ·  elizaos-plugin                      │
├─────────────────────────────────────────────────────────────┤
│                    Covenant Primitives                        │
│                                                              │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐             │
│  │ identity │  │ covenant-lang│  │ action-log │             │
│  │  (DID)   │  │    (DSL)     │  │(hash-chain)│             │
│  └──────────┘  └──────────────┘  └────────────┘             │
│                                                              │
│  ┌────────────┐  ┌──────────────┐  ┌───────────────┐        │
│  │ middleware  │  │ verification │  │ composability │        │
│  │(pre-exec)  │  │ (post-hoc)   │  │(trust graph)  │        │
│  └────────────┘  └──────────────┘  └───────────────┘        │
│                                                              │
│  ┌─────┐  ┌───────────┐                                     │
│  │ tee │  │ contracts │                                     │
│  │(SGX)│  │(Solidity) │                                     │
│  └─────┘  └───────────┘                                     │
├─────────────────────────────────────────────────────────────┤
│                      Foundation                              │
│        core-types  ·  crypto  ·  evm                         │
└─────────────────────────────────────────────────────────────┘
```

## The Covenant DSL

```
covenant SafeTrader {
  permit read;
  permit transfer (amount <= 500);
  forbid transfer (amount > 500);
  forbid delete;
  require counterparty.compliance_score >= 0.8;
}
```

**Forbid wins.** If any `forbid` matches, the action is blocked regardless of permits. Default deny for unmatched actions. Conditions support `>`, `<`, `>=`, `<=`, `==`, `!=` on numeric, string, and boolean fields.

## Core Packages (9)

| Package | Description |
|---------|-------------|
| [`@nobulex/core-types`](packages/core-types/) | TypeScript interfaces for the six primitives |
| [`@nobulex/identity`](packages/identity/) | W3C DID creation, Ed25519 signing, DID document management |
| [`@nobulex/covenant-lang`](packages/covenant-lang/) | Cedar-inspired DSL: lexer, parser, compiler, serializer |
| [`@nobulex/action-log`](packages/action-log/) | Hash-chained action log with Merkle tree proofs |
| [`@nobulex/middleware`](packages/middleware/) | Pre-execution enforcement — blocks forbidden actions |
| [`@nobulex/verification`](packages/verification/) | Post-hoc verification with deterministic compliance checking |
| [`@nobulex/composability`](packages/composability/) | Covenant compatibility, agent matching, trust topology |
| [`@nobulex/tee`](packages/tee/) | TEE attestation for SGX, TDX, SEV-SNP with DID binding |
| [`@nobulex/contracts`](packages/contracts/) | Solidity staking/slashing contracts with TypeScript bindings |

## Platform Packages

| Package | Description |
|---------|-------------|
| [`@nobulex/sdk`](packages/sdk/) | Unified API combining all primitives |
| [`@nobulex/cli`](packages/cli/) | Command-line: `nobulex init`, `verify`, `deploy`, `inspect` |
| [`@nobulex/elizaos-plugin`](packages/elizaos-plugin/) | ElizaOS plugin: actions, evaluators, providers |

## On-Chain Contracts (Solidity)

Three contracts deployed to Ethereum (Sepolia testnet):

| Contract | Purpose |
|----------|---------|
| `CovenantRegistry` | Register covenant hashes on-chain, prevent duplicates |
| `StakeManager` | Stake ETH on covenants, lock/slash on violation |
| `SlashingJudge` | Submit violations, compute escalating penalties |

## Live Demo

```bash
npx tsx demo/covenant-demo.ts
```

Creates two agents, authors a covenant, enforces it via middleware, blocks a forbidden transfer, and verifies compliance — all in one script.

## Development

```bash
git clone https://github.com/agbusiness195/NOBULEX.git
cd NOBULEX
npm install
npx vitest run    # 6,062 tests, 112 files, 0 failures
```

## Documentation

- **[White Paper](docs/whitepaper.md)** — Formal protocol specification
- **[Getting Started](docs/getting-started.md)** — Developer guide with code examples
- **[Pitch Deck](docs/pitch-deck.md)** — 12-slide overview
- **[NIST RFI Response](docs/nist-rfi.md)** — AI agent security positioning

## Comparison

| | Bitcoin | Ethereum | Nobulex |
|---|---------|----------|---------|
| **What it trusts** | Monetary transfers | Contract execution | Agent behavior |
| **Trust mechanism** | Proof of Work | Proof of Stake | Proof of Compliance |
| **What's verified** | Transaction validity | State transitions | Behavioral commitments |
| **Guarantee** | Trustless money | Trustless agreements | Trustless agents |

## Links

- **Website:** [nobulex.com](https://nobulex.com)
- **npm:** [@nobulex](https://www.npmjs.com/org/nobulex)
- **GitHub:** [github.com/agbusiness195/NOBULEX](https://github.com/agbusiness195/NOBULEX)

## License

MIT
