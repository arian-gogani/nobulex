# EU AI Act Compliance Checklist — Nobulex Mapping

**Deadline: August 2, 2026** for general obligations on high-risk AI systems.

Use this checklist to verify your agent deployment meets EU AI Act requirements via Nobulex.

---

## High-Level Checklist

| # | Requirement | Nobulex Capability | Package | Status |
|---|-------------|----------------|---------|--------|
| 1 | Risk management (Art. 10) | Covenant constraints, canary tests, breach detection | @nobulex/core, @nobulex/canary, @nobulex/breach | ✅ |
| 2 | Data governance (Art. 11) | Behavioral provenance, audit trail | @nobulex/enforcement | ✅ |
| 3 | Transparency (Art. 13) | CCL human-readable, LegalIdentityPackage | @nobulex/core, @nobulex/legal | ✅ |
| 4 | Human oversight (Art. 14) | CCL require/deny, revocation | @nobulex/ccl, @nobulex/breach | ✅ |
| 5 | Accuracy & cybersecurity (Art. 15) | Canary, robustness, Ed25519 | @nobulex/canary, @nobulex/robustness, @nobulex/crypto | ✅ |
| 6 | Record-keeping (Art. 17) | Hash-chained audit trail | @nobulex/enforcement, @nobulex/store | ✅ |
| 7 | Transparency obligations (Art. 53) | Covenant disclosure, LegalIdentityPackage | @nobulex/legal | ✅ |
| 8 | Conformity assessment (Art. 71) | Verification, compliance proof | @nobulex/verifier, @nobulex/proof | ✅ |

---

## Implementation Steps

### 1. Declare a Covenant (5 min)

```bash
kova init
# or
npx kova init
```

Creates `stele.config.json` and key pair. Add constraints in CCL.

### 2. Run Compliance Audit (1 min)

```bash
kova audit .
```

Shows EU AI Act readiness %, missing items, and recommendations.

### 3. Enable Enforcement (10 min)

```typescript
import { withKova } from 'kova';
const server = await withKova(yourMCPServer, 'data-isolation');
```

Or use `@nobulex/enforcement` Monitor for custom agents.

### 4. Export Legal Package (5 min)

```typescript
import { exportLegalPackage } from '@nobulex/legal';
const pkg = exportLegalPackage(agentId, operatorId, data, 'json');
```

Court-ready evidentiary package for regulators and insurers.

---

## Article-by-Article Mapping

See [eu-ai-act-mapping.md](./eu-ai-act-mapping.md) for full Article → Nobulex capability mapping.

---

## Certification Path

For regulated industries (finance, healthcare, critical infrastructure):

1. **Solo tier** — Run `kova init` + `kova audit`; fix gaps
2. **Bilateral** — Add attestation; counterparty signs interactions
3. **Network** — Enroll in Nobulex trust graph; publish reputation
4. **Certified** — Use @nobulex/certification for agent class certification

---

## Support

- [QUICK-START.md](./QUICK-START.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- GitHub Issues: https://github.com/nobulexdev/nobulex/issues
