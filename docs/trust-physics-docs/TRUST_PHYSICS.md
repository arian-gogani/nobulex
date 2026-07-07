# Trust Physics: A Mathematical Framework for Multidimensional Trust in Autonomous Systems

## Abstract

The internet was built with three missing primitives: identity, value, and trust. Bitcoin solved value. We solve trust.

As billions of autonomous systems  - AI agents, robotic fleets, autonomous vehicles, drone swarms, IoT networks  - deploy into the physical and digital world, a fundamental question emerges: how does one machine decide whether to cooperate with another? Today's trust systems (star ratings, credit scores, TLS certificates) are one-dimensional, centralized, and designed for humans making slow decisions. They cannot serve a world where machines must establish, evaluate, and act on trust at computational speed.

The Covenant Protocol introduces **Trust Physics**  - a mathematical framework where trust is a multidimensional vector, directional, context-dependent, time-decaying, composable through chains with attenuation, and stakeable as an economic primitive. Built on cryptographic identity and zero-knowledge proof verification, Trust Physics transforms trust from a human intuition into a computable, composable protocol primitive.

## 1. The Problem

Consider a world with 10 billion autonomous agents. Agent A needs to delegate a financial transaction to Agent B, whom it has never encountered. Three questions arise:

1. **Should A trust B at all?** Not in a generic sense  - specifically, should A trust B to execute a transaction of this type, in this amount, under these constraints?
2. **How much should A trust B?** Not a binary yes/no, but a nuanced, multidimensional assessment across reliability, capability, integrity, benevolence, predictability, and transparency.
3. **Can A's trust assessment be composed from others?** If Agent C trusts B, and A trusts C, can A derive a calibrated trust in B without direct experience?

Current systems fail on all three questions:

- **Star ratings** collapse trust into one dimension. A 4.5-star rating tells you nothing about whether an agent is reliable vs. capable vs. honest.
- **Credit scores** are centralized, opaque, and domain-locked. They cannot transfer across contexts.
- **TLS certificates** verify identity, not behavior. Knowing who an agent is tells you nothing about what it will do.
- **Reputation systems** in Web3 are either trivially Sybil-attackable or require staking mechanisms that conflate financial capital with behavioral trustworthiness.

What's needed is a trust framework that is **decentralized** (no central authority), **multidimensional** (captures the nuances of trust), **directional** (A trusting B ≠ B trusting A), **contextual** (financial trust ≠ medical trust), **temporal** (trust decays without evidence), **composable** (trust transfers through chains), and **stakeable** (agents can put reputation on the line).

## 2. Trust Properties

Trust Physics formalizes seven properties of trust that any complete framework must capture:

### 2.1 Directional

Trust is not symmetric. If a drone fleet operator trusts an AI route planner, it does not follow that the route planner trusts the fleet operator's maintenance commitments. Every trust relationship is a directed edge from trustor to trustee.

### 2.2 Contextual

Trust is always scoped. An AI agent trusted to execute financial transactions under $10,000 is not automatically trusted for medical diagnostic decisions. Each trust relationship is bound to a domain (e.g., "financial") and scope (e.g., "transactions_under_10k") with explicit constraints.

### 2.3 Decaying

Trust erodes in the absence of evidence. An agent that hasn't been verified in 90 days should not retain the same trust level as one verified yesterday. Trust Physics applies exponential time decay, with the rate modulated by the history of past verifications.

### 2.4 Transferable (with Attenuation)

If A trusts B with confidence 0.9 and B trusts C with confidence 0.8, then A can derive a trust in C  - but not at 0.9 or 0.8. Each hop in a trust chain attenuates the signal. With an attenuation factor of 0.7, the derived trust per dimension is 0.9 × 0.8 × 0.7 = 0.504. Longer chains yield weaker derived trust.

### 2.5 Asymmetric (Hard to Build, Easy to Destroy)

Trust accumulates slowly through repeated verified covenant compliance and collapses rapidly on a single breach. This asymmetry is fundamental to any realistic trust model and is encoded in the decay and reinforcement mechanics.

### 2.6 Composable

Trust relationships compose algebraically. Vectors multiply component-wise through chains. Multiple assessors aggregate via weighted average or consensus minimum. These operations are closed over the trust vector space, enabling complex trust topologies.

### 2.7 Stakeable

Trust can be staked as economic collateral. An agent can vouch for another by putting its own reputation at risk. If the vouched-for agent complies with its covenants, the staker is rewarded. If it breaches, the staker is penalized. This creates an emergent trust economy.

## 3. The Mathematical Model

### 3.1 Trust Vectors

A trust assessment is a vector **T** ∈ [0, 1]^n where n ≥ 6 core dimensions:

```
T = (reliability, capability, integrity, benevolence, predictability, transparency, ...custom)
```

The **magnitude** of a trust vector provides a scalar summary:

```
||T|| = sqrt( (1/n) × Σ Tᵢ² )
```

This is normalized so that a unit vector (all dimensions at 1.0) has magnitude 1.0.

