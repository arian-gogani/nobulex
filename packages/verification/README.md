# @nobulex/verification

Post-hoc covenant verification with Merkle proofs. Provides the deterministic function `verify(covenant, actionLog) -> VerificationResult` that checks every action log entry against covenant rules and requirements, producing a list of violations with cryptographic proofs.

Given the same covenant and log, `verify` always produces the same result.

## Installation

```bash
npm install @nobulex/verification
```

**Requirements:** Node.js >= 18

**Dependencies:** `@nobulex/core-types`, `@nobulex/covenant-lang`, `@nobulex/action-log`, `@nobulex/crypto`

## Quick Usage

```typescript
import { verify, verifyWithProofs, verifyBatch, proveViolation } from '@nobulex/verification';
import { parseSource } from '@nobulex/covenant-lang';
import { ActionLogBuilder } from '@nobulex/action-log';

const spec = parseSource(`
  covenant SafeAgent {
    permit read;
    forbid delete;
  }
`);

// Build an action log (simulating some actions that bypassed middleware)
const builder = new ActionLogBuilder('did:nobulex:agent-1');
builder.append({ action: 'read', resource: '/data', params: {}, outcome: 'success' });
builder.append({ action: 'delete', resource: '/data', params: {}, outcome: 'success' });
const log = builder.toLog();

// Verify compliance
const result = verify(spec, log);
console.log(result.compliant);           // false
console.log(result.violations.length);   // 1
console.log(result.violations[0].action); // 'delete'
console.log(result.violations[0].reason); // describes the forbid rule match
```

## API Reference

### Functions

#### `verify(spec: CovenantSpec, log: ActionLog, options?: VerifyOptions): VerificationResult`

Verify a covenant against an action log. This is the core deterministic verification function.

Checks each executed action log entry (skipping `'blocked'` entries) against the covenant's forbid rules and requirements.

```typescript
const result = verify(spec, log);
if (!result.compliant) {
  for (const v of result.violations) {
    console.log(`Entry ${v.entryIndex}: ${v.reason}`);
  }
}
```

**Options:**

| Option                | Type      | Default | Description                              |
| --------------------- | --------- | ------- | ---------------------------------------- |
| `includeMerkleProofs` | `boolean` | `true`  | Whether to compute the Merkle root       |
| `verifyLogIntegrity`  | `boolean` | `true`  | Whether to verify hash-chain integrity first |

#### `proveViolation(log: ActionLog, violation: Violation): MerkleProof`

Generate a Merkle inclusion proof for a specific violation. The proof can be independently verified to confirm the violating entry exists in the log.

```typescript
const result = verify(spec, log);
for (const v of result.violations) {
  const proof = proveViolation(log, v);
  console.log('Merkle root:', proof.root);
  console.log('Entry hash:', proof.entryHash);
}
```

#### `verifyWithProofs(spec: CovenantSpec, log: ActionLog): { result: VerificationResult; proofs: Map<number, MerkleProof> }`

Verify a covenant against an action log and return Merkle proofs for every violation. Combines `verify` and `proveViolation` in a single call.

```typescript
const { result, proofs } = verifyWithProofs(spec, log);

if (!result.compliant) {
  for (const [entryIndex, proof] of proofs) {
    console.log(`Violation at entry ${entryIndex}, proof root: ${proof.root}`);
  }
}
```

#### `verifyBatch(specs: readonly CovenantSpec[], log: ActionLog): Map<string, VerificationResult>`

Verify multiple covenants against a single action log. Returns a map of covenant name to `VerificationResult`.

```typescript
const specA = parseSource('covenant A { forbid delete; }');
const specB = parseSource('covenant B { forbid transfer (amount > 1000); }');

const results = verifyBatch([specA, specB], log);
for (const [name, result] of results) {
  console.log(`${name}: ${result.compliant ? 'compliant' : 'non-compliant'}`);
}
```

### Interfaces

#### `VerifyOptions`

Configuration for the `verify` function.

| Field                 | Type      | Default | Description                               |
| --------------------- | --------- | ------- | ----------------------------------------- |
| `includeMerkleProofs` | `boolean` | `true`  | Compute Merkle root for the log           |
| `verifyLogIntegrity`  | `boolean` | `true`  | Verify hash-chain integrity before checking rules |

### Re-exported Types (from `@nobulex/core-types`)

- `Violation` -- A single violation found during verification.
  - `entryIndex: number`
  - `action: string`
  - `resource: string`
  - `rule: CovenantStatement | CovenantRequirement`
  - `reason: string`
  - `timestamp: string`

- `VerificationResult` -- Full result of verification.
  - `compliant: boolean`
  - `covenantId: string`
  - `agentDid: string`
  - `totalActions: number`
  - `violations: readonly Violation[]`
  - `checkedAt: string`
  - `merkleRoot: string | null`

- `MerkleProof` -- Merkle inclusion proof for an entry.
  - `entryIndex: number`
  - `entryHash: string`
  - `proof: readonly MerkleProofNode[]`
  - `root: string`

## Verification Flow

```
1. Verify log integrity (hash chain)
2. Build Merkle tree from entry hashes
3. For each executed entry:
   a. Compile covenant to enforcement function
   b. Evaluate entry against covenant rules
   c. If blocked by a forbid rule -> record violation
4. Return VerificationResult with all violations
```

Entries with outcome `'blocked'` are skipped because they were already enforced by middleware and never executed.

## License

MIT
