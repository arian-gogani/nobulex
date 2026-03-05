# The Rail Spec

Trust resolution and transaction execution merged into one atomic operation. Nobulex becomes the rail, not just the checkpoint.

---

## Concept

**Today:** Agent checks trust, then transacts separately. Two steps. Trust can pass, then transaction fails (or vice versa).

**The Rail:** Trust resolution and transaction happen as one atomic step. If trust fails, transaction never executes. If transaction executes, trust was verified. No gap.

---

## Architecture

1. **Transaction request** — Agent A wants to pay Agent B
2. **Trust resolution** — Nobulex verifies A's covenant, B's covenant, compliance
3. **Execution** — If trust passes: transaction executes. If not: rejected. No partial state.

---

## Difference from Checkpoint

| Checkpoint | Rail |
|------------|------|
| Verify, then transact elsewhere | Verify + transact in one op |
| Trust is advisory | Trust is mandatory for execution |

---

## Implementation Path

- **Phase 1:** Trust resolution API (exists)
- **Phase 2:** Transaction execution layer (escrow, settlement)
- **Phase 3:** Atomic integration — single API for "verify and execute"
