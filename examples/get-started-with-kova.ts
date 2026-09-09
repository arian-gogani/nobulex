#!/usr/bin/env npx tsx
/**
 * Get Started with Kova, 3 lines of code
 *
 * Run: npx tsx examples/get-started-with-kova.ts
 *
 * This example shows the minimal integration: wrap any MCP server
 * with Kova trust enforcement. No covenant setup required.
 */
import { SteleGuard, PRESETS } from '@nobulex/mcp';

// Create a minimal mock MCP server for demonstration
const mockMCPServer = {
  name: 'demo-server',
  version: '1.0.0',
  tools: [
    {
      name: 'read_file',
      description: 'Read a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    },
  ],
  handleToolCall: async (name: string, args: Record<string, unknown>) => {
    if (name === 'read_file') {
      const path = (args.path as string) ?? '/unknown';
      return { content: [{ type: 'text', text: `Read: ${path}` }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  },
};

async function main() {
  console.log('Kova, The trust layer for the agent economy\n');

  // Three lines: wrap your MCP server with Kova
  const server = await SteleGuard.wrap(mockMCPServer, { constraints: PRESETS['standard:data-isolation'] });
  console.log('✓ Server wrapped with Kova (data-isolation preset)');
  console.log('  Constraints: file.read on /data/**, deny writes, require audit');

  // The wrapped server enforces covenant constraints on every tool call
  const result = await server.handleToolCall('read_file', { path: '/data/ok.txt' });
  console.log('✓ Permitted: read_file /data/ok.txt ->', (result as { content?: unknown[] })?.content?.[0] ? 'OK' : 'N/A');

  console.log("\nNext: npm install @nobulex/mcp && wrap your own server with SteleGuard.wrap(server, { constraints: PRESETS['standard:data-isolation'] })");
}

main().catch((err) => {
  // Exit non-zero. `catch(console.error)` printed the failure and then
  // exited 0, so two examples in this directory threw a TypeError and
  // were still counted as passing by every check that reads exit codes,
  // including this repository's CI. An example that fails must say so
  // through the channel a machine reads.
  console.error(err);
  process.exit(1);
});
