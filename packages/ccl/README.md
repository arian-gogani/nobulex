# @nobulex/ccl

Covenant Constraint Language parser and evaluator for Nobulex.

## Install

```bash
npm install @nobulex/ccl
```

## Usage

```typescript
import { parse, evaluate } from "@nobulex/ccl";

const constraint = parse("ALLOW read WHERE scope = 'public'");
const result = evaluate(constraint, context);
```

## Learn More

[nobulex.com](https://nobulex.com)
