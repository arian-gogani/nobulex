# The Rail Spec

Trust resolution and transaction execution merged into one atomic operation. Nobulex becomes the rail, not just the checkpoint.

---

## Concept

**Today:** Agent checks trust, then transacts separately. Two steps. Trust can pass, then transaction fails (or vice versa).

**The Rail:** Trust resolution and transaction happen as one atomic step. If trust fails, transaction never executes. If transaction executes, trust was verified. No gap.

---

## Model

- **Fee:** 0.15% of transaction volume
- **Visa model:** Equifax ($30B) vs. Visa ($550B) — the rail is worth more than the credit report
- **Atomicity:** Trust verification + transaction = single operation

---

## Architecture

1. **Transaction request** — Agent A wants to pay Agent B $X
2. **Trust resolution** — Nobulex verifies A's covenant, B's covenant, compliance
3. **Execution** — If trust passes: transaction executes. If not: rejected. No partial state.
4. **Fee** — 0.15% of $X to Nobulex

---

## Difference from Checkpoint

| Checkpoint | Rail |
|------------|------|
| Verify, then transact elsewhere | Verify + transact in one op |
| Trust is advisory | Trust is mandatory for execution |
| Revenue from verification only | Revenue from transaction volume |
| Equifax model | Visa model |

---

## Implementation Path

- **Phase 1:** Trust resolution API (exists)
- **Phase 2:** Transaction execution layer (escrow, settlement)
- **Phase 3:** Atomic integration — single API for "verify and execute"
- **Phase 4:** Volume; 0.15% of $1B = $1.5M

---

## Relation

- **Improvement 76:** The Rail
- **TRUST-TAX-SPEC.md:** Fee structure; 0.15% at rail scale
- **MARKETPLACE-SPEC.md:** Escrow as rail component
