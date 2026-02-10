/**
 * Example 07: Advanced Enforcement
 *
 * Demonstrates how enforcement, reputation, and breach tracking work together:
 * - Creating a covenant with enforcement config (type: 'capability')
 * - Creating a covenant with proof config (type: 'audit_log')
 * - Using the enforcement Monitor to track action compliance
 * - Using the reputation module to compute a score from execution receipts
 * - Using the breach module to track violations via TrustGraph
 * - Showing how enforcement and reputation interact
 *
 * Run: npx tsx examples/07-advanced-enforcement.ts
 */

import {
  Monitor,
  type AuditEntry,
} from '@stele/enforcement';

import {
  createReceipt,
  computeReputationScore,
  createEndorsement,
  type ExecutionReceipt,
} from '@stele/reputation';

import {
  createBreachAttestation,
  TrustGraph,
} from '@stele/breach';

import {
  buildCovenant,
  type Issuer,
  type Beneficiary,
} from '@stele/core';

import { generateKeyPair, sha256String, toHex, type HashHex } from '@stele/crypto';

async function main() {
  console.log('========================================');
  console.log('  Example 07: Advanced Enforcement');
  console.log('========================================\n');

  // ── Step 1: Set up keys and parties ─────────────────────────────────────

  console.log('--- Step 1: Set Up Keys ---\n');

  const issuerKeys = await generateKeyPair();
  const agentKeys = await generateKeyPair();
  const reporterKeys = await generateKeyPair();

  console.log('Issuer public key:  ', issuerKeys.publicKeyHex.slice(0, 32) + '...');
  console.log('Agent public key:   ', agentKeys.publicKeyHex.slice(0, 32) + '...');
  console.log('Reporter public key:', reporterKeys.publicKeyHex.slice(0, 32) + '...');

  const issuer: Issuer = {
    id: 'org:enforcement-demo',
    publicKey: issuerKeys.publicKeyHex,
    role: 'issuer',
    name: 'Enforcement Demo Org',
  };

  const beneficiary: Beneficiary = {
    id: 'agent:monitored-agent',
    publicKey: agentKeys.publicKeyHex,
    role: 'beneficiary',
    name: 'Monitored Agent',
  };

  // ── Step 2: Create a covenant with enforcement and proof configs ────────

  console.log('\n--- Step 2: Create Covenant with Enforcement ---\n');

  const covenant = await buildCovenant({
    issuer,
    beneficiary,
    constraints: [
      "permit read on '/data/**'",
      "permit write on '/data/output/**'",
      "deny write on '/data/sensitive/**'",
      "deny delete on '**'",
      'limit api.call 100 per 1 hours',
    ].join('\n'),
    privateKey: issuerKeys.privateKey,
    enforcement: {
      type: 'capability',
      config: { gateMode: 'strict', auditAll: true },
    },
    proof: {
      type: 'audit_log',
      config: { merkleTree: true, hashChain: true },
    },
    metadata: {
      name: 'Monitored Agent Policy',
      tags: ['enforcement', 'audit', 'production'],
    },
  });

  console.log('Covenant ID:      ', covenant.id.slice(0, 32) + '...');
  console.log('Enforcement type: ', covenant.enforcement?.type);
  console.log('Proof type:       ', covenant.proof?.type);

  // ── Step 3: Create a Monitor for runtime enforcement ────────────────────

  console.log('\n--- Step 3: Runtime Enforcement with Monitor ---\n');

  const violations: AuditEntry[] = [];
  const monitor = new Monitor(covenant.id, covenant.constraints, {
    mode: 'log_only',  // Log violations but don't throw
    onViolation: (entry) => violations.push(entry),
  });

  // Execute some actions
  const actions = [
    { action: 'read', resource: '/data/users' },
    { action: 'write', resource: '/data/output/report.csv' },
    { action: 'write', resource: '/data/sensitive/secrets' },  // DENIED
    { action: 'delete', resource: '/data/output/old.csv' },    // DENIED
    { action: 'read', resource: '/data/metrics' },
  ];

  console.log('Executing actions:');
  for (const { action, resource } of actions) {
    const result = await monitor.evaluate(action, resource);
    const status = result.permitted ? 'PERMITTED' : 'DENIED';
    console.log(`  ${action} ${resource} => ${status}`);
  }

  console.log(`\nViolations captured: ${violations.length}`);
  for (const v of violations) {
    console.log(`  - ${v.action} on ${v.resource} (${v.outcome})`);
  }

  // Verify audit log integrity
  const auditLog = monitor.getAuditLog();
  const integrityOk = monitor.verifyAuditLogIntegrity();
  console.log(`\nAudit log entries: ${auditLog.count}`);
  console.log('Audit log integrity:', integrityOk ? 'VALID' : 'CORRUPTED');
  console.log('Merkle root:        ', auditLog.merkleRoot.slice(0, 32) + '...');

  // ── Step 4: Create execution receipts for reputation scoring ────────────

  console.log('\n--- Step 4: Build Execution Receipts ---\n');

  // Use agent's public key hex as identity hash for this demo
  const agentIdentityHash = agentKeys.publicKeyHex as HashHex;
  const proofHash = sha256String('proof-of-compliance-data') as HashHex;

  // Create a chain of receipts simulating covenant executions
  const receipts: ExecutionReceipt[] = [];

  // Receipt 1: fulfilled
  const receipt1 = await createReceipt(
    covenant.id,
    agentIdentityHash,
    issuerKeys.publicKeyHex,
    'fulfilled',
    proofHash,
    150,  // 150ms duration
    agentKeys,
    null, // first in chain
  );
  receipts.push(receipt1);
  console.log('Receipt 1: fulfilled (150ms)');

  // Receipt 2: fulfilled
  const receipt2 = await createReceipt(
    covenant.id,
    agentIdentityHash,
    issuerKeys.publicKeyHex,
    'fulfilled',
    proofHash,
    200,
    agentKeys,
    receipt1.receiptHash,
  );
  receipts.push(receipt2);
  console.log('Receipt 2: fulfilled (200ms)');

  // Receipt 3: partial
  const receipt3 = await createReceipt(
    covenant.id,
    agentIdentityHash,
    issuerKeys.publicKeyHex,
    'partial',
    proofHash,
    500,
    agentKeys,
    receipt2.receiptHash,
  );
  receipts.push(receipt3);
  console.log('Receipt 3: partial (500ms)');

  // Receipt 4: breached (low severity)
  const receipt4 = await createReceipt(
    covenant.id,
    agentIdentityHash,
    issuerKeys.publicKeyHex,
    'breached',
    proofHash,
    100,
    agentKeys,
    receipt3.receiptHash,
    'low',  // breach severity
  );
  receipts.push(receipt4);
  console.log('Receipt 4: breached (low severity, 100ms)');

  // Receipt 5: fulfilled
  const receipt5 = await createReceipt(
    covenant.id,
    agentIdentityHash,
    issuerKeys.publicKeyHex,
    'fulfilled',
    proofHash,
    175,
    agentKeys,
    receipt4.receiptHash,
  );
  receipts.push(receipt5);
  console.log('Receipt 5: fulfilled (175ms)');

  // ── Step 5: Compute reputation score ────────────────────────────────────

  console.log('\n--- Step 5: Compute Reputation Score ---\n');

  const score = computeReputationScore(agentIdentityHash, receipts);

  console.log('Reputation Score:');
  console.log('  Agent:           ', score.agentIdentityHash.slice(0, 32) + '...');
  console.log('  Total executions:', score.totalExecutions);
  console.log('  Fulfilled:       ', score.fulfilled);
  console.log('  Partial:         ', score.partial);
  console.log('  Failed:          ', score.failed);
  console.log('  Breached:        ', score.breached);
  console.log('  Success rate:    ', (score.successRate * 100).toFixed(1) + '%');
  console.log('  Weighted score:  ', score.weightedScore.toFixed(4));
  console.log('  Merkle root:     ', score.receiptsMerkleRoot.slice(0, 32) + '...');
  console.log('  Last updated:    ', score.lastUpdatedAt);

  // ── Step 6: Add an endorsement and recompute ────────────────────────────

  console.log('\n--- Step 6: Endorsement Impact ---\n');

  const endorserKeys = await generateKeyPair();
  const endorserIdentityHash = endorserKeys.publicKeyHex as HashHex;

  const endorsement = await createEndorsement(
    endorserIdentityHash,
    agentIdentityHash,
    { covenantsCompleted: 50, breachRate: 0.02 },
    ['data-processing', 'analytics'],
    0.85,  // endorsement weight
    endorserKeys,
  );

  console.log('Endorsement created:');
  console.log('  Endorser:         ', endorsement.endorserIdentityHash.slice(0, 32) + '...');
  console.log('  Basis:             50 covenants, 2% breach rate');
  console.log('  Weight:           ', endorsement.weight);
  console.log('  Scopes:           ', endorsement.scopes.join(', '));

  const scoreWithEndorsement = computeReputationScore(
    agentIdentityHash,
    receipts,
    [endorsement],
  );

  console.log('\nScore without endorsement:', score.weightedScore.toFixed(4));
  console.log('Score with endorsement:   ', scoreWithEndorsement.weightedScore.toFixed(4));
  console.log('Delta:                    ', (scoreWithEndorsement.weightedScore - score.weightedScore).toFixed(4));

  // ── Step 7: Breach tracking with TrustGraph ─────────────────────────────

  console.log('\n--- Step 7: Breach Tracking (TrustGraph) ---\n');

  const trustGraph = new TrustGraph();

  // Register dependencies: agent depends on a service provider
  const serviceProviderHash = sha256String('service-provider-identity') as HashHex;
  const dependentAgentHash = sha256String('dependent-agent-identity') as HashHex;

  trustGraph.registerDependency(agentIdentityHash, dependentAgentHash);
  trustGraph.registerDependency(serviceProviderHash, agentIdentityHash);

  console.log('Trust graph:');
  console.log('  Service Provider -> Agent -> Dependent Agent');
  console.log('  Agent status:           ', trustGraph.getStatus(agentIdentityHash));
  console.log('  Dependent agent status: ', trustGraph.getStatus(dependentAgentHash));

  // Register a breach listener
  trustGraph.onBreach((event) => {
    console.log(`  [BREACH EVENT] Agent ${event.affectedAgent.slice(0, 16)}... ` +
      `${event.previousStatus} -> ${event.newStatus} (depth: ${event.propagationDepth})`);
  });

  // Create and process a breach attestation against the agent
  const evidenceHash = sha256String('breach-evidence-data') as HashHex;

  const breachAttestation = await createBreachAttestation(
    covenant.id,
    agentIdentityHash,
    "deny write on '/data/sensitive/**'",
    'medium',
    'write',
    '/data/sensitive/credentials',
    evidenceHash,
    [covenant.id],
    reporterKeys,
  );

  console.log('\nBreach attestation:');
  console.log('  ID:                 ', breachAttestation.id.slice(0, 32) + '...');
  console.log('  Severity:           ', breachAttestation.severity);
  console.log('  Recommended action: ', breachAttestation.recommendedAction);
  console.log('  Violated constraint:', breachAttestation.violatedConstraint);

  console.log('\nProcessing breach (with propagation):');
  const breachEvents = await trustGraph.processBreach(breachAttestation);

  console.log(`\n${breachEvents.length} agents affected:`);
  for (const event of breachEvents) {
    console.log(`  ${event.affectedAgent.slice(0, 16)}... : ${event.previousStatus} -> ${event.newStatus}`);
  }

  // Check trust status after breach
  console.log('\nPost-breach trust status:');
  console.log('  Agent:           ', trustGraph.getStatus(agentIdentityHash));
  console.log('  Dependent agent: ', trustGraph.getStatus(dependentAgentHash));
  console.log('  Agent trusted?   ', trustGraph.isTrusted(agentIdentityHash));

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log('\n--- Summary ---\n');
  console.log('Enforcement:');
  console.log('  Actions monitored:    ', actions.length);
  console.log('  Violations detected:  ', violations.length);
  console.log('  Audit log integrity:  ', integrityOk ? 'VALID' : 'CORRUPTED');
  console.log('\nReputation:');
  console.log('  Receipts created:     ', receipts.length);
  console.log('  Weighted score:       ', scoreWithEndorsement.weightedScore.toFixed(4));
  console.log('  Success rate:         ', (score.successRate * 100).toFixed(1) + '%');
  console.log('\nBreach Tracking:');
  console.log('  Breach processed:      1 (medium severity)');
  console.log('  Agents affected:      ', breachEvents.length);
  console.log('  Trust propagation:     service -> agent -> dependent');

  console.log('\n========================================');
  console.log('  Example complete!');
  console.log('========================================');
}

main().catch(console.error);
