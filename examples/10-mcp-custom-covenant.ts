/**
 * Example 10: MCP Server with Custom Covenant
 *
 * Wraps an MCP server with a custom CCL constraint string (not a preset).
 * Use this when you need fine-grained control over permit/deny rules.
 *
 * Run: npx tsx examples/10-mcp-custom-covenant.ts
 */

import { withKova } from 'kova';

// Custom CCL: permit read_file on /data, deny on /secrets, require audit
const customCCL = `permit tool.read_file on '/data/**'
permit tool.read_file on '/output/**'
deny tool.read_file on '/secrets/**' severity critical
deny tool.write_file on '**' severity high
require audit.log on '**'`;

const mockMCPServer = {
  name: 'custom-covenant-demo',
  tools: [
    { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
    { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object' } },
  ],
  handleToolCall: async (name: string, args: Record<string, unknown>) => {
    const path = (args.path as string) ?? '';
    if (name === 'read_file') return { content: [{ type: 'text', text: `Read: ${path}` }] };
    if (name === 'write_file') return { written: true, path };
    throw new Error(`Unknown: ${name}`);
  },
};

async function main() {
  console.log('========================================');
  console.log('  Example 10: MCP Server with Custom Covenant');
  console.log('========================================\n');

  console.log('Custom CCL:');
  console.log(customCCL);
  console.log('');

  const server = await withKova(mockMCPServer, customCCL);
  console.log('✓ Server wrapped with custom covenant\n');

  const tests = [
    { tool: 'read_file', path: '/data/report.csv', expect: 'PERMITTED' },
    { tool: 'read_file', path: '/secrets/api-key', expect: 'DENIED' },
    { tool: 'write_file', path: '/output/result.txt', expect: 'DENIED' },
  ];

  for (const { tool, path, expect } of tests) {
    try {
      await server.handleToolCall(tool, { path });
      console.log(`  ${tool} ${path} => ${expect === 'PERMITTED' ? '✓ PERMITTED' : '✗ (unexpected success)'}`);
    } catch (err) {
      console.log(`  ${tool} ${path} => ${expect === 'DENIED' ? '✓ DENIED' : '✗ (unexpected deny)'}`);
    }
  }

  const covenant = server.getCovenant();
  console.log('\nCovenant ID:', covenant.id.slice(0, 24) + '...');
  console.log('\n========================================');
  console.log('  Example complete!');
  console.log('========================================');
}

main().catch(console.error);
