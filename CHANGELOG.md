# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Agent Reliability Index** (observatory layer): a weekly public publication tracking AI agent behavior change across frontier vendors. Charter Issue 001 committed at `observatory/issue-001-charter.md`. Methodology specified at `docs/AGENT-RELIABILITY-INDEX.md`. Strategic rationale documented at `docs/OBSERVATORY-VISION.md`. Public-facing page added at `website/observatory.html` with main-nav and sitemap entries.
- The observatory layer sits on top of the existing bilateral receipt protocol substrate, not replacing it. Year-1 operation runs on publicly observable data (standardized prompts on public model endpoints, vendor disclosure deltas, public incident reports); Year-2+ scales to bilateral receipt streams as adoption grows.

### Strategic positioning

- Nobulex's category framing is updated from "compliance evidence protocol" to "neutral observer of cross-organization AI agent transactions, on path to becoming the rating-agency layer for the agent economy." The existing protocol work remains the substrate and credibility foundation; the observatory and rating-agency framing is the strategic destination layered on top. See `docs/OBSERVATORY-VISION.md` for the full thesis.

## [0.3.0] - 2026-04-16

### Changed
- Merged `@nobulex/quickstart` into `@nobulex/middleware` (protect/transformSyntax)
- Merged `@nobulex/core-types` into `@nobulex/types` (all protocol interfaces)
- Merged `@nobulex/composability` into `@nobulex/core` (covenant compatibility)
- Merged `@nobulex/attestation` into `@nobulex/proof` (session digests, attestation records)
- Merged `@nobulex/verifier` into `@nobulex/verification` (standalone verifier engine)
- Merged `@nobulex/kova` into `@nobulex/mcp` (withKova convenience layer)
- Reduced package count from 32 to 26

## [0.2.2] - 2026-04-15

### Added

- Behavioral attestation records (`@nobulex/attestation`) — session digests and chain verification
- Cross-agent verification handshake — 8-step protocol in `@nobulex/sdk`
- Property-based tests with fast-check — protocol correctness by construction (6 properties)
- Performance benchmark suite (`benchmarks/bench.ts`) — 14 benchmarks covering keygen through 10K-action handshake
- Interactive demo (`examples/demo.ts`) — two agents verify each other, tampered proof caught at step 3
- LangChain integration example (`examples/langchain-agent.ts`) — covenant enforcement around a mocked agent
- Financial and healthcare scenario examples (`examples/scenarios/`) — regulated-industry use cases
- Partial chain verification (`verifyPartial`) — verify last N entries without replaying the full chain
- Threat model documentation (`docs/threat-model.md`)
- Security self-audit section in README
- API documentation with TypeDoc (`npm run docs:api`)
- Shared protocol constants module (`packages/types/src/constants.ts`)

### Changed

- Pruned ~520 trivial tests (string-equals-string assertions), replaced with parametric edge-case coverage
- Humanized code comments across all packages — varied density, informal inline notes, removed uniform JSDoc boilerplate
- Replaced generic `throw new Error()` with typed error classes (ValidationError, CryptoError, StorageError) across 37 call sites
- Added runtime input validation on all public SDK entry points (19 functions)
- Rewrote README to lead with demo output instead of description
- Updated CONTRIBUTING.md with code style guidance
- CI workflow simplified to Node 20, single job (install → build → vitest)

### Fixed

- TypeScript strict mode errors across workspace (stale nested dist copies, missing .d.ts emission)
- `ValidationError` constructor now accepts optional `field` parameter
- `NobulexError` now forwards `cause` to `Error()` for proper error chaining
- merkle and evidence-core builds now emit `.d.ts` files

## [0.1.0] - 2025-02-07

### Added

#### Foundation Layer
- **@nobulex/types**: Shared error classes (`NobulexError`, `ValidationError`, `CryptoError`,
  `CCLError`, `ChainError`, `StorageError`), validation utilities (`validateNonEmpty`,
  `validateRange`, `validateHex`, `validateProbability`), `Result<T, E>` type,
  runtime type guards, input sanitization, and structured logging with levels and
  child loggers.
- **@nobulex/crypto**: Ed25519 key generation, signing, and verification via
  `@noble/ed25519`; SHA-256 hashing; canonical JSON (JCS / RFC 8785);
  hex and base64url encoding; constant-time comparison; nonce generation.
- **@nobulex/ccl**: Covenant Constraint Language (CCL) with `permit`, `deny`,
  `require`, and `limit` statements; `when` conditional clauses; glob-based
  resource matching; deny-wins merge semantics; narrowing validation; serialization.
