# @nobulex/c2pa

C2PA content provenance manifests — cryptographic proof of AI agent output creation history.

## Install

```bash
npm install @nobulex/c2pa
```

## Usage

```typescript
import { createManifest, embedProvenance } from "@nobulex/c2pa";

const manifest = createManifest(agentOutput);
const signed = await embedProvenance(manifest);
```

## Learn More

[nobulex.com](https://nobulex.com)
