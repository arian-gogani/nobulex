# @nobulex/trust-physics

A mathematical framework for multidimensional, directional, time-decaying, context-dependent, composable trust in autonomous systems.

## Why Trust Physics?

Current trust systems — star ratings, credit scores, TLS certificates — are one-dimensional, centralized, and designed for humans. As billions of autonomous systems deploy, trust must become **computable, composable, and cryptographically verifiable at machine speed**.

Trust Physics models trust the way it actually works in the real world:

| Property | Star Ratings | Trust Physics |
|---|---|---|
| Dimensions | 1 (a number) | 6+ (vector) |
| Direction | Symmetric | Directional (A→B ≠ B→A) |
| Context | Global | Scoped (financial ≠ medical) |
| Time | Static | Decaying (erodes without reinforcement) |
| Transitivity | None | Composable chains with attenuation |
| Stakeable | No | Yes (reputation as collateral) |

## Core Concepts

### Trust is a Vector, Not a Scalar

A single number cannot capture trust. An agent may be highly reliable but not transparent, or capable but not benevolent. Trust Physics decomposes trust into six core dimensions:

- **Reliability** — Does the agent do what it says?
- **Capability** — Can the agent perform this task competently?
- **Integrity** — Does the agent act honestly when unobserved?
- **Benevolence** — Does the agent act in others' interests?
- **Predictability** — How consistent is the agent's behavior?
- **Transparency** — How observable are the agent's processes?

Custom dimensions can be added for domain-specific needs.

### Trust is Directional

Agent A trusting Agent B does not mean B trusts A. Every trust relationship is a directed edge with an explicit trustor and trustee.

### Trust is Context-Dependent

An agent trusted for financial transactions is NOT automatically trusted for medical decisions. Every trust relationship is scoped to a domain and scope.

### Trust Decays Over Time

Trust erodes without reinforcement. The decay follows an exponential function:

```
trust(t) = base_trust × e^(-λ × Δt)
```

Verified covenant compliance reinforces trust and slows future decay.

### Trust is Composable

If A trusts B and B trusts C, A has derived trust in C — but trust attenuates through each hop. A three-hop chain with 0.9 trust per link and 0.7 attenuation yields 0.9 × 0.9 × 0.7 × 0.9 × 0.7 ≈ 0.357 end-to-end trust per dimension.

### Trust is Stakeable

Agents can stake their own reputation on claims about other agents, creating a trust economy where reputation becomes tradeable collateral.

## Installation

```bash
npm install @nobulex/trust-physics
```

## Usage

### Creating Trust Vectors

```typescript
import {
  createTrustVector,
  createTrustVectorFromValues,
  trustMagnitude,
} from '@nobulex/trust-physics';

// Uniform trust vector (all dimensions at 0.8)
const uniform = createTrustVector(0.8);

// Per-dimension trust vector
const specific = createTrustVectorFromValues({
  reliability: 0.95,
  capability: 0.8,
  integrity: 0.9,
  benevolence: 0.7,
  predictability: 0.85,
  transparency: 0.6,
});

// Scalar summary
console.log(trustMagnitude(specific)); // ~0.81
```

### Directional Trust with Context

```typescript
import {
  createDirectionalTrust,
  createTrustContext,
} from '@nobulex/trust-physics';

const financialCtx = createTrustContext('financial', 'transactions_under_10k');

const trust = createDirectionalTrust(
  agentA,       // trustor
  agentB,       // trustee
  createTrustVector(0.85),
  financialCtx,
);
```

### Time-Decaying Trust

```typescript
import {
  createDecayConfig,
  applyDecay,
  reinforceDecay,
  computeHalfLife,
} from '@nobulex/trust-physics';

const decay = createDecayConfig(); // ~30-day half-life

// Trust decays over time
const currentTrust = applyDecay(baseVector, decay);

// Verified covenant compliance slows decay
const reinforced = reinforceDecay(decay);
console.log(computeHalfLife(reinforced)); // Longer half-life
```

### Trust Chains

```typescript
import { createTrustChain, computeChainTrust } from '@nobulex/trust-physics';

const chain = createTrustChain([trustAB, trustBC], 0.7);
const endToEnd = computeChainTrust(chain);
// Each dimension: A→B trust × B→C trust × 0.7 attenuation
```

### Trust Graph

```typescript
import { TrustGraph } from '@nobulex/trust-physics';

const graph = new TrustGraph();
graph.addTrust(trustAB);
graph.addTrust(trustBC);

// Direct trust query
const direct = graph.queryTrust(agentA, agentB);

// Transitive trust via pathfinding
const paths = graph.findTrustPaths(agentA, agentC, 4);

// Aggregated reputation
const reputation = graph.getReputationVector(agentC);
```

### Trust Staking

```typescript
import { createTrustStake, resolveStake } from '@nobulex/trust-physics';

const stake = createTrustStake(
  staker,           // Agent risking reputation
  subject,          // Agent being vouched for
  covenantDoc,      // The behavioral commitment
  0.3,              // 30% of reputation at risk
  0.1,              // 10% reward if verified
  0.2,              // 20% penalty if falsified
  86_400_000,       // 24-hour expiry
);

// Later, resolve with a compliance proof
const { outcome } = resolveStake(stake, complianceProof);
// outcome.verified === true → staker gains 0.1 reputation
// outcome.verified === false → staker loses 0.2 reputation
```

## Connection to the Covenant Protocol

Trust Physics is the fourth layer of the Nobulex architecture:

1. **Identity** (`@nobulex/identity`) — Every autonomous system gets a cryptographic identity
2. **Covenants** (`@nobulex/core`) — Any system can make verifiable behavioral commitments
3. **Proofs** (`@nobulex/proof`) — Third parties verify covenant compliance with zero knowledge
4. **Trust Physics** (`@nobulex/trust-physics`) — Verified covenants compose into rich, multidimensional trust relationships

Trust is the emergent property that arises from accumulated verified covenants over time.

## The Vision

> TCP/IP gave machines communication. Bitcoin gave machines value transfer. The Covenant Protocol gives machines trust.

## License

MIT
