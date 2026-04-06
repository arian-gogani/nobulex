# @nobulex/negotiation

Automated covenant negotiation between agents and service providers.

## Install

```bash
npm install @nobulex/negotiation
```

## Usage

```typescript
import { negotiate } from "@nobulex/negotiation";

const agreement = await negotiate(agentTerms, providerTerms);
console.log(agreement.covenant);
```

## Learn More

[nobulex.com](https://nobulex.com)
