# Stele SDK API Reference

Complete API reference for all 25 packages in the Stele protocol SDK.

---

## Foundation Packages

### @stele/types

Shared TypeScript type definitions, error classes, validation utilities, and protocol constants used across the entire SDK.

**Key exports:**
- `SteleError`, `ValidationError`, `CryptoError`, `CCLError`, `ChainError`, `StorageError` -- Typed error classes with `SteleErrorCode` discrimination
- `SteleErrorCode` -- Enum of all error codes (INVALID_INPUT, CRYPTO_FAILURE, CCL_PARSE_ERROR, etc.)
- `validateNonEmpty()`, `validateRange()`, `validateHex()`, `validateProbability()` -- Input validation utilities
- `Result<T, E>`, `ok()`, `err()` -- Rust-inspired Result type for error handling without exceptions
- `isNonEmptyString()`, `isValidHex()`, `isValidPublicKey()`, `isValidSignature()`, `freezeDeep()` -- Runtime type guards and sanitization
- `STELE_VERSION`, `SUPPORTED_HASH_ALGORITHMS`, `SUPPORTED_SIGNATURE_SCHEMES` -- Protocol constants

---

### @stele/crypto

Ed25519 cryptographic primitives: key generation, signing, verification, SHA-256 hashing, and encoding utilities. Built on `@noble/ed25519` and `@noble/hashes`.

**Key exports:**
- `generateKeyPair()` -- Generate a new Ed25519 key pair from cryptographically secure randomness
- `keyPairFromPrivateKey()`, `keyPairFromPrivateKeyHex()` -- Reconstruct key pairs from existing private keys
- `sign()`, `signString()` -- Sign bytes or UTF-8 strings with a private key
- `verify()` -- Verify an Ed25519 signature against a message and public key
- `sha256()`, `sha256String()`, `sha256Object()` -- SHA-256 hashing of bytes, strings, and canonical JSON objects
- `canonicalizeJson()` -- Deterministic JSON serialization following JCS (RFC 8785)
- `toHex()`, `fromHex()`, `base64urlEncode()`, `base64urlDecode()` -- Encoding utilities
- `generateNonce()`, `generateId()`, `timestamp()`, `constantTimeEqual()` -- Nonce generation, timestamping, and timing-safe comparison
- Types: `KeyPair`, `HashHex`, `PrivateKey`, `PublicKey`, `Signature`, `Nonce`, `Base64Url`

---

### @stele/ccl

Covenant Constraint Language (CCL) parser, evaluator, serializer, and merge engine. CCL is the domain-specific language that defines what actions an agent is permitted or denied.

**Key exports:**
- `parse(source)` -- Parse CCL source text into a `CCLDocument`
- `evaluate(doc, action, resource, context?)` -- Evaluate an action/resource pair against constraints, returning `{ permitted, matchedRule, reason }`
- `merge(a, b)` -- Merge two CCL documents with deny-wins semantics
- `serialize(doc)` -- Serialize a CCLDocument back to CCL source text
- `matchAction(pattern, action)`, `matchResource(pattern, resource)` -- Glob-style pattern matching
- `checkRateLimit(doc, action, currentCount)` -- Check if a rate limit has been exceeded
- `validateNarrowing(parent, child)` -- Validate that child only narrows (never broadens) parent constraints
- `evaluateCondition()`, `specificity()` -- Condition evaluation and rule specificity ranking
- `tokenize()`, `parseTokens()` -- Low-level tokenizer and token parser
- `CCLSyntaxError`, `CCLValidationError` -- Typed parse/validation errors
- Types: `CCLDocument`, `Statement`, `PermitDenyStatement`, `RequireStatement`, `LimitStatement`, `Condition`, `CompoundCondition`, `EvaluationContext`, `EvaluationResult`, `NarrowingViolation`, `Severity`

**CCL syntax reference:**
```
permit <action> on '<resource>'
deny <action> on '<resource>'
permit <action> on '<resource>' when <key> = '<value>'
limit <action> <count> per <period_count> <period_unit>
require <capability>
```

