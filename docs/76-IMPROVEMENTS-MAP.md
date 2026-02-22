# 76 Improvements — Master Map

Master index mapping every KOVA improvement to its implementation (package or doc). Use this to verify completeness and navigate the codebase.

---

## Phase 1: Feature Upgrades (1–15)

| # | Improvement | Package | Doc |
|---|-------------|---------|-----|
| 1 | External Attestation | [@stele/attestation](../packages/attestation) | [UPGRADES.md](./UPGRADES.md#upgrade-1-external-attestation) |
| 2 | Dominant-Strategy Honesty | [@stele/gametheory](../packages/gametheory) | [UPGRADES.md](./UPGRADES.md#upgrade-2-dominant-strategy-honesty) |
| 3 | Trust Composability | [@stele/composition](../packages/composition) | [UPGRADES.md](./UPGRADES.md#upgrade-3-trust-composability) |
| 4 | Challenge-Response Canaries | [@stele/canary](../packages/canary) | [UPGRADES.md](./UPGRADES.md#upgrade-4-challenge-response-canaries) |
| 5 | Antifragile Trust Networks | [@stele/antifragile](../packages/antifragile) | [UPGRADES.md](./UPGRADES.md#upgrade-5-antifragile-trust-networks) |
| 6 | Covenant Negotiation | [@stele/negotiation](../packages/negotiation) | [UPGRADES.md](./UPGRADES.md#upgrade-6-covenant-negotiation) |
| 7 | Behavioral Derivatives | [@stele/derivatives](../packages/derivatives) | [UPGRADES.md](./UPGRADES.md#upgrade-7-behavioral-derivatives) |
| 8 | Proof of Accountability | [@stele/consensus](../packages/consensus) | [UPGRADES.md](./UPGRADES.md#upgrade-8-proof-of-accountability) |
| 9 | Accountability as Alignment | [@stele/alignment](../packages/alignment) | [UPGRADES.md](./UPGRADES.md#upgrade-9-accountability-as-alignment) |
| 10 | Legal Personhood Infrastructure | [@stele/legal](../packages/legal) | [UPGRADES.md](./UPGRADES.md#upgrade-10-agent-legal-personhood-infrastructure) |
| 11 | Adversarial Robustness Proofs | [@stele/robustness](../packages/robustness) | [UPGRADES.md](./UPGRADES.md#upgrade-11-adversarial-robustness-proofs) |
| 12 | Cross-Substrate Accountability | [@stele/substrate](../packages/substrate) | [UPGRADES.md](./UPGRADES.md#upgrade-12-cross-substrate-accountability) |
| 13 | Temporal Covenant Evolution | [@stele/temporal](../packages/temporal) | [UPGRADES.md](./UPGRADES.md#upgrade-13-temporal-covenant-evolution), [MODEL-UPDATE-TRIGGERS.md](./MODEL-UPDATE-TRIGGERS.md) |
| 14 | Recursive Accountability | [@stele/recursive](../packages/recursive) | [UPGRADES.md](./UPGRADES.md#upgrade-14-recursive-accountability) |
| 15 | Emergent Norm Discovery | [@stele/norms](../packages/norms) | [UPGRADES.md](./UPGRADES.md#upgrade-15-emergent-norm-discovery) |

---

## Phase 2: Strategic Changes (16–26)

| # | Improvement | Package | Doc |
|---|-------------|---------|-----|
| 16 | Strip to 3 Primitives | — | [PROTOCOL.md](../PROTOCOL.md), [README.md](../README.md) |
| 17 | Trust Infrastructure framing | — | [MANIFESTO.md](../MANIFESTO.md), [STRATEGIC-CHANGES.md](./STRATEGIC-CHANGES.md) |
| 18 | Bridge Web2/Web3 | [@stele/evm](../packages/evm), [@stele/legal](../packages/legal) | [STRATEGIC-CHANGES.md](./STRATEGIC-CHANGES.md) |
| 19 | EU AI Act target | [@stele/legal](../packages/legal), [@stele/eu-compliance](../packages/eu-compliance) | [eu-ai-act-mapping.md](./eu-ai-act-mapping.md) |
| 20 | One package, 30 min | [kova](../packages/kova) | [QUICK-START.md](./QUICK-START.md) |
| 21 | Agentic AI Foundation | [@stele/mcp](../packages/mcp) | [README.md](../README.md) |
| 22 | Crisis Playbook | — | [crisis-playbook/](./crisis-playbook/) |
| 23 | Self-Bootstrapping Solo Value | — | [ADOPTION-STRATEGY.md](./ADOPTION-STRATEGY.md), [MANIFESTO.md](../MANIFESTO.md) |
| 24 | Trust Handshake as Distribution | — | [STRATEGIC-CHANGES.md](./STRATEGIC-CHANGES.md) |
| 25 | Covenant as Lingua Franca | — | [STRATEGIC-CHANGES.md](./STRATEGIC-CHANGES.md) |
| 26 | Define Unit of Trust | [@stele/reputation](../packages/reputation) | [UNIT-OF-TRUST.md](./UNIT-OF-TRUST.md) |

---

## Phase 3: Core Mechanism Improvements (27–37)

| # | Improvement | Package | Doc |
|---|-------------|---------|-----|
| 27 | Self-Enforcing Covenant Runtime | [@stele/enforcement](../packages/enforcement) (CapabilityGate) | [CORE-MECHANISMS.md](./CORE-MECHANISMS.md) |
| 28 | Behavioral Provenance | [@stele/enforcement](../packages/enforcement) | [CORE-MECHANISMS.md](./CORE-MECHANISMS.md), [PROTOCOL.md](../PROTOCOL.md) |
| 29 | Trust Algebra | [@stele/composition](../packages/composition) | [CORE-MECHANISMS.md](./CORE-MECHANISMS.md) |
| 30 | Trust as Bounded Resource | [@stele/reputation](../packages/reputation) | [HOLES-PATCHED.md](./HOLES-PATCHED.md#hole-5) |
| 31 | Accountability Kernel | — | [ACCOUNTABILITY-KERNEL.md](./ACCOUNTABILITY-KERNEL.md) |
| 32 | Covenants as Executable Specs | [@stele/ccl](../packages/ccl), [@stele/enforcement](../packages/enforcement) | [CORE-MECHANISMS.md](./CORE-MECHANISMS.md) |
| 33 | Adversarial Trust Equilibrium (ESS) | [@stele/gametheory](../packages/gametheory) | [CORE-MECHANISMS.md](./CORE-MECHANISMS.md) |
| 34 | Zero-Knowledge Identity Hierarchy | — | [ZK-IDENTITY-HIERARCHY.md](./ZK-IDENTITY-HIERARCHY.md) |
| 35 | Trust Entanglement | [@stele/recursive](../packages/recursive) | [PROTOCOL.md](../PROTOCOL.md) |
| 36 | Impossibility Conjectures | — | [IMPOSSIBILITY-CONJECTURES.md](./IMPOSSIBILITY-CONJECTURES.md) |
| 37 | Bounded Self-Improvement | — | [CORE-MECHANISMS.md](./CORE-MECHANISMS.md), [IMPOSSIBILITY-CONJECTURES.md](./IMPOSSIBILITY-CONJECTURES.md) |

---

## Phase 4: Hole Patches (38–47)

| # | Improvement | Doc |
|---|-------------|-----|
| 38 | Hard vs Soft Enforcement | [HOLES-PATCHED.md](./HOLES-PATCHED.md#hole-1) |
| 39 | Game Theory → Operators | [HOLES-PATCHED.md](./HOLES-PATCHED.md#hole-2) |
| 40 | Three Adoption Tiers | [HOLES-PATCHED.md](./HOLES-PATCHED.md#hole-3) |
| 41 | Defense in Depth | [HOLES-PATCHED.md](./HOLES-PATCHED.md#hole-4) |
| 42 | Collateralization Bound | [HOLES-PATCHED.md](./HOLES-PATCHED.md#hole-5) |
| 43 | Conjectures, not proofs | [IMPOSSIBILITY-CONJECTURES.md](./IMPOSSIBILITY-CONJECTURES.md) |
| 44 | Model Updates Trigger Re-verification | [MODEL-UPDATE-TRIGGERS.md](./MODEL-UPDATE-TRIGGERS.md) |
| 45 | Federated Discovery | [DISCOVERY.md](./DISCOVERY.md), `createWellKnownHandler` in [@stele/sdk](../packages/sdk) |
| 46 | Multidimensional Trust Profile | [UNIT-OF-TRUST.md](./UNIT-OF-TRUST.md) |
| 47 | Governance Bootstrap | [GOVERNANCE-BOOTSTRAP.md](./GOVERNANCE-BOOTSTRAP.md) |

---

## Phase 5: Incentive Alignment + Adoption (48–53)

| # | Improvement | Package | Doc |
|---|-------------|---------|-----|
| 48 | Adopt Because Profitable | — | [ADOPTION-STRATEGY.md](./ADOPTION-STRATEGY.md) |
| 49 | Regulatory Wedge | — | [ADOPTION-STRATEGY.md](./ADOPTION-STRATEGY.md), [eu-ai-act-mapping.md](./eu-ai-act-mapping.md) |
| 50 | Internal Governance Wedge | — | [ADOPTION-STRATEGY.md](./ADOPTION-STRATEGY.md) |
| 51 | MCP Certification Wedge | — | [MCP-CERTIFICATION-PLAN.md](./MCP-CERTIFICATION-PLAN.md), [ADOPTION-READINESS.md](./ADOPTION-READINESS.md) |
| 52 | Kova API Gateway | [@stele/sdk](../packages/sdk) (`kovaGatewayMiddleware`) | [ADOPTION-STRATEGY.md](./ADOPTION-STRATEGY.md) |
| 53 | Actuarial Risk Model | [@stele/derivatives](../packages/derivatives) | [ACTUARIAL-WHITEPAPER-OUTLINE.md](./ACTUARIAL-WHITEPAPER-OUTLINE.md) |

---

## Phase 6: Adoption Readiness (54–65)

| # | Improvement | Package | Doc |
|---|-------------|---------|-----|
| 54 | Platform Champion Targets | — | [ADOPTION-READINESS.md](./ADOPTION-READINESS.md#gap-1) |
| 55 | Content Engine | — | [ADOPTION-READINESS.md](./ADOPTION-READINESS.md#gap-2) |
| 56 | Open Source Community | — | [CONTRIBUTING.md](../CONTRIBUTING.md), [KIP-PROCESS.md](./KIP-PROCESS.md), [GOOD-FIRST-ISSUES.md](./GOOD-FIRST-ISSUES.md) |
| 57 | Compliance Audit Trojan Horse | [@stele/cli](../packages/cli) (`kova audit`) | [ADOPTION-READINESS.md](./ADOPTION-READINESS.md#gap-4) |
| 58 | Academic Strategy | — | [ADOPTION-READINESS.md](./ADOPTION-READINESS.md#gap-8) |
| 59 | Conference Strategy | — | [ADOPTION-READINESS.md](./ADOPTION-READINESS.md) |
| 60 | Open Core Pricing | — | [PRICING.md](./PRICING.md) |
| 61 | Competitive Moat | — | [ADOPTION-READINESS.md](./ADOPTION-READINESS.md#gap-9) |
| 62 | Localization | — | [i18n/](./i18n/) |
| 63 | Public Milestones | — | [ADOPTION-READINESS.md](./ADOPTION-READINESS.md#gap-10) |
| 64 | Metrics Dashboard | — | [METRICS-DASHBOARD.md](./METRICS-DASHBOARD.md) |
| 65 | Enterprise Pipeline via Audit | — | [ADOPTION-READINESS.md](./ADOPTION-READINESS.md#gap-4) |

---

## Phase 7: Money Machine v1 (66–70)

| # | Improvement | Package | Doc |
|---|-------------|---------|-----|
| 66 | Certification Authority | [@stele/certification](../packages/certification) | [CERTIFICATION-AUTHORITY-SPEC.md](./CERTIFICATION-AUTHORITY-SPEC.md), [REVENUE-MODEL.md](./REVENUE-MODEL.md) |
| 67 | Trust Tax (Transaction Fee) | [@stele/revenue](../packages/revenue) | [TRUST-TAX-SPEC.md](./TRUST-TAX-SPEC.md), [REVENUE-MODEL.md](./REVENUE-MODEL.md) |
| 68 | Trust Data Monopoly | [@stele/trust-data](../packages/trust-data) | [TRUST-DATA-SPEC.md](./TRUST-DATA-SPEC.md), [REVENUE-MODEL.md](./REVENUE-MODEL.md) |
| 69 | Trust-Gated Marketplace | [@stele/marketplace](../packages/marketplace) | [MARKETPLACE-SPEC.md](./MARKETPLACE-SPEC.md), [REVENUE-MODEL.md](./REVENUE-MODEL.md) |
| 70 | Sovereign Licensing | — | [REVENUE-MODEL.md](./REVENUE-MODEL.md) |

---

## Phase 8: Money Machine v2 (71–75)

| # | Improvement | Package | Doc |
|---|-------------|---------|-----|
| 71 | Two-Sided Payments | [@stele/revenue](../packages/revenue) | [TWO-SIDED-PAYMENTS-SPEC.md](./TWO-SIDED-PAYMENTS-SPEC.md) |
| 72 | Value-Proportional Pricing | [@stele/revenue](../packages/revenue) | [TRUST-TAX-SPEC.md](./TRUST-TAX-SPEC.md) |
| 73 | Trust Futures Market | [@stele/trust-futures](../packages/trust-futures) | [TRUST-FUTURES-SPEC.md](./TRUST-FUTURES-SPEC.md) |
| 74 | Compliance Autopilot | [@stele/compliance-autopilot](../packages/compliance-autopilot) | [COMPLIANCE-AUTOPILOT-SPEC.md](./COMPLIANCE-AUTOPILOT-SPEC.md) |
| 75 | Productive Staking Tiers | [@stele/staking](../packages/staking) | [STAKING-TIERS-SPEC.md](./STAKING-TIERS-SPEC.md) |

---

## Phase 9: The Rail (76)

| # | Improvement | Package | Doc |
|---|-------------|---------|-----|
| 76 | Trust Resolution = Transaction Execution | [@stele/rail](../packages/rail) | [THE-RAIL-SPEC.md](./THE-RAIL-SPEC.md) |

---

## Percentile Journey

| Phase | Percentile |
|-------|------------|
| Base idea (10 packages, "accountability") | 75–80 |
| + 15 feature upgrades | 80–83 |
| + 11 strategic changes | 85–88 |
| + 11 core mechanism improvements | 88–90 |
| + 10 hole patches | 90 (defended) |
| + 6 incentive/adoption improvements | 91–92 |
| + 12 adoption readiness improvements | 91–92 (readiness to 94–96) |
| + Money Machine v1 | 91–92 |
| + Money Machine v2 | 92–93 |
| + The Rail | 92–93 |

### Mechanism Percentile Journey

| Phase | Percentile |
|-------|------------|
| Original (SaaS tiers) | 75 |
| + 5 revenue upgrades | 82–85 |
| + Money Machine v1 | 93–94 |
| + Money Machine v2 | 95–96 |
| + The Rail | 96 |

### Revenue Journey

| Model | Year 10 Revenue | Year 10 Valuation |
|-------|-----------------|-------------------|
| Original SaaS | $871M | $10–15B |
| 5 Revenue Upgrades | $3.5B | $15–25B |
| Money Machine v1 | $6B | $40–70B |
| Money Machine v2 | $25–45B | $150–300B |
| Money Machine v2 + Rail | $40–96B | $200–500B |

### Final State

- **Idea percentile:** 92nd–93rd
- **Mechanism percentile:** 96th
- **Adoption readiness percentile:** 94th–96th
- **Overall:** 92nd–93rd
- **Better pre-launch idea than:** Apple, Amazon, Microsoft, Meta, Nvidia, Tesla
- **Tied with:** Ethereum, Stripe
- **Below:** Bitcoin, Google

### The One Sentence

A protocol that makes honesty the only rational strategy for any autonomous system — and takes an invisible cut of every transaction it enables.

---

## Summary

- **Phases 1–4:** Core protocol and mechanisms — largely implemented.
- **Phases 5–6:** Adoption and readiness — documented; localization and metrics are incremental.
- **Phases 7–9:** Revenue and rail — spec docs for future productization.

See [README.md](./README.md) for the full doc index.
