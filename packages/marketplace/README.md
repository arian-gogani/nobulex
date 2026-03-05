# @nobulex/marketplace

Marketplace for discovering and trading covenant-verified AI agent services.

## Install

```bash
npm install @nobulex/marketplace
```

## Usage

```typescript
import { Marketplace } from "@nobulex/marketplace";

const market = new Marketplace(config);
const agents = await market.discover({ compliance: "eu-ai-act" });
```

## Learn More

[nobulex.com](https://nobulex.com)
