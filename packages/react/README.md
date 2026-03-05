# @nobulex/react

React hooks and reactive primitives for Nobulex-powered UIs.

## Install

```bash
npm install @nobulex/react
```

## Usage

```typescript
import { useCovenant, useVerification } from "@nobulex/react";

function AgentStatus({ agentId }) {
  const { covenant, loading } = useCovenant(agentId);
  const { verified } = useVerification(covenant);
  return <div>{verified ? "Verified" : "Pending"}</div>;
}
```

## Learn More

[nobulex.com](https://nobulex.com)
