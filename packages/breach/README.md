# @stele/breach

Breach detection, attestation creation, verification, and trust graph propagation for the Stele protocol.

## TrustGraph Propagation Rules

The `TrustGraph` propagates trust degradation when a breach attestation is processed. Understanding these rules is essential for modeling cascading effects across dependent agents.

### Severity → Trust Status

| Severity | Violator Status |
|----------|-----------------|
| `critical` | `revoked` |
| `high`     | `restricted` |
| `medium`   | `degraded` |
| `low`      | `trusted` (no change) |

### Propagation Path

1. **Violator** receives status from severity (depth 0).
2. **Dependents** are degraded by one level per hop via BFS.
3. **Degradation chain**: `revoked` → `restricted` → `degraded` → (stop).

### Dependency Semantics: `registerDependency(upstreamHash, downstreamHash)`

- **First arg (upstream)**: The agent whose breach *causes* propagation. When this agent breaches, its dependents are affected.
- **Second arg (downstream)**: The agent *affected* when the upstream breaches. Downstream "depends on" upstream.

`registerDependency(B, A)` means: A is a dependent of B. When B breaches, A's trust status is degraded.
Think of it as: "A depends on B" (A relies on B) → `registerDependency(B, A)`.

Example: API consumer A relies on API provider B. Call `graph.registerDependency(B, A)`.
When B breaches, A's status degrades (A was depending on B).

```
B (violator) --breach--> B: revoked
         |
         v
A (dependent) --> A: restricted (one level down from revoked)
         |
         v
C (dependent of A) --> C: degraded (one level down from restricted)
```

### Rules Summary

- **BFS propagation**: All transitive dependents are visited in breadth-first order.
- **Degrade by one**: Each hop applies one step down the chain (revoked→restricted→degraded).
- **Worse wins**: If a node already has a bad status, it is only updated if the new status is worse.
- **Degraded/trusted stop propagation**: Once status is `degraded`, further propagation does not change it (no level below degraded for dependents).

### Usage

```typescript
import { TrustGraph, createBreachAttestation } from '@stele/breach';

const graph = new TrustGraph();
graph.registerDependency(violatorHash, dependentHash);

graph.onBreach((event) => {
  console.log(`${event.affectedAgent}: ${event.previousStatus} -> ${event.newStatus} (depth ${event.propagationDepth})`);
});

const attestation = await createBreachAttestation(/* ... */);
const events = await graph.processBreach(attestation);
```
