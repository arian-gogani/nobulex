# Holes Patched

Preemptive defenses against known objections and attack vectors.

---

## Hole 1: Language outputs can't be hard-enforced

**Objection:** Covenants can restrict tool calls and API access, but LLM text output is stochastic. You can't cryptographically enforce "don't say X."

**Fix:** Two-tier enforcement model.

- **Hard enforcement** — Tool use, API access, file I/O, network calls. These are discrete, auditable, and can be gated by a covenant runtime. Violation is computationally impossible when the runtime compiles constraints into capability restrictions.
- **Soft enforcement** — Language outputs. Measured via confidence scores, classifiers, or human review. Labeled honestly as probabilistic, not cryptographic. Documentation states the distinction explicitly.

**Implication:** Kova's strongest guarantees apply to actions, not utterances. For high-stakes domains, combine hard enforcement with output monitoring and human-in-the-loop where appropriate.

---

## Hole 2: Game theory assumes rational agents

**Objection:** Nash equilibrium and dominant-strategy honesty assume rational actors. AI agents are stochastic systems, not rational players.

**Fix:** Game theory applies to **operators** (humans), not agents (stochastic systems).

- Operators bear the economic cost of breaches (reputation, stake, insurance).
- Operators are rational and respond to incentives.
- Operators invest in monitoring, canary tests, and better constraints to reduce breach probability.
- The protocol incentivizes operators to build agents that behave honestly; the agent itself need not be rational.

**Implication:** Kova's game-theoretic guarantees hold at the operator level. Agent behavior is a controlled variable; operator incentives are the lever.

---

## Hole 3: External attestation requires counterparty cooperation

**Objection:** If the counterparty doesn't run Kova, you can't get bilateral attestation. Solo verification is weaker.

**Fix:** Three adoption tiers with honest-detection probabilities.

| Tier | Setup | Honest detection probability | Game theory |
|------|------|------------------------------|-------------|
| **Solo** | Single agent, no counterparty | 60–70% | Works with adjusted stake; solo value from immutable record |
| **Bilateral** | Both sides run Kova | 85–95% | Strong Nash equilibrium |
| **Network** | Many agents, cross-attestation | >99% | Near-certain detection |

**Implication:** Value exists at every tier. Solo agents get debugging, auditing, compliance. Bilateral gets strong verification. Network gets maximum assurance. No central mandate required.

---

## Hole 4: ZK proofs only verify against the audit trail

**Objection:** Zero-knowledge proofs verify that a computation was performed correctly on given inputs. If the audit trail is compromised, the proof is meaningless.

**Fix:** Defense in depth — three independent layers.

1. **Runtime restriction** — Covenant compiles into capability restrictions. Violation requires bypassing the runtime.
2. **External attestation** — Counterparty holds a signed record. Tampering requires collusion.
3. **ZK proof** — Verifies compliance against the (assumed honest) audit trail.

**Circumventing all three simultaneously** is computationally infeasible. The math is stated explicitly in protocol documentation. No single point of failure.

---

## Hole 5: Trust conservation is asserted, not proven

**Objection:** "Trust is conserved" sounds like a physics law. Where's the proof?

**Fix:** Reframe as **collateralization bound**.

- Trust cannot exceed the economic value staked to back it.
- Trust has real scarcity — it's bounded by collateral.
- Weaker claim than "conservation" but defensible and still prevents trust inflation.
- Trust markets (insurance, derivatives) require this bound to price risk correctly.

**Formula (implemented in `@stele/reputation`):** `stakeBound = min(1, currentStake + 0.5 * (1 - totalBurned) * historyFactor)` where `historyFactor = min(1, totalExecutions / 100)`. Trust score is capped: `weightedScore <= stakeBound`.

---

## Hole 6: Impossibility proofs don't exist yet

**Objection:** Claims about fundamental limits of agent trust systems are unsubstantiated.

**Fix:** Publish as **conjectures** with informal arguments.

- Observation bound, trust–privacy tradeoff, composition limit, conservation theorem.
- Invite the research community to formalize and prove.
- Creates a research agenda rather than making unsubstantiated claims.
- Kova documents these as open problems, not settled facts.

---

## Hole 7: Model updates break covenants

**Objection:** When you fine-tune or swap the model, the covenant may no longer describe behavior. Covenants become stale.

**Fix:** Model change is a **trust-relevant event** triggering:

1. **Mandatory re-verification** — Covenant must be re-signed or re-validated.
2. **Canary re-run** — Challenge-response tests must pass again.
3. **Lineage carry-forward** — Old covenant links to new; audit trail preserved.
4. **Grace period at reduced trust tier** — Until re-verification completes, agent operates at lower trust level.

**Implication:** Covenants are versioned with model lineage. `@stele/temporal` provides the `model_update` trigger: when `agentState.modelVersion` changes from the expected value, the trigger fires and can drive mandatory re-verification, canary re-run, and grace-period transitions. See `defineEvolution` with `type: 'model_update'`.

---

## Hole 8: Cross-platform discovery requires a registry

**Objection:** How do agents find each other's covenants without a central registry?

**Fix:** **Federated discovery protocol** (like DNS).

- Multiple independent resolvers.
- Trust the Ed25519 signature, not the resolver.
- Resolvers can be run by anyone; resolution is verifiable.
- `.well-known` style endpoints for covenant discovery.
- No single point of control.

---

## Hole 9: Single trust score creates gaming incentives

**Objection:** If there's one number, agents will optimize for it. Goodhart's Law.

**Fix:** **Multidimensional trust profile** (Kova Score, `computeSteleScore` in `@stele/legal`).

- Dimensions: compliance rate, attestation coverage, canary pass rate, breach history, stake, lineage.
- Dimensions trade off — can't optimize all simultaneously.
- Gaming one dimension costs another (e.g., high stake with low compliance is suspicious).
- Open algorithm; anyone can compute it from public data.
- The FICO score for agents — useful, but not gameable in a single dimension.

---

## Hole 10: No governance at launch

**Objection:** Who decides protocol parameters, CCL evolution, and dispute resolution?

**Fix:** **Four-phase bootstrap**.

| Phase | Governance | Milestone |
|-------|------------|-----------|
| **0** | Centralized (founders) | Launch, initial adoption |
| **1** | Advisory council | First 100 production agents |
| **2** | Participation-weighted | Stake or usage-weighted voting |
| **3** | Full decentralization | On-chain or federated governance |

Explicit milestones. Transparent transition criteria. No permanent central control.

---

## Summary

| Hole | Fix |
|------|-----|
| 1. Language outputs | Two tiers: hard (tools) + soft (outputs), labeled honestly |
| 2. Rational agents | Game theory on operators, not agents |
| 3. Attestation cooperation | Three tiers: solo, bilateral, network |
| 4. ZK vs audit trail | Defense in depth: runtime + attestation + ZK |
| 5. Trust conservation | Collateralization bound (weaker, defensible) |
| 6. Impossibility proofs | Conjectures + research agenda |
| 7. Model updates | Re-verification, canary re-run, lineage, grace period |
| 8. Discovery registry | Federated discovery, trust signature not resolver |
| 9. Single score gaming | Multidimensional Kova Score, trade-offs |
| 10. No governance | Four-phase bootstrap with milestones |
