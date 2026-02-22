# Kova — One Pager

**The trust layer for the agent economy.**

---

## What It Is

Kova is an open cryptographic protocol (MIT license) that enables AI agents to declare behavioral commitments, prove compliance, and build verifiable reputation across platforms. The way HTTPS enabled e-commerce, Kova enables agents to transact safely across organizational boundaries.

---

## Three Primitives

| Primitive | What It Does |
|-----------|--------------|
| **Identity Binding** | Agent proves who it is and who's responsible |
| **Covenant Declaration** | Agent publishes signed behavioral commitments in a formal constraint language |
| **Compliance Proof** | Anyone verifies compliance via zero-knowledge proofs without seeing proprietary logic |

---

## Key Mechanism

**Self-enforcing covenant runtime.** Covenants compile into capability restrictions — agents physically cannot violate tool/API constraints. Hard enforcement for actions (guaranteed). Soft enforcement for language outputs (probabilistic, honestly labeled). The covenant is simultaneously the specification, the enforcement, and the proof — one object that can't drift.

---

## Why Adopt

**Profit, not virtue.** Kova-verified agents earn more than unverified ones.

- **Trust-gated access** — Kova API Gateway: liability protection for API providers. Drop-in middleware. Target 5 providers.
- **Lower insurance** — Actuarial whitepaper for cyber insurers. Let them price Kova verification.
- **Marketplace priority** — Verified agents rank higher. More jobs, more revenue.
- **Reduced collateral** — Verified agents lock up less capital in escrow.

---

## Three Wedges (No Network Effects Required)

1. **Regulatory** — Fastest path to EU AI Act compliance for agentic systems (Aug 2026).
2. **Internal governance** — Govern your own agents. Single-org use case.
3. **MCP certification** — Proactive certification of top 50 MCP servers. Trust report + badge. Create market by doing the work first.

---

## Integration

```bash
npm install kova
```

```typescript
import { withKova } from 'kova';
const server = await withKova(yourMCPServer, 'data-isolation');
```

Three lines. Covenant enforcement active.

---

## What Kova Is Not

- Not alignment. Not a platform. Not guaranteed for language outputs.
- Impossibility bounds are conjectures, not theorems.
- Honest about every limitation.

---

## Positioning

Bridges Web2 and Web3. Maps to EU AI Act. Fills the accountability gap in the Agentic AI Foundation (MCP). Ready when the first major AI agent crisis hits.

**One protocol. Three primitives. The trust layer for the agent economy.**
