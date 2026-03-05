# Core Mechanism Improvements

The actual technical and conceptual improvements to Nobulex's trust infrastructure.

---

## Core 1: Self-Enforcing Covenants

**Idea:** Agents execute inside covenant runtimes where violation is computationally impossible for tool use and API access.

- Not audit — **architecture**.
- The covenant compiles into capability restrictions on the runtime itself.
- Tool calls and API access are gated by the runtime; denied actions never reach the underlying system.
- Enforcement monitor (`@nobulex/enforcement`) implements this; MCP middleware (`@nobulex/mcp`) gates tool calls.

**Status:** Implemented. Covenant constraints evaluate before execution; denied actions are blocked. CCL supports optional `enforcement hard` or `enforcement soft` per constraint: hard = runtime restriction (tool/API); soft = behavioral monitoring (outputs). See HOLES-PATCHED Hole 1.

---

## Core 2: Trust Algebra

**Idea:** Formal algebraic system for trust with proven properties.

- **Composition** — Trust(A→B) + Trust(B→C) ⇒ derivable properties about A→C.
- **Intersection** — Multiple covenants on same agent; combined constraints.
- **Negation** — What trust does *not* imply.
- **Tensor product** — Trust across parallel delegation chains.

**Status:** `@nobulex/composition` provides `composeTrust`, `intersectTrust`, `negateTrust`, and `tensorTrust`. Negation returns deny constraints; tensor merges parallel composition proofs.

---

## Core 3: Behavioral Provenance

**Idea:** Every agent action carries a cryptographic chain linking it back to the specific covenant authorization that permitted it.

- Not just "didn't violate constraints" but "here's the specific justification."
- Each action references the permit/rule that allowed it.
- Audit trail is a hash chain; verification can trace any action to its covenant clause.

**Status:** Enforcement monitor produces audit trail with `authorizationConstraint` and `enforcementTier` on each `AuditEntry`, linking actions to the CCL rule that permitted or denied them.

---

## Core 4: Trust as Bounded Resource

**Idea:** Trust can't exceed the economic value risked to back it.

- **Collateralization bound** — Prevents trust inflation.
- Trust has real scarcity, making it genuinely valuable.
- Reputation and stake are linked; high trust requires staked value.

**Status:** `@nobulex/reputation` supports stake-weighted scoring with `stakeBound` (collateralization bound). Pass `stakeData: { currentStake, totalBurned }` to `computeReputationScore` to cap trust by stake; see HOLES-PATCHED.md for formula.

---

## Core 5: Accountability Kernel

**Idea:** Minimal formally verifiable core.

- **Identity binding** — Agent ↔ keypair, lineage.
- **Covenant signing** — Ed25519, content-addressed.
- **Proof verification** — 11 specification checks.
- **Trust accounting** — Reputation, stake, breach propagation.

If the kernel is correct, the entire system maintains guarantees regardless of ecosystem complexity.

**Status:** Foundation packages (`@nobulex/core`, `@nobulex/verifier`, `@nobulex/identity`) form the kernel. Formal verification is a roadmap item.

---

## Core 6: Covenants as Executable Specifications

**Idea:** The covenant is simultaneously:

1. Human-readable commitment
2. Machine-enforceable constraint
3. Formal specification

They can't drift because they're the same object. CCL is parsed, evaluated, and enforced from a single source of truth.

**Status:** Implemented. CCL is the single representation; no separate spec document.

---

## Core 7: Adversarial Trust Equilibrium

**Idea:** Honest behavior isn't just a Nash equilibrium — it's an **Evolutionary Stable Strategy**.

- No mutant strategy can invade the population.
- Deviations self-extinguish.
- **Applies to operators (rational humans), not agents (stochastic systems).**
- `@nobulex/gametheory` provides computable inequalities for dominant-strategy honesty.

**Status:** Game theory package implements honesty proofs. ESS framing is documented.

---

## Core 8: Zero-Knowledge Identity Hierarchy

**Idea:** Prove trust properties without revealing identity.

- "I'm operated by a Fortune 500 company" without saying which one.
- Privacy-preserving trust.
- ZK proofs for compliance without exposing agent or operator identity.

**Status:** `@nobulex/proof` uses Poseidon hashes. Full ZK identity hierarchy is a research direction.

---

## Core 9: Trust Entanglement

**Idea:** Delegated trust relationships are cryptographically linked.

- Verifying one agent partially verifies its partners.
- Network-wide verification at sublinear cost.
- Composition and breach propagation (`@nobulex/breach`) implement linked verification.

**Status:** Delegation chains and breach propagation exist. Sublinear network verification is an optimization target.

---

## Core 10: Impossibility Conjectures

**Idea:** Define the fundamental limits of what any agent trust system can achieve.

- **Observation bound** — What can be verified from finite observations?
- **Trust–privacy tradeoff** — Can you have perfect trust and perfect privacy?
- **Composition limit** — How many agents can compose before guarantees degrade?
- **Conservation theorem** — Formalize collateralization bound.

Published as conjectures inviting formal proofs. Creates research agenda.

**Status:** Documented in HOLES-PATCHED.md. Formalization is open research.

---

## Core 11: Bounded Self-Improvement

**Idea:** Protocol improves its own trust mechanisms over time within formally proven safety envelopes.

- The kernel is immutable.
- Parameters above it evolve (thresholds, decay rates, canary schedules).
- Gets better, provably can't get worse.
- `@nobulex/antifragile` — breaches generate improvements.

**Status:** Antifragile package implements breach-to-improvement. Parameter evolution within envelopes is a design principle.

---

## Summary

| Core | Mechanism | Status |
|------|-----------|--------|
| 1 | Self-enforcing covenants | Implemented |
| 2 | Trust algebra | Partial (composition) |
| 3 | Behavioral provenance | Audit trail exists; rule linking enhanced |
| 4 | Trust as bounded resource | Documented; stake-weighted |
| 5 | Accountability kernel | Implemented |
| 6 | Covenants as executable spec | Implemented |
| 7 | Adversarial trust equilibrium | Documented; gametheory |
| 8 | ZK identity hierarchy | Research direction |
| 9 | Trust entanglement | Delegation + breach propagation |
| 10 | Impossibility conjectures | Documented |
| 11 | Bounded self-improvement | Antifragile package |
