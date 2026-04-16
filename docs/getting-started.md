# Getting Started with Nobulex

## Overview

Nobulex is a TypeScript protocol for adding **cryptographic behavioral accountability** to AI agents. It lets you define what an agent is allowed to do (as a formal covenant), enforce those rules at runtime, record every action in a tamper-evident log, and verify compliance after the fact with Merkle proofs suitable for on-chain evidence.

This guide walks through the core workflow: creating an agent identity, writing a covenant, enforcing it with middleware, building an action log, verifying compliance, and checking covenant compatibility across agents.

## Prerequisites

- Node.js >= 18
- npm or yarn

## Installation

Install the individual packages you need:

```bash
npm install @nobulex/core-types @nobulex/identity @nobulex/covenant-lang @nobulex/action-log @nobulex/middleware @nobulex/verification
```

Or install the SDK, which re-exports everything from a single entry point:

```bash
npm install @nobulex/sdk
```

For multi-agent composability analysis:

```bash
npm install @nobulex/core
```

For TEE attestation and on-chain contract bindings:

```bash
npm install @nobulex/tee @nobulex/contracts
```

---

## Step 1: Create an Agent Identity (DID)

Every agent in the Nobulex protocol is identified by a **Decentralized Identifier** (DID) using the `did:nobulex:` method. Under the hood, this generates an Ed25519 key pair and derives the DID from the public key hash.

```typescript
import { createDID } from '@nobulex/identity';

const agent = await createDID();

console.log(agent.did);           // did:nobulex:a3b8f1c9e2d04567...
console.log(agent.publicKeyHex);  // 64-character hex public key
console.log(agent.document.id);   // same as agent.did
```

The returned `DIDKeyPair` contains:

| Field           | Type           | Description                              |
|-----------------|----------------|------------------------------------------|
| `did`           | `string`       | The `did:nobulex:...` identifier         |
| `document`      | `DIDDocument`  | Full W3C DID Document                    |
| `privateKey`    | `Uint8Array`   | Ed25519 private key (keep secret)        |
| `publicKey`     | `Uint8Array`   | Ed25519 public key                       |
| `publicKeyHex`  | `string`       | Hex-encoded public key                   |

The DID Document follows the W3C DID specification and includes an `Ed25519VerificationKey2020` verification method. You can sign and verify arbitrary messages with the DID:

```typescript
import { signWithDID, verifyWithDID } from '@nobulex/identity';

const signature = await signWithDID('hello world', agent);
const valid = await verifyWithDID('hello world', signature, agent.document);
console.log(valid); // true
```

---

## Step 2: Write a Covenant in the DSL

Covenants are behavioral specifications written in a Cedar-inspired domain-specific language. The syntax supports three kinds of statements:

- **`permit action`** -- Allow an action (optionally with a condition)
- **`forbid action`** -- Block an action (optionally with a condition)
- **`require field op value`** -- Require a parameter constraint for all actions

The general structure is:

```
covenant Name {
  permit action;
  permit action (field op value);
  forbid action;
  forbid action (field op value);
  require dotted.field op value;
}
```

Here is a complete example:

```typescript
import { parseSource, compile, serialize } from '@nobulex/covenant-lang';

const source = `
  covenant SafeTrader {
    permit read;
    permit transfer (amount <= 500);
    forbid transfer (amount > 500);
    forbid delete;
    require counterparty.compliance_score >= 0.8;
  }
`;

const spec = parseSource(source);
console.log(spec.name);          // 'SafeTrader'
console.log(spec.statements);    // Array of permit and forbid rules
console.log(spec.requirements);  // Array of require clauses
```

### DSL Semantics: Forbid Wins

The covenant compiler uses **forbid-wins** evaluation semantics:

1. Check all `forbid` rules first -- if any match the action and its conditions, **block**.
2. Check all `permit` rules -- if any match, check `require` clauses, then **allow**.
3. If no rules match, **block** (default deny).

