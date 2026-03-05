# @nobulex/evm

EVM anchoring utilities with ABI encoding, Keccak-256 hashing, and JSON-RPC provider interface.

## Install

```bash
npm install @nobulex/evm
```

## Usage

```typescript
import { anchor, verifyAnchor } from "@nobulex/evm";

const tx = await anchor(evidenceRoot, provider);
const valid = await verifyAnchor(tx.hash, provider);
```

## Learn More

[nobulex.com](https://nobulex.com)
