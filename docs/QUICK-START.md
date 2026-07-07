# Quick Start  - 30 Minutes to Your First Verified Covenant

Get from zero to a signed, verified covenant in under 30 minutes.

---

## Prerequisites

- Node.js 18+
- npm 9+

---

## Fastest Path: MCP Server (5 min)

Run the Nobulex MCP server and wire it into your MCP client:

```bash
npm install -g @nobulex/mcp-server
npx nobulex-mcp
```

Client config (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "nobulex": { "command": "npx", "args": ["nobulex-mcp"] }
  }
}
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
import { NobulexClient } from '@nobulex/sdk';

const client = new NobulexClient();
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

const store = new FileStore({ basePath: './nobulex-data' });
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

Use the CLI to produce a compliance report from a saved action log:

```bash
npx @nobulex/cli report ./action-log.json --framework eu-ai-act-article-12
```

Supported frameworks: `eu-ai-act-article-12`, `colorado-ai-act`, `soc2`,
`iso-42001`. The report is derived from the signed, hash-chained log, so it
reflects what the agent actually did, not a self-asserted summary.

---

## You're Done

You now have:

- A signed covenant with CCL constraints
- Verification (specification checks)
- Action evaluation
- Persistence
- Canary validation
- A compliance report tied to a verifiable action log

**Next:** See [docs/README.md](./README.md) for the full doc index, [architecture.md](./architecture.md) for the protocol, or [eu-ai-act-mapping.md](./eu-ai-act-mapping.md) for EU AI Act compliance.