This means a `forbid` rule always takes precedence over a `permit` rule for the same action.

### Compiling and Serializing

You can compile a `CovenantSpec` into a stateless enforcement function, or serialize it back to DSL source:

```typescript
const enforce = compile(spec);

const decision = enforce({ action: 'transfer', params: { amount: 600 } });
console.log(decision.action); // 'block'
console.log(decision.reason); // "Action 'transfer' is forbidden by covenant 'SafeTrader'"

// Round-trip: serialize back to DSL source
const dslText = serialize(spec);
console.log(dslText);
// covenant SafeTrader {
//   permit read;
//   permit transfer (amount <= 500);
//   forbid transfer (amount > 500);
//   forbid delete;
//   require counterparty.compliance_score >= 0.8;
// }
```

### Step-by-Step Parsing

If you need finer control, you can tokenize and parse separately:

```typescript
import { tokenize, parse } from '@nobulex/covenant-lang';

const tokens = tokenize(source);
const spec = parse(tokens);
```

---

## Step 3: Enforce a Covenant with Middleware

The `EnforcementMiddleware` wraps action handlers, blocking forbidden actions before they execute and logging every decision (allowed or blocked) into an action log automatically.

```typescript
import { EnforcementMiddleware } from '@nobulex/middleware';
import { parseSource } from '@nobulex/covenant-lang';

const spec = parseSource(`
  covenant SafeTrader {
    permit read;
    permit transfer (amount <= 500);
    forbid transfer (amount > 500);
    forbid delete;
    require counterparty.compliance_score >= 0.8;
  }
`);

const mw = new EnforcementMiddleware({
  agentDid: agent.did,
  spec: spec,
});

// Attempt a $300 transfer -- allowed
const result1 = await mw.execute(
  { action: 'transfer', params: { amount: 300, counterparty: { compliance_score: 0.9 } } },
  async (ctx) => {
    // This handler runs because the action is permitted
    return { success: true };
  }
);
console.log(result1.decision.action); // 'allow'
console.log(result1.executed);        // true

// Attempt a $600 transfer -- blocked!
const result2 = await mw.execute(
  { action: 'transfer', params: { amount: 600 } },
  async (ctx) => {
    // This handler never runs because the action is forbidden
    return { success: true };
  }
);
console.log(result2.decision.action); // 'block'
console.log(result2.executed);        // false

// Dry-run check without executing
const check = mw.check({ action: 'delete', params: {} });
console.log(check.action); // 'block'
console.log(check.reason); // "Action 'delete' is forbidden by covenant 'SafeTrader'"
```

### Convenience Constructors

You can also create middleware directly from DSL source text:

```typescript
import { createMiddleware } from '@nobulex/middleware';

const mw = createMiddleware(agent.did, `
  covenant Safe {
    permit read;
    forbid delete;
  }
`);
```

### Retrieving the Log from Middleware

The middleware automatically maintains an action log:

```typescript
const log = mw.getLog();
console.log(log.length);     // number of actions processed
console.log(mw.actionCount); // same count via accessor
```

---

## Step 4: Build an Action Log

If you need to construct an action log manually (for example, when recording actions from an agent that does not use the middleware), use the `ActionLogBuilder`:

```typescript
import { ActionLogBuilder, verifyIntegrity } from '@nobulex/action-log';

const builder = new ActionLogBuilder(agent.did);

builder.append({
  action: 'transfer',
  resource: '/accounts',
  params: { amount: 300, to: 'did:nobulex:recipient123' },
  outcome: 'success',
});

builder.append({
  action: 'read',
  resource: '/balance',
  params: {},
  outcome: 'success',
});

const log = builder.toLog();
console.log(log.length);    // 2
console.log(log.rootHash);  // SHA-256 hash of the first entry
console.log(log.headHash);  // SHA-256 hash of the latest entry
```

Each entry in the log is hash-chained to the previous entry via `previousHash`, forming a tamper-evident append-only chain. You can verify the entire chain at any time:

