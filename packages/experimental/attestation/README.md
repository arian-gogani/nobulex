# @nobulex/attestation

Attestation generation and verification for the Nobulex covenant framework.

## Install

```bash
npm install @nobulex/attestation
```

## Usage

```typescript
import { createAttestation, verifyAttestation } from "@nobulex/attestation";

const attestation = await createAttestation(evidence);
const valid = await verifyAttestation(attestation);
```

## Learn More

[nobulex.com](https://nobulex.com)
