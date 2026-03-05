# @nobulex/crypto

Cryptographic primitives for the Nobulex covenant framework.

## Install

```bash
npm install @nobulex/crypto
```

## Usage

```typescript
import { hash, sign, verify } from "@nobulex/crypto";

const digest = hash(data);
const signature = await sign(digest, privateKey);
const valid = await verify(digest, signature, publicKey);
```

## Learn More

[nobulex.com](https://nobulex.com)
