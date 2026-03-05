# @nobulex/trust-data

Trust data structures and serialization for the Nobulex framework.

## Install

```bash
npm install @nobulex/trust-data
```

## Usage

```typescript
import { TrustRecord, serialize } from "@nobulex/trust-data";

const record = new TrustRecord(identity, covenant, evidence);
const bytes = serialize(record);
```

## Learn More

[nobulex.com](https://nobulex.com)
