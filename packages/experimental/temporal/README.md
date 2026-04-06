# @nobulex/temporal

Time-bound covenants and temporal constraint enforcement for the Nobulex framework.

## Install

```bash
npm install @nobulex/temporal
```

## Usage

```typescript
import { withExpiry, isExpired } from "@nobulex/temporal";

const bounded = withExpiry(covenant, { ttl: "30d" });
console.log(isExpired(bounded));
```

## Learn More

[nobulex.com](https://nobulex.com)
