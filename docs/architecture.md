# Stele Architecture

## Overview

Stele is a digital accountability protocol for AI agents. It provides a cryptographically
signed covenant system that defines what an AI agent may and may not do, with mechanisms
for verification, enforcement, identity tracking, reputation scoring, and legal compliance.

The core idea: before an AI agent operates, it enters into a **covenant** -- a signed
document specifying constraints on its behavior. These constraints are written in CCL
(Covenant Constraint Language), a purpose-built rule language. The covenant is signed by
an **issuer** (typically the operator) and references a **beneficiary** (the party whose
interests are protected). Every action the agent takes can be evaluated against its
covenant constraints, producing a verifiable audit trail.

Stele is designed to be:

- **Cryptographically verifiable**: All documents are signed with Ed25519 and content-addressed with SHA-256.
- **Composable**: Covenants can form delegation chains where each child narrows the parent's constraints.
- **Extensible**: Pluggable storage, custom chain resolvers, and an event-driven SDK.
- **Zero-dependency at runtime**: Only `@noble/ed25519` and `@noble/hashes` are required.

## Layer Diagram

The monorepo is organized into five layers, where each layer depends only on the
layers below it:

```
┌─────────────────────────────────────────────────────┐
│                     Platform                         │
│       react  ·  evm  ·  mcp-server  ·  cli           │
├─────────────────────────────────────────────────────┤
│                       SDK                            │
│          sdk (SteleClient, QuickCovenant)             │
├─────────────────────────────────────────────────────┤
│                    Protocol                          │
│   attestation · canary · gametheory · composition     │
│   antifragile · negotiation · consensus · robustness  │
│   temporal · recursive · alignment · norms            │
│   substrate · derivatives · legal                     │
├─────────────────────────────────────────────────────┤
│                   Enforcement                        │
│    enforcement · proof · breach · reputation · mcp    │
├─────────────────────────────────────────────────────┤
│                   Foundation                         │
│   types · crypto · ccl · core · store · verifier ·    │
│   identity                                           │
└─────────────────────────────────────────────────────┘
```

### Foundation

The bottom layer provides the cryptographic primitives, type system, constraint
language, document lifecycle, storage, verification, and identity management that
every other layer builds upon.

### Enforcement

Sits above Foundation and provides runtime enforcement capabilities: the `Monitor`
class that gates agent actions through CCL evaluation, Poseidon-based compliance
proofs, breach attestation, reputation scoring, and MCP server wrapping.

### Protocol

Advanced protocol features that combine multiple Foundation and Enforcement
primitives: external attestation reconciliation, canary testing, game-theoretic
analysis, formal composition, antifragility, multi-party negotiation, consensus,
robustness analysis, temporal evolution, recursive meta-covenants, alignment
verification, emergent norms, cross-substrate translation, trust derivatives,
and legal compliance.

### SDK

A thin unification layer (`SteleClient`) that re-exports and wraps Foundation
packages into a single, ergonomic API with an event system.

### Platform

Integration adapters: reactive UI primitives, EVM blockchain anchoring, a
JSON-RPC MCP server, and a command-line interface.

## Data Flow

A typical Stele workflow follows this sequence:

