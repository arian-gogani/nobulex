# Nobulex

**The trust layer for AI agents.**

Nobulex is an open cryptographic protocol (MIT license) that enables AI agents to declare behavioral commitments, prove compliance, and build verifiable reputation across platforms. The way HTTPS enabled e-commerce, Nobulex enables agents to transact safely across organizational boundaries.

![Tests](https://img.shields.io/badge/tests-5%2C053%20passing-brightgreen)
![Packages](https://img.shields.io/badge/packages-44-orange)
![License](https://img.shields.io/badge/license-MIT-green)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![Lines](https://img.shields.io/badge/lines-106%2C000%2B-blue)

## Quick Start
```bash
npm install @nobulex/core @nobulex/crypto
```
```typescript
const { buildCovenant, verifyCovenant } = require('@nobulex/core');
const { generateKeyPair } = require('@nobulex/crypto');

const issuerKeys = await generateKeyPair();
const agentKeys = await generateKeyPair();

const covenant = await buildCovenant({
  issuer: { id: 'operator-1', publicKey: issuerKeys.publicKeyHex, role: 'issuer' },
  beneficiary: { id: 'my-agent', publicKey: agentKeys.publicKeyHex, role: 'beneficiary' },
  privateKey: issuerKeys.privateKey,
  constraints: "permit read on '/data/**'\ndeny write on '/system/**'"
});

const result = await verifyCovenant(covenant);
console.log(result.valid);  // true — 11 cryptographic checks passed
```

## The Protocol

**Three primitives. One protocol.**

1. **Inscribe** — Agent publishes a signed Covenant specifying behavioral constraints
2. **Operate** — Every action evaluated against constraints in real-time
3. **Verify** — Anyone verifies compliance using 11 specification checks with just the public key

## Verification Output
```
✓ id_match          — Document ID matches canonical hash
✓ signature_valid   — Ed25519 issuer signature is valid
✓ not_expired       — Covenant has not expired
✓ active            — Covenant is active
✓ ccl_parses        — CCL constraints parsed successfully
✓ enforcement_valid — Enforcement config valid
✓ proof_valid       — Proof config valid
✓ chain_depth       — Chain depth within limits
✓ document_size     — Document size within limits
✓ countersignatures — Countersignatures valid
✓ nonce_present     — Cryptographic nonce present (replay protection)
```

## CCL (Covenant Constraint Language)
```ccl
permit read on '/data/**'
deny write on '/system/**'
permit api.call on 'openai.com/**' when request.token_count < 10000
require audit.log on '**'
limit api.call 500 per 3600 seconds
```

Deny wins. Most specific match wins. Default deny. Resource globs supported.

## Packages (44)

### Foundation
| Package | Description |
|---------|-------------|
| @nobulex/types | Error hierarchy, validation guards, logging, tracing |
| @nobulex/crypto | Ed25519 signing, SHA-256 hashing, JCS canonicalization |
| @nobulex/ccl | Covenant Constraint Language parser & evaluator |
| @nobulex/core | Covenant build, verify, chain, serialize, countersign |
| @nobulex/store | MemoryStore + FileStore pluggable persistence |
| @nobulex/verifier | Stateful verification engine with 11 checks |
| @nobulex/identity | Agent identity creation, evolution & lineage tracking |

### Enforcement
| Package | Description |
|---------|-------------|
| @nobulex/enforcement | Runtime enforcement monitor with audit trail |
| @nobulex/proof | Poseidon-based compliance proof generation |
| @nobulex/breach | Breach detection, attestation & trust graph propagation |
| @nobulex/reputation | Trust scoring with decay and stake-weighted reputation |
| @nobulex/mcp | MCP middleware guard for tool-call enforcement |

### Protocol
| Package | Description |
|---------|-------------|
| @nobulex/attestation | External attestation reconciliation |
| @nobulex/canary | Canary testing framework |
| @nobulex/gametheory | Game-theoretic honesty proofs |
| @nobulex/composition | Formal constraint composition |
| @nobulex/antifragile | Breach-to-improvement engine |
| @nobulex/negotiation | Multi-party covenant negotiation |
| @nobulex/consensus | Accountability-based consensus |
| @nobulex/robustness | Formal robustness analysis |
| @nobulex/temporal | Temporal evolution & triggers |
| @nobulex/recursive | Meta-covenants and recursive verification |
| @nobulex/alignment | AI alignment property verification |
| @nobulex/norms | Emergent norm discovery |
| @nobulex/substrate | Cross-substrate constraint translation |
| @nobulex/derivatives | Trust futures & derivative instruments |
| @nobulex/legal | Legal compliance mapping |
| @nobulex/eu-compliance | EU AI Act compliance mapping |

### Platform
| Package | Description |
|---------|-------------|
| @nobulex/sdk | Unified API and QuickCovenant builders |
| @nobulex/react | Reactive UI primitives |
| @nobulex/evm | EVM anchoring & on-chain registry |
| @nobulex/mcp-server | JSON-RPC 2.0 MCP server |
| @nobulex/cli | Command-line interface |

## Architecture
```
+-----------------------------------------------------+
|                      Platform                        |
|        react  .  evm  .  mcp-server  .  cli          |
+-----------------------------------------------------+
|                        SDK                           |
+-----------------------------------------------------+
|                      Protocol                        |
|    attestation . canary . gametheory . composition    |
|    antifragile . negotiation . consensus . robustness |
|    temporal . recursive . alignment . norms           |
|    substrate . derivatives . legal . eu-compliance    |
+-----------------------------------------------------+
|                    Enforcement                       |
|     enforcement . proof . breach . reputation . mcp   |
+-----------------------------------------------------+
|                    Foundation                        |
|   types . crypto . ccl . core . store . verifier .   |
|   identity                                           |
+-----------------------------------------------------+
```

## EU AI Act Compliance

Enforcement deadline: **August 2, 2026**. Fines up to **€35M or 7% of global turnover**.

Nobulex maps directly to EU AI Act requirements. See @nobulex/eu-compliance for templates.

## Development
```bash
git clone https://github.com/agbusiness195/NOBULEX.git
cd NOBULEX
npm install
npm run build
npx vitest run    # 5,053 tests across 92 suites
```

## Links

- **Website:** [nobulex.com](https://nobulex.com)
- **npm:** [@nobulex](https://www.npmjs.com/org/nobulex)
- **X:** [@nobulexlabs](https://x.com/nobulexlabs)

## License

MIT
