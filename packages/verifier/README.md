# @nobulex/verifier

Standalone verification engine for third-party auditors.

## Install

```bash
npm install @nobulex/verifier
```

## Usage

```typescript
import { Verifier } from "@nobulex/verifier";

const verifier = new Verifier();
const result = await verifier.verify(covenant, evidence);
console.log(result.valid);
```

## Learn More

[nobulex.com](https://nobulex.com)