```
1. Key Generation
   generateKeyPair() --> KeyPair { privateKey, publicKey, publicKeyHex }

2. Covenant Building
   buildCovenant({ issuer, beneficiary, constraints, privateKey })
     --> validates inputs
     --> parses CCL to verify syntax
     --> generates cryptographic nonce
     --> computes canonical JSON form
     --> signs with Ed25519
     --> computes SHA-256 document ID
     --> returns CovenantDocument

3. Verification
   verifyCovenant(doc)
     --> runs 11 specification checks:
         id_match, signature_valid, not_expired, active,
         ccl_parses, enforcement_valid, proof_valid,
         chain_depth, document_size, countersignatures, nonce_present
     --> returns VerificationResult { valid, checks[] }

4. Action Evaluation
   evaluate(cclDoc, action, resource, context)
     --> matches action pattern
     --> matches resource glob
     --> evaluates `when` conditions against context
     --> applies specificity tie-breaking
     --> deny-wins: if any deny matches, result is denied
     --> returns EvaluationResult { permitted, matchedRule, reason }

5. Chain Delegation
   buildCovenant({ ..., chain: { parentId, relation: 'delegation', depth: 1 } })
     --> child covenant references parent by ID
     --> validateChainNarrowing(child, parent) ensures child only restricts

6. Identity Management
   createIdentity({ operatorKeyPair, model, capabilities, deployment })
     --> hashes capabilities, computes identity hash
     --> signs with operator key
     --> returns AgentIdentity with lineage

7. Enforcement
   Monitor.execute(action, resource, handler)
     --> evaluates action against CCL
     --> checks rate limits
     --> if permitted, runs handler
     --> creates hash-chained audit entry
     --> returns ExecutionOutcome
```

## CCL Design

The Covenant Constraint Language (CCL) is a declarative rule language with four
statement types:

| Statement | Syntax | Semantics |
|-----------|--------|-----------|
| `permit`  | `permit <action> on '<resource>' [when <condition>]` | Allow the action on matching resources |
| `deny`    | `deny <action> on '<resource>' [when <condition>]` | Block the action on matching resources |
| `require` | `require <action> on '<resource>' [when <condition>]` | Mandate that the action must occur |
| `limit`   | `limit <action> <count> per <n> <unit>` | Rate-limit the action |

### Evaluation Rules

1. **Deny wins**: If both a `permit` and a `deny` match the same action/resource, the
   `deny` takes precedence regardless of specificity.
2. **Specificity tie-breaking**: Among statements of the same type, the most specific
   match wins (exact action > wildcard, exact resource > glob).
3. **Default deny**: If no statement matches, the action is denied.
4. **Condition evaluation**: `when` clauses compare context variables using `=`, `!=`,
   `<`, `>`, `<=`, `>=` operators, with `and`/`or` compound conditions.

### Resource Matching

- Exact: `/data` matches only `/data`
- Single glob: `/data/*` matches `/data/foo` but not `/data/foo/bar`
- Recursive glob: `/data/**` matches `/data/foo`, `/data/foo/bar`, etc.
- Universal: `**` matches everything

### Merge Semantics

When merging two CCL documents (e.g., parent and child in a chain):

- All `deny` statements from both documents are kept (deny-wins)
- `permit` statements are intersected (both must permit)
- `limit` statements use the more restrictive values
- `require` statements are unioned (both requirements apply)

### CCL Gotchas

- `severity` is a **reserved keyword** in `when` conditions -- use `risk_level` instead
- Resource matching is **exact**: `/secrets` does not match `/secrets/key`
- Default behavior is **deny** when no rules match

## Chain Model

Covenants form delegation chains via the `chain` field:

```typescript
chain: {
  parentId: string;     // SHA-256 ID of the parent document
  relation: string;     // 'delegation' | 'amendment' | 'renewal'
  depth: number;        // 1-based depth in the chain
}
```

### Chain Rules

- **Maximum depth**: `MAX_CHAIN_DEPTH` (16 by default)
- **Narrowing only**: A child covenant may only restrict (never broaden) its parent's
  constraints. This is enforced by `validateChainNarrowing()`.
- **Depth monotonicity**: Each child's depth must equal its index in the chain.
- **Parent reference integrity**: `child.chain.parentId` must equal `parent.id`.
- **Effective constraints**: `computeEffectiveConstraints()` merges the full chain
  from root to leaf using CCL merge semantics.

### Chain Resolution

The `ChainResolver` interface allows pluggable lookup of parent documents:

```typescript
interface ChainResolver {
  resolve(id: HashHex): Promise<CovenantDocument | undefined>;
}
```

`MemoryChainResolver` is provided for testing. Production deployments should implement
a resolver backed by their storage system.

## Identity Model

