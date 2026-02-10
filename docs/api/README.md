# Stele API Reference

Complete API reference for all packages in the Stele monorepo. Packages are grouped
by layer: **Foundation**, **Enforcement**, **Protocol**, and **Platform**.

---

## Table of Contents

- [Foundation](#foundation)
  - [@stele/types](#steletypes)
  - [@stele/crypto](#stelecrypto)
  - [@stele/ccl](#steleccl)
  - [@stele/core](#stelecore)
  - [@stele/store](#stelestore)
  - [@stele/verifier](#steleverifier)
  - [@stele/sdk](#stelesdk)
  - [@stele/identity](#steleidentity)
- [Enforcement](#enforcement)
  - [@stele/enforcement](#steleenforcement)
  - [@stele/proof](#steleproof)
  - [@stele/breach](#stelebreach)
  - [@stele/reputation](#stelereputation)
  - [@stele/mcp](#stelemcp)
- [Protocol](#protocol)
  - [@stele/attestation](#steleattestation)
  - [@stele/canary](#stelecanary)
  - [@stele/gametheory](#stelegametheory)
  - [@stele/composition](#stelecomposition)
  - [@stele/antifragile](#steleantifragile)
  - [@stele/negotiation](#stelenegotiation)
  - [@stele/consensus](#steleconsensus)
  - [@stele/robustness](#stelerobustness)
  - [@stele/temporal](#steletemporal)
  - [@stele/recursive](#stelerecursive)
  - [@stele/alignment](#stelealignment)
  - [@stele/norms](#stelenorms)
  - [@stele/substrate](#stelesubstrate)
  - [@stele/derivatives](#stelederivatives)
  - [@stele/legal](#stelelegal)
- [Platform](#platform)
  - [@stele/react](#stelereact)
  - [@stele/evm](#steleevm)
  - [@stele/mcp-server](#stelemcp-server)
  - [@stele/cli](#stelecli)

---

## Foundation

### @stele/types

Shared TypeScript type definitions, error classes, validation utilities, and protocol constants used across the entire SDK.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `SteleError` | class | Base error class carrying a `SteleErrorCode` for programmatic error handling. |
| `ValidationError` | class | Thrown when an input fails validation; includes a `field` property. |
| `CryptoError` | class | Thrown when a cryptographic operation fails. |
| `CCLError` | class | Thrown when CCL parsing or evaluation fails. |
| `ChainError` | class | Thrown when a chain operation violates protocol rules. |
| `StorageError` | class | Thrown when a storage operation fails. |
| `SteleErrorCode` | enum | Enumeration of all error codes (`INVALID_INPUT`, `CRYPTO_FAILURE`, `CCL_PARSE_ERROR`, etc.). |
| `validateNonEmpty(value, name)` | function | Assert a string is non-empty; throws `ValidationError`. |
| `validateRange(value, min, max, name)` | function | Assert a number is within `[min, max]`. |
| `validateHex(value, name)` | function | Assert a string is valid hex (even length, `[0-9a-fA-F]`). |
| `validateProbability(value, name)` | function | Assert a number is in `[0, 1]`. |
| `Result<T, E>` | type | Discriminated union: `{ ok: true, value: T }` or `{ ok: false, error: E }`. |
| `ok(value)` | function | Construct a successful `Result`. |
| `err(error)` | function | Construct a failed `Result`. |
| `isNonEmptyString`, `isValidHex`, `isValidId`, `isValidPublicKey`, `isValidSignature`, `isValidISODate`, `isValidVersion`, `isPlainObject` | function | Runtime type guards for input validation. |
| `sanitizeString(input)` | function | Sanitize a string for safe use. |
| `sanitizeJsonInput(input)` | function | Sanitize raw JSON input. |
| `freezeDeep(obj)` | function | Recursively freeze an object. |
| `Logger`, `createLogger`, `defaultLogger` | class/function | Structured logging with levels and child loggers. |
| `STELE_VERSION` | const | Current SDK version string (`"0.1.0"`). |
| `DEFAULT_SEVERITY` | const | Default CCL severity level (`"must"`). |
| `Identifiable`, `Timestamped`, `Hashable`, `Serializable<T>` | interface | Common structural interfaces. |

#### Usage

```typescript
import { ValidationError, validateNonEmpty, ok, err, Result } from '@stele/types';

validateNonEmpty(input, 'agentId'); // throws if empty
const result: Result<number> = ok(42);
if (result.ok) console.log(result.value);
```

---

### @stele/crypto

Ed25519 key management, signing, verification, SHA-256 hashing, and encoding utilities built on `@noble/ed25519` and `@noble/hashes`.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `generateKeyPair()` | async function | Generate a new Ed25519 key pair from cryptographic randomness. Returns `KeyPair`. |
| `keyPairFromPrivateKey(pk)` | async function | Reconstruct a `KeyPair` from an existing `Uint8Array` private key. |
| `keyPairFromPrivateKeyHex(hex)` | async function | Reconstruct a `KeyPair` from a hex-encoded private key string. |
| `sign(message, privateKey)` | async function | Sign a `Uint8Array` message, returning a `Uint8Array` signature. |
| `signString(message, privateKey)` | async function | Sign a UTF-8 string message. |
| `verify(message, signature, publicKey)` | async function | Verify an Ed25519 signature. Returns `boolean`. |
| `sha256(data)` | function | Compute SHA-256 of a `Uint8Array`. Returns `Uint8Array`. |
| `sha256String(data)` | function | Compute SHA-256 of a UTF-8 string. Returns hex-encoded `HashHex`. |
| `sha256Object(obj)` | function | Compute SHA-256 of a canonicalized JSON object. Returns `HashHex`. |
| `canonicalizeJson(obj)` | function | Produce deterministic JSON via JCS (RFC 8785). |
| `toHex(bytes)` / `fromHex(hex)` | function | Convert between `Uint8Array` and hex strings. |
| `base64urlEncode(bytes)` / `base64urlDecode(str)` | function | Base64url encoding/decoding. |
| `generateNonce()` | function | Generate a 32-byte cryptographic nonce. |
| `generateId(length?)` | function | Generate a random hex ID of the specified length. |
| `constantTimeEqual(a, b)` | function | Constant-time comparison of two `Uint8Array` buffers. |
| `timestamp()` | function | Return the current time as an ISO 8601 string. |
| `KeyPair` | type | `{ privateKey: Uint8Array, publicKey: Uint8Array, publicKeyHex: string }` |
| `HashHex`, `Base64Url`, `Signature`, `Nonce` | type | Branded string types for type safety. |

#### Usage

```typescript
import { generateKeyPair, signString, verify, sha256String, toHex } from '@stele/crypto';

const kp = await generateKeyPair();
const sig = await signString('hello', kp.privateKey);
const valid = await verify(new TextEncoder().encode('hello'), sig, kp.publicKey);
```

---

### @stele/ccl

Parser, evaluator, merger, and serializer for the Covenant Constraint Language (CCL) -- the rule language that governs what actions agents may perform.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `parse(source)` | function | Parse CCL source text into a `CCLDocument`. Convenience wrapper around `tokenize` + `parseTokens`. |
| `tokenize(source)` | function | Tokenize CCL source text into a `Token[]` array. |
| `parseTokens(tokens)` | function | Parse a token array into a `CCLDocument`. |
| `evaluate(doc, action, resource, context?)` | function | Evaluate an action/resource pair against a `CCLDocument`. Returns `EvaluationResult`. |
| `matchAction(pattern, action)` | function | Test whether an action matches a CCL action pattern. |
| `matchResource(pattern, resource)` | function | Test whether a resource path matches a CCL resource glob. |
| `specificity(statement)` | function | Compute the specificity score of a CCL statement for tie-breaking. |
| `evaluateCondition(condition, context)` | function | Evaluate a single `when` condition against a context object. |
| `checkRateLimit(statement, currentCount)` | function | Check whether a rate-limited action is within its quota. |
| `merge(a, b)` | function | Merge two `CCLDocument`s using deny-wins semantics. |
| `validateNarrowing(parent, child)` | function | Validate that a child CCL document only narrows (never broadens) its parent. |
| `serialize(doc)` | function | Serialize a `CCLDocument` back to CCL source text. |
| `CCLSyntaxError` | class | Thrown on parse errors. |
| `CCLValidationError` | class | Thrown on validation errors. |
| `CCLDocument` | type | `{ statements, permits, denies, obligations, limits }` |
| `EvaluationResult` | type | `{ permitted, matchedRule?, allMatches, reason?, severity? }` |
| `EvaluationContext` | type | Key-value context object for `when` condition evaluation. |
| `Statement`, `PermitDenyStatement`, `RequireStatement`, `LimitStatement` | type | Statement AST node types. |

#### Usage

```typescript
import { parse, evaluate } from '@stele/ccl';

const doc = parse("permit read on '**'\ndeny write on '/system/**'");
const result = evaluate(doc, 'write', '/system/config');
console.log(result.permitted); // false
```

---

### @stele/core

Covenant document lifecycle: building, signing, verifying, countersigning, chain resolution, and serialization.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `buildCovenant(options)` | async function | Build a new, signed `CovenantDocument` from `CovenantBuilderOptions`. |
| `verifyCovenant(doc)` | async function | Run all 11 specification checks on a document. Returns `VerificationResult`. |
| `countersignCovenant(doc, keyPair, role)` | async function | Add a countersignature to a covenant. Returns a new document. |
| `resignCovenant(doc, privateKey)` | async function | Re-sign a document with a new nonce and signature. |
| `resolveChain(doc, resolver, maxDepth?)` | async function | Walk up the delegation chain, collecting ancestor documents. |
| `computeEffectiveConstraints(doc, ancestors)` | async function | Merge constraints from root ancestor to leaf. Returns `CCLDocument`. |
| `validateChainNarrowing(child, parent)` | async function | Validate that a child only narrows its parent's constraints. |
| `canonicalForm(doc)` | function | Compute the canonical JSON form (stripping `id`, `signature`, `countersignatures`). |
| `computeId(doc)` | function | Compute the SHA-256 document ID from canonical form. |
| `serializeCovenant(doc)` | function | Serialize a `CovenantDocument` to JSON. |
| `deserializeCovenant(json)` | function | Deserialize and validate a JSON string into a `CovenantDocument`. |
| `MemoryChainResolver` | class | In-memory `ChainResolver` backed by a `Map`. Methods: `add(doc)`, `resolve(id)`. |
| `CovenantBuildError` | class | Thrown on build validation failure; includes `field`. |
| `CovenantVerificationError` | class | Thrown on verification failure; includes `checks[]`. |
| `PROTOCOL_VERSION` | const | Current protocol version string. |
| `MAX_CONSTRAINTS` | const | Maximum number of CCL statements per document. |
| `MAX_CHAIN_DEPTH` | const | Maximum delegation chain depth. |
| `MAX_DOCUMENT_SIZE` | const | Maximum serialized document size in bytes. |
| `CovenantDocument` | type | The core document type with `id`, `issuer`, `beneficiary`, `constraints`, `signature`, etc. |
| `ChainResolver` | interface | `{ resolve(id: HashHex): Promise<CovenantDocument | undefined> }` |

#### Usage

```typescript
import { buildCovenant, verifyCovenant } from '@stele/core';

const doc = await buildCovenant({
  issuer, beneficiary,
  constraints: "permit read on '**'",
  privateKey,
});
const result = await verifyCovenant(doc);
console.log(result.valid); // true
```

---

### @stele/store

Pluggable storage backends for covenant documents with event-driven notifications.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `MemoryStore` | class | In-memory `CovenantStore` backed by a `Map`. Suitable for testing and CLI tools. |
| `FileStore` | class | Persistent file-system `CovenantStore` with atomic writes. |
| `CovenantStore` | interface | `put(doc)`, `get(id)`, `has(id)`, `delete(id)`, `list(filter?)`, `count(filter?)`, `putBatch(docs)`, `getBatch(ids)`, `deleteBatch(ids)`, `onEvent(cb)`, `offEvent(cb)`. |
| `StoreFilter` | type | Filter criteria: `issuerId?`, `beneficiaryId?`, `createdAfter?`, `createdBefore?`, `hasChain?`, `tags?`. |
| `StoreEvent` | type | `{ type, documentId, document?, timestamp }` |
| `StoreEventType` | type | `'put' | 'delete'` |
| `StoreEventCallback` | type | `(event: StoreEvent) => void` |

#### Usage

```typescript
import { MemoryStore } from '@stele/store';

const store = new MemoryStore();
await store.put(covenantDoc);
const retrieved = await store.get(covenantDoc.id);
const all = await store.list({ issuerId: 'operator-1' });
```

---

### @stele/verifier

Standalone verification engine for third-party auditors with history tracking, batch processing, chain integrity validation, and action-level evaluation.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `Verifier` | class | Stateful verification engine. Methods: `verify(doc)`, `verifyChain(docs)`, `verifyAction(doc, action, resource, context?)`, `getHistory()`, `clearHistory()`. |
| `verifyBatch(docs, options?)` | async function | Verify a batch of documents in parallel. Returns `BatchVerificationReport`. |
| `VerifierOptions` | type | `{ verifierId?, strictMode?, maxHistorySize?, maxChainDepth? }` |
| `VerificationReport` | type | Extends core `VerificationResult` with `verifierId`, `timestamp`, `durationMs`, `warnings`. |
| `ChainVerificationReport` | type | `{ valid, documentResults[], integrityChecks[], narrowingResults[] }` |
| `ActionVerificationReport` | type | `{ permitted, documentValid, matchedRule?, allMatches[], reason, severity? }` |
| `BatchVerificationReport` | type | `{ reports[], summary: { total, passed, failed, durationMs } }` |
| `VerificationRecord` | type | History record: `{ kind, documentIds[], valid, timestamp, durationMs }` |

#### Usage

```typescript
import { Verifier, verifyBatch } from '@stele/verifier';

const v = new Verifier({ strictMode: true });
const report = await v.verify(doc);
const chainReport = await v.verifyChain([root, child1, child2]);
const batchReport = await verifyBatch(docs);
```

---

### @stele/sdk

High-level unified SDK that ties together all foundation packages into a single `SteleClient` entry point with an event system.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `SteleClient` | class | Main entry point. Provides `generateKeyPair()`, `createCovenant(options)`, `verifyCovenant(doc)`, `countersign(doc, role?, keyPair?)`, `evaluateAction(doc, action, resource, context?)`, `createIdentity(options)`, `evolveIdentity(identity, options)`, `resolveChain(doc, knownDocs?)`, `validateChain(docs)`, `parseCCL(source)`, `mergeCCL(a, b)`, `serializeCCL(doc)`, `on(event, handler)`, `off(event, handler)`, `removeAllListeners(event?)`. |
| `QuickCovenant` | class | Convenience builders: `permit(action, resource, issuer, beneficiary, privateKey)`, `deny(...)`, `standard(issuer, beneficiary, privateKey)`. |
| `SteleClientOptions` | type | `{ keyPair?, agentId?, strictMode? }` |
| `CreateCovenantOptions` | type | Options for `createCovenant`: issuer, beneficiary, constraints, privateKey, obligations, chain, enforcement, proof, revocation, metadata, expiresAt, activatesAt. |
| `SteleEventType` | type | `'covenant:created' | 'covenant:verified' | 'covenant:countersigned' | 'identity:created' | 'identity:evolved' | 'chain:resolved' | 'chain:validated' | 'evaluation:completed'` |

Also re-exports all types and functions from `@stele/core`, `@stele/crypto`, `@stele/ccl`, and `@stele/identity`.

#### Usage

```typescript
import { SteleClient, QuickCovenant } from '@stele/sdk';

const client = new SteleClient();
const kp = await client.generateKeyPair();
const doc = await client.createCovenant({
  issuer, beneficiary, constraints,
  privateKey: kp.privateKey,
});
const result = await client.evaluateAction(doc, 'read', '/data');
```

---

### @stele/identity

Agent identity management with lineage tracking, evolution policies, and reputation carry-forward.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createIdentity(options)` | async function | Create a new `AgentIdentity` with model attestation, capabilities, and deployment context. |
| `evolveIdentity(identity, options)` | async function | Evolve an existing identity (model change, capability update, operator transfer, etc.). |
| `verifyIdentity(identity)` | async function | Verify the cryptographic integrity of an identity document. |
| `computeCapabilityManifestHash(caps)` | function | Hash a sorted capabilities list for deterministic comparison. |
| `computeIdentityHash(identity)` | function | Hash the canonical form of an identity. |
| `computeCarryForward(identity, changeType, policy?)` | function | Compute reputation carry-forward rate for a given change type. |
| `getLineage(identity)` | function | Return the full lineage chain of an identity. |
| `shareAncestor(a, b)` | function | Check whether two identities share a common ancestor. |
| `serializeIdentity(identity)` / `deserializeIdentity(json)` | function | JSON serialization/deserialization of identities. |
| `DEFAULT_EVOLUTION_POLICY` | const | Default carry-forward rates (e.g., `minorUpdate: 0.95`, `modelFamilyChange: 0.20`, `fullRebuild: 0.00`). |
| `AgentIdentity` | type | Identity document with model attestation, capabilities, deployment context, lineage, and operator signature. |
| `EvolutionPolicy` | type | Carry-forward rates for each evolution type. |
| `ModelAttestation`, `DeploymentContext`, `LineageEntry` | type | Supporting types for identity documents. |

#### Usage

```typescript
import { createIdentity, evolveIdentity } from '@stele/identity';

const identity = await createIdentity({
  operatorKeyPair: kp,
  model: { provider: 'anthropic', modelId: 'claude-3' },
  capabilities: ['read', 'write'],
  deployment: { runtime: 'container' },
});
const evolved = await evolveIdentity(identity, {
  operatorKeyPair: kp,
  changeType: 'minorUpdate',
  description: 'Bug fix',
  updates: {},
});
```

---

## Enforcement

### @stele/enforcement

Runtime constraint enforcement engine with capability-based access control, monitoring, audit logging, and rate limiting.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `Monitor` | class | Stateful enforcement monitor. Evaluates actions against CCL constraints, enforces rate limits, produces audit entries, and tracks execution history. |
| `CapabilityManifest` | type | Declares the capabilities an agent possesses. |
| `AuditEntry` | type | A single audit log entry with hash chaining for tamper evidence. |
| `AuditLog` | type | Complete audit log with genesis hash and ordered entries. |
| `ExecutionOutcome` | type | Result of an enforced action execution. |
| `MonitorConfig` | type | Configuration for the monitor (rate limits, logging, etc.). |
| `RateLimitState` | type | Current state of rate limit counters. |

#### Usage

```typescript
import { Monitor } from '@stele/enforcement';

const monitor = new Monitor(covenantDoc, keyPair);
const outcome = await monitor.execute('read', '/data', handler);
console.log(outcome.permitted, outcome.auditEntry);
```

---

### @stele/proof

Zero-knowledge-style compliance proofs using Poseidon hashing for efficient audit log commitment and verification.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `computeAuditCommitment(entries)` | function | Compute a Poseidon commitment over a sequence of audit entries. |
| `computeConstraintCommitment(constraints)` | function | Compute a Poseidon commitment over constraint definition strings. |
| `generateComplianceProof(options)` | async function | Generate a full compliance proof linking audit entries to constraints. |
| `verifyComplianceProof(proof)` | function | Verify a compliance proof's integrity. Returns `ProofVerificationResult`. |
| `poseidonHash(inputs)` | function | Low-level Poseidon hash function over bigint field elements. |
| `hashToField(hex)` | function | Convert a hex hash to a field element. |
| `fieldToHex(field)` | function | Convert a field element back to hex. |
| `FIELD_PRIME` | const | The Poseidon field prime. |
| `ComplianceProof`, `ProofVerificationResult`, `AuditEntryData` | type | Core proof types. |

#### Usage

```typescript
import { generateComplianceProof, verifyComplianceProof } from '@stele/proof';

const proof = await generateComplianceProof({
  entries: auditEntries,
  constraints: "permit read on '**'",
});
const result = verifyComplianceProof(proof);
console.log(result.valid);
```

---

### @stele/breach

Breach detection, attestation, and trust graph management for tracking covenant violations and their impact on agent trust.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createBreachAttestation(event, keyPair)` | async function | Create a signed attestation of a covenant breach. |
| `verifyBreachAttestation(attestation)` | async function | Verify the cryptographic integrity of a breach attestation. |
| `TrustNode` | type | Node in the trust graph with status, breach history, and relationships. |
| `TrustStatus` | type | `'trusted' | 'degraded' | 'restricted' | 'revoked'` |
| `BreachAttestation` | type | Signed record of a breach event with severity and recommended action. |
| `BreachEvent` | type | `{ covenantId, violatorId, severity, description, timestamp }` |

#### Usage

```typescript
import { createBreachAttestation, verifyBreachAttestation } from '@stele/breach';

const attestation = await createBreachAttestation({
  covenantId: doc.id,
  violatorId: 'agent-1',
  severity: 'high',
  description: 'Unauthorized write',
  timestamp: Date.now(),
}, keyPair);
const valid = await verifyBreachAttestation(attestation);
```

---

### @stele/reputation

Reputation scoring, staking, delegation, and endorsement system for agents based on execution history and breach records.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createReceipt(params)` | function | Create a signed `ExecutionReceipt` for a completed action. |
| `computeScore(receipts, config?)` | function | Compute a `ReputationScore` from execution receipts with recency decay. |
| `stakeReputation(agentId, amount, keyPair)` | async function | Create a signed `ReputationStake`. |
| `delegateReputation(from, to, weight, keyPair)` | async function | Create a signed `ReputationDelegation`. |
| `createEndorsement(agentId, endorserId, score, keyPair)` | async function | Create a signed `Endorsement`. |
| `DEFAULT_SCORING_CONFIG` | const | Default scoring configuration with recency decay and breach penalties. |
| `ExecutionReceipt`, `ReputationScore`, `ReputationStake`, `ReputationDelegation`, `Endorsement`, `ScoringConfig` | type | Core reputation types. |

#### Usage

```typescript
import { createReceipt, computeScore } from '@stele/reputation';

const receipt = createReceipt({
  agentId: 'agent-1', action: 'read',
  resource: '/data', success: true, keyPair,
});
const score = computeScore([receipt]);
console.log(score.overall); // 0.0 - 1.0
```

---

### @stele/mcp

MCP (Model Context Protocol) guard that wraps an MCP server with Stele covenant enforcement, audit logging, identity creation, and compliance proof generation.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `steleGuard(server, options)` | function | Wrap an MCP server with Stele enforcement. Returns `WrappedMCPServer` with audit log, identity, and compliance proof. |
| `PRESETS` | const | Named constraint presets (e.g., `"standard:data-isolation"`, `"standard:read-only"`). |
| `MCPServer`, `WrappedMCPServer` | type | MCP server interfaces. |
| `SteleGuardOptions` | type | Guard configuration: constraints, key pair, operator identifier, model, capabilities, deployment. |
| `ViolationDetails`, `ToolCallDetails` | type | Event detail types for monitoring. |

#### Usage

```typescript
import { steleGuard, PRESETS } from '@stele/mcp';

const wrapped = await steleGuard(mcpServer, {
  constraints: 'standard:data-isolation',
  keyPair,
  model: { provider: 'anthropic', modelId: 'claude-3' },
  capabilities: ['read'],
  deployment: { runtime: 'process' },
});
// wrapped.server now enforces constraints on every tool call
```

---

## Protocol

### @stele/attestation

External attestation creation, reconciliation, chain linking, and coverage analysis for verifying agent interactions with external counterparties.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createAttestation(agentId, counterpartyId, endpoint, inputHash, outputHash, interactionHash, timestamp)` | function | Create an `ExternalAttestation` with a deterministic content-addressed ID. |
| `reconcileAttestations(agent, counterparty)` | function | Reconcile two attestations and identify discrepancies. Returns `AttestationReconciliation`. |
| `linkAttestations(attestations, keyPair)` | async function | Link a sequence of attestations into a signed chain. |
| `verifyAttestationChain(chain)` | async function | Verify integrity of an attestation chain. |
| `computeAttestationCoverage(actions, attestations)` | function | Compute what fraction of agent actions are attested. |
| `ExternalAttestation`, `AttestationReconciliation`, `Discrepancy`, `AttestationChainLink`, `ChainVerificationResult`, `AttestationCoverageResult` | type | Core attestation types. |

#### Usage

```typescript
import { createAttestation, reconcileAttestations } from '@stele/attestation';

const agentAtt = createAttestation(
  'agent-1', 'service-a', '/api/data',
  inHash, outHash, ixHash, Date.now(),
);
const serviceAtt = createAttestation(
  'service-a', 'agent-1', '/api/data',
  inHash, outHash, ixHash, Date.now(),
);
const reconciliation = reconcileAttestations(agentAtt, serviceAtt);
```

---

### @stele/canary

Canary testing framework that generates challenge payloads from CCL constraints and verifies agent compliance by probing boundary conditions.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createCanary(constraints, agentId)` | function | Create a `Canary` test from CCL constraint text. |
| `runCanary(canary, executor)` | async function | Execute a canary test and return a `CanaryResult`. |
| `createCanarySchedule(constraints, agentId, interval)` | function | Create a schedule of periodic canary tests. |
| `runCanarySchedule(schedule, executor)` | async function | Execute all canaries in a schedule. |
| `correlateCanaryResults(results)` | function | Analyze canary results for patterns and correlations. |
| `Canary`, `CanaryResult`, `ChallengePayload`, `CanaryScheduleEntry`, `CanaryCorrelationResult` | type | Core canary types. |

#### Usage

```typescript
import { createCanary, runCanary } from '@stele/canary';

const canary = createCanary("deny write on '/secrets/**'", 'agent-1');
const result = await runCanary(canary, async (challenge) => {
  return { permitted: false };
});
console.log(result.passed);
```

---

### @stele/gametheory

Game-theoretic analysis proving that honest behavior is the dominant strategy under Stele's incentive structure.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `proveHonesty(params)` | function | Prove (or disprove) that honesty dominates given `HonestyParameters`. Returns `HonestyProof`. |
| `minimumStake(params)` | function | Compute the minimum stake required to make honesty dominant. |
| `validateParameters(params)` | function | Validate that all parameters are within acceptable ranges. |
| `HonestyParameters` | type | `{ stakeAmount, detectionProbability, reputationValue, maxViolationGain, coburn }` |
| `HonestyProof` | type | Structured proof with step-by-step derivation and margin. |

#### Usage

```typescript
import { proveHonesty } from '@stele/gametheory';

const proof = proveHonesty({
  stakeAmount: 1000,
  detectionProbability: 0.9,
  reputationValue: 500,
  maxViolationGain: 200,
  coburn: 100,
});
console.log(proof.isDominantStrategy); // true
```

---

### @stele/composition

Formal composition of multiple covenant constraints with proof of system-property preservation and complexity analysis.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `composeConstraints(constraints)` | function | Compose multiple CCL constraint strings into a single `CCLDocument` with proof. |
| `verifyComposition(proof)` | function | Verify a composition proof's correctness. |
| `checkSystemProperty(doc, property)` | function | Check whether a CCL document satisfies a named system property. |
| `decomposeCovenant(doc)` | function | Decompose a covenant's constraints into categorized parts. |
| `computeCompositionComplexity(constraints)` | function | Analyze the computational complexity of composing constraints. |
| `CompositionProof`, `ComposedConstraint`, `SystemProperty`, `CovenantSummary`, `DecomposedCovenant`, `CompositionComplexityResult` | type | Core composition types. |

#### Usage

```typescript
import { composeConstraints, checkSystemProperty } from '@stele/composition';

const result = composeConstraints([
  "permit read on '**'",
  "deny write on '/system/**'",
]);
const ok = checkSystemProperty(result.document, {
  name: 'no-system-writes',
  constraints: ["deny write on '/system/**'"],
});
```

---

### @stele/antifragile

Antifragility analysis that turns breach events into system improvements through antibody generation, stress testing, and governance proposals.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `generateAntibody(breach)` | function | Generate a `BreachAntibody` (new constraint) from a breach event. |
| `assessNetworkHealth(breaches, antibodies)` | function | Compute a `NetworkHealth` score from breach/antibody history. |
| `proposeGovernanceChange(antibodies)` | function | Generate a `GovernanceProposal` from accumulated antibodies. |
| `runStressTest(constraints, scenarios)` | function | Stress-test constraints against adversarial scenarios. |
| `computeAntifragilityIndex(breaches, antibodies)` | function | Compute an antifragility index measuring system resilience. |
| `BreachAntibody`, `NetworkHealth`, `GovernanceProposal`, `BreachSummary`, `StressTestResult`, `AntifragilityIndexResult` | type | Core antifragility types. |

#### Usage

```typescript
import { generateAntibody, assessNetworkHealth } from '@stele/antifragile';

const antibody = generateAntibody({
  violatedConstraint: "deny write on '/secrets/**'",
  severity: 'critical',
  description: 'Secret exfiltration attempt',
});
const health = assessNetworkHealth(breaches, [antibody]);
```

---

### @stele/negotiation

Multi-party covenant negotiation with proposal/counter-proposal workflows, Nash bargaining solutions, and Pareto optimality analysis.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createSession(parties)` | function | Create a new `NegotiationSession` between named parties. |
| `submitProposal(session, proposal)` | function | Submit a `Proposal` to an active session. |
| `evaluateProposal(session, proposal)` | function | Evaluate a proposal against session policy. |
| `findNashBargainingSolution(outcomes, utilities)` | function | Compute the Nash bargaining solution for a set of outcomes. |
| `findParetoOptimal(outcomes, utilities)` | function | Find Pareto-optimal outcomes. |
| `NegotiationSession`, `Proposal`, `NegotiationPolicy`, `UtilityFunction`, `Outcome`, `NashBargainingSolution`, `ParetoOutcome` | type | Core negotiation types. |

#### Usage

```typescript
import { createSession, submitProposal } from '@stele/negotiation';

const session = createSession(['operator', 'agent']);
submitProposal(session, {
  from: 'operator',
  constraints: ["deny write on '/system/**'"],
  requirements: [],
  timestamp: Date.now(),
});
```

---

### @stele/consensus

Accountability-score-based consensus protocol for multi-agent governance decisions and access control.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `computeAccountabilityScore(data)` | function | Compute a weighted accountability score from covenant, compliance, stake, attestation, and canary data. |
| `classifyTier(score)` | function | Map an accountability score to a tier: `exemplary`, `trusted`, `verified`, `basic`, or `untrusted`. |
| `evaluateInteractionPolicy(score, policy)` | function | Evaluate whether an agent's score meets an interaction policy's requirements. |
| `makeAccessDecision(score, policies)` | function | Make an access decision based on score and multiple policies. |
| `AccountabilityConfig` | type | Configuration for tier thresholds and component weights. |
| `AccountabilityTier`, `AccountabilityScore`, `InteractionPolicy`, `AccessDecision`, `ProtocolData` | type | Core consensus types. |

#### Usage

```typescript
import { computeAccountabilityScore, classifyTier } from '@stele/consensus';

const score = computeAccountabilityScore({
  covenantCompleteness: 0.9,
  complianceHistory: 0.85,
  stakeRatio: 0.7,
  attestationCoverage: 0.8,
  canaryPassRate: 0.95,
});
const tier = classifyTier(score); // 'trusted'
```

---

### @stele/robustness

Formal robustness analysis for covenant constraints: input bound verification, vulnerability scanning, contradiction detection, and robustness scoring.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `proveInputBound(constraints, bounds)` | function | Prove that constraints hold for all inputs within specified bounds. |
| `scanVulnerabilities(constraints, options?)` | function | Scan constraints for potential vulnerabilities and edge cases. |
| `formalVerify(spec)` | function | Formally verify a covenant specification against its constraint definitions. |
| `computeRobustnessScore(constraints)` | function | Compute a multi-factor robustness score for a constraint set. |
| `RobustnessProof`, `InputBound`, `RobustnessReport`, `Vulnerability`, `FormalVerificationResult`, `Contradiction`, `RobustnessScoreResult` | type | Core robustness types. |

#### Usage

```typescript
import { scanVulnerabilities, computeRobustnessScore } from '@stele/robustness';

const vulns = scanVulnerabilities([
  "permit read on '**'",
  "deny write on '/system/**'",
]);
const score = computeRobustnessScore([
  "permit read on '**'",
  "deny write on '/system/**'",
]);
console.log(score.overall, score.factors);
```

---

### @stele/temporal

Temporal evolution of covenants: trigger-based constraint evolution, trust decay modeling, violation tracking, and expiration forecasting.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createEvolutionPolicy(triggers)` | function | Create an `EvolutionPolicy` from a set of `EvolutionTrigger` definitions. |
| `evaluateTrigger(trigger, state)` | function | Evaluate whether a trigger condition is met for a given agent state. |
| `applyTransition(state, trigger)` | function | Apply a triggered transition to a `CovenantState`. |
| `modelTrustDecay(initialTrust, decayRate, timePoints)` | function | Model trust decay over time. Returns `DecayPoint[]`. |
| `trackViolation(record, violation)` | function | Record a violation and update severity tracking. |
| `forecastExpiration(state, decayRate)` | function | Forecast when a covenant's trust will fall below a threshold. |
| `EvolutionPolicy`, `EvolutionTrigger`, `EvolutionEvent`, `AgentState`, `CovenantState`, `DecayPoint`, `ViolationRecord`, `ExpirationForecastResult` | type | Core temporal types. |

#### Usage

```typescript
import { createEvolutionPolicy, modelTrustDecay } from '@stele/temporal';

const policy = createEvolutionPolicy([{
  type: 'reputation_threshold',
  condition: { threshold: 0.5 },
  action: 'tighten',
  constraintDelta: "deny write on '/sensitive/**'",
}]);
const decay = modelTrustDecay(1.0, 0.95, [0, 30, 60, 90]);
```

---

### @stele/recursive

Meta-covenants and recursive verification: covenants that govern other covenants, termination proofs, and transitive trust analysis.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createMetaCovenant(targetType, constraints, dependsOn?)` | function | Create a `MetaCovenant` that governs a target entity type. |
| `verifyRecursive(metaCovenant, depth?)` | function | Recursively verify a meta-covenant chain. Returns `RecursiveVerification`. |
| `proveTermination(metaCovenants)` | function | Prove that a set of meta-covenants terminates (no infinite recursion). |
| `computeTransitiveTrust(entities, edges)` | function | Compute transitive trust scores across a verification graph. |
| `findMinimalVerificationSet(verifiers, targets)` | function | Find the minimal set of verifiers needed to cover all targets. |
| `MetaCovenant`, `RecursiveVerification`, `TerminationProof`, `TrustBase`, `TransitiveTrustResult`, `MinimalVerificationSetResult` | type | Core recursive types. |

#### Usage

```typescript
import { createMetaCovenant, proveTermination } from '@stele/recursive';

const meta = createMetaCovenant('ai-agent', ["deny * on '/system/**'"]);
const proof = proveTermination([meta]);
console.log(proof.terminates); // true
```

---

### @stele/alignment

AI alignment verification: HHH (Helpful, Honest, Harmless) property checking, alignment drift detection, and decomposition analysis.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createAlignmentCovenant(properties)` | function | Create an `AlignmentCovenant` from named alignment properties. |
| `verifyAlignment(covenant, records)` | function | Verify alignment against execution records. Returns `AlignmentReport`. |
| `detectDrift(records, windowSize?)` | function | Detect alignment drift over a time window. |
| `decomposeAlignment(covenant)` | function | Decompose alignment into individual property contributions. |
| `STANDARD_ALIGNMENT_PROPERTIES` | const | Pre-defined HHH alignment properties (harmlessness, honesty, helpfulness). |
| `AlignmentProperty`, `AlignmentCovenant`, `AlignmentReport`, `ExecutionRecord`, `AlignmentDriftResult`, `AlignmentDecompositionResult` | type | Core alignment types. |

#### Usage

```typescript
import { createAlignmentCovenant, verifyAlignment, STANDARD_ALIGNMENT_PROPERTIES } from '@stele/alignment';

const covenant = createAlignmentCovenant(STANDARD_ALIGNMENT_PROPERTIES);
const report = verifyAlignment(covenant, executionRecords);
console.log(report.overallScore, report.propertyScores);
```

---

### @stele/norms

Emergent norm discovery, clustering, governance proposal generation, and template management from observed covenant patterns.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `discoverNorms(covenants)` | function | Discover emergent norms from a set of covenant constraint patterns. |
| `clusterNorms(norms)` | function | Cluster discovered norms by similarity. |
| `proposeGovernance(clusters)` | function | Generate governance proposals from norm clusters. |
| `createTemplate(norm)` | function | Create a reusable `CovenantTemplate` from a discovered norm. |
| `detectConflicts(norms)` | function | Detect conflicts between norms. |
| `resolveNormPrecedence(norms)` | function | Resolve precedence ordering among conflicting norms. |
| `DiscoveredNorm`, `NormAnalysis`, `NormCluster`, `GovernanceProposal`, `CovenantTemplate`, `NormConflict`, `NormPrecedenceResult` | type | Core norm types. |

#### Usage

```typescript
import { discoverNorms, clusterNorms, proposeGovernance } from '@stele/norms';

const norms = discoverNorms(covenantDataset);
const clusters = clusterNorms(norms);
const proposals = proposeGovernance(clusters);
```

---

### @stele/substrate

Cross-substrate constraint translation for AI agents, robots, IoT devices, autonomous vehicles, smart contracts, and drones.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createAdapter(type, config)` | function | Create a `SubstrateAdapter` for a specific substrate type (`'ai-agent'`, `'robot'`, `'iot-device'`, `'autonomous-vehicle'`, `'smart-contract'`, `'drone'`). |
| `translateConstraints(adapter, constraints)` | function | Translate CCL constraints to substrate-specific enforcement rules. |
| `computeSafetyBounds(adapter, constraints)` | function | Compute physical safety bounds for a substrate. |
| `checkCompatibility(adapters)` | function | Check compatibility between multiple substrate adapters. |
| `buildCapabilityMatrix(adapters)` | function | Build a capability matrix across substrates. |
| `createUniversalCovenant(adapters, constraints)` | function | Create a covenant that spans multiple substrates. |
| `SubstrateType`, `SubstrateAdapter`, `PhysicalConstraint`, `SafetyBound`, `UniversalCovenant`, `CapabilityMatrix` | type | Core substrate types. |

#### Usage

```typescript
import { createAdapter, translateConstraints } from '@stele/substrate';

const adapter = createAdapter('robot', { maxVelocity: 1.5, maxForce: 100 });
const rules = translateConstraints(adapter, [
  "deny * on '/actuators/**' when risk_level = 'critical'",
]);
```

---

### @stele/derivatives

Trust derivatives: trust futures, agent insurance policies, risk assessment, and settlement for accountability-based financial instruments.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createTrustFuture(agentId, maturityDate, coverage, premium)` | function | Create a `TrustFuture` contract. |
| `createInsurancePolicy(agentId, coverage, reputationData, config?)` | function | Create an `AgentInsurancePolicy` with risk-based premium pricing. |
| `assessRisk(reputationData, config?)` | function | Compute a `RiskAssessment` for an agent. |
| `settleFuture(future, reputationData)` | function | Settle a trust future based on actual reputation data. |
| `PricingConfig` | type | Configuration for risk weights, premium multiplier, and maturity half-life. |
| `TrustFuture`, `AgentInsurancePolicy`, `RiskAssessment`, `RiskFactor`, `Settlement`, `ReputationData` | type | Core derivatives types. |

#### Usage

```typescript
import { createInsurancePolicy, assessRisk } from '@stele/derivatives';

const risk = assessRisk({
  breachCount: 0, trustScore: 0.85,
  complianceRate: 0.95, stakeAmount: 1000,
  maturityDays: 180,
});
const policy = createInsurancePolicy('agent-1', 10000, reputationData);
console.log(policy.premiumRate, risk.overallRisk);
```

---

### @stele/legal

Legal compliance: identity packages, jurisdictional mappings, cross-jurisdiction compliance checking, audit trail export, and regulatory gap analysis.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createLegalIdentityPackage(identity, covenants, reputation, attestations, insurance?)` | function | Bundle all accountability artifacts into a `LegalIdentityPackage`. |
| `checkCompliance(pkg, standard)` | function | Check a legal package against a compliance standard. Returns `ComplianceRecord`. |
| `mapJurisdiction(pkg, jurisdiction)` | function | Map a legal package to jurisdiction-specific requirements. |
| `checkCrossJurisdiction(pkg, jurisdictions)` | function | Check compliance across multiple jurisdictions. |
| `exportAuditTrail(pkg, format?)` | function | Export the audit trail in a structured format. |
| `analyzeRegulatoryGaps(pkg, standard)` | function | Identify gaps between current compliance and a regulatory standard. |
| `LegalIdentityPackage`, `ComplianceRecord`, `JurisdictionalMapping`, `CrossJurisdictionResult`, `AuditTrailExport`, `RegulatoryGapAnalysisResult` | type | Core legal types. |

#### Usage

```typescript
import { createLegalIdentityPackage, checkCompliance } from '@stele/legal';

const pkg = createLegalIdentityPackage(
  identity, covenants, reputation, attestations,
);
const compliance = checkCompliance(pkg, 'ISO-42001');
console.log(compliance.compliant, compliance.gaps);
```

---

## Platform

### @stele/react

Framework-agnostic reactive primitives (Observable, CovenantState, IdentityState) for building Stele-powered UIs.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `Observable<T>` | class | Reactive value container with `get()`, `set(value)`, `subscribe(fn)`, `map(fn)`. |
| `CovenantState` | class | Reactive wrapper around covenant documents with verification status and evaluation. |
| `IdentityState` | class | Reactive wrapper around agent identity with evolution tracking. |
| `StoreState` | class | Reactive wrapper around a `CovenantStore` with filtered listing and event sync. |
| `Subscriber<T>` | type | Callback type for Observable subscribers. |

#### Usage

```typescript
import { Observable, CovenantState } from '@stele/react';

const counter = new Observable(0);
counter.subscribe((value) => console.log('Count:', value));
counter.set(1); // logs "Count: 1"

const state = new CovenantState(client);
await state.create(options);
```

---

### @stele/evm

EVM anchoring utilities for on-chain covenant verification: ABI encoding/decoding, contract interface generation, and anchor/verify helpers for Ethereum-compatible blockchains.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `encodeUint256(value)` | function | ABI-encode a `bigint` as a 64-char hex string. |
| `decodeUint256(hex)` | function | Decode a 64-char hex string to `bigint`. |
| `encodeAddress(address)` | function | ABI-encode a 20-byte Ethereum address. |
| `encodeBytes32(hex)` | function | ABI-encode a 32-byte value. |
| `encodeString(value)` | function | ABI-encode a dynamic UTF-8 string. |
| `encodeFunctionCall(selector, params)` | function | Encode a full function call with selector and parameters. |
| `computeFunctionSelector(signature)` | function | Compute the 4-byte function selector from a signature string. |
| `anchorCovenant(doc)` | function | Prepare a covenant for on-chain anchoring (returns encoded calldata). |
| `verifyAnchor(anchorData, doc)` | function | Verify that anchor data matches a covenant document. |
| `STELE_CONTRACT_ABI` | const | ABI definition for the Stele covenant anchor contract. |

#### Usage

```typescript
import { anchorCovenant, encodeUint256, computeFunctionSelector } from '@stele/evm';

const calldata = anchorCovenant(covenantDoc);
const selector = computeFunctionSelector('anchor(bytes32,bytes32,uint256)');
const encoded = encodeUint256(42n);
```

---

### @stele/mcp-server

Model Context Protocol server exposing Stele tools to AI agents via JSON-RPC 2.0 over stdio.

#### Key Exports

| Export | Kind | Description |
|--------|------|-------------|
| `MCPSteleServer` | class | JSON-RPC 2.0 server with 6 built-in tools: `create_covenant`, `verify_covenant`, `evaluate_action`, `create_identity`, `parse_ccl`, `list_covenants`. Methods: `handleRequest(json)`, `getToolDefinitions()`, `start()`. |
| `JSON_RPC_ERRORS` | const | Standard JSON-RPC 2.0 error codes. |
| `JsonRpcRequest`, `JsonRpcResponse`, `ToolDefinition`, `ToolResult`, `MCPServerOptions` | type | JSON-RPC and MCP types. |

#### Usage

```typescript
import { MCPSteleServer } from '@stele/mcp-server';

const server = new MCPSteleServer({ storePath: './covenants' });
const response = await server.handleRequest({
  jsonrpc: '2.0', id: 1,
  method: 'tools/call',
  params: { name: 'parse_ccl', arguments: { source: "permit read on '**'" } },
});
```

---

### @stele/cli

Command-line interface for Stele operations: key generation, covenant management, identity management, CCL parsing, and verification.

#### Commands

| Command | Description |
|---------|-------------|
| `stele keygen` | Generate a new Ed25519 key pair and write to files. |
| `stele build --issuer <file> --beneficiary <file> --constraints <ccl> --key <file>` | Build and sign a new covenant document. |
| `stele verify <file>` | Verify a covenant document from a JSON file. |
| `stele inspect <file>` | Display details of a covenant document. |
| `stele resign <file> --key <file>` | Re-sign a covenant with a new nonce. |
| `stele parse <ccl>` | Parse CCL source text and display the AST. |
| `stele identity create --key <file> --model <json> --capabilities <list> --deployment <json>` | Create a new agent identity. |
| `stele identity evolve <file> --key <file> --change-type <type> --description <text>` | Evolve an existing agent identity. |

#### Usage

```bash
# Generate a key pair
stele keygen --output ./keys

# Build a covenant
stele build --issuer issuer.json --beneficiary beneficiary.json \
  --constraints "permit read on '**'" --key ./keys/private.hex

# Verify a covenant
stele verify covenant.json

# Parse CCL
stele parse "deny write on '/system/**'"
```

---

## Type Glossary

| Type | Package | Description |
|------|---------|-------------|
| `CovenantDocument` | core | The primary covenant document with issuer, beneficiary, constraints, signature. |
| `KeyPair` | crypto | Ed25519 key pair: `{ privateKey, publicKey, publicKeyHex }`. |
| `CCLDocument` | ccl | Parsed constraint document: `{ statements, permits, denies, obligations, limits }`. |
| `AgentIdentity` | identity | Agent identity with model attestation, capabilities, lineage. |
| `VerificationResult` | core | `{ valid: boolean, checks: VerificationCheck[], document }`. |
| `EvaluationResult` | ccl | `{ permitted: boolean, matchedRule?, allMatches[], reason?, severity? }`. |
| `SteleError` | types | Base error with `code: SteleErrorCode`. |
| `Result<T, E>` | types | Discriminated union for fallible operations. |

---

## Protocol Constants

| Constant | Package | Value | Description |
|----------|---------|-------|-------------|
| `PROTOCOL_VERSION` | core | `"1.0"` | Current protocol version. |
| `MAX_CONSTRAINTS` | core | `100` | Maximum CCL statements per document. |
| `MAX_CHAIN_DEPTH` | core | `16` | Maximum delegation chain depth. |
| `MAX_DOCUMENT_SIZE` | core | `1048576` | Maximum serialized document size (1 MB). |
| `STELE_VERSION` | types | `"0.1.0"` | SDK version string. |
| `DEFAULT_SEVERITY` | types | `"must"` | Default CCL severity level. |
