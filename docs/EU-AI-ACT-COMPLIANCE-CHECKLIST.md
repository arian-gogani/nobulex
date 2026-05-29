# EU AI Act Compliance Checklist — Nobulex Mapping

**Deadline: August 2, 2026** for general obligations on high-risk AI systems.

Use this checklist to verify your agent deployment meets EU AI Act requirements with Nobulex.

---

## High-Level Checklist

| # | Requirement | How Nobulex helps |
|---|-------------|-------------------|
| 1 | Risk management (Art. 10) | Covenant constraints declare permitted behavior; deviations are detectable |
| 2 | Data governance (Art. 11) | Behavioral provenance via signed, hash-chained action log |
| 3 | Transparency (Art. 13) | CCL constraints are human-readable; receipts are independently verifiable |
| 4 | Human oversight (Art. 14) | CCL require/deny rules and covenant revocation |
| 5 | Accuracy & cybersecurity (Art. 15) | Ed25519 signatures over RFC 8785 canonical JSON |
| 6 | Record-keeping (Art. 17) | Tamper-evident hash-chained audit trail |
| 7 | Transparency obligations (Art. 53) | Covenant disclosure; receipts verifiable without trusting the operator |
| 8 | Conformity assessment (Art. 71) | Deterministic verification of the action log against the covenant |

---

## Implementation Steps

### 1. Declare a Covenant (5 min)

```bash
npx @nobulex/cli init
```

Scaffolds a new covenant project. Add constraints in CCL.

### 2. Verify the Action Log (1 min)

```bash
npx @nobulex/cli verify ./action-log.json
```

Checks the Ed25519 signatures and hash-chain integrity of the log.

### 3. Enable Enforcement (10 min)

```bash
npm install -g @nobulex/mcp-server
npx nobulex-mcp
```

Wire it into your MCP client config, or use `@nobulex/sdk`'s `protect()` for custom agents.

### 4. Export Compliance Report (5 min)

```bash
npx @nobulex/cli report ./action-log.json --framework eu-ai-act-article-12
```

Produces a compliance report derived from the signed, hash-chained action log.

---

## Article-by-Article Mapping

See [eu-ai-act-mapping.md](./eu-ai-act-mapping.md) for full Article-to-capability mapping.

---

## Certification Path

For regulated industries (finance, healthcare, critical infrastructure):

1. **Solo tier** — Run `npx @nobulex/cli init` then `verify`; fix gaps
2. **Bilateral** — Add attestation; counterparty countersigns the covenant
3. **Network** — Publish receipts so a downstream auditor can verify independently
4. **Certified** — Third-party conformity assessment for your agent class

---

## Support

- [QUICK-START.md](./QUICK-START.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- GitHub Issues: https://github.com/arian-gogani/nobulex/issues
