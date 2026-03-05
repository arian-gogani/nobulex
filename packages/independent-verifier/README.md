# @nobulex/independent-verifier

Independent third-party verifier for Nobulex covenants and action logs. Runs without trusting the operator.

## Install

```bash
npm install @nobulex/independent-verifier
```

## Usage

```typescript
import { IndependentVerifier } from "@nobulex/independent-verifier";

const verifier = new IndependentVerifier();
const result = await verifier.verify(actionLog);
console.log(result.valid);
```

## Learn More

[nobulex.com](https://nobulex.com)
