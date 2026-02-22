# Zero-Knowledge Identity Hierarchy

**Design document.** Prove trust properties without revealing identity. "Fortune 500 operator" without saying which one.

---

## Goal

Enable privacy-preserving trust verification:

- Prove compliance without exposing agent or operator identity.
- Prove membership in a class (e.g., "regulated financial institution") without revealing which institution.
- Prove trust score exceeds threshold without revealing exact score or history.

---

## Hierarchy Levels

| Level | Revealed | Hidden | Use Case |
|-------|----------|--------|----------|
| **0** | Full identity | Nothing | Public verification, legal discovery |
| **1** | Agent class, covenant scope | Operator identity | B2B without exposing principals |
| **2** | Compliance boolean, score range | Identity, exact score | Marketplace filtering |
| **3** | "Meets threshold" | Everything else | Access gating |

---

## Technical Approach

- **@nobulex/proof** uses Poseidon hashes for ZK-friendly commitments.
- **ZK-SNARKs** (future): Prove "I have a valid covenant" or "my score ≥ X" without revealing covenant or score.
- **Selective disclosure**: Reveal specific claims (e.g., "EU AI Act compliant") without full audit trail.

---

## Relation to Other Improvements

- **Trust–Privacy Tradeoff** ([IMPOSSIBILITY-CONJECTURES.md](./IMPOSSIBILITY-CONJECTURES.md)): ZK allows partial verification with partial disclosure.
- **Improvement 34**: This document.
- **@nobulex/identity**: Current identity binding; ZK hierarchy extends it.

---

## Status

Research direction. Full implementation requires ZK circuit design and integration with covenant verification pipeline.