**Important notes:**
- `severity` is a reserved keyword in `when` conditions -- use `risk_level` instead
- Resource matching is exact: `/secrets` does NOT match `/secrets/key` -- use `/secrets/**` with wildcards
- Default deny: when no rules match, `evaluate()` returns `{ permitted: false }`

---

### @stele/core

Core covenant document builder, verifier, chain resolver, and serialization. This is the foundation for creating and validating Stele covenant documents.

**Key exports:**
- `buildCovenant(options)` -- Build a new, signed `CovenantDocument` from options (issuer, beneficiary, constraints, privateKey, etc.)
- `verifyCovenant(doc)` -- Verify a covenant document by running all 11 specification checks (id_match, signature_valid, not_expired, active, ccl_parses, enforcement_valid, proof_valid, chain_depth, document_size, countersignatures, nonce_present)
- `countersignCovenant(doc, signerKeyPair, signerRole)` -- Add a countersignature to a covenant document
- `resignCovenant(doc, privateKey)` -- Re-sign a document with a new nonce (key rotation)
- `canonicalForm(doc)`, `computeId(doc)` -- Canonical form computation and ID derivation
- `resolveChain(doc, resolver, maxDepth?)` -- Walk up the delegation chain collecting ancestors
- `computeEffectiveConstraints(doc, ancestors)` -- Compute merged CCL constraints for a chain
- `validateChainNarrowing(child, parent)` -- Validate narrowing between parent-child pairs
- `serializeCovenant(doc)`, `deserializeCovenant(json)` -- JSON serialization/deserialization with validation
- `MemoryChainResolver` -- In-memory chain resolver for testing
- `CovenantBuildError`, `CovenantVerificationError` -- Typed error classes
- `PROTOCOL_VERSION`, `MAX_CONSTRAINTS`, `MAX_CHAIN_DEPTH`, `MAX_DOCUMENT_SIZE` -- Protocol constants
- Types: `CovenantDocument`, `CovenantBuilderOptions`, `VerificationResult`, `VerificationCheck`, `Issuer`, `Beneficiary`, `Party`, `PartyRole`, `ChainReference`, `EnforcementConfig`, `ProofConfig`, `RevocationConfig`, `Countersignature`, `Obligation`, `CovenantMetadata`

---

### @stele/store

Pluggable storage backend for persisting and querying covenant documents. Supports in-memory storage, batch operations, and event subscriptions.

**Key exports:**
- `MemoryStore` -- In-memory storage implementation with full query support
- `store.put(doc)` -- Store a covenant document
- `store.get(id)` -- Retrieve a document by ID
- `store.has(id)` -- Check if a document exists
- `store.delete(id)` -- Delete a document
- `store.list(filter?)` -- Query documents with filters (issuerId, tags, createdAfter, createdBefore)
- `store.count(filter?)` -- Count documents matching a filter
- `store.getBatch(ids)`, `store.putBatch(docs)`, `store.deleteBatch(ids)` -- Batch operations
- `store.onEvent(handler)`, `store.offEvent(handler)` -- Subscribe to put/delete events
- `store.size` -- Current number of stored documents
- Types: `StoreEvent`, `StoreFilter`, `Store` (interface)

---

### @stele/verifier

Independent document and action verification engine with audit trail and verification history.

**Key exports:**
- `Verifier` class -- Configurable verification engine with history tracking
- `verifier.verify(doc)` -- Full document verification with timing and check details
- `verifier.verifyAction(doc, action, resource, context?)` -- Verify both document validity and action permission
- `verifier.getHistory()` -- Retrieve all verification records
- Types: `VerifierOptions`, `VerificationReport`, `ActionVerificationReport`, `VerificationRecord`

---

### @stele/sdk

The main entry point. Provides `SteleClient` for the full protocol lifecycle, plus re-exports from all foundation packages.