- **@nobulex/core**: Covenant document lifecycle -- `buildCovenant`, `verifyCovenant`
  (11 specification checks), `countersignCovenant`, `resignCovenant`, chain
  resolution, effective constraint computation, narrowing validation, and
  JSON serialization/deserialization.
- **@nobulex/store**: Pluggable `CovenantStore` interface with `MemoryStore` (in-memory)
  and `FileStore` (persistent, atomic writes) implementations; event system for
  put/delete notifications; batch operations; filtered listing.
- **@nobulex/verifier**: Standalone `Verifier` class with single, chain, action, and
  batch verification; history tracking; strict mode with warning escalation.
- **@nobulex/sdk**: Unified `NobulexClient` entry point combining key management,
  covenant lifecycle, identity management, chain operations, and CCL utilities;
  `QuickCovenant` convenience builders; typed event system with 8 event types.
- **@nobulex/identity**: Agent identity with model attestation, capabilities, deployment
  context, lineage tracking, evolution with carry-forward rates, and cryptographic
  verification.

#### Enforcement Layer
- **@nobulex/enforcement**: Runtime `Monitor` with CCL evaluation, rate limiting,
  hash-chained audit logging, and capability manifests.
- **@nobulex/proof**: Poseidon-based compliance proofs -- audit commitment, constraint
  commitment, proof generation, and verification.
- **@nobulex/breach**: Breach attestation with severity-based trust status mapping,
  trust graph management, and cryptographic verification.
- **@nobulex/reputation**: Reputation scoring with recency decay, breach penalties,
  staking, delegation, and endorsements.
- **@nobulex/mcp**: MCP guard wrapping MCP servers with Nobulex enforcement, audit
  logging, identity creation, and compliance proof generation; named presets.

#### Protocol Layer
- **@nobulex/attestation**: External attestation creation, reconciliation, chain
  linking, and coverage analysis.
- **@nobulex/canary**: Canary testing with challenge generation from CCL constraints,
  scheduled execution, and result correlation.
- **@nobulex/gametheory**: Game-theoretic honesty proofs with minimum stake computation.
- **@nobulex/composition**: Formal constraint composition with system-property checking,
  decomposition, and complexity analysis.
- **@nobulex/antifragile**: Breach-to-antibody generation, network health assessment,
  stress testing, governance proposals, and antifragility indexing.
- **@nobulex/negotiation**: Multi-party negotiation sessions with proposal workflows,
  Nash bargaining solutions, and Pareto optimality.
- **@nobulex/consensus**: Accountability-score-based tier classification and access
  decisions with configurable component weights.
- **@nobulex/robustness**: Input bound verification, vulnerability scanning, formal
  verification, contradiction detection, and robustness scoring.
- **@nobulex/temporal**: Trigger-based constraint evolution, trust decay modeling,
  violation tracking, and expiration forecasting.
- **@nobulex/recursive**: Meta-covenants, recursive verification, termination proofs,
  transitive trust computation, and minimal verification sets.
- **@nobulex/alignment**: HHH (Helpful, Honest, Harmless) alignment properties,
  alignment verification, drift detection, and decomposition.
- **@nobulex/norms**: Emergent norm discovery, clustering, governance proposals,
  template creation, conflict detection, and precedence resolution.
- **@nobulex/substrate**: Cross-substrate adapters for AI agents, robots, IoT devices,
  autonomous vehicles, smart contracts, and drones; constraint translation and
  safety bounds.
- **@nobulex/derivatives**: Trust futures, agent insurance policies, risk assessment
  with configurable weights, and settlement.
- **@nobulex/legal**: Legal identity packages, compliance checking, jurisdictional
  mapping, cross-jurisdiction analysis, audit trail export, and regulatory gap analysis.

#### Platform Layer
- **@nobulex/react**: Framework-agnostic reactive primitives (`Observable`,
  `CovenantState`, `IdentityState`, `StoreState`).
- **@nobulex/evm**: EVM anchoring utilities -- ABI encoding/decoding, function
  selector computation, covenant anchoring, and anchor verification.
- **@nobulex/mcp-server**: JSON-RPC 2.0 MCP server with 6 tools (`create_covenant`,
  `verify_covenant`, `evaluate_action`, `create_identity`, `parse_ccl`,
  `list_covenants`).
- **@nobulex/cli**: Command-line interface for key generation, covenant build/verify/
  inspect/resign, CCL parsing, and identity create/evolve.

#### Infrastructure
- CI/CD pipeline with matrix testing across Node.js 18, 20, and 22.
- 3,251 tests across 41 test suites, all passing.
- 7 runnable examples in the `examples/` directory.
- Full API documentation in `docs/api/README.md`.
- Architecture documentation in `docs/architecture.md`.
