# @nobulex/proof

Proof generation and verification for the Nobulex covenant framework.

## Install

```bash
npm install @nobulex/proof
```

## Usage

```typescript
import { generateProof, verifyProof } from "@nobulex/proof";

const proof = await generateProof(evidence, covenant);
const valid = await verifyProof(proof);
```

## Learn More

[nobulex.com](https://nobulex.com)