**Key exports:**
- `SteleClient` -- Unified, high-level API for key management, covenant lifecycle, identity management, chain operations, and CCL utilities
  - `client.generateKeyPair()` -- Generate and set active key pair
  - `client.createCovenant(options)` -- Create a signed covenant document
  - `client.verifyCovenant(doc)` -- Verify a document (throws in strict mode)
  - `client.countersign(doc, role?, keyPair?)` -- Add a countersignature
  - `client.evaluateAction(doc, action, resource, context?)` -- Evaluate CCL constraints
  - `client.createIdentity(options)` -- Create an agent identity
  - `client.evolveIdentity(identity, options)` -- Evolve an identity (model update, capability change)
  - `client.resolveChain(doc, knownDocuments?)` -- Resolve ancestor chain
  - `client.validateChain(docs)` -- Validate a chain of documents
  - `client.parseCCL(source)`, `client.mergeCCL(a, b)`, `client.serializeCCL(doc)` -- CCL utilities
  - `client.on(event, handler)`, `client.off(event, handler)` -- Event system
- `QuickCovenant` -- Convenience builders: `permit()`, `deny()`, `standard()`
- `generateKeyPair()` -- Re-exported from @stele/crypto
- All types and functions from @stele/crypto, @stele/ccl, @stele/core, and @stele/identity

---

### @stele/cli

Command-line interface for the Stele protocol. Provides commands for key management, covenant operations, and verification.

**Key commands:**
- `stele keygen` -- Generate a new Ed25519 key pair
- `stele build` -- Build and sign a covenant document from a JSON or CCL file
- `stele verify` -- Verify a covenant document
- `stele evaluate` -- Evaluate an action/resource against a covenant
- `stele countersign` -- Add a countersignature
- `stele chain` -- Resolve and validate delegation chains
- `stele identity create` -- Create an agent identity
- `stele identity evolve` -- Evolve an identity

---

### @stele/identity

Agent identity lifecycle management: creation, evolution (model upgrades, capability changes), verification, and lineage tracking.

**Key exports:**
- `createIdentity(options)` -- Create a new agent identity with model attestation, capabilities, and deployment context
- `evolveIdentity(identity, options)` -- Evolve an identity with a new change (model_update, capability_change, operator_change, deployment_change)
- `verifyIdentity(identity)` -- Verify identity integrity (hash, signature, lineage, version)
- `computeIdentityHash(identity)`, `computeCapabilityManifestHash(capabilities)` -- Hash computation
- `computeCarryForward(changeType)` -- Compute reputation carry-forward factor for a change type
- `getLineage(identity)`, `shareAncestor(a, b)` -- Lineage chain and ancestry checks
- `serializeIdentity(identity)`, `deserializeIdentity(json)` -- Serialization
- `DEFAULT_EVOLUTION_POLICY` -- Default policy for identity evolution
- Types: `AgentIdentity`, `ModelAttestation`, `DeploymentContext`, `LineageEntry`, `EvolutionPolicy`, `RuntimeType`

---

### @stele/enforcement

Runtime constraint enforcement with audit logging, merkle proofs, and compliance monitoring.

**Key exports:**
- `Monitor` class -- Runtime enforcement engine that evaluates actions against CCL constraints
  - `monitor.evaluate(action, resource, context?)` -- Evaluate and log an action
  - `monitor.getAuditLog()` -- Get the audit log with merkle root and entry count
  - `monitor.verifyAuditLogIntegrity()` -- Verify merkle tree integrity of the audit log
- Types: `AuditEntry`, `AuditLog`, `MonitorOptions`

---

### @stele/reputation

Execution receipt chain, reputation scoring with recency decay, endorsements, stakes, and delegations.

**Key exports:**
- `createReceipt(covenantId, agentHash, principalKey, outcome, proofHash, durationMs, keyPair, previousHash?, severity?)` -- Create a signed execution receipt
- `verifyReceipt(receipt)` -- Verify receipt integrity and signature
- `countersignReceipt(receipt, principalKeyPair)` -- Principal countersigns a receipt
- `computeReputationScore(agentHash, receipts, endorsements?, config?)` -- Compute a weighted reputation score with recency decay, breach penalties, and endorsement blending
- `verifyReceiptChain(receipts)` -- Verify hash chain integrity
- `computeReceiptsMerkleRoot(receipts)` -- Compute merkle root of receipts
- `createStake(agentHash, covenantId, amount, keyPair)` -- Create a reputation stake
- `releaseStake()`, `burnStake()` -- Stake lifecycle
- `createDelegation()`, `burnDelegation()`, `coBurnDelegation()` -- Reputation delegation with co-burn
- `createEndorsement(endorserHash, endorsedHash, basis, scopes, weight, keyPair)` -- Create a peer endorsement
- `verifyEndorsement(endorsement)` -- Verify endorsement integrity
- `DEFAULT_SCORING_CONFIG` -- Default scoring parameters
- Types: `ExecutionReceipt`, `ReputationScore`, `ReputationStake`, `ReputationDelegation`, `Endorsement`, `ScoringConfig`

