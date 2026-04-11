---
title: "Proof-of-Behavior: The Missing Trust Layer for AI Agents"
published: false
description: "AI agents make promises. Proof-of-behavior makes them provable. An open standard for how autonomous agents verify each other before transacting."
tags: ai, security, opensource, webdev
canonical_url: https://nobulex.com
---

## The Problem Nobody Is Solving

AI agents are moving money, signing contracts, and managing infrastructure. MCP handles tool connections. A2A handles agent-to-agent messaging. But nobody handles the most important question: **can you prove what the agent actually did?**

Right now, compliance is self-reported. Logs are written by the same software being audited. That's like asking a defendant to write their own court transcript.

## What Is Proof-of-Behavior?

Proof-of-behavior is a new concept: every autonomous agent action is **declared** in advance, **enforced** at runtime, and **proven** cryptographically.

**1. A constraint language** — Define what an agent can and cannot do:

```
covenant SafeTrader {
  permit read;
  permit transfer (amount <= 500);
  forbid transfer (amount > 500);
  forbid delete;
}
```

Three keywords. No YAML. No JSON schemas. Just rules.

**2. Runtime enforcement** — Every action is evaluated before execution. Forbidden actions are blocked, not logged-and-reported:

```typescript
const mw = new EnforcementMiddleware({ agentDid: agent.did, spec });

// $300 transfer — allowed
await mw.execute({ action: 'transfer', params: { amount: 300 } }, handler);

// $600 transfer — BLOCKED before execution
await mw.execute({ action: 'transfer', params: { amount: 600 } }, handler);
// handler never runs
```

**3. Cryptographic proof** — Every decision is logged in a SHA-256 hash chain. Tamper with one entry and the chain breaks:

```typescript
const result = verify(spec, mw.getLog());
// { compliant: true, violations: [] }
```

Always decidable, always deterministic. No ML, no heuristics.

## The Cross-Agent Handshake

Before two agents transact, they verify each other's proof-of-behavior:

```typescript
import { generateProof, verifyCounterparty } from '@nobulex/sdk';

// Agent A generates its proof
const proof = await generateProof({
  identity: agentA,
  covenant: spec,
  actionLog: middleware.getLog(),
});

// Agent B verifies before transacting
const result = await verifyCounterparty(proof);

if (!result.trusted) {
  console.log('Refusing transaction:', result.reason);
  return; // No proof, no transaction
}

await executeTransaction(proof.agentDid, amount);
```

**No proof, no transaction.** The moment one major framework adopts this handshake, every agent without proof-of-behavior gets locked out.

## Why Not Just Use Guardrails?

| What exists today | What's missing |
|---|---|
| Guardrails filter prompts and outputs | No proof at the action layer |
| Monitoring watches after the fact | No enforcement before execution |
| Identity verifies who the agent is | No verification of what it did |
| Governance provides dashboards | No cryptographic evidence for third parties |

Proof-of-behavior fills the gap: declare, enforce, prove.

## Try It Right Now

**Interactive playground (no install):** [nobulex.com/playground](https://nobulex.com/playground)

Define rules, test actions, watch the hash chain build — all in your browser.

**Install the SDK:**

```bash
npm install @nobulex/sdk
```

**Three lines to add proof-of-behavior:**

```typescript
const agent = await createDID();
const spec = parseSource(`covenant MyAgent { permit read; forbid write; }`);
const mw = new EnforcementMiddleware({ agentDid: agent.did, spec });
```

## The Specification

The [Proof-of-Behavior Specification v0.1.0](https://github.com/arian-gogani/nobulex/blob/main/docs/proof-of-behavior-spec.md) is published as an open standard under CC-BY-4.0. Anyone can implement it.

Nobulex is the reference implementation. MIT licensed, 4,244 tests, integrations on npm, PyPI, and MCP.

## Why Now?

The EU AI Act mandates tamper-evident logging for high-risk AI systems starting **August 2, 2026**. Three companies raised $42M building adjacent solutions. Microsoft released an agent governance toolkit. But none provide cryptographic proof that a third party can independently verify. They monitor and report. Proof-of-behavior enforces and proves.

## Links

- **GitHub:** [github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex)
- **Playground:** [nobulex.com/playground](https://nobulex.com/playground)
- **Spec:** [Proof-of-Behavior Specification v0.1.0](https://github.com/arian-gogani/nobulex/blob/main/docs/proof-of-behavior-spec.md)
- **npm:** @nobulex/sdk
- **PyPI:** langchain-nobulex

I'm 15 and built this solo with Claude Code. Feedback welcome — especially on the constraint language design and the handshake protocol.
