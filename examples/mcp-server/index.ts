/**
 * Nobulex SDK - MCP Server Wrapping
 *
 * Demonstrates wrapping a Model Context Protocol server with NobulexGuard
 * to enforce constraints on every tool call, generate compliance proofs,
 * and produce execution receipts.
 */
import { NobulexGuard } from '@nobulex/mcp';
import type { MCPServer } from '@nobulex/mcp';
import { MonitorDeniedError } from '@nobulex/enforcement';
import { verifyComplianceProof } from '@nobulex/proof';

async function main() {
  // 1. Create a mock MCP server with three tools
  const mockServer: MCPServer = {
    tools: [
      { name: 'readFile', description: 'Reads a file from /data' },
      { name: 'writeFile', description: 'Writes a file to /output' },
      { name: 'sendEmail', description: 'Sends an email over the network' },
    ],
    async handleToolCall(name: string, args: Record<string, unknown>) {
      switch (name) {
        case 'readFile':
          return { content: `Contents of ${args.path}` };
        case 'writeFile':
          return { written: true, path: args.path };
        case 'sendEmail':
          return { sent: true, to: args.to };
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    },
  };

  // 2. Wrap with NobulexGuard using data-isolation preset
  //    This preset permits file.read on /data/**, denies file.write and
  //    network.send on all resources, and requires audit logging.
  const server = await NobulexGuard.wrap(mockServer, {
    constraints: 'standard:data-isolation',
    mode: 'enforce',
  });
  console.log('MCP server wrapped with data-isolation constraints\n');

  // 3. Execute tool calls through the wrapped server

  // readFile - attempts to read from /data (should succeed under data-isolation)
  try {
    const result = await server.handleToolCall!('readFile', { path: '/data/report.csv' });
    console.log('readFile /data/report.csv -> SUCCESS:', JSON.stringify(result));
  } catch (err) {
    if (err instanceof MonitorDeniedError) {
      console.log('readFile /data/report.csv -> DENIED:', err.message);
    }
  }

  // writeFile - file.write is denied by data-isolation
  try {
    await server.handleToolCall!('writeFile', { path: '/output/result.txt' });
    console.log('writeFile /output/result.txt -> SUCCESS (unexpected)');
  } catch (err) {
    if (err instanceof MonitorDeniedError) {
      console.log('writeFile /output/result.txt -> DENIED:', err.message);
    }
  }

  // sendEmail - network.send is denied by data-isolation
  try {
    await server.handleToolCall!('sendEmail', { to: 'user@example.com' });
    console.log('sendEmail -> SUCCESS (unexpected)');
  } catch (err) {
    if (err instanceof MonitorDeniedError) {
      console.log('sendEmail -> DENIED:', err.message);
    }
  }

  // 4. Get the audit log and print summary
  const log = server.getAuditLog();
  console.log(`\nAudit log: ${log.count} entries`);
  for (const entry of log.entries) {
    console.log(`  [${entry.outcome}] ${entry.action} on ${entry.resource}`);
  }

  // 5. Generate a compliance proof and verify it
  const proof = await server.generateProof();
  console.log('\nCompliance proof generated');
  console.log('  System:', proof.proofSystem);
  console.log('  Covenant:', proof.covenantId.slice(0, 16) + '...');
  console.log('  Entries covered:', proof.entryCount);
  console.log('  Audit commitment:', proof.auditLogCommitment.slice(0, 16) + '...');

  const proofResult = await verifyComplianceProof(proof);
  console.log('  Proof valid:', proofResult.valid);

  // 6. Get the execution receipt
  const receipt = server.getReceipt();
  if (receipt) {
    console.log('\nExecution receipt');
    console.log('  Outcome:', receipt.outcome);
    console.log('  Duration:', receipt.durationMs, 'ms');
    console.log('  Receipt hash:', receipt.receiptHash.slice(0, 16) + '...');
  } else {
    console.log('\nNo receipt generated (no tool calls completed)');
  }

  // Print the covenant ID for reference
  const covenant = server.getCovenant();
  console.log('\nCovenant ID:', covenant.id.slice(0, 16) + '...');
}

main().catch(console.error);
