# @nobulex/store

Pluggable storage backends — SQLite, PostgreSQL, S3.

## Install

```bash
npm install @nobulex/store
```

## Usage

```typescript
import { createStore } from "@nobulex/store";

const store = createStore({ backend: "sqlite", path: "./nobulex.db" });
await store.put(evidenceItem);
```

## Learn More

[nobulex.com](https://nobulex.com)
