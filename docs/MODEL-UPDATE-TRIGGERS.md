# Model Update Triggers (Hole 7 / 39)

When you fine-tune or swap the model, the covenant may no longer describe behavior. Model change is a **trust-relevant event** that must trigger re-verification.

---

## Workflow

1. **Mandatory re-verification**  - Covenant must be re-signed or re-validated.
2. **Canary re-run**  - Challenge-response tests must pass again.
3. **Lineage carry-forward**  - Old covenant links to new; audit trail preserved.
4. **Grace period at reduced trust tier**  - Until re-verification completes, agent operates at lower trust level.

---

## Implementation: `model_update` Trigger

The `@nobulex/temporal` package supports a `model_update` trigger type. When the agent's model version changes from the expected value, the trigger fires and can drive evolution (e.g., add a "pending_reverification" constraint, tighten restrictions during grace period).

### Usage

```typescript
import { defineEvolution, evaluateTriggers } from '@nobulex/temporal';

const policy = defineEvolution(
  covenantId,
  [
    {
      type: 'model_update',
      condition: 'gpt-4-turbo',  // previous model version
      action: 'tighten',
      constraintId: 'pending_reverification',
    },
  ],
  [
    {
      fromConstraint: 'pending_reverification',
      toConstraint: 'verified',
      trigger: 'reverification_complete',
      reversible: false,
      cooldown: 0,
    },
  ],
);

// When model changes, evaluateTriggers fires
const agentState = {
  reputationScore: 0.9,
  capabilities: ['read', 'write'],
  breachCount: 0,
  currentTime: Date.now(),
  modelVersion: 'gpt-5',  // changed from gpt-4-turbo
};

const fired = evaluateTriggers(covenant, agentState);
// fired includes the model_update trigger
```

### Operator Responsibilities

When `model_update` fires:

1. **Re-run canary tests**  - Use `@nobulex/canary` to validate the new model against the covenant.
2. **Re-sign or re-validate covenant**  - Use `@nobulex/core` to produce a new signed covenant with updated model lineage.
3. **Preserve lineage**  - Link the old covenant to the new one in the audit trail.
4. **Apply grace period**  - Until re-verification completes, operate at reduced trust (e.g., via `tighten` action adding temporary constraints).

---

## Package Reference

| Package | Role |
|---------|------|
| `@nobulex/temporal` | `model_update` trigger, evolution policy |
| `@nobulex/canary` | Re-run challenge-response tests |
| `@nobulex/core` | Re-sign covenant with model lineage |
