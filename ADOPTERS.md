# Who's using Nobulex

## Integration Partners

**AgentAudit AI** (RunLockAI) — First integration partner. Five-point partnership locked: reference implementation, mutual docs, co-authored `action-ref-v1` spec, joint case study, founding member status. Cross-validation passed (5/5). Signed specimen receipt published at [fixtures/agentaudit-specimen-v1.json](./fixtures/agentaudit-specimen-v1.json). Integration guide: [docs/INTEGRATION-GUIDE-AGENTAUDIT.md](./docs/INTEGRATION-GUIDE-AGENTAUDIT.md). On-chain persistence across 5 EVM mainnets (Base, Arbitrum, Optimism, Polygon, Mantle).

## Peer Implementations

**ahg/inference-receipts** (PHP) — Independent PHP implementation of the nobulex receipt format by ArchiveHeritageGroup/heratio. Apache-2.0, published on [Packagist](https://packagist.org/packages/ahg/inference-receipts). Uses nobulex test vectors as conformance fixtures. Built for EU AI Act Article 12 compliance in PHP 8.3/Laravel. [GitHub](https://github.com/ArchiveHeritageGroup/inference-receipts)

## Ecosystem Adoption

**AURA Reputation Protocol** — Wired Nobulex `action_ref` as the idempotency key for reputation observations. Receipts feed directly into agent reputation scoring.

**agentmemory** (16,700+ stars) — Developer acknowledged Nobulex for canonicalization and signing as the next layer for audit receipts.

**Agent OS** (Liuyanfeng1234) — Byte-compatible COMMITTED Claim engine uses the same four-field preimage structure. Cross-validation in progress for the A2A v0.4 conformance matrix.

## Standards & Ecosystem

- **x402 Foundation** (Coinbase) — CODEOWNER review, composite trust-query co-sign, test vectors cross-validated
- **IETF** — Referenced in draft-vauban-x402-stark-receipts-00
- **W3C AIVS** — Exploring interoperability with Conduit session proofs
- **OWASP** — Contributing to AML compliance and AI vulnerability scoring
- **A2A** (Google) — Active in Composable Trust Evidence Format discussions
- **AutoGen** (Microsoft) — Participating in delegation provenance discussions

## Using Nobulex?

Open an issue or PR to add yourself.

**ATR (Agent-Threat-Rules)** — eeee2345 opened tracking issue #70 listing Nobulex as the reference implementation for the ATREventHandler protocol.

**CTEF v0.3.2** — kenneives published the Conformance Test Evidence Format with nobulex accepted as a row alongside AlgoVoi, Concordia, Dominion Observatory, and Vauban Pay.

**AURA** — luisllaver built a receipt sink using nobulex action_ref for idempotency. Receipts become reputation observations automatically via `POST /v1/reputation/ingest-receipt`.

**LlamaIndex GuardedMemory** — vgudur-dev proposing `GuardedMemory(BaseMemory)` PR using nobulex action_ref pattern for memory provenance attestation.
