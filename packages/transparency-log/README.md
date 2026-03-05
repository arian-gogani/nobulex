# @nobulex/transparency-log

Append-only transparency log for epoch Merkle roots — self-hosted or managed.

## Install

```bash
npm install @nobulex/transparency-log
```

## Usage

```typescript
import { TransparencyLog } from "@nobulex/transparency-log";

const log = new TransparencyLog({ storage: "self-hosted" });
await log.append(epochRoot);
const proof = await log.proveInclusion(epochRoot);
```

## Learn More

[nobulex.com](https://nobulex.com)
