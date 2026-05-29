# @nobulex/sdk

High-level TypeScript SDK for embedding Nobulex into agent frameworks and apps.
The fastest way to put a verifiable behavioral covenant around an agent.

## Install

```bash
npm install @nobulex/sdk
```

## Usage

```typescript
import { protect } from "@nobulex/sdk";

// Wrap an agent in a signed, verifiable covenant in one call
const guard = await protect({
  name: "support-agent",
  rules: ["read-only", "no-data-exfiltration", "eu-ai-act"],
});

console.log(guard.id);              // covenant id
console.log(await guard.verify());  // { valid: true, checks: [...] }
```

`rules` accepts friendly presets (`read-only`, `no-data-leak`,
`no-external-calls`, `no-code-execution`, `eu-ai-act`, `hipaa`),
shorthands (`budget-cap:500`, `rate-limit:100`), or raw CCL
(`permit read on '/data/**'`).

## Lower-level client

```typescript
import { NobulexClient } from "@nobulex/sdk";

const client = new NobulexClient();
// build, sign, store, and verify covenants with full control
```

## Learn More

[github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex) · [nobulex.com](https://nobulex.com)
