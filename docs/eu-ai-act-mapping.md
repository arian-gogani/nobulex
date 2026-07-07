# EU AI Act Mapping

**Regulation (EU) 2024/1689**  - Artificial Intelligence Act  
**Key deadline:** December 2, 2027 (general obligations for high-risk AI systems)

Nobulex capabilities mapped to EU AI Act requirements. Use this as the fastest path to compliance.

---

## Article 10  - Risk Management

| Requirement | Nobulex Capability |
|-------------|------------------|
| Identify and analyze known and foreseeable risks | Covenant constraints define permitted/denied actions; canary tests probe boundaries |
| Iterative risk management throughout lifecycle | Temporal evolution; covenant updates; lineage tracking |
| Residual risk assessment | Breach detection; attestation; compliance record |
| Documentation of risk management | Audit trail; LegalIdentityPackage; export to PDF/legal-XML |

**Packages:** `@nobulex/core`, `@nobulex/canary`, `@nobulex/temporal`, `@nobulex/legal`

---

## Article 11  - Data Governance

| Requirement | Nobulex Capability |
|-------------|------------------|
| Training data quality and relevance | Out of scope (model-level); Nobulex constrains agent *behavior* post-training |
| Bias monitoring | Canary tests for discriminatory patterns; CCL conditions |
| Data provenance | Behavioral provenance; audit trail links actions to covenant |

**Packages:** `@nobulex/canary`, `@nobulex/enforcement`

---

## Article 13  - Transparency and Explainability

| Requirement | Nobulex Capability |
|-------------|------------------|
| Design for interpretability | CCL is human-readable; covenant is the specification |
| Instructions for use | Covenant constraints document intended use; beneficiary/issuer roles |
| Explainability of output | Behavioral provenance; which rule permitted each action |
| Documentation for deployers | LegalIdentityPackage; compliance record; attestations |

**Packages:** `@nobulex/core`, `@nobulex/legal`, `@nobulex/enforcement`

---

## Article 14  - Human Oversight

| Requirement | Nobulex Capability |
|-------------|------------------|
| Effective human oversight | Covenant can require human-in-the-loop for specific actions |
| Override and intervention | CCL `require` and `deny`; operator can revoke covenant |
| Awareness of limitations | Canary tests surface edge cases; breach attestation |

**Packages:** `@nobulex/ccl`, `@nobulex/canary`, `@nobulex/breach`

---

## Article 15  - Accuracy, Robustness, Cybersecurity

| Requirement | Nobulex Capability |
|-------------|------------------|
| Accuracy and resilience | Canary tests; robustness package; adversarial testing |
| Fallback for critical applications | CCL conditions; temporal triggers for degraded mode |
| Cybersecurity | Ed25519 signing; content-addressed documents; constant-time comparison |
| Adversarial robustness | `@nobulex/robustness`; fuzz testing; boundary analysis |

**Packages:** `@nobulex/canary`, `@nobulex/robustness`, `@nobulex/crypto`

---

## Article 17  - Record-Keeping (Logs)

| Requirement | Nobulex Capability |
|-------------|------------------|
| Automatic logging | Enforcement monitor produces hash-chained audit trail |
| Logs of decisions | Each action linked to covenant evaluation |
| Traceability | Content-addressed documents; lineage; LegalIdentityPackage |
| Retention | Configurable in store; export for legal hold |

**Packages:** `@nobulex/enforcement`, `@nobulex/store`, `@nobulex/legal`

---

## Article 53  - Transparency Obligations for Certain AI Systems

| Requirement | Nobulex Capability |
|-------------|------------------|
| Disclosure that content is AI-generated | Covenant can require labeling; CCL `require` for disclosure |
| Synthetic content identification | Out of scope (model output); Nobulex can enforce metadata tagging |
| Transparency to deployers | LegalIdentityPackage; compliance record; covenant history |

**Packages:** `@nobulex/legal`, `@nobulex/core`

---

## Article 71  - Conformity Assessment

| Requirement | Nobulex Capability |
|-------------|------------------|
| Internal control (self-assessment) | Verification engine; 11 specification checks; canary tests |
| Technical documentation | Covenant + audit trail + LegalIdentityPackage |
| Declarations of conformity | Legal package export; jurisdictional mapping |

**Packages:** `@nobulex/verifier`, `@nobulex/canary`, `@nobulex/legal`

---

## Article 72  - Post-Market Monitoring

| Requirement | Nobulex Capability |
|-------------|------------------|
| Monitor performance in use | Reputation; breach propagation; attestation coverage |
| Report serious incidents | Breach attestation; trust graph propagation |
| Corrective action | Covenant revocation; temporal evolution; antifragile improvements |

**Packages:** `@nobulex/reputation`, `@nobulex/breach`, `@nobulex/antifragile`, `@nobulex/temporal`

---

## Summary: Nobulex → EU AI Act

| Article | Nobulex Coverage |
|---------|----------------|
| 10  - Risk management | Covenant, canary, temporal, legal |
| 11  - Data governance | Partial (behavioral provenance) |
| 13  - Transparency | Covenant, CCL, LegalIdentityPackage |
| 14  - Human oversight | CCL conditions, canary |
| 15  - Accuracy, robustness | Canary, robustness, crypto |
| 17  - Record-keeping | Enforcement, store, legal |
| 53  - Transparency obligations | Legal, CCL |
| 71  - Conformity assessment | Verifier, canary, legal |
| 72  - Post-market monitoring | Reputation, breach, antifragile |

**Gaps:** Training data quality (Article 11) and synthetic content identification (Article 53) are model-level; Nobulex operates at the agent/behavior layer. Combine with model documentation and output classifiers for full coverage.

---

## Quick Compliance Path

1. **Create covenant**  - Document permitted/denied actions, intended use, limitations.
2. **Run canary tests**  - Validate constraints; document in compliance record.
3. **Enable enforcement**  - Runtime gating; audit trail.
4. **Export LegalIdentityPackage**  - For conformity assessment and audits.
5. **Map to jurisdiction**  - Use `@nobulex/legal` EU-AI mapping.

```typescript
import { NobulexClient } from '@nobulex/sdk';
import { exportLegalPackage } from '@nobulex/legal';

const client = new NobulexClient();
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
