# @nobulex/core-types

TypeScript interfaces for the six Nobulex covenant primitives. This package contains zero runtime code -- only type definitions that form the shared schema for the entire Nobulex stack.

## The Six Primitives

1. **Identity (DID)** -- W3C DID Documents for agent identity
2. **Covenant** -- Cedar-like permit/forbid DSL over observable actions
3. **Attestation** -- W3C Verifiable Credential wrapping a signed covenant
4. **Action Log** -- Hash-chained tamper-evident record of agent actions
5. **Verification** -- Deterministic `verify(covenant, actionLog) -> boolean`
6. **Enforcement** -- Staking/slashing contracts for economic accountability

## Installation

```bash
npm install @nobulex/core-types
```

**Requirements:** Node.js >= 18

## Quick Usage

```typescript
import type {
  DIDDocument,
  CovenantSpec,
  ActionLogEntry,
  VerificationResult,
} from '@nobulex/core-types';

// Type-check a DID document
const doc: DIDDocument = {
  '@context': ['https://www.w3.org/ns/did/v1'],
  id: 'did:nobulex:agent-1',
  controller: 'did:nobulex:agent-1',
  verificationMethod: [
    {
      id: 'did:nobulex:agent-1#key-1',
      type: 'Ed25519VerificationKey2020',
      controller: 'did:nobulex:agent-1',
      publicKeyHex: 'abc123...',
    },
  ],
  authentication: ['did:nobulex:agent-1#key-1'],
  assertionMethod: ['did:nobulex:agent-1#key-1'],
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
};

// Type-check a covenant spec
const spec: CovenantSpec = {
  name: 'SafeAgent',
  statements: [
    { effect: 'permit', action: 'read', conditions: [] },
    { effect: 'forbid', action: 'delete', conditions: [] },
  ],
  requirements: [],
};
```

## API Reference

### Identity (DID)

#### `DIDVerificationMethod`

W3C DID verification method for agent identity.

| Field          | Type                            | Description                              |
| -------------- | ------------------------------- | ---------------------------------------- |
| `id`           | `string`                        | Unique identifier (e.g., `did:...#key-1`)|
| `type`         | `'Ed25519VerificationKey2020'`  | Cryptographic suite                      |
| `controller`   | `string`                        | DID of the controlling entity            |
| `publicKeyHex` | `string`                        | Public key as lowercase hex              |

#### `DIDDocument`

W3C DID Document for an agent.

| Field                | Type                              | Description                        |
| -------------------- | --------------------------------- | ---------------------------------- |
| `@context`           | `readonly string[]`               | JSON-LD context URIs               |
| `id`                 | `string`                          | The agent's DID                    |
| `controller`         | `string`                          | Controlling entity's DID           |
| `verificationMethod` | `readonly DIDVerificationMethod[]`| Verification methods               |
| `authentication`     | `readonly string[]`               | Authentication method references   |
| `assertionMethod`    | `readonly string[]`               | Assertion method references        |
| `created`            | `string`                          | ISO 8601 creation timestamp        |
| `updated`            | `string`                          | ISO 8601 last-updated timestamp    |

#### `DIDKeyPair`

Key pair used for DID operations.

| Field          | Type         | Description                   |
| -------------- | ------------ | ----------------------------- |
| `did`          | `string`     | Associated DID                |
| `privateKey`   | `Uint8Array` | Raw private key bytes         |
| `publicKey`    | `Uint8Array` | Raw public key bytes          |
| `publicKeyHex` | `string`     | Public key as lowercase hex   |

### Covenant (Behavioral Spec)

#### `CovenantEffect`

```typescript
type CovenantEffect = 'permit' | 'forbid';
```

#### `ComparisonOperator`

```typescript
type ComparisonOperator = '>' | '<' | '>=' | '<=' | '==' | '!=';
```

#### `CovenantCondition`

A condition attached to a covenant statement.

| Field      | Type                          | Description               |
| ---------- | ----------------------------- | ------------------------- |
| `field`    | `string`                      | Field name to evaluate    |
| `operator` | `ComparisonOperator`          | Comparison operator       |
| `value`    | `string \| number \| boolean` | Value to compare against  |

