# @nobulex/identity

Agent identity creation, evolution, lineage tracking, and DID management for the Stele covenant framework.

## Evolution Policy and `computeCarryForward`

When an agent's identity evolves (model change, capability change, operator transfer, etc.), reputation may be partially carried forward. The `computeCarryForward` function returns a value in `[0, 1]` indicating what fraction of reputation is preserved.

### Default Policy (`DEFAULT_EVOLUTION_POLICY`)

| Change Type | Rate | Description |
|-------------|------|-------------|
| `created` | 1.0 | New identity; full reputation |
| `model_update` (same family) | 0.80 | Version bump within same model (e.g. claude-3 → claude-3.1) |
| `model_update` (different family) | 0.20 | Provider or model ID change |
| `capability_expansion` | 0.90 | Adding capabilities |
| `capability_reduction` | 1.0 | Removing capabilities (trust-preserving) |
| `operator_transfer` | 0.50 | Operator key change |
| `fork` | 0.50 | Same as operator transfer |
| `merge` | min(0.90, 0.80) | Merging identities |
| `minor_update` (no model/cap changes) | 0.95 | Metadata-only change |
| Unknown | 0.0 | Full rebuild; no carry-forward |

### Usage

```typescript
import { computeCarryForward, evolveIdentity, DEFAULT_EVOLUTION_POLICY } from '@nobulex/identity';

// Check carry-forward before evolving
const rate = computeCarryForward('model_update', currentIdentity, {
  model: { provider: 'anthropic', modelId: 'claude-3', modelVersion: '2.0' },
});
// rate === 0.80 (same family)

// Custom policy
const customPolicy = { ...DEFAULT_EVOLUTION_POLICY, operatorTransfer: 0.75 };
const rate2 = computeCarryForward('operator_transfer', identity, {}, customPolicy);
```

The `reputationCarryForward` value is stored in each lineage entry and used by the reputation layer to decay trust across identity evolutions.
