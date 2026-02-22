# EU AI Act Mapping

**Regulation (EU) 2024/1689** — Artificial Intelligence Act  
**Key deadline:** August 2, 2026 (general obligations for high-risk AI systems)

Kova capabilities mapped to EU AI Act requirements. Use this as the fastest path to compliance.

---

## Article 10 — Risk Management

| Requirement | Kova Capability |
|-------------|------------------|
| Identify and analyze known and foreseeable risks | Covenant constraints define permitted/denied actions; canary tests probe boundaries |
| Iterative risk management throughout lifecycle | Temporal evolution; covenant updates; lineage tracking |
| Residual risk assessment | Breach detection; attestation; compliance record |
| Documentation of risk management | Audit trail; LegalIdentityPackage; export to PDF/legal-XML |

**Packages:** `@stele/core`, `@stele/canary`, `@stele/temporal`, `@stele/legal`

---

## Article 11 — Data Governance

| Requirement | Kova Capability |
|-------------|------------------|
| Training data quality and relevance | Out of scope (model-level); Kova constrains agent *behavior* post-training |
| Bias monitoring | Canary tests for discriminatory patterns; CCL conditions |
| Data provenance | Behavioral provenance; audit trail links actions to covenant |

**Packages:** `@stele/canary`, `@stele/enforcement`

---

## Article 13 — Transparency and Explainability

| Requirement | Kova Capability |
|-------------|------------------|
| Design for interpretability | CCL is human-readable; covenant is the specification |
| Instructions for use | Covenant constraints document intended use; beneficiary/issuer roles |
| Explainability of output | Behavioral provenance; which rule permitted each action |
| Documentation for deployers | LegalIdentityPackage; compliance record; attestations |

**Packages:** `@stele/core`, `@stele/legal`, `@stele/enforcement`

---

## Article 14 — Human Oversight

| Requirement | Kova Capability |
|-------------|------------------|
| Effective human oversight | Covenant can require human-in-the-loop for specific actions |
| Override and intervention | CCL `require` and `deny`; operator can revoke covenant |
| Awareness of limitations | Canary tests surface edge cases; breach attestation |

**Packages:** `@stele/ccl`, `@stele/canary`, `@stele/breach`

---

## Article 15 — Accuracy, Robustness, Cybersecurity

| Requirement | Kova Capability |
|-------------|------------------|
| Accuracy and resilience | Canary tests; robustness package; adversarial testing |
| Fallback for critical applications | CCL conditions; temporal triggers for degraded mode |
| Cybersecurity | Ed25519 signing; content-addressed documents; constant-time comparison |
| Adversarial robustness | `@stele/robustness`; fuzz testing; boundary analysis |

**Packages:** `@stele/canary`, `@stele/robustness`, `@stele/crypto`

---

## Article 17 — Record-Keeping (Logs)

| Requirement | Kova Capability |
|-------------|------------------|
| Automatic logging | Enforcement monitor produces hash-chained audit trail |
| Logs of decisions | Each action linked to covenant evaluation |
| Traceability | Content-addressed documents; lineage; LegalIdentityPackage |
| Retention | Configurable in store; export for legal hold |

**Packages:** `@stele/enforcement`, `@stele/store`, `@stele/legal`

---

## Article 53 — Transparency Obligations for Certain AI Systems

| Requirement | Kova Capability |
|-------------|------------------|
| Disclosure that content is AI-generated | Covenant can require labeling; CCL `require` for disclosure |
| Synthetic content identification | Out of scope (model output); Kova can enforce metadata tagging |
| Transparency to deployers | LegalIdentityPackage; compliance record; covenant history |

**Packages:** `@stele/legal`, `@stele/core`

---

## Article 71 — Conformity Assessment

| Requirement | Kova Capability |
|-------------|------------------|
| Internal control (self-assessment) | Verification engine; 11 specification checks; canary tests |
| Technical documentation | Covenant + audit trail + LegalIdentityPackage |
| Declarations of conformity | Legal package export; jurisdictional mapping |

**Packages:** `@stele/verifier`, `@stele/canary`, `@stele/legal`

---

## Article 72 — Post-Market Monitoring

| Requirement | Kova Capability |
|-------------|------------------|
| Monitor performance in use | Reputation; breach propagation; attestation coverage |
| Report serious incidents | Breach attestation; trust graph propagation |
| Corrective action | Covenant revocation; temporal evolution; antifragile improvements |

**Packages:** `@stele/reputation`, `@stele/breach`, `@stele/antifragile`, `@stele/temporal`

---

## Summary: Kova → EU AI Act

| Article | Kova Coverage |
|---------|----------------|
| 10 — Risk management | Covenant, canary, temporal, legal |
| 11 — Data governance | Partial (behavioral provenance) |
| 13 — Transparency | Covenant, CCL, LegalIdentityPackage |
| 14 — Human oversight | CCL conditions, canary |
| 15 — Accuracy, robustness | Canary, robustness, crypto |
| 17 — Record-keeping | Enforcement, store, legal |
| 53 — Transparency obligations | Legal, CCL |
| 71 — Conformity assessment | Verifier, canary, legal |
| 72 — Post-market monitoring | Reputation, breach, antifragile |

**Gaps:** Training data quality (Article 11) and synthetic content identification (Article 53) are model-level; Kova operates at the agent/behavior layer. Combine with model documentation and output classifiers for full coverage.

---

## Quick Compliance Path

1. **Create covenant** — Document permitted/denied actions, intended use, limitations.
2. **Run canary tests** — Validate constraints; document in compliance record.
3. **Enable enforcement** — Runtime gating; audit trail.
4. **Export LegalIdentityPackage** — For conformity assessment and audits.
5. **Map to jurisdiction** — Use `@stele/legal` EU-AI mapping.

```typescript
import { SteleClient } from '@stele/sdk';
import { exportLegalPackage } from '@stele/legal';

const client = new SteleClient();
// ... create covenant, run canary, operate ...

const pkg = exportLegalPackage(agentId, operatorId, {
  covenants: covenantHistory,
  compliance: complianceRecord,
  reputation: reputationSnapshot,
  attestations,
  insurance: [],
}, 'pdf');
// Submit for conformity assessment
```