---

### @stele/breach

Breach attestation, trust graph, and breach propagation. Tracks violations and propagates trust degradation through dependency chains.

**Key exports:**
- `createBreachAttestation(covenantId, violatorHash, constraint, severity, action, resource, evidenceHash, affectedCovenants, reporterKeyPair)` -- Create a signed breach attestation
- `verifyBreachAttestation(attestation)` -- Verify attestation integrity and signature
- `TrustGraph` class -- Directed trust dependency graph with breach propagation
  - `graph.registerDependency(parentHash, childHash)` -- Register a trust dependency
  - `graph.processBreach(attestation)` -- Process a breach with BFS propagation; returns all `BreachEvent`s
  - `graph.getStatus(hash)` -- Get trust status: 'trusted', 'degraded', 'restricted', 'revoked', 'unknown'
  - `graph.isTrusted(hash)` -- Check if fully trusted
  - `graph.getDependents(hash)`, `graph.getDependencies(hash)` -- Traverse graph
  - `graph.onBreach(listener)`, `graph.offBreach(listener)` -- Breach event listeners
  - `graph.export()` -- Export graph for serialization/visualization
- Types: `BreachAttestation`, `TrustStatus`, `TrustNode`, `BreachEvent`

---

## Protocol Packages

### @stele/attestation

External attestation management, reconciliation against execution receipts, and attestation chain verification.

**Key exports:**
- `createExternalAttestation()` -- Create and sign an external attestation about agent behavior
- `verifyExternalAttestation()` -- Verify attestation integrity
- `reconcileAttestations()` -- Compare external attestations with execution receipts to find discrepancies
- `verifyAttestationChain()` -- Verify a chain of linked attestations
- `computeAttestationCoverage()` -- Compute how well attestations cover agent actions
- Types: `ExternalAttestation`, `AttestationReconciliation`, `Discrepancy`, `AttestationChainLink`, `AgentAction`, `AttestationCoverageResult`

---

### @stele/canary

Canary challenge system for proactive compliance verification. Generates synthetic challenges to test if agents are still following constraints.

**Key exports:**
- `generateChallenge()` -- Generate a canary challenge from a CCL document
- `evaluateChallenge()` -- Evaluate an agent's response to a canary challenge
- `createSchedule()` -- Create a scheduled series of canary checks
- `computeCorrelation()` -- Correlate canary results with real-world execution data
- Types: `ChallengePayload`, `Canary`, `CanaryResult`, `CanaryScheduleEntry`, `CanaryCorrelationResult`

---

### @stele/gametheory

Game-theoretic analysis of covenant honesty and incentive structures. Models the conditions under which rational agents comply with constraints.

**Key exports:**
- `validateParameters()` -- Validate honesty model parameters
- `computeHonestyIncentive()` -- Compute the expected payoff for honest vs. dishonest behavior
- `generateProof()` -- Generate a formal proof that honesty is incentive-compatible under given parameters
- `nashEquilibrium()` -- Find Nash equilibria in multi-agent covenant games
- Types: `HonestyParameters`, `HonestyProof`

---

### @stele/composition

CCL document composition: intersection, union, difference, conflict detection, complement, and template expansion.

**Key exports:**
- `intersect()` -- Compute the intersection of two CCL documents (most restrictive)
- `union()` -- Compute the union of two CCL documents (most permissive)
- `difference()` -- Compute rules in A but not in B
- `detectConflicts()` -- Detect conflicting rules between two documents
- `complement()` -- Compute the complement of a CCL document
- `expandTemplate()` -- Expand a CCL template with variable substitution
- Types: `CompositionConflict`, `ConflictResolution`

---

### @stele/antifragile

Antifragility analysis: how the protocol gets stronger from breaches through breach antibodies, stress testing, and governance proposals.