```typescript
const integrity = verifyIntegrity(log);
console.log(integrity.valid);  // true
console.log(integrity.errors); // [] (empty when valid)
```

### Merkle Trees and Proofs

Action logs support Merkle trees for compact, independently verifiable proofs of individual entries:

```typescript
import { buildMerkleTree, generateMerkleProof, verifyMerkleProof } from '@nobulex/action-log';

// Build a Merkle tree from all entry hashes
const hashes = log.entries.map(e => e.hash);
const tree = buildMerkleTree(hashes);
console.log(tree.root); // Merkle root hash

// Generate a proof for entry 0
const proof = generateMerkleProof(log, 0);
console.log(proof.root);      // same as tree.root
console.log(proof.entryHash); // hash of entry 0

// Verify the proof independently
const proofValid = verifyMerkleProof(proof);
console.log(proofValid); // true
```

---

## Step 5: Verify Compliance

The verification module checks every action in a log against the covenant rules, producing a deterministic result. Given the same covenant and log, `verify()` always returns the same result.

```typescript
import { verify, verifyWithProofs } from '@nobulex/verification';

// Basic verification
const result = verify(spec, log);
console.log(result.compliant);    // true (no violations)
console.log(result.totalActions); // 2
console.log(result.violations);   // []
console.log(result.merkleRoot);   // Merkle root of the action log
```

### Verification with Merkle Proofs

For on-chain evidence, use `verifyWithProofs()` to get a Merkle proof for each violation:

```typescript
const { result: r, proofs } = verifyWithProofs(spec, log);
console.log(r.compliant);   // true
console.log(r.merkleRoot);  // Merkle root of the action log
console.log(proofs.size);   // 0 (no violations, so no proofs)
```

### When Violations Occur

If an agent bypasses the middleware and logs a forbidden action, verification catches it:

```typescript
// Simulate a rogue agent that bypassed middleware and performed a forbidden action
const rogueBuilder = new ActionLogBuilder(agent.did);

rogueBuilder.append({
  action: 'delete',
  resource: '/important-data',
  params: {},
  outcome: 'success',  // The agent actually did it
});

rogueBuilder.append({
  action: 'transfer',
  resource: '/accounts',
  params: { amount: 9999 },
  outcome: 'success',  // Over the $500 limit
});

const rogueLog = rogueBuilder.toLog();
const rogueResult = verify(spec, rogueLog);

console.log(rogueResult.compliant);          // false
console.log(rogueResult.violations.length);  // 2
console.log(rogueResult.violations[0].action);  // 'delete'
console.log(rogueResult.violations[0].reason);  // "Action 'delete' is forbidden by covenant 'SafeTrader'"
console.log(rogueResult.violations[1].action);  // 'transfer'
console.log(rogueResult.violations[1].reason);  // "Action 'transfer' is forbidden by covenant 'SafeTrader'"
```

You can also prove a specific violation with a Merkle proof:

```typescript
import { proveViolation } from '@nobulex/verification';

const violationProof = proveViolation(rogueLog, rogueResult.violations[0]);
console.log(violationProof.entryIndex); // 0
console.log(verifyMerkleProof(violationProof)); // true
```

### Batch Verification

Verify multiple covenants against a single log at once:

```typescript
import { verifyBatch } from '@nobulex/verification';

const specA = parseSource('covenant A { permit read; forbid write; }');
const specB = parseSource('covenant B { permit read; permit write; }');

const results = verifyBatch([specA, specB], log);
console.log(results.get('A')?.compliant); // depends on log contents
console.log(results.get('B')?.compliant); // depends on log contents
```

---

## Step 6: Check Covenant Compatibility (Optional)

When multiple agents need to collaborate, you can check whether their covenants are compatible -- that is, whether they have conflicting rules for the same actions.

