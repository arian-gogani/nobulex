#!/usr/bin/env node
/**
 * Nobulex MCP Server — stdio transport.
 *
 * Reads newline-delimited JSON-RPC 2.0 messages from stdin,
 * dispatches them to the NobulexServer, and writes responses to stdout.
 *
 * Usage:
 *   npx nobulex-mcp
 *   echo '{"jsonrpc":"2.0","method":"initialize","id":1}' | npx nobulex-mcp
 */

import { NobulexServer } from './index';
import { MemoryStore } from '@nobulex/store';
import type { JsonRpcRequest } from './types';

const store = new MemoryStore();
const server = new NobulexServer(store);

let buffer = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk: string) => {
  buffer += chunk;

  // Process complete lines (newline-delimited JSON-RPC)
  let newlineIndex: number;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);

    if (line.length === 0) continue;

    void processLine(line);
  }
});

process.stdin.on('end', () => {
  // Process any remaining buffer content
  const line = buffer.trim();
  if (line.length > 0) {
    void processLine(line);
  }
});

async function processLine(line: string): Promise<void> {
  try {
    const message = JSON.parse(line) as JsonRpcRequest;
    const response = await server.handleMessage(message);
    process.stdout.write(JSON.stringify(response) + '\n');
  } catch (err) {
    // JSON parse error
    const errorResponse = {
      jsonrpc: '2.0' as const,
      error: {
        code: -32700,
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
      id: null,
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
