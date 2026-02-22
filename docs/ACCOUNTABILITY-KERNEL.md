# Accountability Kernel

The minimal formally verifiable core. Four operations. If these four are correct, the entire system maintains guarantees.

---

## The Four Operations

| Operation | Description | Package | Function |
|-----------|-------------|---------|----------|
| **1. Identity binding** | Link agent to principal; unforgeable | `@nobulex/identity` | `createIdentity`, `evolveIdentity`, `verifyIdentity` |
| **2. Covenant signing** | Commit to constraints; immutable | `@nobulex/core` | `buildCovenant`, `resignCovenant` |
| **3. Proof verification** | Check compliance; deterministic | `@nobulex/verifier`, `@nobulex/proof` | `verifyCovenant`, `verifyComplianceProof` |
| **4. Trust accounting** | Compute trust score; bounded | `@nobulex/reputation` | `computeReputationScore` |

---

## Guarantees

- **Identity binding** — Agent cannot forge a different principal. Composite identity hash binds model, version, platform, configuration.
- **Covenant signing** — Covenant cannot be modified after inscription. Ed25519 signature, content-addressed ID.
- **Proof verification** — Verification requires only public data. No oracle, no API call, no trust assumption.
- **Trust accounting** — Trust score bounded by collateralization. Cannot exceed staked value.

---

## Kernel Immutability

The accountability kernel is **immutable**. It never changes. Parameters above it (decay rates, canary schedules, governance thresholds) may evolve within proven safety envelopes. The kernel is the foundation; the ecosystem builds on it.
