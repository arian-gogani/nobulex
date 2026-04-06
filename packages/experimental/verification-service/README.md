# @nobulex/verification-service

Hosted verification API — verify covenants via HTTP.

## Install

```bash
npm install @nobulex/verification-service
```

## Usage

```typescript
import { createVerificationService } from "@nobulex/verification-service";

const service = createVerificationService({ port: 3000 });
await service.start();
```

## Learn More

[nobulex.com](https://nobulex.com)
