# @nobulex/rail

Guardrails and safety rails for AI agent actions within the Nobulex framework.

## Install

```bash
npm install @nobulex/rail
```

## Usage

```typescript
import { applyRails } from "@nobulex/rail";

const guarded = applyRails(agent, { maxTokens: 1000, noExternalCalls: true });
```

## Learn More

[nobulex.com](https://nobulex.com)