#### `CovenantRequirement`

A require clause in a covenant.

| Field      | Type                          | Description               |
| ---------- | ----------------------------- | ------------------------- |
| `field`    | `string`                      | Field name to evaluate    |
| `operator` | `ComparisonOperator`          | Comparison operator       |
| `value`    | `string \| number \| boolean` | Value to compare against  |

#### `CovenantStatement`

A single statement in a covenant spec.

| Field        | Type                           | Description        |
| ------------ | ------------------------------ | ------------------ |
| `effect`     | `CovenantEffect`               | permit or forbid   |
| `action`     | `string`                       | Action name        |
| `conditions` | `readonly CovenantCondition[]`  | Attached conditions|

#### `CovenantSpec`

A parsed covenant specification.

| Field          | Type                              | Description         |
| -------------- | --------------------------------- | ------------------- |
| `name`         | `string`                          | Covenant name       |
| `statements`   | `readonly CovenantStatement[]`    | Permit/forbid rules |
| `requirements` | `readonly CovenantRequirement[]`  | Require clauses     |

#### `SignedCovenant`

A signed covenant document binding an issuer and subject.

| Field        | Type                  | Description               |
| ------------ | --------------------- | ------------------------- |
| `id`         | `string`              | Unique identifier         |
| `spec`       | `CovenantSpec`        | The covenant specification|
| `issuerDid`  | `string`              | Issuer's DID              |
| `subjectDid` | `string`              | Subject's DID             |
| `issuedAt`   | `string`              | ISO 8601 issuance time    |
| `expiresAt`  | `string \| null`      | Expiration or null        |
| `signature`  | `string`              | Cryptographic signature   |
| `nonce`      | `string`              | Replay protection nonce   |

### Attestation (Verifiable Credential)

#### `VCProof`

W3C Verifiable Credential proof.

#### `CovenantAttestation`

W3C Verifiable Credential wrapping a signed covenant.

### Action Log

#### `ActionLogEntry`

A single entry in the hash-chained action log.

| Field          | Type                                    | Description              |
| -------------- | --------------------------------------- | ------------------------ |
| `index`        | `number`                                | Sequential index         |
| `timestamp`    | `string`                                | ISO 8601 timestamp       |
| `agentDid`     | `string`                                | Agent's DID              |
| `action`       | `string`                                | Action name              |
| `resource`     | `string`                                | Target resource          |
| `params`       | `Record<string, unknown>`               | Action parameters        |
| `outcome`      | `'success' \| 'failure' \| 'blocked'`   | Action outcome           |
| `previousHash` | `string \| null`                        | Previous entry's hash    |
| `hash`         | `string`                                | SHA-256 hash of entry    |

#### `ActionLog`

A complete, verifiable action log.

| Field       | Type                          | Description            |
| ----------- | ----------------------------- | ---------------------- |
| `agentDid`  | `string`                      | Agent's DID            |
| `entries`   | `readonly ActionLogEntry[]`   | All log entries        |
| `rootHash`  | `string \| null`              | First entry's hash     |
| `headHash`  | `string \| null`              | Last entry's hash      |
| `length`    | `number`                      | Entry count            |

### Verification

#### `Violation` -- A single violation found during verification.

#### `VerificationResult` -- Result of verifying a covenant against an action log.

#### `MerkleProofNode` -- A node in a Merkle proof (`hash` + `direction`).

#### `MerkleProof` -- A Merkle proof for a specific action log entry.

### Enforcement

#### `EnforcementAction`

```typescript
type EnforcementAction = 'block' | 'allow' | 'flag';
```

#### `EnforcementDecision` -- Result of evaluating an action through enforcement middleware.

#### `StakeConfig` -- Configuration for staking-based enforcement.

#### `SlashEvent` -- A slashing event triggered by a covenant breach.

### Utility Types

#### `HexString` -- A hex-encoded string (lowercase).

#### `ISOTimestamp` -- An ISO 8601 timestamp string.

## License

MIT
