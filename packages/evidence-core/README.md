# @nobulex/evidence-core

Evidence item data structure — signed hash-chained records of AI agent actions.

## Install

```bash
npm install @nobulex/evidence-core
```

## Usage

```typescript
import { createEvidenceItem, chainEvidence } from "@nobulex/evidence-core";

const item = createEvidenceItem(action, identity);
const chain = chainEvidence([item]);
```

## Learn More

[nobulex.com](https://nobulex.com)