**Key exports:**
- `createAntibody()` -- Create a breach antibody (a new constraint learned from a breach)
- `measureNetworkHealth()` -- Compute overall network health metrics
- `proposeGovernanceChange()` -- Create governance proposals based on breach patterns
- `stressTest()` -- Run simulated breach scenarios and measure resilience
- `computeAntifragilityIndex()` -- Compute how antifragile the protocol network is
- Types: `BreachAntibody`, `NetworkHealth`, `GovernanceProposal`, `StressTestResult`, `AntifragilityIndexResult`

---

### @stele/negotiation

Multi-party constraint negotiation with Nash bargaining solutions, Pareto optimization, and automated proposal generation.

**Key exports:**
- `createSession()` -- Create a negotiation session between parties
- `submitProposal()` -- Submit a constraint proposal
- `computeNashBargaining()` -- Compute Nash bargaining solution
- `findParetoFrontier()` -- Find Pareto-optimal outcomes
- `autoNegotiate()` -- Automated negotiation with configurable policies
- Types: `NegotiationSession`, `Proposal`, `NegotiationPolicy`, `UtilityFunction`, `NashBargainingSolution`, `ParetoOutcome`

---

### @stele/consensus

Accountability-tiered access control: assign agents to trust tiers based on reputation and determine access policies.

**Key exports:**
- `computeAccountabilityScore()` -- Compute an accountability score for an agent
- `assignTier()` -- Assign a trust tier based on score
- `createInteractionPolicy()` -- Create access policies based on tiers
- `decide()` -- Make access decisions based on accountability
- Types: `AccountabilityTier`, `AccountabilityScore`, `InteractionPolicy`, `AccessDecision`

---

### @stele/robustness

Formal robustness analysis of CCL constraints: input boundary testing, vulnerability scanning, and coverage verification.

**Key exports:**
- `generateInputBounds()` -- Generate boundary test cases for a CCL document
- `scanVulnerabilities()` -- Scan for known vulnerability patterns in constraints
- `computeRobustnessScore()` -- Compute overall robustness score
- `verifyCompleteness()` -- Check if constraints cover all expected action/resource combinations
- Types: `RobustnessProof`, `InputBound`, `RobustnessReport`, `Vulnerability`, `CovenantSpec`

---

### @stele/temporal

Temporal constraint analysis: evolution policies, triggers, state machines, decay modeling, and expiration forecasting.

**Key exports:**
- `createEvolutionPolicy()` -- Define how constraints evolve over time
- `createTrigger()` -- Create event-driven constraint transitions
- `advanceState()` -- Advance the temporal state machine
- `computeDecay()` -- Model trust/constraint decay over time
- `forecastExpiration()` -- Forecast when constraints or trust levels will expire
- Types: `EvolutionPolicy`, `EvolutionTrigger`, `TransitionFunction`, `EvolutionEvent`, `AgentState`, `CovenantState`, `DecayPoint`

---

### @stele/recursive

Recursive verification: meta-covenants (covenants about covenants), termination proofs, and transitive trust computation.

**Key exports:**
- `createMetaCovenant()` -- Create a covenant that governs other covenants
- `verifyRecursively()` -- Recursively verify a covenant and all meta-covenants
- `proveTermination()` -- Generate a proof that recursive verification terminates
- `computeTransitiveTrust()` -- Compute transitive trust through a verification network
- `findMinimalVerificationSet()` -- Find the minimal set of verifiers needed
- Types: `MetaCovenant`, `RecursiveVerification`, `TerminationProof`, `TrustBase`, `TransitiveTrustResult`

---

### @stele/alignment

Alignment verification: property-based checking, drift detection, and decomposition analysis of covenant compliance.

**Key exports:**
- `defineProperty()` -- Define an alignment property to check
- `verifyAlignment()` -- Verify that execution records satisfy alignment properties
- `measureDrift()` -- Measure how far actual behavior has drifted from covenant intent
- `decomposeAlignment()` -- Break down alignment into per-property contributions
- Types: `AlignmentProperty`, `AlignmentCovenant`, `AlignmentReport`, `ExecutionRecord`, `AlignmentDriftResult`

