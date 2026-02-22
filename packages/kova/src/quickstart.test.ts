/**
 * Integration: withKova wraps MCP server and enforces constraints
 */
import { describe, it, expect } from 'vitest';
import { withKova, getPresetConstraints } from './index.js';
import type { MCPServer } from '@stele/mcp';

describe('withKova', () => {
  it('wraps MCP server and enforces permit/deny', async () => {
    const mockServer = {
      name: 'test',
      tools: [{ name: 'read_file', description: 'Read', inputSchema: {} }],
      handleToolCall: async (name: string, args: Record<string, unknown>) => {
        if (name === 'read_file') return { content: [{ type: 'text', text: 'ok' }] };
        throw new Error(`Unknown: ${name}`);
      },
    };

    const server = await withKova(
      mockServer,
      "permit tool.read_file on '/data/**'\ndeny tool.read_file on '/system/**'",
    );

    const ok = await server.handleToolCall('read_file', { path: '/data/file.txt' });
    expect(ok).toBeDefined();
    expect((ok as { content?: { text: string }[] }).content?.[0]?.text).toBe('ok');

    await expect(server.handleToolCall('read_file', { path: '/system/secret' })).rejects.toThrow();
  });

  it('accepts preset names', async () => {
    const mockServer = {
      tools: [],
      handleToolCall: async () => ({}),
    };
    const server = await withKova(mockServer, 'data-isolation');
    expect(server.getCovenant()).toBeDefined();
    expect(server.getAuditLog()).toBeDefined();
  });

  it('throws clear error when server is null', async () => {
    await expect(withKova(null as unknown as MCPServer, 'data-isolation')).rejects.toThrow(
      'withKova: server is required',
    );
  });

  it('throws clear error when server lacks handleToolCall', async () => {
    const badServer = { tools: [], name: 'test' } as unknown as MCPServer;
    await expect(withKova(badServer, 'data-isolation')).rejects.toThrow('handleToolCall');
  });

  it('throws clear error when preset is empty', async () => {
    const mockServer = { tools: [], handleToolCall: async () => ({}) };
    await expect(withKova(mockServer, '')).rejects.toThrow('preset must be a non-empty string');
    await expect(withKova(mockServer, '   ')).rejects.toThrow('preset must be a non-empty string');
  });

  it('getPresetConstraints returns CCL for known presets', () => {
    const dataIsolation = getPresetConstraints('data-isolation');
    expect(dataIsolation).toContain('permit');
    expect(dataIsolation).toContain('deny');
    expect(getPresetConstraints('read-write')).toContain('permit');
    expect(getPresetConstraints('network')).toContain('network.send');
    expect(getPresetConstraints('minimal')).toContain('deny');
  });

  it('getPresetConstraints throws for unknown preset', () => {
    expect(() => getPresetConstraints('unknown' as 'data-isolation')).toThrow('Unknown preset');
  });
});
