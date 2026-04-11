# Nobulex

**The proof-of-behavior protocol for autonomous AI agents.**

Every AI agent makes promises — "I won't transfer more than $500," "I'll only access approved APIs," "I won't touch production data." But today, there's no way to prove an agent kept those promises. Logs are written by the same software being audited. Compliance is asserted, never proven.

Nobulex changes that. Define behavioral rules. Enforce them before execution. Prove compliance with cryptography, not trust.

![CI](https://github.com/arian-gogani/nobulex/actions/workflows/ci.yml/badge.svg)
![Tests](https://img.shields.io/badge/tests-4%2C237%20passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)

## What is Proof-of-Behavior?

You can't audit a neural network. But you **can** audit actions against stated commitments.

```
verify(covenant, actionLog) → { compliant: boolean, violations: Violation[] }
```

This is always decidable, always deterministic, always efficient. No ML, no heuristics — mathematical proof.

**Proof-of-behavior** means every autonomous agent action is:
- **Declared** — behavioral rules defined before deployment in a formal language
- **Enforced** — violations blocked at runtime, before execution
- **Proven** — every action hash-chained into a tamper-evident audit trail that third parties can independently verify

## Quick Start

```bash
npm install @nobulex/sdk
```

```typescript
import { createDID } from '@nobulex/identity';
import { parseSource } from '@nobulex/covenant-lang';
import { EnforcementMiddleware } from '@nobulex/middleware';
import { verify } from '@nobulex/verification';

// 1. Create an agent identity
const agent = await createDID();

// 2. Write behavioral rules
const spec = parseSource(`
  covenant SafeTrader {
    permit read;
    permit transfer (amount <= 500);
    forbid transfer (amount > 500);
    forbid delete;
  }
`);

// 3. Enforce at runtime
const mw = new EnforcementMiddleware({ agentDid: agent.did, spec });

// $300 transfer — allowed
await mw.execute(
  { action: 'transfer', params: { amount: 300 } },
  async () => ({ success: true }),
);

// $600 transfer — BLOCKED before execution
await mw.execute(
  { action: 'transfer', params: { amount: 600 } },
  async () => ({ success: true }),  // never runs
);

// 4. Prove compliance
const result = verify(spec, mw.getLog());
console.log(result.compliant);    // true
console.log(result.violations);   // []
```

## Why Proof-of-Behavior Matters

| What exists today | What's missing |
|---|---|
| **Guardrails** filter prompts and outputs | No proof the agent followed rules at the action layer |
| **Monitoring** watches what agents do after the fact | No enforcement before execution |
| **Identity** verifies who the agent is | No verification of what the agent did |
| **Governance platforms** provide dashboards and policies | No cryptographic evidence a third party can independently verify |

Proof-of-behavior fills the gap: declare → enforce → prove.

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

**Forbid wins.** If any `forbid` matches, the action is immediately blocked regardless of permits. Default deny for unmatched actions. Conditions support `>`, `<`, `>=`, `<=`, `==`, `!=` on numeric, string, and boolean fields.

Three keywords. No configuration files. No YAML. No JSON schemas. Just rules.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Platform                             │
│              cli  ·  sdk  ·  mcp-server                     │
├─────────────────────────────────────────────────────────────┤
│                  Proof-of-Behavior Stack                    │
│                                                             │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐            │
│  │ identity │  │ covenant-lang│  │ action-log │            │
│  │  (DID)   │  │    (DSL)     │  │(hash-chain)│            │
│  └──────────┘  └──────────────┘  └────────────┘            │
│                                                             │
│  ┌────────────┐  ┌──────────────┐  ┌───────────────┐       │
│  │ middleware  │  │ verification │  │ composability │       │
│  │(pre-exec)  │  │ (post-hoc)   │  │(trust graph)  │       │
│  └────────────┘  └──────────────┘  └───────────────┘       │
├─────────────────────────────────────────────────────────────┤
│                      Foundation                             │
│            core-types  ·  crypto  ·  types                  │
└─────────────────────────────────────────────────────────────┘
```

## Core Packages

| Package | What It Does |
|---------|-------------|
| [`@nobulex/identity`](packages/identity/) | W3C DID creation with Ed25519 keys |
| [`@nobulex/covenant-lang`](packages/covenant-lang/) | Cedar-inspired DSL: lexer, parser, compiler |
| [`@nobulex/action-log`](packages/action-log/) | SHA-256 hash-chained tamper-evident log with Merkle proofs |
| [`@nobulex/middleware`](packages/middleware/) | Pre-execution enforcement — blocks violations before they run |
| [`@nobulex/verification`](packages/verification/) | Deterministic compliance verification |
| [`@nobulex/sdk`](packages/sdk/) | Unified API combining all primitives |
| [`@nobulex/mcp-server`](packages/mcp-server/) | MCP compliance server for any MCP-compatible agent |
| [`@nobulex/cli`](packages/cli/) | Command-line: `nobulex init`, `verify`, `inspect` |
| [`@nobulex/langchain`](packages/langchain/) | LangChain middleware integration ([PyPI](https://pypi.org/project/langchain-nobulex/)) |

## Integrations

- **npm** — `npm install @nobulex/sdk`
- **PyPI** — `pip install langchain-nobulex`
- **MCP** — `npx @nobulex/mcp-server` (works with Claude Desktop, Cursor, VS Code)
- **LangChain** — drop-in compliance middleware
- **ElizaOS** — plugin for actions, evaluators, providers

## Conceptual Comparison

| | Bitcoin | Ethereum | Nobulex |
|---|---------|----------|---------|
| **What it verifies** | Monetary transfers | Contract execution | Agent behavior |
| **Mechanism** | Proof of Work | Proof of Stake | **Proof of Behavior** |
| **What's proven** | Transaction validity | State transitions | Behavioral compliance |
| **Guarantee** | Trustless money | Trustless contracts | Trustless agents |

## Live Demo

```bash
npx tsx demo/covenant-demo.ts
```

Creates two agents, defines behavioral rules, enforces at runtime, blocks a forbidden transfer, and cryptographically verifies compliance — all in one script.

## Development

```bash
git clone https://github.com/arian-gogani/nobulex.git
cd nobulex
npm install
npx vitest run    # 4,237 tests, 80 files, 0 failures
```

## Documentation

- **[White Paper](docs/whitepaper.md)** — Formal protocol specification
- **[Getting Started](docs/getting-started.md)** — Developer guide
- **[NIST RFI Response](docs/nist-rfi.md)** — Formal comments to NIST AI Agent Standards Initiative

## Links

- **Website:** [nobulex.com](https://nobulex.com)
- **npm:** [@nobulex](https://www.npmjs.com/org/nobulex)
- **PyPI:** [langchain-nobulex](https://pypi.org/project/langchain-nobulex/)
- **NIST:** [Docket NIST-2025-0035](https://www.regulations.gov/docket/NIST-2025-0035) (public comment submitted)

## License

MIT — use it for anything.
