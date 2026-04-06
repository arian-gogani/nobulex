/**
 * Example 11: Identity Evolution with Lineage
 *
 * Focused example on identity evolution and lineage chain inspection.
 * Creates an identity, evolves it 2-3 times, then inspects the lineage
 * and uses shareAncestor to find common ancestry.
 *
 * Run: npx tsx examples/11-identity-evolution-lineage.ts
 */

import {
  NobulexClient,
  generateKeyPair,
  getLineage,
  shareAncestor,
  type ModelAttestation,
  type DeploymentContext,
} from '@nobulex/sdk';

async function main() {
  console.log('========================================');
  console.log('  Example 11: Identity Evolution with Lineage');
  console.log('========================================\n');

  const operatorKeys = await generateKeyPair();
  const client = new NobulexClient({ keyPair: operatorKeys });

  const model: ModelAttestation = {
    provider: 'anthropic',
    modelId: 'claude',
    version: '3.0',
    hash: 'sha256:abc',
  };

  const deployment: DeploymentContext = {
    environment: 'production',
    runtime: 'node' as const,
    constraints: ['read-only'],
  };

  // Create initial identity
  const v1 = await client.createIdentity({
    operatorIdentifier: 'operator:acme',
    model,
    capabilities: ['read', 'write'],
    deployment,
  });
  console.log('v1 created:', v1.id.slice(0, 24) + '...');

  // Evolve: model upgrade
  const v2 = await client.evolveIdentity(v1, {
    changeType: 'model_update',
    description: 'Upgrade to Claude 3.5',
    updates: { model: { ...model, version: '3.5-sonnet', hash: 'sha256:def' } },
  });
  console.log('v2 created:', v2.id.slice(0, 24) + '...');

  // Evolve: capability expansion
  const v3 = await client.evolveIdentity(v2, {
    changeType: 'capability_change',
    description: 'Add image-analysis',
    updates: { capabilities: [...v2.capabilities, 'image-analysis'] },
  });
  console.log('v3 created:', v3.id.slice(0, 24) + '...\n');

  // Inspect lineage chain
  const lineage = getLineage(v3);
  console.log('--- Lineage Chain ---\n');
  console.log(`Total entries: ${lineage.length} (genesis + 2 evolutions)\n`);

  for (let i = 0; i < lineage.length; i++) {
    const e = lineage[i]!;
    console.log(`  ${i + 1}. ${e.changeType}: ${e.description}`);
    console.log(`     Identity: ${e.identityHash.slice(0, 24)}...`);
    console.log(`     Parent:   ${e.parentHash ? e.parentHash.slice(0, 24) + '...' : 'null (genesis)'}`);
    console.log(`     Carry-forward: ${e.reputationCarryForward}`);
    console.log('');
  }

  // shareAncestor: v1 and v3 share v1 as ancestor
  const ancestorV1V3 = shareAncestor(v1, v3);
  console.log('--- Ancestry ---\n');
  console.log('v1 and v3 share ancestor:', ancestorV1V3);

  // Create unrelated identity
  const otherKeys = await generateKeyPair();
  const otherClient = new NobulexClient({ keyPair: otherKeys });
  const other = await otherClient.createIdentity({
    operatorIdentifier: 'operator:other',
    model: { provider: 'openai', modelId: 'gpt-4', version: '1.0', hash: 'sha256:other' },
    capabilities: ['read'],
    deployment: { environment: 'staging', runtime: 'node' as const, constraints: [] },
  });
  console.log('v3 and other share ancestor:', shareAncestor(v3, other));

  console.log('\n========================================');
  console.log('  Example complete!');
  console.log('========================================');
}

main().catch(console.error);
