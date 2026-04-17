# Nobulex

[![CI](https://github.com/arian-gogani/nobulex/actions/workflows/ci.yml/badge.svg)](https://github.com/arian-gogani/nobulex/actions)

**AI agents can't prove they followed their own rules. Nobulex fixes that.**

```bash
$ npx tsx examples/demo.ts

Agent A declares covenant: permit read, forbid transfer > 500
Agent A executes 5 actions...
  ✓ read /data/users — allowed
  ✓ transfer $300 — allowed
  ✓ read /data/orders — allowed
  ✗ transfer $600 — BLOCKED by covenant
  ✓ read /data/config — allowed

Agent B verifies Agent A...
  ✓ Step 1: Covenant signature valid
  ✓ Step 2: Proof signature valid
  ✓ Step 3: Log integrity verified (5 entries, chain intact)
  ✓ Step 4: Compliance check passed (0 violations)
  ✓ Step 5: History length sufficient (5 ≥ 1)
  ✓ Step 6: Covenant matches requirements
  ✓ Step 7: Audience binding confirmed
  ✓ Step 8: Task class verified

Result: Agent B trusts Agent A ✅

Agent C presents tampered proof...
  ✓ Step 1: Covenant signature valid
  ✓ Step 2: Proof signature valid
  ✗ Step 3: FAILED — hash chain broken at entry 2

Result: Agent B refuses Agent C ❌
```

Three primitives. That's the whole protocol:

1. **Declare** — write rules: `permit`, `forbid`, `require`
2. **Enforce** — check every action *before* it runs
3. **Prove** — tamper-evident hash chain anyone can verify

![Tests](https://img.shields.io/badge/tests-3%2C648%20passing-brightgreen)
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

## Cross-Agent Verification Handshake

Before two agents transact, they verify each other's proof-of-behavior. **No proof, no transaction.**

```typescript
import { generateProof, verifyCounterparty } from '@nobulex/sdk';

// Agent A generates its proof-of-behavior
const proof = await generateProof({
  identity: agentA,
  covenant: spec,
  actionLog: middleware.getLog(),
});

// Agent B verifies Agent A before transacting
const result = await verifyCounterparty(proof);

if (!result.trusted) {
  console.log('Refusing transaction:', result.reason);
  return; // No proof, no transaction
}

// Safe to transact — Agent A is verified
await executeTransaction(proof.agentDid, amount);
```

The handshake checks eight things in order: covenant signature, proof signature, log integrity, compliance, minimum history, required covenant, audience binding, and task class scoping. If any check fails, the transaction is refused.

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
│  │ middleware  │  │ verification │  │    core       │       │
│  │(pre-exec)  │  │ (post-hoc)   │  │(trust graph)  │       │
│  └────────────┘  └──────────────┘  └───────────────┘       │
├─────────────────────────────────────────────────────────────┤
│                      Foundation                             │
│                 crypto  ·  types                            │
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
npx tsx examples/demo.ts
```

Creates two agents, defines behavioral rules, enforces at runtime, blocks a forbidden transfer, generates a proof-of-behavior, runs the 8-step handshake, and then shows the same handshake rejecting a third agent whose log was tampered with — all in one script.

```bash
npx tsx examples/langchain-agent.ts   # covenant enforcement around a mocked LangChain agent
npx tsx benchmarks/bench.ts           # protocol performance on your hardware
```

## Security Audit

We've conducted an internal security review. Here's what we tested and what we found:

**Verified secure:**
- Hash chain integrity: modifying any entry breaks the chain (property-tested with fast-check across random chains of varying length).
- Signature forgery: invalid signatures are rejected 100% of the time.
- Replay attack prevention: audience-bound proofs fail when replayed to a different verifier (property-tested).
- Covenant enforcement: forbidden actions are blocked *before* execution, never after — the handler never runs.

**Known limitations:**
- No key revocation mechanism yet — compromised keys remain trusted until removed out-of-band.
- No rate limiting on handshake verification — potential DoS vector under adversarial load.
- Single-threaded chain verification — chains above ~100K entries take visible time (see [benchmarks](benchmarks/README.md)).
- Clock skew tolerance is 0 — agents with desynchronized clocks may fail timestamp checks.

**Not in scope:**
- Model-level safety (prompt injection, jailbreaking) — use guardrails for that.
- Network transport security — use TLS.
- Key storage — use your platform's HSM or key vault.

See [docs/threat-model.md](docs/threat-model.md) for the full threat model.

## Development

```bash
git clone https://github.com/arian-gogani/nobulex.git
cd nobulex
npm install
npx vitest run             # full test suite (incl. fast-check property tests)
npx tsx examples/demo.ts   # see the protocol run end-to-end
npx tsx benchmarks/bench.ts
```

## Documentation

- **[API Reference](docs/api/)** — Full API docs generated with TypeDoc (`npm run docs:api`)
- **[Proof-of-Behavior Spec](docs/proof-of-behavior-spec.md)** — Formal standard specification (CC-BY-4.0)
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
