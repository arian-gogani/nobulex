# @nobulex/merkle

Merkle tree with domain separation and epoch-based batching for evidence items.

## Install

```bash
npm install @nobulex/merkle
```

## Usage

```typescript
import { MerkleTree } from "@nobulex/merkle";

const tree = new MerkleTree(evidenceItems);
const root = tree.root();
const proof = tree.prove(index);
```

## Learn More

[nobulex.com](https://nobulex.com)