### 3.2 Decay Function

Trust decays exponentially from the time of last verification:

```
T(t) = T₀ × e^(-λ_eff × (t - t_last))
```

Where:
- T₀ is the base trust vector at time of last verification
- λ_eff is the effective decay constant
- t_last is the timestamp of last covenant verification

**Adaptive decay:** The effective decay constant decreases with repeated reinforcement:

```
λ_eff = λ₀ × 0.85^max(0, reinforcements - threshold)
```

This rewards agents who consistently prove their covenant compliance: their trust decays slower over time.

**Half-life:** The time for trust to halve is:

```
t_half = ln(2) / λ_eff
```

### 3.3 Chain Attenuation

For a trust chain A → B → C → ... → Z with per-hop attenuation factor α ∈ (0, 1]:

```
T(A→Z) = T(A→B) ⊙ (α × T(B→C)) ⊙ (α × T(C→D)) ⊙ ...
```

Where ⊙ denotes component-wise multiplication. Each subsequent hop both multiplies the trust vectors and applies the attenuation factor, compounding the degradation.

### 3.4 Aggregation

**Weighted average:** Given assessments T₁, T₂, ..., Tₖ with weights w₁, w₂, ..., wₖ:

```
T_agg = Σ(wᵢ × Tᵢ) / Σ(wᵢ)
```

The weights can encode the trustworthiness of the assessors themselves, creating a recursive trust structure.

**Consensus minimum:** The most conservative estimate  - the component-wise minimum across all assessors:

```
T_consensus = (min(T₁ᵢ, T₂ᵢ, ..., Tₖᵢ)) for each dimension i
```

**Dispute detection:** A dispute is flagged when max(Tⱼᵢ) - min(Tⱼᵢ) > threshold for any dimension i across assessors j.

## 4. Integration with the Covenant Protocol

Trust Physics does not exist in isolation. It is the emergent fourth layer of a complete protocol stack:

### Layer 1: Identity (`@nobulex/identity`)

Every autonomous system receives a cryptographic identity  - a content-addressed, Ed25519-signed document that binds a public key to model attestations, capabilities, and a hash-linked lineage chain. Identity answers the question: **who is this agent?**

### Layer 2: Covenants (`@nobulex/core`)

Any system can make verifiable behavioral commitments expressed in the Covenant Constraint Language (CCL). Covenants are signed, chained, and enforceable. They answer the question: **what does this agent commit to do?**

### Layer 3: Proofs (`@nobulex/proof`)

Third-party verifiers generate zero-knowledge compliance proofs attesting that an agent's behavior satisfies its covenant constraints, without revealing the behavior itself. Proofs answer the question: **did the agent actually do what it said?**

### Layer 4: Trust Physics (`@nobulex/trust-physics`)

Accumulated verified covenants compose into rich, multidimensional trust relationships. Trust Physics answers the question: **how much should I rely on this agent, for what, and how has that changed over time?**

The key insight is that trust is not declared  - it is **earned** through repeated, verified covenant compliance and **erodes** in its absence. Trust Physics simply computes the mathematical consequence of an agent's verifiable history.

## 5. Applications Beyond AI Agents

While designed for AI agent coordination, Trust Physics applies to any system where autonomous entities must cooperate without central authority:

- **Robotic fleets:** A warehouse robot evaluates whether to accept a task handoff from a robot it hasn't worked with before.
- **Autonomous vehicles:** A vehicle entering an intersection decides whether to trust another vehicle's signaled intent.
- **Drone swarms:** A drone determines whether to follow a formation command from an unfamiliar swarm coordinator.
- **IoT networks:** A smart grid controller evaluates whether to accept power routing suggestions from an edge device.
- **Supply chain:** An autonomous logistics agent evaluates whether to trust a warehouse agent's inventory claims.

The protocol is agent-agnostic: it doesn't care whether the agent is an LLM, a robotic controller, a smart contract, or a human behind an API. It only cares about verifiable behavioral commitments and their outcomes.

## 6. The Trust Economy

Trust staking transforms reputation into a tradeable economic primitive:

1. **Vouching:** Agent A stakes 30% of its reputation that Agent B will comply with covenant C. If B complies, A gains 10%. If B breaches, A loses 30%.
2. **Risk pricing:** Agents with high trust can charge premiums for vouching. Agents with low trust must offer larger rewards to attract stakers.
3. **Market dynamics:** Trust stakes create a market where the price of vouching for an agent reflects the collective assessment of that agent's trustworthiness.

This is analogous to credit scores  - but decentralized, multidimensional, and designed for machines operating at computational speed. No central bureau decides your score. Your score is the mathematical consequence of your verifiable behavior.

## Conclusion

Communication layer: TCP/IP (1970s). Value layer: Bitcoin (2009). Trust layer: Covenant Protocol (2026).

Trust Physics completes the internet's unfinished architecture by giving machines the ability to compute, compose, and act on trust  - the missing primitive required for autonomous systems to cooperate at scale.
