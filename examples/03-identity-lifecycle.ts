/**
 * Example 03: Identity Lifecycle
 *
 * Demonstrates the full lifecycle of an AI agent identity:
 * - Generating an operator key pair
 * - Creating an agent identity with model attestation, capabilities, deployment context
 * - Evolving the identity (model upgrade, capability expansion)
 * - Verifying identity at each stage
 * - Printing the lineage chain
 *
 * Run: npx tsx examples/03-identity-lifecycle.ts
 */

import {
  SteleClient,
  generateKeyPair,
  verifyIdentity,
  getLineage,
  shareAncestor,
  computeIdentityHash,
  computeCapabilityManifestHash,
  type ModelAttestation,
  type DeploymentContext,
} from '@stele/sdk';

async function main() {
  console.log('========================================');
  console.log('  Example 03: Identity Lifecycle');
  console.log('========================================\n');

  // ── Step 1: Generate operator key pair ──────────────────────────────────
  // The operator is the human or organization responsible for the agent.

  console.log('--- Step 1: Generate Operator Key Pair ---\n');

  const operatorKeys = await generateKeyPair();
  console.log('Operator public key:', operatorKeys.publicKeyHex.slice(0, 32) + '...');

  // ── Step 2: Define model attestation and deployment context ─────────────
  // These describe *what* the agent is and *where* it runs.

  console.log('\n--- Step 2: Define Model & Deployment ---\n');

  const model: ModelAttestation = {
    provider: 'anthropic',
    modelId: 'claude',
    version: '3.5-sonnet',
    hash: 'sha256:abc123def456',
  };

  const deployment: DeploymentContext = {
    environment: 'production',
    runtime: 'node' as const,
    constraints: ['no-network-access', 'read-only-filesystem'],
  };

  console.log('Model:', `${model.provider}/${model.modelId}@${model.version}`);
  console.log('Environment:', deployment.environment);
  console.log('Runtime:', deployment.runtime);
  console.log('Constraints:', deployment.constraints.join(', '));

  // ── Step 3: Create the initial identity ─────────────────────────────────
  // The identity binds the operator, model, capabilities, and deployment
  // together with a cryptographic signature.

  console.log('\n--- Step 3: Create Agent Identity ---\n');

  const client = new SteleClient({ keyPair: operatorKeys });

  const identity = await client.createIdentity({
    operatorIdentifier: 'operator:acme-research-lab',
    model,
    capabilities: ['text-generation', 'code-analysis', 'data-retrieval'],
    deployment,
  });

  console.log('Identity ID:          ', identity.id.slice(0, 32) + '...');
  console.log('Version:              ', identity.version);
  console.log('Operator public key:  ', identity.operatorPublicKey.slice(0, 32) + '...');
  console.log('Capabilities:         ', identity.capabilities.join(', '));
  console.log('Capability manifest:  ', identity.capabilityManifestHash.slice(0, 32) + '...');
  console.log('Created at:           ', identity.createdAt);

  // ── Step 4: Verify the initial identity ─────────────────────────────────
  // Verification checks the composite hash, signature, lineage, and version.

  console.log('\n--- Step 4: Verify Initial Identity ---\n');

  const v1Result = await verifyIdentity(identity);
  console.log('Identity valid:', v1Result.valid);
  for (const check of v1Result.checks) {
    const icon = check.passed ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${check.name}: ${check.message}`);
  }

  // ── Step 5: Evolve identity -- model upgrade ────────────────────────────
  // When the underlying model changes, the identity evolves. Reputation
  // carry-forward depends on the type of change.

  console.log('\n--- Step 5: Evolve Identity (Model Upgrade) ---\n');

  const upgradedModel: ModelAttestation = {
    provider: 'anthropic',
    modelId: 'claude',
    version: '4.0-opus',
    hash: 'sha256:xyz789ghi012',
  };

  const evolved1 = await client.evolveIdentity(identity, {
    changeType: 'model_update',
    description: 'Upgraded from Claude 3.5 Sonnet to Claude 4.0 Opus',
    updates: { model: upgradedModel },
  });

  console.log('New identity ID:      ', evolved1.id.slice(0, 32) + '...');
  console.log('Version:              ', evolved1.version);
  console.log('Model:                ', `${evolved1.model.provider}/${evolved1.model.modelId}@${evolved1.model.version}`);
  console.log('Updated at:           ', evolved1.updatedAt);

  // Verify the evolved identity
  const v2Result = await verifyIdentity(evolved1);
  console.log('Evolved identity valid:', v2Result.valid);

  // ── Step 6: Evolve identity -- add capability ───────────────────────────
  // Adding new capabilities triggers a capability_change evolution.

  console.log('\n--- Step 6: Evolve Identity (Add Capability) ---\n');

  const evolved2 = await client.evolveIdentity(evolved1, {
    changeType: 'capability_change',
    description: 'Added image-analysis capability for multimodal tasks',
    updates: {
      capabilities: [
        ...evolved1.capabilities,
        'image-analysis',
      ],
    },
  });

  console.log('New identity ID:      ', evolved2.id.slice(0, 32) + '...');
  console.log('Version:              ', evolved2.version);
  console.log('Capabilities:         ', evolved2.capabilities.join(', '));
  console.log('Updated at:           ', evolved2.updatedAt);

  // Verify the final identity
  const v3Result = await verifyIdentity(evolved2);
  console.log('Final identity valid: ', v3Result.valid);

  // ── Step 7: Print lineage ───────────────────────────────────────────────
  // The lineage is a chain of signed entries recording every evolution.

  console.log('\n--- Step 7: Identity Lineage ---\n');

  const lineage = getLineage(evolved2);
  console.log(`Lineage has ${lineage.length} entries:\n`);

  for (let i = 0; i < lineage.length; i++) {
    const entry = lineage[i]!;
    console.log(`  Entry ${i + 1}:`);
    console.log(`    Change type:       ${entry.changeType}`);
    console.log(`    Description:       ${entry.description}`);
    console.log(`    Timestamp:         ${entry.timestamp}`);
    console.log(`    Identity hash:     ${entry.identityHash.slice(0, 32)}...`);
    console.log(`    Parent hash:       ${entry.parentHash ? entry.parentHash.slice(0, 32) + '...' : 'null (genesis)'}`);
    console.log(`    Carry-forward:     ${entry.reputationCarryForward}`);
    console.log(`    Signature:         ${entry.signature.slice(0, 32)}...`);
    console.log('');
  }

  // ── Step 8: Check ancestry ──────────────────────────────────────────────
  // Two identities share an ancestor if their lineage chains overlap.

  console.log('--- Step 8: Ancestry Check ---\n');

  console.log('v1 and v3 share ancestor:', shareAncestor(identity, evolved2));

  // Create an unrelated identity for comparison
  const otherKeys = await generateKeyPair();
  const otherClient = new SteleClient({ keyPair: otherKeys });
  const otherIdentity = await otherClient.createIdentity({
    operatorIdentifier: 'operator:other-org',
    model: { provider: 'openai', modelId: 'gpt-4', version: '1.0', hash: 'sha256:other' },
    capabilities: ['text-generation'],
    deployment: { environment: 'staging', runtime: 'node' as const, constraints: [] },
  });

  console.log('v3 and other share ancestor:', shareAncestor(evolved2, otherIdentity));

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log('\n--- Summary ---\n');
  console.log('Identity versions created: 3');
  console.log('Lineage entries:          ', lineage.length);
  console.log('Model upgrades:            1 (3.5-sonnet -> 4.0-opus)');
  console.log('Capability additions:      1 (image-analysis)');
  console.log('All versions verified:    ', v1Result.valid && v2Result.valid && v3Result.valid);

  console.log('\n========================================');
  console.log('  Example complete!');
  console.log('========================================');
}

main().catch(console.error);
