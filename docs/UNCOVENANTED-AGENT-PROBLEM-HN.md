# The Uncovenanted Agent Problem

**Title for HN:** The Uncovenanted Agent Problem

---

In the next twelve months, AI agents will book flights, execute trades, manage cloud infrastructure, negotiate contracts, triage medical data, and call other agents to do the same. Many already do.

Every one of them operates on a handshake — or worse, nothing at all.

There is no protocol-level mechanism for an agent to declare what it will and won't do. No way for a counterparty to verify those commitments. No consequence when they're broken. No portable record of whether an agent has ever behaved honestly.

We have built the most powerful autonomous systems in history on a foundation of "trust me."

This is the Uncovenanted Agent Problem.

---

**Why it matters now**

When you call an API today, you trust the documentation. When an agent calls an API on your behalf, it has no mechanism to evaluate whether the service will behave as advertised. The service has no mechanism to prove that it will.

This works when agents are simple and supervised. It stops working the moment agents:

- Call other agents across organizational boundaries
- Handle money, medical data, or legal obligations
- Operate autonomously for extended periods
- Are held to regulatory standards (the EU AI Act's high-risk obligations take effect August 2, 2026)

The agent economy is projected to manage trillions in economic value within a few years. The trust infrastructure for that economy does not exist.

---

**What would a solution look like?**

Think about how trust works between humans in economic contexts. We don't operate on "trust me." We use contracts, credentials, credit scores, insurance, audits, and courts. Each serves a specific function: declaring commitments, verifying identity, proving track records, imposing consequences.

Agents need the same primitives, adapted for machines:

1. **Identity binding.** An agent cryptographically proves who it is and who is responsible for it — a verifiable link to a principal who bears consequences.

2. **Behavioral commitment.** An agent declares, in a machine-readable and cryptographically signed format, what it will and won't do. A covenant.

3. **Compliance verification.** A third party verifies that an agent honored its commitments without the agent revealing its proprietary logic. Zero-knowledge proofs make this possible.

These three primitives — identity, covenant, proof — are the minimum viable trust layer. Everything else (reputation, insurance, certification, regulatory compliance) builds on top.

---

**What we built**

We built Kova — an open protocol (MIT license) implementing these three primitives. It's designed as a narrow interoperability standard, like SMTP or TLS, not a platform.

An agent publishes a signed covenant declaring its behavioral constraints. Constraints are written in CCL (Covenant Constraint Language) — permit, deny, require, limit. The covenant is signed by an issuer (typically the operator) and references a beneficiary (the party whose interests are protected). Every action is evaluated against the covenant in real time. The agent produces cryptographic execution receipts. Anyone can verify compliance via zero-knowledge proofs without accessing the agent's internals.

The integration is minimal:

```typescript
import { withKova } from 'kova';
const server = await withKova(yourMCPServer, 'data-isolation');
```

Two lines. Every tool call is covenanted, monitored, and provable.

The protocol is intentionally thin. Three primitives. The core spec fits in a few pages. We believe the trust layer for the agent economy should be as minimal and universal as possible — a narrow waist that everything else builds on.

---

**Defense in depth**

We don't rely on a single guarantee. Three independent layers:

1. **Runtime restriction** — The covenant compiles into capability restrictions. Violation requires bypassing the runtime. Denied actions never reach the underlying system.

2. **External attestation** — Counterparties hold signed records. Tampering requires collusion.

3. **ZK proof** — Verifies compliance against the audit trail. Circumventing all three simultaneously is computationally infeasible. No single point of failure.

---

**Hard vs. soft enforcement**

Covenants can **hard-enforce** tool and API restrictions at the runtime level — the agent literally cannot violate them. Violation is computationally impossible when the runtime gates execution.

Language model outputs are different. You can't cryptographically enforce "don't say X." So we have **soft enforcement** for outputs: confidence scores, classifiers, human review. Labeled honestly as probabilistic, not cryptographic. We're explicit about which is which. We don't claim guarantees we can't deliver.

**Implication:** Our strongest guarantees apply to actions, not utterances. For high-stakes domains, combine hard enforcement with output monitoring and human-in-the-loop.

---

**Three adoption tiers**

Value exists at every tier. No central mandate required.

| Tier | Setup | Honest detection |
|------|------|------------------|
| **Solo** | Single agent, no counterparty | 60–70% — debugging, auditing, compliance |
| **Bilateral** | Both sides run Kova | 85–95% — strong verification |
| **Network** | Many agents, cross-attestation | >99% — near-certain detection |

Solo agents get value from day one: immutable record, debugging, compliance. You don't need to wait for counterparties.

---

**Why adopt? Profit, not virtue.**

Accountability-as-compliance produces slow, grudging adoption. The fix: make Kova-verified agents **earn more** than unverified ones.

- **Trust-gated access** — Kova API Gateway: drop-in middleware for API providers. Pitch is liability protection. Target 5 worried providers.
- **Lower insurance** — Actuarial whitepaper + risk model. Share with cyber insurers (Coalition, At-Bay, Corvus, Resilience). Let them price it.
- **Marketplace priority** — Kova-verified agents rank higher when agents hire other agents. More jobs, more revenue.
- **Reduced collateral** — Verified agents lock up less capital in escrow.

Kova isn't a cost of doing business. It's a competitive advantage. Three wedges: EU AI Act compliance (Aug 2026), internal agent governance, proactive MCP certification (top 50 servers analyzed). See [ADOPTION-STRATEGY.md](./ADOPTION-STRATEGY.md).

---

**Trust as a bounded resource**

We don't claim "trust is conserved" like a physics law. We use a **collateralization bound**: trust cannot exceed the economic value staked to back it. Trust has real scarcity — it's bounded by collateral. Weaker claim, defensible, prevents trust inflation. Trust markets (insurance, derivatives) require this bound to price risk correctly. It's implemented in the reputation package.

---

**Game theory on operators, not agents**

Agents are stochastic. Nash equilibrium applies to **operators** (humans), not agents. Operators bear the economic cost of breaches (reputation, stake, insurance). Operators are rational and respond to incentives. The protocol incentivizes operators to build agents that behave honestly; the agent itself need not be rational.

---

**Federated discovery**

No central registry. Agents expose covenants via `/.well-known/stele` — like DNS. Multiple independent resolvers. Trust the Ed25519 signature, not the resolver. Anyone can run a resolver. Resolution is verifiable.

---

**Multidimensional trust (Kova Score)**

A single trust score invites gaming. Goodhart's Law. So we use a **multidimensional profile**: compliance rate, attestation coverage, canary pass rate, breach history, stake, lineage. Dimensions trade off — you can't optimize all simultaneously. Gaming one dimension costs another. Open algorithm; anyone can compute it from public data. The FICO score for agents.

---

**Model updates break covenants**

When you fine-tune or swap the model, the covenant may no longer describe behavior. Model change is a trust-relevant event. We support triggers: mandatory re-verification, canary re-run, lineage carry-forward, grace period at reduced trust tier. Covenants are versioned with model lineage.

---

**Ecosystem**

The three primitives are the protocol. Everything else is ecosystem — attestation, canary testing, game-theoretic honesty proofs, formal composition, antifragility (breaches generate constraint antibodies), covenant negotiation, consensus, robustness analysis, temporal evolution, recursive meta-covenants, alignment verification, emergent norms, cross-substrate translation, trust derivatives, legal compliance. EU AI Act mapping. NIST AI RMF mapping. EVM anchoring. Bridge Web2 and Web3 — nobody else fills that gap.

---

**What we're not claiming**

We're not claiming we've solved AI alignment. We're not claiming this prevents all possible agent misbehavior. Language model outputs can't be cryptographically constrained the way API calls can. Impossibility conjectures (observation bound, trust–privacy tradeoff, composition limit) are published as conjectures with informal arguments — invite the research community to formalize. We're honest about that boundary.

We are claiming that a protocol-level trust layer — where agents declare commitments, prove compliance, and build verifiable reputation across platforms — is both necessary and currently missing. And that the right time to build it is before the first major AI agent failure, not after.

---

**Governance**

Four-phase bootstrap: Phase 0 centralized (launch), Phase 1 advisory council (first 100 production agents), Phase 2 participation-weighted (stake or usage voting), Phase 3 full decentralization. Explicit milestones. Transparent transition criteria. No permanent central control.

---

Spec, code, and documentation: [GitHub](https://github.com/agbusiness195/stele)

We'd appreciate feedback from anyone thinking about agent infrastructure, AI safety, or protocol design. What are we missing? What would you need to adopt something like this?