```typescript
import { checkCompatibility, findCompatibleAgents } from '@nobulex/core';

const specA = parseSource('covenant Reader { permit read; forbid write; }');
const specB = parseSource('covenant Writer { permit write; forbid delete; }');

const compat = checkCompatibility(specA, specB);
console.log(compat.compatible);    // true (no conflicting rules on same actions)
console.log(compat.score);         // 0..1 compatibility score
console.log(compat.conflicts);     // [] (empty when compatible)
console.log(compat.overlapActions); // [] (no shared actions)
```

When there is a conflict:

```typescript
const specX = parseSource('covenant Permitter { permit transfer; }');
const specY = parseSource('covenant Blocker { forbid transfer; }');

const conflict = checkCompatibility(specX, specY);
console.log(conflict.compatible);              // false
console.log(conflict.conflicts.length);        // 1
console.log(conflict.conflicts[0].action);     // 'transfer'
console.log(conflict.conflicts[0].reason);     // Describes the permit vs. forbid conflict
```

### Finding Compatible Agents

Search a pool of agents for those whose covenants are compatible with a target:

```typescript
const agents = [
  { did: 'did:nobulex:agent1', covenant: specA, capabilities: ['read'] },
  { did: 'did:nobulex:agent2', covenant: specB, capabilities: ['write'] },
];

const matches = findCompatibleAgents(specA, agents, 0.5); // minScore = 0.5
for (const match of matches) {
  console.log(match.agent.did, match.compatibility.score);
}
```

### Trust Topology Analysis

Analyze the trust graph across a set of agents:

```typescript
import { analyzeTopology } from '@nobulex/core';

const topology = analyzeTopology(agents, 0.5);
console.log(topology.nodes);         // all agent DIDs
console.log(topology.edges);         // compatibility edges
console.log(topology.clusters);      // connected components
console.log(topology.density);       // graph density (0..1)
console.log(topology.isolatedNodes); // agents with no compatible peers
```

### Merging Covenants

Combine two covenants into a single merged spec:

```typescript
import { mergeCovenants } from '@nobulex/core';

const merged = mergeCovenants(specA, specB, 'ReaderWriter');
console.log(merged.name);        // 'ReaderWriter'
console.log(merged.statements);  // combined statements from both
```

---

## Step 7: Putting It All Together

Here is a full end-to-end example that creates two agents, writes a covenant, enforces it with middleware, and verifies compliance:

