# @nobulex/robustness

Robustness testing and fault tolerance for covenant-governed AI agents.

## Install

```bash
npm install @nobulex/robustness
```

## Usage

```typescript
import { stressTest } from "@nobulex/robustness";

const report = await stressTest(covenant, { iterations: 1000 });
console.log(report.failureRate);
```

## Learn More

[nobulex.com](https://nobulex.com)
