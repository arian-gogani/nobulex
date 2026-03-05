# @nobulex/consensus

Consensus mechanisms for multi-party covenant agreement in the Nobulex framework.

## Install

```bash
npm install @nobulex/consensus
```

## Usage

```typescript
import { reachConsensus } from "@nobulex/consensus";

const agreement = await reachConsensus(parties, proposal);
console.log(agreement.accepted);
```

## Learn More

[nobulex.com](https://nobulex.com)
