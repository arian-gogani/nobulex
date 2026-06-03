# Who's using Nobulex

## Integration Partners

**AgentAudit AI** (RunLockAI) — First integration partner. Five-point partnership locked: reference implementation, mutual docs, co-authored `action-ref-v1` spec, joint case study, founding member status. Cross-validation passed (5/5). Signed specimen receipt published at [fixtures/agentaudit-specimen-v1.json](./fixtures/agentaudit-specimen-v1.json). Integration guide: [docs/INTEGRATION-GUIDE-AGENTAUDIT.md](./docs/INTEGRATION-GUIDE-AGENTAUDIT.md). On-chain persistence across 5 EVM mainnets (Base, Arbitrum, Optimism, Polygon, Mantle).

## Peer Implementations

**ahg/inference-receipts** (PHP) — Independent PHP implementation of the nobulex receipt format by ArchiveHeritageGroup/heratio. Apache-2.0, published on [Packagist](https://packagist.org/packages/ahg/inference-receipts). Uses nobulex test vectors as conformance fixtures. Built for EU AI Act Article 12 compliance in PHP 8.3/Laravel. [GitHub](https://github.com/ArchiveHeritageGroup/inference-receipts)

## Ecosystem Adoption

**AURA Reputation Protocol** — Wired Nobulex `action_ref` as the idempotency key for reputation observations. Receipts feed directly into agent reputation scoring.

**agentmemory** (16,700+ stars) — Privacy-safe audit receipts PR ([rohitg00/agentmemory#617](https://github.com/rohitg00/agentmemory/pull/617)) uses Nobulex canonicalization and signing for memory provenance.

## Standards & Ecosystem

- **OWASP** — Sections 8-11 of the AML and Sanctions Compliance for AI Agent Payments cheat sheet ([PR #2210](https://github.com/OWASP/CheatSheetSeries/pull/2210), merged into master by Jim Manico) include JCS canonicalization rationale, cross-agent payment accountability, sanctions-list freshness in signed receipts, and regulatory mapping, credited to @arian-gogani.
- **vaara v0.50** (Henri Sirkkavaara) — Aider + MCP runtime audit layer shipping Ed25519-signed, JCS-canonical receipts with RFC 3161 timestamp anchoring and EU AI Act Article 12 export, citing the nobulex signed-receipt design. [GitHub](https://github.com/vaaraio/vaara)
- **Microsoft Agent Governance Toolkit** — ADOPTERS.md PR #1703 merged by Microsoft maintainers
- **W3C AIVS** — In contact with chair re: format alignment between per-action receipts (Nobulex) and session-level proofs (Conduit)
- **AutoGen (Microsoft)** — Engaged in HDP delegation provenance discussion ([microsoft/autogen#7667](https://github.com/microsoft/autogen/pull/7667))

## Using Nobulex?

Open an issue or PR to add yourself.

**LlamaIndex GuardedMemory** — vgudur-dev proposing `GuardedMemory(BaseMemory)` PR using nobulex action_ref pattern for memory provenance attestation.

**Mission Control (builderz-labs)** — RFC accepted as feature request, design proposal at [docs/integrations/builderz-labs-mission-control-rfc.md](./docs/integrations/builderz-labs-mission-control-rfc.md) covering DID identity, signed attestations, and blend policy.