Agent identities track an AI agent across its lifecycle:

```typescript
interface AgentIdentity {
  id: string;                    // Content-addressed hash
  operatorId: string;            // Who operates this agent
  model: ModelAttestation;       // { provider, modelId, modelVersion? }
  capabilities: string[];        // What this agent can do
  deployment: DeploymentContext;  // { runtime, region?, provider? }
  lineage: LineageEntry[];       // Evolution history
  operatorSignature: string;     // Ed25519 signature
  createdAt: string;             // ISO 8601
}
```

### Evolution

When an agent's model, capabilities, or operator changes, the identity **evolves**
rather than being replaced. The `evolveIdentity()` function creates a new identity
document with a lineage entry recording what changed.

Reputation carry-forward rates control how much of the previous identity's reputation
transfers to the new one:

| Change Type | Default Carry-Forward |
|-------------|----------------------|
| Minor update | 95% |
| Model version change | 80% |
| Model family change | 20% |
| Operator transfer | 50% |
| Capability expansion | 90% |
| Capability reduction | 100% |
| Full rebuild | 0% |

## Security Model

### Signing and Verification

All covenant documents are signed using **Ed25519** (via `@noble/ed25519`):

1. The document body (excluding `id`, `signature`, `countersignatures`) is serialized
   to **canonical JSON** (JCS / RFC 8785).
2. The canonical form is signed with the issuer's private key.
3. The document `id` is the **SHA-256** hash of the canonical form.
4. Verification recomputes the canonical form, checks the signature against the
   issuer's public key, and verifies the ID matches.

### Constant-Time Comparison

The `constantTimeEqual()` function ensures that signature and hash comparisons do not
leak timing information, preventing side-channel attacks.

### Content Addressing

Every document, identity, attestation, and proof is identified by the SHA-256 hash of
its canonical content. This provides:

- **Integrity**: Any modification invalidates the ID
- **Deduplication**: Identical documents have the same ID
- **Verifiability**: Anyone can recompute the ID from the content

### Nonce Protection

Each covenant document includes a 32-byte cryptographic nonce generated from a CSPRNG.
This prevents:

- **Replay attacks**: The same constraints with different nonces produce different documents
- **Prediction**: An attacker cannot guess future document IDs

## Extension Points

### CovenantStore Interface

Implement the `CovenantStore` interface to provide custom persistence:

```typescript
interface CovenantStore {
  put(doc: CovenantDocument): Promise<void>;
  get(id: string): Promise<CovenantDocument | undefined>;
  has(id: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  list(filter?: StoreFilter): Promise<CovenantDocument[]>;
  count(filter?: StoreFilter): Promise<number>;
  putBatch(docs: CovenantDocument[]): Promise<void>;
  getBatch(ids: string[]): Promise<(CovenantDocument | undefined)[]>;
  deleteBatch(ids: string[]): Promise<number>;
  onEvent(callback: StoreEventCallback): void;
  offEvent(callback: StoreEventCallback): void;
}
```

Built-in implementations: `MemoryStore` (testing), `FileStore` (file system).

### ChainResolver Interface

Implement `ChainResolver` to provide custom parent document lookup for chain
resolution:

```typescript
interface ChainResolver {
  resolve(id: HashHex): Promise<CovenantDocument | undefined>;
}
```

### SteleClient Events

The `SteleClient` emits typed events throughout the covenant lifecycle:

| Event | Emitted When |
|-------|-------------|
| `covenant:created` | A new covenant is built and signed |
| `covenant:verified` | A covenant passes (or fails) verification |
| `covenant:countersigned` | A countersignature is added |
| `identity:created` | A new agent identity is created |
| `identity:evolved` | An identity is evolved |
| `chain:resolved` | A delegation chain is resolved |
| `chain:validated` | A chain is validated |
| `evaluation:completed` | An action is evaluated against constraints |

```typescript
const client = new SteleClient();
client.on('covenant:created', (event) => {
  console.log('New covenant:', event.document.id);
});
```
