# @nobulex/mcp-server

Model Context Protocol server with stdio transport that exposes Nobulex covenant tools to AI agents.

## Install

```bash
npm install @nobulex/mcp-server
```

## Usage

```typescript
import { createMCPServer } from "@nobulex/mcp-server";

const server = createMCPServer({ transport: "stdio" });
await server.start();
```

## Learn More

[nobulex.com](https://nobulex.com)
