# Nobulex

[![CI](https://github.com/arian-gogani/nobulex/actions/workflows/ci.yml/badge.svg)](https://github.com/arian-gogani/nobulex/actions)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/12626/badge)](https://www.bestpractices.dev/projects/12626)
[![npm](https://img.shields.io/npm/v/@nobulex/core)](https://www.npmjs.com/package/@nobulex/core)

**Credit scores for AI agents. Autonomy earned, not granted.**

AI agents get full access on day one and build zero track record. Nobulex fixes that.

Every agent starts restricted. As it performs reliably, it earns **Trust Capital** that unlocks higher autonomy, bigger transaction limits, lower insurance premiums, and enterprise approval. Agents that deviate lose access before the damage spreads. The same way credit scores turned lending into a scalable economic system, Trust Capital turns agent governance into one where reputation has real economic value.

> **If this is useful, [star the repo](https://github.com/arian-gogani/nobulex/stargazers) to help others find it.**

### Adopted by

- **Microsoft** merged the core primitive into their [Agent Governance Toolkit](https://github.com/microsoft/agent-governance-toolkit) (PRs [#1302](https://github.com/microsoft/agent-governance-toolkit/pull/1302), [#1333](https://github.com/microsoft/agent-governance-toolkit/pull/1333))
- **OpenLineage** (Linux Foundation) accepted Nobulex into their [ecosystem](https://github.com/OpenLineage/OpenLineage/pull/4480)
- **AAIF** (Linux Foundation, founded by Anthropic/OpenAI/Google/Microsoft/AWS/Block) has the project [under staff review](https://github.com/aaif/project-proposals/issues/20)
- **State of Agent Security 2026** [litepaper](https://agentgraph.co/state-of-agent-security-2026) lists @nobulex/crypto as 10/10 conformance validated

### Quick Start

```bash
npm install @nobulex/core
npx tsx examples/trust-capital-demo.ts
```

```
Agent starts at RESTRICTED tier (Trust Capital: 0)

Action 1: read_data — ALLOWED ✓ (Trust Capital: 12)
Action 2: read_data — ALLOWED ✓ (Trust Capital: 24)
Action 3: process_payment — BLOCKED ✗ (insufficient trust for financial ops)
Action 4: read_data — ALLOWED ✓ (Trust Capital: 36)
Action 5: read_data — ALLOWED ✓ (Trust Capital: 48)

Agent promoted to STANDARD tier
Action 6: process_payment — ALLOWED ✓ (Trust Capital: 65)
Action 7: approve_contract — BLOCKED ✗ (requires TRUSTED tier)

Agent promoted to TRUSTED tier (Trust Capital: 89)
Action 8: approve_contract — ALLOWED ✓
```

![Tests](https://img.shields.io/badge/tests-6%2C057%20passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)

**[Try it live](https://nobulex.com/try.html)** · **[Policy Designer](https://nobulex.com/designer.html)** · **[Quickstart](https://nobulex.com/docs/quickstart.html)** · **[Compare](https://nobulex.com/compare.html)** · **[Receipt Schema](https://nobulex.com/docs/receipt-schema.html)** · **[Pricing](https://nobulex.com/pricing.html)** · **[IETF Draft](drafts/draft-gogani-nobulex-proof-of-behavior-00.txt)**


## What is Trust Capital?

You can't audit a neural network. But you **can** audit actions against stated commitments — and accumulate that audit history into a reputation that has real economic value.

```
verify(covenant, actionLog) → { compliant: boolean, violations: Violation[], trustCapital: number }
```

This is always decidable, always deterministic, always efficient. No ML, no heuristics — mathematical proof.

**Trust Capital** means every autonomous agent action is:
- **Declared** — behavioral rules defined before deployment in a formal covenant
- **Enforced** — violations blocked at runtime, before execution
- **Proven** — every action hash-chained into a tamper-evident audit trail that third parties can independently verify
- **Accumulated** — verified behavior builds Trust Capital that gates future autonomy, transaction limits, insurance eligibility, and enterprise approval

## Quick Start

```bash
npm install @nobulex/sdk
```

```typescript
import { createDID, parseSource, EnforcementMiddleware, verify } from '@nobulex/core';

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

Before two agents transact, they verify each other's Trust Capital. **No proof, no transaction.**

```typescript
import { generateProof, verifyCounterparty } from '@nobulex/sdk';

// Agent A generates its Trust Capital proof
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

## Why Trust Capital Matters

| What exists today | What's missing |
|---|---|
| **Guardrails** filter prompts and outputs | No proof the agent followed rules at the action layer |
| **Monitoring** watches what agents do after the fact | No enforcement before execution |
| **Identity** verifies who the agent is | No verification of what the agent did |
| **Governance platforms** provide dashboards and policies | No cryptographic evidence a third party can independently verify |

Trust Capital fills the gap: declare → enforce → prove → accumulate.


## Conceptual Comparison

| | Bitcoin | Ethereum | Nobulex |
|---|---------|----------|---------|
| **What it verifies** | Monetary transfers | Contract execution | Agent behavior |
| **Mechanism** | Proof of Work | Proof of Stake | **Trust Capital** |
| **What's proven** | Transaction validity | State transitions | Behavioral compliance |
| **Guarantee** | Trustless money | Trustless contracts | Trustless agents |

## Live Demo

```bash
npx tsx examples/demo.ts
```

Creates two agents, defines behavioral rules, enforces at runtime, blocks a forbidden transfer, generates Trust Capital proof, runs the 8-step handshake, and then shows the same handshake rejecting a third agent whose log was tampered with.

```bash
npx tsx examples/langchain-agent.ts   # covenant enforcement around a mocked LangChain agent
npx tsx examples/trust-capital-demo.ts # watch an agent earn credit through verified behavior
npx tsx benchmarks/bench.ts           # protocol performance on your hardware
```

## Security Audit

We've conducted an internal security review. Here's what we tested and what we found:

**Verified secure:**
- Hash chain integrity: modifying any entry breaks the chain (property-tested with fast-check across random chains of varying length).
- Signature forgery: invalid signatures are rejected 100% of the time.
- Replay attack prevention: audience-bound proofs fail when replayed to a different verifier (property-tested).
- Covenant enforcement: forbidden actions are blocked *before* execution, never after.

**Known limitations:**
- No key revocation mechanism yet.
- No rate limiting on handshake verification.
- Single-threaded chain verification.
- Clock skew tolerance is 0.

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

## Standards

- **[IETF Internet-Draft](drafts/draft-gogani-nobulex-proof-of-behavior-00.txt)** — `draft-gogani-nobulex-proof-of-behavior-00`: Trust Capital Protocol for Autonomous AI Agents
- **[LangChain RFC #35691](https://github.com/langchain-ai/langchain/issues/35691)** — ComplianceCallbackHandler, 10+ implementations converging
- **[NIST RFI Response](docs/nist-rfi.md)** — Formal comments to NIST AI Agent Standards Initiative
- **[Microsoft AGT](https://github.com/microsoft/agent-governance-toolkit/pull/1333)** — Bilateral receipt primitive merged (PRs #1302, #1333)

## Ecosystem

Projects building on or composing with Nobulex:

| Partner | Layer | Integration |
|---------|-------|-------------|
| [Microsoft AGT](https://github.com/microsoft/agent-governance-toolkit) | Governance toolkit | Bilateral receipt primitive (PR #1333) |
| [APS](https://github.com/aeoess) | Receipt schema | 10/10 byte-match on bilateral-delegation fixtures |
| [AgentGraph](https://agentgraph.co) | CTEF vectors | Cross-implementation byte-match validation |
| [AgentID](https://github.com/haroldmalikfrimpong-ops/getagentid) | Identity layer | Claim type convergence |
| [HiveTrust](https://github.com/srotzin/hivetrust) | Compliance | Bilateral receipt endorsement |
| [Concordia](https://github.com/eriknewton) | Envelope layer | JCS canonicalization alignment |
| [Dominion Observatory](https://github.com/vdineshk/dominion-observatory) | Pre-call trust scores | Feeds trust_score into covenant `require` |
| [Signet](https://github.com/willamhou) | Signing layer | Bilateral co-signing, policy attestation |

## Documentation

- **[API Reference](docs/api/)** — Full API docs generated with TypeDoc (`npm run docs:api`)
- **[Trust Capital Spec](docs/proof-of-behavior-spec.md)** — Formal standard specification (CC-BY-4.0)
- **[White Paper](docs/whitepaper.md)** — Formal protocol specification
- **[Receipt Schema](https://nobulex.com/docs/receipt-schema.html)** — Every field, verification steps, examples
- **[Getting Started](docs/getting-started.md)** — Developer guide

## Links

- **Website:** [nobulex.com](https://nobulex.com)
- **Try it:** [nobulex.com/try](https://nobulex.com/try.html)
- **npm:** [@nobulex](https://www.npmjs.com/org/nobulex)
- **IETF:** [draft-gogani-nobulex-proof-of-behavior-00](drafts/draft-gogani-nobulex-proof-of-behavior-00.txt)

## License

MIT