---

### @stele/norms

Emergent norm discovery and governance: analyze covenant patterns to discover community norms and generate governance proposals.

**Key exports:**
- `discoverNorms()` -- Analyze a collection of covenants to discover common patterns
- `analyzeNorms()` -- Compute statistics on discovered norms
- `clusterNorms()` -- Group similar norms into clusters
- `proposeGovernance()` -- Generate governance proposals from norm analysis
- `resolvePrecedence()` -- Resolve conflicts between overlapping norms
- Types: `DiscoveredNorm`, `NormAnalysis`, `NormCluster`, `GovernanceProposal`, `NormConflict`, `NormPrecedenceResult`

---

### @stele/substrate

Cross-substrate adaptation: translate covenants between different execution environments (cloud, edge, embedded, robotic, multi-agent).

**Key exports:**
- `createAdapter()` -- Create a substrate adapter for a specific runtime
- `definePhysicalConstraint()` -- Define physical-world safety constraints
- `computeSafetyBounds()` -- Compute safety bounds for a given substrate
- `checkCompatibility()` -- Check if a covenant is compatible with a substrate
- `translateConstraints()` -- Translate constraints between substrates
- `generateCapabilityMatrix()` -- Generate a capability matrix across substrates
- Types: `SubstrateType`, `SubstrateAdapter`, `PhysicalConstraint`, `SafetyBound`, `UniversalCovenant`, `CompatibilityResult`

---

### @stele/derivatives

Trust-based financial instruments: trust futures, agent insurance, and risk assessment for covenant execution.

**Key exports:**
- `createTrustFuture()` -- Create a trust future (prediction market on agent compliance)
- `createInsurancePolicy()` -- Create an insurance policy against agent breach
- `assessRisk()` -- Assess the risk of a covenant based on agent history
- `settleFuture()` -- Settle a trust future based on actual outcomes
- Types: `TrustFuture`, `AgentInsurancePolicy`, `RiskAssessment`, `RiskFactor`, `Settlement`

---

### @stele/legal

Legal and jurisdictional compliance: identity packages, compliance records, cross-jurisdiction mapping, and audit trails.

**Key exports:**
- `createIdentityPackage()` -- Create a legal identity package binding cryptographic identity to legal identity
- `createComplianceRecord()` -- Create a compliance record against a standard
- `mapJurisdiction()` -- Map covenant constraints to jurisdictional requirements
- `checkCrossJurisdiction()` -- Check compliance across multiple jurisdictions
- `exportAuditTrail()` -- Export a complete audit trail for regulatory review
- Types: `LegalIdentityPackage`, `ComplianceRecord`, `JurisdictionalMapping`, `ComplianceStandard`, `AuditTrailExport`

---

### @stele/proof

Zero-knowledge compliance proofs: generate and verify ZK proofs that demonstrate covenant compliance without revealing execution details. Uses a Poseidon-based hash for field-friendly computation.

**Key exports:**
- `generateComplianceProof()` -- Generate a ZK compliance proof from audit entries
- `verifyComplianceProof()` -- Verify a ZK compliance proof
- `poseidonHash()`, `hashToField()`, `fieldToHex()` -- Poseidon hash utilities
- `FIELD_PRIME` -- The prime field constant
- Types: `ComplianceProof`, `ProofVerificationResult`, `ProofGenerationOptions`, `AuditEntryData`

---

### @stele/mcp

Model Context Protocol server integration for exposing Stele protocol operations as MCP tools. Integrates identity, enforcement, reputation, and proof modules.

**Key exports:**
- `createMCPServer()` -- Create an MCP server instance with Stele tools
- Integrates: key generation, covenant building, identity creation, enforcement monitoring, receipt creation, and compliance proof generation as MCP-callable tools

---

## Stub Packages

The following packages require external dependencies and are currently stubs:

### @stele/react
React hooks and components for building Stele-powered UIs. Requires React as a peer dependency.

### @stele/evm
Ethereum Virtual Machine integration for on-chain covenant anchoring. Requires ethers.js as a peer dependency.

### @stele/mcp-server
Standalone MCP server binary for external tool hosting. Requires the MCP SDK as a dependency.
