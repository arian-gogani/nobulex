/**
 * Example 02: Delegation Chain
 *
 * Demonstrates how covenants can be chained in a delegation hierarchy.
 * Each child covenant narrows the permissions granted by its parent,
 * ensuring the principle of least privilege. Shows:
 * - Creating a root covenant with broad permissions
 * - Delegating a subset of permissions to a child
 * - Further narrowing with a grandchild
 * - Validating the entire chain
 * - Computing effective constraints at each level
 *
 * Run: npx tsx examples/02-delegation-chain.ts
 */

import {
  SteleClient,
  generateKeyPair,
  serializeCCL,
  type Issuer,
  type Beneficiary,
} from '@stele/sdk';

async function main() {
  console.log('========================================');
  console.log('  Example 02: Delegation Chain');
  console.log('========================================\n');

  // ── Generate keys for three levels of delegation ───────────────────────

  const orgKeys = await generateKeyPair();       // Organization (root)
  const teamKeys = await generateKeyPair();      // Team lead (child)
  const agentKeys = await generateKeyPair();     // AI agent (grandchild)

  // ── Level 1: Root covenant (Organization) ──────────────────────────────
  // The org grants broad read/write access to all data, with some limits.

  console.log('--- Level 1: Root Covenant (Organization) ---\n');

  const orgIssuer: Issuer = {
    id: 'org:global-corp',
    publicKey: orgKeys.publicKeyHex,
    role: 'issuer',
    name: 'GlobalCorp',
  };

  const teamBeneficiary: Beneficiary = {
    id: 'team:data-engineering',
    publicKey: teamKeys.publicKeyHex,
    role: 'beneficiary',
    name: 'Data Engineering Team',
  };

  const client = new SteleClient();

  const rootCovenant = await client.createCovenant({
    issuer: orgIssuer,
    beneficiary: teamBeneficiary,
    constraints: [
      "permit read on '**'",
      "permit write on '/data/**'",
      "permit execute on '/jobs/**'",
      "deny delete on '/data/production/**'",
      "deny write on '/system/**'",
      "limit api.call 10000 per 1 hours",
    ].join('\n'),
    privateKey: orgKeys.privateKey,
    metadata: {
      name: 'Organization Root Policy',
      tags: ['root', 'org-level'],
    },
  });

  console.log('Root covenant ID:', rootCovenant.id.slice(0, 32) + '...');
  console.log('Constraints:');
  console.log('  ' + rootCovenant.constraints.split('\n').join('\n  '));

  // ── Level 2: Child covenant (Team Lead) ────────────────────────────────
  // The team lead narrows permissions: only data access, no job execution.

  console.log('\n--- Level 2: Child Covenant (Team Lead) ---\n');

  const teamIssuer: Issuer = {
    id: 'team:data-engineering',
    publicKey: teamKeys.publicKeyHex,
    role: 'issuer',
    name: 'Data Engineering Team',
  };

  const agentBeneficiary: Beneficiary = {
    id: 'agent:etl-processor',
    publicKey: agentKeys.publicKeyHex,
    role: 'beneficiary',
    name: 'ETL Processor Agent',
  };

  const childCovenant = await client.createCovenant({
    issuer: teamIssuer,
    beneficiary: agentBeneficiary,
    constraints: [
      "permit read on '/data/**'",
      "permit write on '/data/staging/**'",
      "deny write on '/data/production/**'",
      "deny delete on '**'",
      "limit api.call 5000 per 1 hours",
    ].join('\n'),
    privateKey: teamKeys.privateKey,
    chain: {
      parentId: rootCovenant.id,
      relation: 'delegates',
      depth: 1,
    },
    metadata: {
      name: 'Team ETL Agent Policy',
      tags: ['team-level', 'etl'],
    },
  });

  console.log('Child covenant ID:', childCovenant.id.slice(0, 32) + '...');
  console.log('Parent reference: ', childCovenant.chain?.parentId.slice(0, 32) + '...');
  console.log('Chain relation:   ', childCovenant.chain?.relation);
  console.log('Constraints:');
  console.log('  ' + childCovenant.constraints.split('\n').join('\n  '));

  // ── Level 3: Grandchild covenant (Restricted Agent) ────────────────────
  // Further restrict to read-only on specific data paths.

  console.log('\n--- Level 3: Grandchild Covenant (Restricted Agent) ---\n');

  const restrictedKeys = await generateKeyPair();

  const agentIssuer: Issuer = {
    id: 'agent:etl-processor',
    publicKey: agentKeys.publicKeyHex,
    role: 'issuer',
    name: 'ETL Processor Agent',
  };

  const restrictedBeneficiary: Beneficiary = {
    id: 'agent:etl-reader',
    publicKey: restrictedKeys.publicKeyHex,
    role: 'beneficiary',
    name: 'ETL Reader Sub-Agent',
  };

  const grandchildCovenant = await client.createCovenant({
    issuer: agentIssuer,
    beneficiary: restrictedBeneficiary,
    constraints: [
      "permit read on '/data/staging/**'",
      "deny write on '**'",
      "deny delete on '**'",
      "limit api.call 1000 per 1 hours",
    ].join('\n'),
    privateKey: agentKeys.privateKey,
    chain: {
      parentId: childCovenant.id,
      relation: 'restricts',
      depth: 2,
    },
    metadata: {
      name: 'ETL Reader Sub-Agent Policy',
      tags: ['restricted', 'read-only'],
    },
  });

  console.log('Grandchild ID:   ', grandchildCovenant.id.slice(0, 32) + '...');
  console.log('Parent reference:', grandchildCovenant.chain?.parentId.slice(0, 32) + '...');
  console.log('Chain depth:     ', grandchildCovenant.chain?.depth);
  console.log('Constraints:');
  console.log('  ' + grandchildCovenant.constraints.split('\n').join('\n  '));

  // ── Validate the entire chain ──────────────────────────────────────────
  // Chain validation verifies each document and checks that children
  // only narrow (never broaden) their parent's permissions.

  console.log('\n--- Chain Validation ---\n');

  const chainResult = await client.validateChain([
    rootCovenant,
    childCovenant,
    grandchildCovenant,
  ]);

  console.log('Chain valid:', chainResult.valid);
  console.log('Documents verified:', chainResult.results.length);

  for (let i = 0; i < chainResult.results.length; i++) {
    const label = i === 0 ? 'Root' : i === 1 ? 'Child' : 'Grandchild';
    console.log(`  ${label}: ${chainResult.results[i]!.valid ? 'VALID' : 'INVALID'}`);
  }

  if (chainResult.narrowingViolations.length > 0) {
    console.log('\nNarrowing violations found:');
    for (const v of chainResult.narrowingViolations) {
      console.log(`  Between index ${v.parentIndex} and ${v.childIndex}:`);
      for (const violation of v.violations) {
        console.log(`    - ${violation.reason}`);
      }
    }
  } else {
    console.log('Narrowing: No violations (each child properly narrows its parent)');
  }

  // ── Compute effective constraints at each level ────────────────────────
  // The effective constraints are the merged result of all ancestors
  // down to the current document. Deny-wins and most-restrictive merging.

  console.log('\n--- Effective Constraints at Each Level ---\n');

  // Root: no ancestors, effective = own constraints
  const rootChain = await client.resolveChain(rootCovenant, []);
  const rootEffective = await import('@stele/core').then(core =>
    core.computeEffectiveConstraints(rootCovenant, rootChain)
  );
  console.log('Root effective constraints:');
  console.log('  ' + serializeCCL(rootEffective).split('\n').join('\n  '));

  // Child: one ancestor (root)
  const childChain = await client.resolveChain(childCovenant, [rootCovenant]);
  const childEffective = await import('@stele/core').then(core =>
    core.computeEffectiveConstraints(childCovenant, childChain)
  );
  console.log('\nChild effective constraints:');
  console.log('  ' + serializeCCL(childEffective).split('\n').join('\n  '));

  // Grandchild: two ancestors (root, child)
  const grandchildChain = await client.resolveChain(grandchildCovenant, [
    rootCovenant,
    childCovenant,
  ]);
  const grandchildEffective = await import('@stele/core').then(core =>
    core.computeEffectiveConstraints(grandchildCovenant, grandchildChain)
  );
  console.log('\nGrandchild effective constraints:');
  console.log('  ' + serializeCCL(grandchildEffective).split('\n').join('\n  '));

  // ── Compare what each level can do ─────────────────────────────────────

  console.log('\n--- Permission Comparison ---\n');

  const testActions = [
    { action: 'read', resource: '/data/staging/file.csv' },
    { action: 'write', resource: '/data/staging/output.csv' },
    { action: 'write', resource: '/data/production/table' },
    { action: 'execute', resource: '/jobs/etl-pipeline' },
    { action: 'delete', resource: '/data/staging/temp' },
  ];

  const levels = [
    { name: 'Root', covenant: rootCovenant },
    { name: 'Child', covenant: childCovenant },
    { name: 'Grandchild', covenant: grandchildCovenant },
  ];

  // Print header
  const header = 'Action'.padEnd(45) + levels.map(l => l.name.padEnd(14)).join('');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const { action, resource } of testActions) {
    const label = `${action} ${resource}`.padEnd(45);
    const results: string[] = [];
    for (const level of levels) {
      const result = await client.evaluateAction(level.covenant, action, resource);
      results.push((result.permitted ? 'PERMIT' : 'DENY').padEnd(14));
    }
    console.log(label + results.join(''));
  }

  console.log('\n========================================');
  console.log('  Example complete!');
  console.log('========================================');
}

main().catch(console.error);
