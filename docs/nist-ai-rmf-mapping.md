# NIST AI RMF Mapping

**NIST AI Risk Management Framework** — January 2023  
Govern, Map, Measure, Manage AI risks.

Kova capabilities mapped to the four pillars of the NIST AI RMF. Use this alongside [eu-ai-act-mapping.md](./eu-ai-act-mapping.md) for comprehensive AI compliance.

---

## Overview: Four Pillars

| Pillar | Kova Capability |
|--------|------------------|
| **Govern** | Covenant as governance artifact; identity binding; operator accountability |
| **Map** | CCL constraints map permitted/denied actions; scope and resources |
| **Measure** | Canary tests, attestation, compliance record, Kova Score |
| **Manage** | Breach detection, antifragile improvements, temporal evolution |

---

## Govern

| RMF Requirement | Kova Capability |
|-----------------|------------------|
| Culture of risk management | Covenant commits operator to behavioral bounds; breach has consequences |
| Roles and responsibilities | Issuer (operator), beneficiary; identity binding |
| Accountability | Legal identity package; evidentiary export for courts/regulators |
| Governance structures | Covenant as executable governance; recursive accountability (monitors have covenants) |
| Policies and procedures | CCL as machine-enforceable policy; audit trail as procedure evidence |

**Packages:** `@nobulex/core`, `@nobulex/identity`, `@nobulex/legal`, `@nobulex/recursive`

---

## Map

| RMF Requirement | Kova Capability |
|-----------------|------------------|
| Context mapping | Covenant scope (capabilities, resources); CCL constraints |
| Risk identification | Canary tests probe boundaries; robustness package finds vulnerabilities |
| Data and system mapping | Behavioral provenance; action → covenant authorization chain |
| Stakeholder mapping | Issuer, beneficiary, counterparties (attestation) |
| Impact assessment | Breach severity; reputation impact; trust graph propagation |

**Packages:** `@nobulex/ccl`, `@nobulex/canary`, `@nobulex/robustness`, `@nobulex/breach`

---

## Measure

| RMF Requirement | Kova Capability |
|-----------------|------------------|
| Performance metrics | Compliance record (covenant coverage, breach rate, canary pass rate) |
| Risk metrics | Attestation coverage; breach count; Kova Score dimensions |
| Benchmarking | Canary tests as synthetic benchmarks; pass rate over time |
| Monitoring | Enforcement monitor; audit trail; reputation scoring |
| Validation | 11 specification checks; external attestation; ZK proofs |

**Packages:** `@nobulex/enforcement`, `@nobulex/attestation`, `@nobulex/reputation`, `@nobulex/legal` (computeNobulexScore → Kova Score)

---

## Manage

| RMF Requirement | Kova Capability |
|-----------------|------------------|
| Risk response | Breach attestation; stake burn; trust graph propagation |
| Allocation of resources | Covenant constraints; rate limits; capability restrictions |
| Tracking and documentation | Audit trail; LegalIdentityPackage; auditTrailExport |
| Continuous improvement | Antifragile package — breaches generate constraint improvements |
| Communication | Covenant as public commitment; attestation as bilateral verification |

**Packages:** `@nobulex/breach`, `@nobulex/antifragile`, `@nobulex/temporal`, `@nobulex/legal`

---

## Kova Score and NIST RMF

The **Kova Score** (multidimensional trust profile, `computeNobulexScore` in `@nobulex/legal`) aligns with NIST's measurement focus:

| Kova Score Dimension | NIST RMF Alignment |
|-----------------------|--------------------|
| complianceRate | Map + Measure — covenant coverage |
| attestationCoverage | Measure — external verification |
| canaryPassRate | Measure — synthetic validation |
| breachFreedom | Manage — risk response effectiveness |
| stakeLevel | Govern — accountability backing |
| lineageDepth | Map — governance lineage |

```typescript
import { computeNobulexScore } from '@nobulex/legal';

const profile = computeNobulexScore(agentId, complianceRecord, covenantHistory, {
  reputation: reputationSnapshot,
});
// Use profile.composite or individual dimensions for NIST-aligned metrics
```

---

## Quick Compliance Path

1. **Govern** — Create covenant; bind identity; document scope.
2. **Map** — Define CCL constraints; run canary tests to map boundaries.
3. **Measure** — Track compliance record; run computeNobulexScore; export LegalIdentityPackage.
4. **Manage** — Enable breach detection; use antifragile improvements; evolve covenants via temporal package.

```typescript
import { NobulexClient } from '@nobulex/sdk';
import { exportLegalPackage, computeNobulexScore } from '@nobulex/legal';

const client = new NobulexClient();
// ... create covenant, operate, run canary ...

const pkg = exportLegalPackage(agentId, operatorId, data, 'json');
const nobulexScore = computeNobulexScore(agentId, pkg.complianceRecord, pkg.covenantHistory, {
  reputation: pkg.reputationSnapshot,
});
```
