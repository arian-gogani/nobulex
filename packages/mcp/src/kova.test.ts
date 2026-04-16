/**
 * Tests for Kova package: withKova API and validation.
 */

import { describe, it, expect } from 'vitest';
import { withKova } from './index.js';
import type { MCPServer } from './index.js';

function createMockServer(): MCPServer {
  return {
    tools: [{ name: 'read_file', description: 'Read a file' }],
    handleToolCall: async (name: string, args: Record<string, unknown>) => ({
      result: `${name} executed`,
      args,
    }),
  };
}

describe('withKova', () => {
  it('wraps a valid server with preset', async () => {
    const server = createMockServer();
    const wrapped = await withKova(server, 'data-isolation');
    expect(wrapped).toBeDefined();
    expect(typeof wrapped.handleToolCall).toBe('function');
    expect(typeof wrapped.getMonitor).toBe('function');
  });

  it('throws when server is null', async () => {
    await expect(withKova(null as unknown as MCPServer, 'data-isolation')).rejects.toThrow(
      'withKova: server is required',
    );
  });

  it('throws when server is undefined', async () => {
    await expect(withKova(undefined as unknown as MCPServer, 'data-isolation')).rejects.toThrow(
      'withKova: server is required',
    );
  });

  it('throws when preset is empty string', async () => {
    const server = createMockServer();
    await expect(withKova(server, '')).rejects.toThrow(
      'withKova: preset must be a non-empty string',
    );
  });

  it('throws when preset is whitespace only', async () => {
    const server = createMockServer();
    await expect(withKova(server, '   ')).rejects.toThrow(
      'withKova: preset must be a non-empty string',
    );
  });
});
