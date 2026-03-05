# @nobulex/core

Core covenant lifecycle management for the Nobulex framework.

## Install

```bash
npm install @nobulex/core
```

## Usage

```typescript
import { createCovenant, signCovenant, verifyCovenant } from "@nobulex/core";

const covenant = createCovenant({ rules: ["data-isolation"] });
const signed = await signCovenant(covenant, identity);
const valid = await verifyCovenant(signed);
```

## Learn More

[nobulex.com](https://nobulex.com)
