# @nobulex/norms

Normative reasoning and behavioral norms for AI agents in the Nobulex framework.

## Install

```bash
npm install @nobulex/norms
```

## Usage

```typescript
import { defineNorm, evaluateNorm } from "@nobulex/norms";

const norm = defineNorm({ principle: "data-minimization" });
const compliant = evaluateNorm(norm, agentAction);
```

## Learn More

[nobulex.com](https://nobulex.com)
