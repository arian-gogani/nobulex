# @nobulex/revenue

Revenue distribution and per-verification toll model for covenant-governed services.

## Install

```bash
npm install @nobulex/revenue
```

## Usage

```typescript
import { configureToll, collectRevenue } from "@nobulex/revenue";

const toll = configureToll({ perVerification: 0.001 });
const revenue = await collectRevenue(toll);
```

## Learn More

[nobulex.com](https://nobulex.com)