```typescript
import { createDID, signWithDID, verifyWithDID } from '@nobulex/identity';
import { parseSource, compile, serialize } from '@nobulex/covenant-lang';
import { EnforcementMiddleware } from '@nobulex/middleware';
import { ActionLogBuilder, verifyIntegrity } from '@nobulex/action-log';
import { verify, verifyWithProofs } from '@nobulex/verification';
import { checkCompatibility } from '@nobulex/core';

async function main() {
  // ── Step 1: Create two agent identities ──
  const operator = await createDID();
  const trader = await createDID();
  console.log('Operator DID:', operator.did);
  console.log('Trader DID:', trader.did);

  // ── Step 2: Define the covenant ──
  const covenantSource = `
    covenant TradingPolicy {
      permit read;
      permit transfer (amount <= 1000);
      forbid transfer (amount > 1000);
      forbid delete;
      require counterparty.trust_score >= 0.7;
    }
  `;
  const spec = parseSource(covenantSource);
  console.log('Covenant:', spec.name);
  console.log('Rules:', spec.statements.length, 'statements,', spec.requirements.length, 'requirements');

  // ── Step 3: Set up enforcement middleware for the trader ──
  const mw = new EnforcementMiddleware({
    agentDid: trader.did,
    spec,
  });

  // ── Step 4: Execute some actions ──
  // Allowed: read
  await mw.execute(
    { action: 'read', params: { counterparty: { trust_score: 0.9 } } },
    async () => ({ data: 'market prices' })
  );

  // Allowed: transfer $500
  await mw.execute(
    { action: 'transfer', params: { amount: 500, counterparty: { trust_score: 0.8 } } },
    async () => ({ txId: 'tx_001' })
  );

  // Blocked: transfer $5000
  const blocked = await mw.execute(
    { action: 'transfer', params: { amount: 5000 } },
    async () => ({ txId: 'tx_002' })
  );
  console.log('$5000 transfer blocked:', !blocked.executed); // true

  // Blocked: delete
  const deleteResult = await mw.execute(
    { action: 'delete', params: {} },
    async () => 'deleted'
  );
  console.log('Delete blocked:', !deleteResult.executed); // true

  // ── Step 5: Retrieve and verify the action log ──
  const log = mw.getLog();
  console.log('Total actions logged:', log.length); // 4 (2 allowed + 2 blocked)

  const integrity = verifyIntegrity(log);
  console.log('Log integrity:', integrity.valid); // true

  // ── Step 6: Verify compliance ──
  const result = verify(spec, log);
  console.log('Compliant:', result.compliant); // true (blocked actions don't count as violations)
  console.log('Violations:', result.violations.length); // 0

  // ── Step 7: Sign the result with the operator's DID ──
  const resultJson = JSON.stringify(result);
  const signature = await signWithDID(resultJson, operator);
  const verified = await verifyWithDID(resultJson, signature, operator.document);
  console.log('Operator signature valid:', verified); // true

  // ── Step 8: Check compatibility with another agent's covenant ──
  const otherSpec = parseSource(`
    covenant AuditorPolicy {
      permit read;
      forbid write;
      forbid transfer;
    }
  `);
  const compat = checkCompatibility(spec, otherSpec);
  console.log('Compatible with auditor:', compat.compatible);
  console.log('Compatibility score:', compat.score);
  if (compat.conflicts.length > 0) {
    console.log('Conflicts:', compat.conflicts.map(c => `${c.action}: ${c.reason}`));
  }
}

main().catch(console.error);
```

---

## Next Steps

- Read the [White Paper](./whitepaper.md) for the formal protocol specification
- Explore the [CLI](../packages/cli/) for command-line covenant management
- Check out the [ElizaOS Plugin](../packages/elizaos-plugin/) for agent framework integration
- See the [Demo](../demo/covenant-demo.ts) for a runnable example

---

## API Reference

Each package has its own detailed API documentation:

| Package | Description |
|---------|-------------|
| [`@nobulex/core-types`](../packages/core-types/) | TypeScript interfaces for the six covenant primitives |
| [`@nobulex/identity`](../packages/identity/) | DID creation (`did:nobulex:` method), Ed25519 keys, signing/verification |
| [`@nobulex/covenant-lang`](../packages/covenant-lang/) | Cedar-inspired DSL: `tokenize()`, `parse()`, `compile()`, `serialize()`, `parseSource()` |
| [`@nobulex/action-log`](../packages/action-log/) | `ActionLogBuilder`, `verifyIntegrity()`, Merkle tree operations |
| [`@nobulex/middleware`](../packages/middleware/) | `EnforcementMiddleware` class with `execute()`, `check()`, `getLog()` |
| [`@nobulex/verification`](../packages/verification/) | `verify()`, `verifyWithProofs()`, `verifyBatch()`, `proveViolation()` |
| [`@nobulex/core`](../packages/core/) | `checkCompatibility()`, `findCompatibleAgents()`, `mergeCovenants()`, `analyzeTopology()` |
| [`@nobulex/tee`](../packages/tee/) | TEE attestation: `generateQuote()`, `verifyAttestation()`, `bindEnclaveToDID()`, `TEERegistry` |
| [`@nobulex/contracts`](../packages/contracts/) | `ContractSimulator`, `encodeRegisterCovenant()`, `encodeStake()`, `encodeSubmitViolation()`, Solidity sources |
| [`@nobulex/sdk`](../packages/sdk/) | High-level SDK re-exporting all packages plus `CovenantAgent` and `NobulexClient` |
