# Rapid Compliance Checklist

Post-incident: get to EU AI Act / NIST AI RMF readiness in under a week.

---

## Day 1: Covenant + Verification

- [ ] Install: `npm install kova` (or `npm install @stele/sdk` for advanced use)
- [ ] Create covenant with constraints covering the incident scenario
- [ ] Run `client.verifyCovenant(covenant)` — all 11 checks pass
- [ ] Persist covenant (FileStore or production backend)

---

## Day 2: Canary + Enforcement

- [ ] Add canary tests for the failure mode and edge cases
- [ ] Run `CanaryRunner.run(covenant, challenges)` — all pass
- [ ] Enable enforcement monitor (or MCP guard) on agent
- [ ] Confirm audit trail is being produced

---

## Day 3: Legal Export + Kova Score

- [ ] Build `ComplianceRecord` from actual data (interactions, breaches, canary results)
- [ ] Call `exportLegalPackage(agentId, operatorId, data, 'json')`
- [ ] Call `computeSteleScore(agentId, compliance, covenantHistory)` (Kova Score)
- [ ] Review Kova Score dimensions; address lowest

---

## Day 4: EU AI Act Mapping

- [ ] Open [eu-ai-act-mapping.md](../eu-ai-act-mapping.md)
- [ ] For each relevant Article (10, 13, 15, 17, 53, 71, 72), confirm Kova capability is in place
- [ ] Run `generateComplianceReport(compliance, 'EU_AI_ACT')`
- [ ] Address any gaps from `regulatoryGapAnalysis`

---

## Day 5: NIST AI RMF Mapping

- [ ] Open [nist-ai-rmf-mapping.md](../nist-ai-rmf-mapping.md)
- [ ] Confirm Govern, Map, Measure, Manage pillars are covered
- [ ] Document in internal risk register

---

## Day 6–7: Attestation + Documentation

- [ ] Set up attestation with key counterparties (if applicable)
- [ ] Export `LegalIdentityPackage` in `pdf` or `legal-xml` for auditors
- [ ] Run `auditTrailExport(pkg)` for chronological evidence
- [ ] Store exports in secure, auditable location

---

## Quick Commands

```bash
# Verify covenant
npx tsx -e "
const { SteleClient } = require('@stele/sdk');
const client = new SteleClient();
// ... load covenant, verify
"

# Export legal package
# See docs/QUICK-START.md Step 7
```
