# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Localization**: README intro translations for Italian and Portuguese (`docs/i18n/README-it.md`, `README-pt.md`).
- **Examples**: `12-breach-attestation-flow.ts` (create → violate → attest → process); `13-trust-futures-flow.ts` (create → trade → settle).
- **CLI**: `--verbose` and `--format markdown` for `kova audit`; scoring breakdown and covenant file paths in verbose mode.
- **Express adapter**: `requiredConstraints` check in `kovaGatewayMiddleware`; integration tests for Bearer token and x-kova-covenant header.
- **Documentation**: TrustGraph propagation rules in `packages/breach/README.md`; `computeCarryForward` evolution policy in `packages/identity/README.md`.
- **Tests**: Basic test coverage for certification, revenue, staking, rail, trust-data, trust-futures, marketplace, compliance-autopilot; multi-statement CCL for `validateCCL`; kovaGatewayMiddleware with real HTTP headers.
- **Vitest**: Added certification, rail, revenue, staking, trust-data, trust-futures, marketplace, compliance-autopilot to package aliases.

### Changed

- **README**: Updated test count (5,052), coverage (92 suites), and packages (39) badges.

## [0.1.0] - 2025-02-07

### Added

#### Foundation Layer
- **@stele/types**: Shared error classes (`SteleError`, `ValidationError`, `CryptoError`,
  `CCLError`, `ChainError`, `StorageError`), validation utilities (`validateNonEmpty`,
  `validateRange`, `validateHex`, `validateProbability`), `Result<T, E>` type,
  runtime type guards, input sanitization, and structured logging with levels and
  child loggers.
- **@stele/crypto**: Ed25519 key generation, signing, and verification via
  `@noble/ed25519`; SHA-256 hashing; canonical JSON (JCS / RFC 8785);
  hex and base64url encoding; constant-time comparison; nonce generation.
- **@stele/ccl**: Covenant Constraint Language (CCL) with `permit`, `deny`,
  `require`, and `limit` statements; `when` conditional clauses; glob-based
  resource matching; deny-wins merge semantics; narrowing validation; serialization.
- **@stele/core**: Covenant document lifecycle -- `buildCovenant`, `verifyCovenant`
  (11 specification checks), `countersignCovenant`, `resignCovenant`, chain
  resolution, effective constraint computation, narrowing validation, and
  JSON serialization/deserialization.
- **@stele/store**: Pluggable `CovenantStore` interface with `MemoryStore` (in-memory)
  and `FileStore` (persistent, atomic writes) implementations; event system for
  put/delete notifications; batch operations; filtered listing.
- **@stele/verifier**: Standalone `Verifier` class with single, chain, action, and
  batch verification; history tracking; strict mode with warning escalation.
- **@stele/sdk**: Unified `SteleClient` entry point combining key management,
  covenant lifecycle, identity management, chain operations, and CCL utilities;
  `QuickCovenant` convenience builders; typed event system with 8 event types.
- **@stele/identity**: Agent identity with model attestation, capabilities, deployment
  context, lineage tracking, evolution with carry-forward rates, and cryptographic
  verification.

#### Enforcement Layer
- **@stele/enforcement**: Runtime `Monitor` with CCL evaluation, rate limiting,
  hash-chained audit logging, and capability manifests.
- **@stele/proof**: Poseidon-based compliance proofs -- audit commitment, constraint
  commitment, proof generation, and verification.
- **@stele/breach**: Breach attestation with severity-based trust status mapping,
  trust graph management, and cryptographic verification.
- **@stele/reputation**: Reputation scoring with recency decay, breach penalties,
  staking, delegation, and endorsements.
- **@stele/mcp**: MCP guard wrapping MCP servers with Stele enforcement, audit
  logging, identity creation, and compliance proof generation; named presets.

#### Protocol Layer
- **@stele/attestation**: External attestation creation, reconciliation, chain
  linking, and coverage analysis.
- **@stele/canary**: Canary testing with challenge generation from CCL constraints,
  scheduled execution, and result correlation.
- **@stele/gametheory**: Game-theoretic honesty proofs with minimum stake computation.
- **@stele/composition**: Formal constraint composition with system-property checking,
  decomposition, and complexity analysis.
- **@stele/antifragile**: Breach-to-antibody generation, network health assessment,
  stress testing, governance proposals, and antifragility indexing.
- **@stele/negotiation**: Multi-party negotiation sessions with proposal workflows,
  Nash bargaining solutions, and Pareto optimality.
- **@stele/consensus**: Accountability-score-based tier classification and access
  decisions with configurable component weights.
- **@stele/robustness**: Input bound verification, vulnerability scanning, formal
  verification, contradiction detection, and robustness scoring.
- **@stele/temporal**: Trigger-based constraint evolution, trust decay modeling,
  violation tracking, and expiration forecasting.
- **@stele/recursive**: Meta-covenants, recursive verification, termination proofs,
  transitive trust computation, and minimal verification sets.
- **@stele/alignment**: HHH (Helpful, Honest, Harmless) alignment properties,
  alignment verification, drift detection, and decomposition.
- **@stele/norms**: Emergent norm discovery, clustering, governance proposals,
  template creation, conflict detection, and precedence resolution.
- **@stele/substrate**: Cross-substrate adapters for AI agents, robots, IoT devices,
  autonomous vehicles, smart contracts, and drones; constraint translation and
  safety bounds.
- **@stele/derivatives**: Trust futures, agent insurance policies, risk assessment
  with configurable weights, and settlement.
- **@stele/legal**: Legal identity packages, compliance checking, jurisdictional
  mapping, cross-jurisdiction analysis, audit trail export, and regulatory gap analysis.

#### Platform Layer
- **@stele/react**: Framework-agnostic reactive primitives (`Observable`,
  `CovenantState`, `IdentityState`, `StoreState`).
- **@stele/evm**: EVM anchoring utilities -- ABI encoding/decoding, function
  selector computation, covenant anchoring, and anchor verification.
- **@stele/mcp-server**: JSON-RPC 2.0 MCP server with 6 tools (`create_covenant`,
  `verify_covenant`, `evaluate_action`, `create_identity`, `parse_ccl`,
  `list_covenants`).
- **@stele/cli**: Command-line interface for key generation, covenant build/verify/
  inspect/resign, CCL parsing, and identity create/evolve.

#### Infrastructure
- CI/CD pipeline with matrix testing across Node.js 18, 20, and 22.
- 3,251 tests across 41 test suites, all passing.
- 7 runnable examples in the `examples/` directory.
- Full API documentation in `docs/api/README.md`.
- Architecture documentation in `docs/architecture.md`.
