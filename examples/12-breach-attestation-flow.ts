/**
 * Example 12: Full Breach Attestation Flow
 *
 * Demonstrates the complete lifecycle: create covenant → violate → attest → process.
 *
 * 1. Create: Build a covenant and agent identity
 * 2. Violate: Monitor evaluates actions; one is denied (violation)
 * 3. Attest: Create a signed breach attestation from the violation
 * 4. Process: Feed attestation into TrustGraph for status propagation
 *
 * Run: npx tsx examples/12-breach-attestation-flow.ts
 */

import { generateKeyPair, sha256Object, sha256String } from '@nobulex/crypto';
import type { HashHex } from '@nobulex/crypto';

import { createIdentity } from '@nobulex/identity';

import { buildCovenant } from '@nobulex/core';
import type { Issuer, Beneficiary } from '@nobulex/core';

import { Monitor } from '@nobulex/enforcement';
import type { AuditEntry } from '@nobulex/enforcement';

import {
  createBreachAttestation,
  verifyBreachAttestation,
  TrustGraph,
} from '@nobulex/breach';
import type { BreachAttestation, BreachEvent } from '@nobulex/breach';

const CONSTRAINTS = [
  "permit file.read on '/src/**'",
  "permit review.generate on '/reviews/**'",
  "deny db.write on '/prod/**' severity critical",
  "deny file.delete on '**' severity high",
].join('\n');

async function main() {
  console.log('========================================');
  console.log('  Example 12: Full Breach Attestation Flow');
  console.log('========================================\n');

  // ── Step 1: Create ───────────────────────────────────────────────────────

  console.log('--- Step 1: Create Covenant and Identity ---\n');

  const [operatorKeys, beneficiaryKeys, reporterKeys] = await Promise.all([
    generateKeyPair(),
    generateKeyPair(),
    generateKeyPair(),
  ]);

  const agentIdentity = await createIdentity({
    operatorKeyPair: operatorKeys,
    operatorIdentifier: 'agent:code-review',
    model: {
      provider: 'anthropic',
      modelId: 'claude',
      modelVersion: '3.0',
      attestationType: 'self_reported',
    },
    capabilities: ['file.read', 'review.generate'],
    deployment: { runtime: 'process' },
  });

  const issuer: Issuer = {
    id: agentIdentity.id,
    publicKey: operatorKeys.publicKeyHex,
    role: 'issuer',
    name: 'Code Review Agent',
  };

  const beneficiary: Beneficiary = {
    id: sha256String('user-principal') as HashHex,
    publicKey: beneficiaryKeys.publicKeyHex,
    role: 'beneficiary',
    name: 'Development Team',
  };

  const covenant = await buildCovenant({
    issuer,
    beneficiary,
    constraints: CONSTRAINTS,
    privateKey: operatorKeys.privateKey,
  });

  console.log('Covenant ID:  ', covenant.id.slice(0, 32) + '...');
  console.log('Agent ID:     ', agentIdentity.id.slice(0, 32) + '...');

  // ── Step 2: Violate ─────────────────────────────────────────────────────

  console.log('\n--- Step 2: Execute Actions (one will violate) ---\n');

  const violations: AuditEntry[] = [];
  const monitor = new Monitor(covenant.id, covenant.constraints, {
    mode: 'log_only',
    onViolation: (entry) => violations.push(entry),
  });

  const actions = [
    { action: 'file.read', resource: '/src/main.ts' },
    { action: 'db.write', resource: '/prod/users' }, // DENIED
    { action: 'file.delete', resource: '/tmp/cache' }, // DENIED
  ];

  for (const { action, resource } of actions) {
    const result = await monitor.evaluate(action, resource);
    console.log(`  ${action} ${resource} => ${result.permitted ? 'PERMITTED' : 'DENIED'}`);
  }

  console.log(`\nViolations captured: ${violations.length}`);

  // ── Step 3: Attest ─────────────────────────────────────────────────────

  console.log('\n--- Step 3: Create Breach Attestation ---\n');

  const deniedEntry = violations.find((e) => e.action === 'db.write')!;
  const evidenceHash = sha256Object({
    auditEntry: deniedEntry,
    merkleRoot: monitor.getAuditLog().merkleRoot,
  }) as HashHex;

  const breachAttestation = await createBreachAttestation(
    covenant.id,
    agentIdentity.id,
    "deny db.write on '/prod/**' severity critical",
    'critical',
    deniedEntry.action,
    deniedEntry.resource,
    evidenceHash,
    [covenant.id],
    reporterKeys,
  );

  console.log('Attestation ID:     ', breachAttestation.id.slice(0, 32) + '...');
  console.log('Severity:           ', breachAttestation.severity);
  console.log('Recommended action: ', breachAttestation.recommendedAction);
  console.log('Violated constraint:', breachAttestation.violatedConstraint);

  const valid = await verifyBreachAttestation(breachAttestation);
  console.log('Signature valid:    ', valid);

  // ── Step 4: Process ─────────────────────────────────────────────────────

  console.log('\n--- Step 4: Process with TrustGraph ---\n');

  const graph = new TrustGraph();
  const dependentHash = sha256String('dependent-agent') as HashHex;
  graph.registerDependency(agentIdentity.id, dependentHash);

  graph.onBreach((event: BreachEvent) => {
    console.log(
      `  [EVENT] ${event.affectedAgent.slice(0, 16)}... ` +
        `${event.previousStatus} -> ${event.newStatus} (depth ${event.propagationDepth})`,
    );
  });

  const events = await graph.processBreach(breachAttestation);

  console.log(`\n${events.length} agents affected by breach propagation`);
  console.log('\nFinal status:');
  console.log('  Violator:   ', graph.getStatus(agentIdentity.id));
  console.log('  Dependent:  ', graph.getStatus(dependentHash));
  console.log('  Trusted?    ', graph.isTrusted(agentIdentity.id));

  console.log('\n========================================');
  console.log('  Example complete!');
  console.log('========================================');
}

main().catch(console.error);
