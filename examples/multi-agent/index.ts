/**
 * Stele SDK - Multi-Agent Chain Delegation
 *
 * Demonstrates parent-child covenant chains where a child covenant
 * narrows the parent's constraints. Shows chain resolution, narrowing
 * validation, identity creation, and differential enforcement across
 * two agents operating under different constraint scopes.
 */
import { generateKeyPair } from '@stele/crypto';
import {
  buildCovenant,
  MemoryChainResolver,
  resolveChain,
  validateChainNarrowing,
} from '@stele/core';
import { Monitor, MonitorDeniedError } from '@stele/enforcement';
import { createIdentity, verifyIdentity } from '@stele/identity';

async function main() {
  // 1. Create two key pairs: one for the parent operator, one for the child
  const parentKey = await generateKeyPair();
  const childKey = await generateKeyPair();
  console.log('Parent key:', parentKey.publicKeyHex.slice(0, 16) + '...');
  console.log('Child key: ', childKey.publicKeyHex.slice(0, 16) + '...\n');

  // 2. Build parent covenant with broad constraints
  //    The parent permits file.read, file.write, and network.send.
  const parentCovenant = await buildCovenant({
    issuer: { id: 'platform', publicKey: parentKey.publicKeyHex, role: 'issuer' },
    beneficiary: { id: 'parent-agent', publicKey: parentKey.publicKeyHex, role: 'beneficiary' },
    constraints: [
      "permit file.read on '**'",
      "permit file.write on '/output/**'",
      "permit network.send on '**'",
      "deny file.write on '/system/**' severity critical",
    ].join('\n'),
    privateKey: parentKey.privateKey,
    enforcement: { type: 'monitor', config: {} },
  });
  console.log('Parent covenant:', parentCovenant.id.slice(0, 16) + '...');

  // 3. Build child covenant that narrows the parent
  //    The child only permits file.read; it denies file.write and network.send.
  const childCovenant = await buildCovenant({
    issuer: { id: 'parent-agent', publicKey: parentKey.publicKeyHex, role: 'issuer' },
    beneficiary: { id: 'child-agent', publicKey: childKey.publicKeyHex, role: 'beneficiary' },
    constraints: [
      "permit file.read on '/data/**'",
      "deny file.write on '**' severity high",
      "deny network.send on '**' severity high",
    ].join('\n'),
    privateKey: parentKey.privateKey,
    chain: {
      parentId: parentCovenant.id,
      relation: 'delegates_to',
      depth: 1,
    },
  });
  console.log('Child covenant: ', childCovenant.id.slice(0, 16) + '...\n');

  // 4. Use MemoryChainResolver to resolve the chain
  const resolver = new MemoryChainResolver();
  resolver.add(parentCovenant);
  resolver.add(childCovenant);

  const ancestors = await resolveChain(childCovenant, resolver);
  console.log('Chain resolved:', ancestors.length, 'ancestor(s)');
  for (const ancestor of ancestors) {
    console.log('  Ancestor:', ancestor.id.slice(0, 16) + '...');
  }

  // 5. Validate chain narrowing (child must only narrow, never broaden parent)
  const narrowing = await validateChainNarrowing(childCovenant, parentCovenant);
  console.log('Chain narrowing valid:', narrowing.valid);
  if (narrowing.violations.length > 0) {
    for (const v of narrowing.violations) {
      console.log('  Violation:', v.message);
    }
  }
  console.log('');

  // 6. Create monitors for both agents
  const parentMonitor = new Monitor(parentCovenant.id, parentCovenant.constraints, { mode: 'enforce' });
  const childMonitor = new Monitor(childCovenant.id, childCovenant.constraints, { mode: 'enforce' });

  // 7. Create identities for both agents
  const parentIdentity = await createIdentity({
    operatorKeyPair: parentKey,
    model: { provider: 'anthropic', modelId: 'claude-3', attestationType: 'self_reported' },
    capabilities: ['file.read', 'file.write', 'network.send'],
    deployment: { runtime: 'process' },
  });

  const childIdentity = await createIdentity({
    operatorKeyPair: childKey,
    model: { provider: 'anthropic', modelId: 'claude-3', attestationType: 'self_reported' },
    capabilities: ['file.read'],
    deployment: { runtime: 'process' },
  });

  const parentVerification = await verifyIdentity(parentIdentity);
  const childVerification = await verifyIdentity(childIdentity);
  console.log('Parent identity valid:', parentVerification.valid);
  console.log('Child identity valid: ', childVerification.valid, '\n');

  // 8. Run actions through both monitors to show differential enforcement
  //    file.read on /data/report.csv: both should permit
  console.log('--- file.read /data/report.csv ---');
  const parentRead = await parentMonitor.evaluate('file.read', '/data/report.csv');
  console.log('  Parent:', parentRead.permitted ? 'PERMITTED' : 'DENIED');
  const childRead = await childMonitor.evaluate('file.read', '/data/report.csv');
  console.log('  Child: ', childRead.permitted ? 'PERMITTED' : 'DENIED');

  //    file.write on /output/result.txt: parent permits, child denies
  console.log('--- file.write /output/result.txt ---');
  const parentWrite = await parentMonitor.evaluate('file.write', '/output/result.txt');
  console.log('  Parent:', parentWrite.permitted ? 'PERMITTED' : 'DENIED');

  try {
    await childMonitor.evaluate('file.write', '/output/result.txt');
    console.log('  Child:  PERMITTED (unexpected)');
  } catch (err) {
    if (err instanceof MonitorDeniedError) {
      console.log('  Child:  DENIED -', err.message);
    }
  }

  //    network.send: parent permits, child denies
  console.log('--- network.send /api/endpoint ---');
  const parentNet = await parentMonitor.evaluate('network.send', '/api/endpoint');
  console.log('  Parent:', parentNet.permitted ? 'PERMITTED' : 'DENIED');

  try {
    await childMonitor.evaluate('network.send', '/api/endpoint');
    console.log('  Child:  PERMITTED (unexpected)');
  } catch (err) {
    if (err instanceof MonitorDeniedError) {
      console.log('  Child:  DENIED -', err.message);
    }
  }

  // Print final audit log summaries
  const parentLog = parentMonitor.getAuditLog();
  const childLog = childMonitor.getAuditLog();
  console.log(`\nParent audit log: ${parentLog.count} entries, integrity:`, parentMonitor.verifyAuditLogIntegrity());
  console.log(`Child audit log:  ${childLog.count} entries, integrity:`, childMonitor.verifyAuditLogIntegrity());
}

main().catch(console.error);
