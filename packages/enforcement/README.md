# @nobulex/enforcement

Covenant enforcement and policy execution for the Nobulex framework.

## Install

```bash
npm install @nobulex/enforcement
```

## Usage

```typescript
import { enforce } from "@nobulex/enforcement";

const result = enforce(action, covenant);
if (!result.allowed) {
  console.log(result.reason);
}
```

## Learn More

[nobulex.com](https://nobulex.com)
