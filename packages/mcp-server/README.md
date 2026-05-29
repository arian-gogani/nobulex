# @nobulex/mcp-server

Model Context Protocol server (stdio transport) that exposes Nobulex covenant
tools to MCP-compatible AI agents and clients.

## Install

```bash
npm install -g @nobulex/mcp-server
```

## Run

```bash
npx nobulex-mcp
```

It speaks newline-delimited JSON-RPC 2.0 over stdio:

```bash
echo '{"jsonrpc":"2.0","method":"initialize","id":1}' | npx nobulex-mcp
```

## Use from an MCP client

Add to your client config (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "nobulex": {
      "command": "npx",
      "args": ["nobulex-mcp"]
    }
  }
}
```

## Use programmatically

```typescript
import { NobulexServer } from "@nobulex/mcp-server";
import { MemoryStore } from "@nobulex/core";

const server = new NobulexServer(new MemoryStore());
console.log(server.listTools());
const result = await server.callTool("verify_covenant", { /* args */ });
```

## Learn More

[github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex) · [nobulex.com](https://nobulex.com)
