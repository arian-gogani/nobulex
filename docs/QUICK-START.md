# Quickstart: Verified Covenant in 5 minutes (MCP in 60 seconds)

Get from zero to a signed, verified covenant in under 30 minutes.

---

## Prerequisites

- Node.js 18+
- npm 9+

---

## Fastest Path: MCP Server (5 min)

For MCP servers, use the `kova` package:

```bash
npm install kova
```

```typescript
import { withKova } from 'kova';

const server = await withKova(yourMCPServer, 'data-isolation');
// Done. Covenant enforcement is active.
```

---

## Full Path: Custom Covenant (30 min)

### Step 1: Install (2 min)

```bash
npm install @nobulex/sdk
```

---

## Step 2: Create a Covenant (5 min)

```typescript
import { SteleClient } from '@nobulex/sdk';

const client = new SteleClient();
await client.generateKeyPair();

const covenant = await client.createCovenant({
  issuer: {
    id: 'operator-1',
    publicKey: client.keyPair!.publicKeyHex,
    role: 'issuer',
  },
  beneficiary: {
    id: 'user-1',
    publicKey: '0'.repeat(64), // placeholder; use real key in production
    role: 'beneficiary',
  },
  constraints: `
    permit read on '/data/**'
    deny write on '/system/**'
    limit api.call 100 per 3600 seconds
  `,
});

console.log('Covenant created:', covenant.id);
```

---

## Step 3: Verify (2 min)

```typescript
const result = await client.verifyCovenant(covenant);
console.log('Valid:', result.valid);
console.log('Checks:', result.checks);
```

---

## Step 4: Evaluate Actions (5 min)

```typescript
const readEval = await client.evaluateAction(covenant, 'read', '/data/file.txt');
console.log('Read permitted:', readEval.permitted); // true

const writeEval = await client.evaluateAction(covenant, 'write', '/system/config');
console.log('Write permitted:', writeEval.permitted); // false
```

---

## Step 5: Persist and Query (5 min)

```typescript
import { FileStore } from '@nobulex/store';

const store = new FileStore({ basePath: './stele-data' });
await store.saveCovenant(covenant);

const loaded = await store.loadCovenant(covenant.id);
console.log('Loaded:', loaded?.id === covenant.id);
```

---

## Step 6: Run a Canary Test (5 min)

Probe covenant boundaries with synthetic challenges using `evaluateAction`:

```typescript
const challenges = [
  { action: 'read', resource: '/data/ok.txt', expected: true },
  { action: 'write', resource: '/system/forbidden', expected: false },
];

let canaryPasses = 0;
for (const { action, resource, expected } of challenges) {
  const eval_ = await client.evaluateAction(covenant, action, resource);
  if (eval_.permitted === expected) canaryPasses++;
}

console.log('Canary passed:', canaryPasses === challenges.length);
```

---

## Step 7: Export for Compliance (5 min)

Wire real data from your covenant, store, and canary results:

```typescript
import { exportLegalPackage, computeSteleScore } from '@nobulex/legal';

// Build covenant history from store (or use loaded covenant)
const covenantHistory = [
  {
    id: covenant.id,
    constraints: covenant.constraints.split('\n').filter(Boolean),
    signedAt: new Date(covenant.createdAt).getTime(),
    status: 'active' as const,
  },
];

// Build compliance from canary results + your interaction counts
// In production: wire from enforcement monitor, breach tracker, attestation service
const compliance = {
  totalInteractions: 10,
  covenantedInteractions: 10,
  breaches: 0,
  canaryTests: challenges.length,
  canaryPasses,
  attestationCoverage: 0.9,
};

const reputation = {
  score: 0.95,
  tier: 'high',
  totalExecutions: 10,
  successRate: 1,
  timestamp: Date.now(),
};

const pkg = exportLegalPackage(
  'agent-1',
  'operator-1',
  {
    covenants: covenantHistory,
    compliance,
    reputation,
    attestations: [],
    insurance: [],
  },
  'json',
);

console.log('Package hash:', pkg.packageHash);

// Nobulex Score — multidimensional trust profile (computeSteleScore in @nobulex/legal)
const nobulexScore = computeSteleScore('agent-1', compliance, covenantHistory, {
  reputation,
});
console.log('Nobulex Score:', nobulexScore.composite, nobulexScore);
```

**Note:** `challenges` and `canaryPasses` come from Step 6. In production, wire `compliance` from your enforcement monitor, breach tracker, and attestation service.

---

## You're Done

You now have:

- A signed covenant with CCL constraints
- Verification (11 specification checks)
- Action evaluation
- Persistence
- Canary validation
- Legal export for compliance
- Nobulex Score (multidimensional trust profile)

**Next:** See [docs/README.md](./README.md) for the full doc index, [architecture.md](./architecture.md) for the protocol, or [eu-ai-act-mapping.md](./eu-ai-act-mapping.md) for EU AI Act compliance.
