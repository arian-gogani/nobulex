# @nobulex/action-log

Hash-chained tamper-evident action log with Merkle proofs. Each entry is linked to the previous via SHA-256, forming an append-only chain that can be verified for integrity at any time.

This package provides the core data structure for recording agent actions in a way that is cryptographically tamper-evident and supports efficient Merkle inclusion proofs.

## Installation

```bash
npm install @nobulex/action-log
```

**Requirements:** Node.js >= 18

**Dependencies:** `@nobulex/core-types`, `@nobulex/crypto`

## Quick Usage

```typescript
import {
  ActionLogBuilder,
  verifyIntegrity,
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
} from '@nobulex/action-log';

// Build an action log
const builder = new ActionLogBuilder('did:nobulex:agent-1');

builder.append({
  action: 'read',
  resource: '/data/users',
  params: {},
  outcome: 'success',
});

builder.append({
  action: 'write',
  resource: '/data/users',
  params: { value: 42 },
  outcome: 'success',
});

const log = builder.toLog();
console.log(log.length); // 2

// Verify chain integrity
const integrity = verifyIntegrity(log);
console.log(integrity.valid); // true

// Generate and verify a Merkle proof
const proof = generateMerkleProof(log, 0);
console.log(verifyMerkleProof(proof)); // true
```

## API Reference

### Classes

#### `ActionLogBuilder`

Mutable builder for constructing an `ActionLog` incrementally. Automatically computes indices, previous hashes, and entry hashes.

```typescript
const builder = new ActionLogBuilder(agentDid: string);
```

**Properties:**

| Property   | Type     | Description                      |
| ---------- | -------- | -------------------------------- |
| `agentDid` | `string` | The agent DID this log belongs to|
| `length`   | `number` | Number of entries in the log     |

**Methods:**

##### `append(input): ActionLogEntry`

Append a new action to the log. Index, `previousHash`, and `hash` are computed automatically.

```typescript
const entry = builder.append({
  action: 'transfer',
  resource: '/accounts',
  params: { amount: 100 },
  outcome: 'success',
  timestamp?: '2025-01-01T00:00:00.000Z', // optional, defaults to now
});
```

##### `get(index: number): ActionLogEntry | undefined`

Get an entry by index.

##### `entries(): readonly ActionLogEntry[]`

Get all entries as a readonly array.

##### `toLog(): ActionLog`

Export the log as an immutable `ActionLog` object with computed `rootHash` and `headHash`.

### Functions

#### `computeEntryHash(entry: Omit<ActionLogEntry, 'hash'>): string`

Compute the SHA-256 hash for an action log entry. The hash covers all fields except `hash` itself (index, timestamp, agentDid, action, resource, params, outcome, previousHash).

```typescript
import { computeEntryHash } from '@nobulex/action-log';

const hash = computeEntryHash({
  index: 0,
  timestamp: '2025-01-01T00:00:00.000Z',
  agentDid: 'did:nobulex:agent-1',
  action: 'read',
  resource: '/data',
  params: {},
  outcome: 'success',
  previousHash: null,
});
```

#### `verifyIntegrity(log: ActionLog): { valid: boolean; errors: string[] }`

Verify the integrity of an action log. Performs four checks:

1. Each entry's hash matches its content.
2. Each entry's `previousHash` matches the prior entry's hash.
3. Indices are sequential starting from 0.
4. Timestamps are non-decreasing.

Also validates `rootHash`, `headHash`, and `length` consistency.

```typescript
const { valid, errors } = verifyIntegrity(log);
if (!valid) {
  console.error('Tampering detected:', errors);
}
```

#### `buildMerkleTree(hashes: readonly string[]): { root: string; layers: string[][] }`

Build a Merkle tree from an array of hash strings. Returns the root hash and all intermediate layers.

```typescript
const hashes = log.entries.map(e => e.hash);
const { root, layers } = buildMerkleTree(hashes);
```

#### `generateMerkleProof(log: ActionLog, entryIndex: number): MerkleProof`

Generate a Merkle inclusion proof for a specific entry in the log. Throws if `entryIndex` is out of range.

```typescript
const proof = generateMerkleProof(log, 0);
// proof contains: entryIndex, entryHash, proof (sibling nodes), root
```

#### `verifyMerkleProof(proof: MerkleProof): boolean`

Verify a Merkle proof by recomputing the root from the entry hash and sibling path.

```typescript
const isValid = verifyMerkleProof(proof);
console.log(isValid); // true
```

### Re-exported Types (from `@nobulex/core-types`)

- `ActionLogEntry` -- A single entry in the hash-chained action log.
- `ActionLog` -- A complete, verifiable action log.
- `MerkleProofNode` -- A node in a Merkle proof (hash + direction).
- `MerkleProof` -- A Merkle inclusion proof for a specific entry.

## How the Hash Chain Works

```
Entry 0: hash = SHA-256(index=0, ..., previousHash=null)
Entry 1: hash = SHA-256(index=1, ..., previousHash=Entry0.hash)
Entry 2: hash = SHA-256(index=2, ..., previousHash=Entry1.hash)
```

Any modification to a past entry invalidates all subsequent hashes, making tampering detectable.

## License

MIT
