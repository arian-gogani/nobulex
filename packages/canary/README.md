# @nobulex/canary

Canary token detection and data exfiltration prevention for the Nobulex framework.

## Install

```bash
npm install @nobulex/canary
```

## Usage

```typescript
import { insertCanary, detectCanary } from "@nobulex/canary";

const tagged = insertCanary(data);
const leaked = detectCanary(output);
```

## Learn More

[nobulex.com](https://nobulex.com)
