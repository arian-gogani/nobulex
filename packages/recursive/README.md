# @nobulex/recursive

Recursive covenant verification for nested and delegated agent interactions.

## Install

```bash
npm install @nobulex/recursive
```

## Usage

```typescript
import { verifyRecursive } from "@nobulex/recursive";

const result = await verifyRecursive(rootCovenant, agentTree);
console.log(result.allCompliant);
```

## Learn More

[nobulex.com](https://nobulex.com)
