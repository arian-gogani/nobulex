# Impossibility Conjectures

We believe these bounds exist. We invite formal proofs or counterexamples. These are **conjectures**, not proven theorems.

---

## Observation Bound

**Conjecture:** There exists a minimum amount of information required to verify compliance to a given confidence level.

- You cannot achieve 99.9% verification confidence with zero observations.
- The bound relates observation count, confidence target, and constraint complexity.
- Informal argument: Each constraint dimension requires at least one observation to verify; confidence increases sublinearly with observations.

---

## Trust-Privacy Tradeoff

**Conjecture:** There is a formal tradeoff between verification strength and privacy preservation.

- Perfect verification (full audit trail) implies zero privacy for the agent's actions.
- Perfect privacy (no disclosure) implies zero verifiability.
- The tradeoff is not linear; ZK proofs allow partial verification with partial disclosure.

---

## Composition Limit

**Conjecture:** There exists a maximum number of agents in a delegation chain before trust guarantees degrade below a useful threshold.

- Each hop introduces verification error, latency, and constraint complexity.
- Beyond some depth N, the probability of undetected breach exceeds acceptable thresholds.
- Informal argument: Error compounds; N is likely O(log(1/epsilon)) for target failure rate epsilon.

---

## Collateralization Theorem

**Conjecture:** Trust cannot be created without stake. Trust cannot exceed the economic value risked to back it.

- New agents do not generate trust from nothing.
- Trust enters the system only through explicit staking by principals.
- Trust is destroyed (burned) through breach.
- Total trust in the system is bounded by total stake — prevents trust inflation.

**Status:** Weaker claim than "conservation." Defensible. Documented in HOLES-PATCHED (Hole 5).

---

## Bounded Self-Improvement

**Conjecture:** A protocol can improve its own trust mechanisms within formally proven safety envelopes.

- The **kernel** (identity binding, covenant signing, proof verification, trust accounting) is immutable.
- **Parameters** above the kernel (thresholds, decay rates, canary schedules) can evolve.
- Improvement is bounded: the protocol gets better, provably cannot get worse.
- `@stele/antifragile` implements breach-to-improvement; parameter evolution within envelopes is a design principle.

**Informal argument:** If evolution is constrained to parameter updates that monotonically improve detection or reduce false positives, the system cannot regress. The kernel provides the invariant; everything else is optimization.
