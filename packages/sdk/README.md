# @nobulex/sdk

TypeScript SDK for embedding Nobulex into agent frameworks and applications.

## Install

```bash
npm install @nobulex/sdk
```

## Usage

```typescript
import { Nobulex } from "@nobulex/sdk";

const nobulex = new Nobulex({ apiKey: process.env.NOBULEX_KEY });
const covenant = await nobulex.createCovenant({ preset: "data-isolation" });
const verified = await nobulex.verify(covenant);
```

## Learn More

[nobulex.com](https://nobulex.com)
