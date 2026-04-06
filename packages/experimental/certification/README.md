# @nobulex/certification

Certification issuance and management for verified AI agent compliance.

## Install

```bash
npm install @nobulex/certification
```

## Usage

```typescript
import { issueCertification, verifyCertification } from "@nobulex/certification";

const cert = await issueCertification(agent, proofs);
const valid = await verifyCertification(cert);
```

## Learn More

[nobulex.com](https://nobulex.com)
