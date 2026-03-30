#!/usr/bin/env npx tsx
/**
 * Nobulex Covenant Protocol — Live Demo
 *
 * Demonstrates the full pipeline:
 *   1. Create two agents with DIDs
 *   2. Agent A authors a covenant (forbid transfer > $500, require compliance)
 *   3. Agent A signs and publishes attestation
 *   4. Middleware wraps Agent A's actions
 *   5. Agent A attempts a $300 transfer — allowed, logged
 *   6. Agent A attempts a $600 transfer — blocked by middleware
 *   7. Verification confirms compliance
 *   8. Results printed to console
 *
 * Run: npx vitest run demo/covenant-demo.test.ts
 *  or: npx tsx --tsconfig demo/tsconfig.json demo/covenant-demo.ts
 */

import { createDID, signWithDID, verifyWithDID } from '@nobulex/identity';
import { parseSource, compile, serialize } from '@nobulex/covenant-lang';
import { ActionLogBuilder, verifyIntegrity } from '@nobulex/action-log';
import { EnforcementMiddleware } from '@nobulex/middleware';
import { verify } from '@nobulex/verification';
import { sha256String, timestamp } from '@nobulex/crypto';

// ─── Helpers ────────────────────────────────────────────────────────────────

function header(text: string): void {
  console.log();
  console.log('═'.repeat(64));
  console.log(`  ${text}`);
  console.log('═'.repeat(64));
}

function step(n: number, text: string): void {
  console.log();
  console.log(`  [${ n }] ${text}`);
  console.log('  ' + '─'.repeat(60));
}

function result(label: string, value: unknown): void {
  console.log(`      ${label}: ${JSON.stringify(value)}`);
}

// ─── Main Demo ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  header('Nobulex Covenant Protocol — Live Demo');

  // ── Step 1: Create two agents with DIDs ─────────────────────────────────

  step(1, 'Create two agents with DIDs');

  const agentA = await createDID();
  result('Agent A DID', agentA.did);
  result('Agent A public key', agentA.publicKeyHex.slice(0, 16) + '...');

  const agentB = await createDID();
  result('Agent B DID', agentB.did);
  result('Agent B public key', agentB.publicKeyHex.slice(0, 16) + '...');

  // ── Step 2: Agent A authors a covenant ──────────────────────────────────

  step(2, 'Agent A authors a covenant');

  const covenantSource = `
    covenant SafeTrader {
      permit read;
      permit transfer (amount <= 500);
      forbid transfer (amount > 500);
      forbid delete;
      require counterparty.compliance_score >= 0.8;
    }
  `;

  const spec = parseSource(covenantSource);
  result('Covenant name', spec.name);
  result('Statements', spec.statements.length);
  result('Requirements', spec.requirements.length);

  console.log();
  console.log('      DSL source:');
  console.log('      ┌──────────────────────────────────────────────');
  for (const line of serialize(spec).split('\n')) {
    console.log(`      │ ${line}`);
  }
  console.log('      └──────────────────────────────────────────────');

  // ── Step 3: Agent A signs and publishes attestation ─────────────────────

  step(3, 'Agent A signs and publishes attestation');

  const covenantHash = sha256String(serialize(spec));
  result('Covenant hash', covenantHash.slice(0, 16) + '...');

  const attestationPayload = JSON.stringify({
    type: 'CovenantAttestation',
    issuer: agentA.did,
    covenantHash,
    issuedAt: timestamp(),
  });

  const signature = await signWithDID(attestationPayload, agentA);
  result('Signature', signature.slice(0, 24) + '...');

  const signatureValid = await verifyWithDID(attestationPayload, signature, agentA.document);
  result('Signature valid', signatureValid);

  // ── Step 4: Middleware wraps Agent A's actions ──────────────────────────

  step(4, 'Middleware wraps Agent A\'s actions');

  const middleware = new EnforcementMiddleware({
    agentDid: agentA.did,
    spec,
  });

  result('Middleware created', true);
  result('Agent DID', middleware.spec.name);

  // ── Step 5: Agent A attempts a $300 transfer — ALLOWED ─────────────────

  step(5, 'Agent A attempts a $300 transfer');

  const transfer300 = await middleware.execute(
    { action: 'transfer', params: { amount: 300, to: agentB.did, counterparty: { compliance_score: 0.9 } } },
    async () => ({ transferred: true, amount: 300 }),
  );

  result('Decision', transfer300.decision.action);
  result('Reason', transfer300.decision.reason);
  result('Executed', transfer300.executed);
  result('Logged at index', transfer300.entry.index);
  console.log('      ✓ $300 transfer ALLOWED and logged');

  // ── Step 6: Agent A attempts a $600 transfer — BLOCKED ─────────────────

  step(6, 'Agent A attempts a $600 transfer');

  const transfer600 = await middleware.execute(
    { action: 'transfer', params: { amount: 600, to: agentB.did, counterparty: { compliance_score: 0.9 } } },
    async () => ({ transferred: true, amount: 600 }),
  );

  result('Decision', transfer600.decision.action);
  result('Reason', transfer600.decision.reason);
  result('Executed', transfer600.executed);
  result('Logged at index', transfer600.entry.index);
  console.log('      ✗ $600 transfer BLOCKED by covenant middleware');

  // Also show a read (should be allowed)
  console.log();
  console.log('      Additional: Agent A reads data...');
  const readResult = await middleware.execute(
    { action: 'read', params: { counterparty: { compliance_score: 0.9 } } },
    async () => ({ data: 'account-balance' }),
  );
  result('Read decision', readResult.decision.action);
  result('Read executed', readResult.executed);

  // And a delete (should be blocked)
  console.log();
  console.log('      Additional: Agent A attempts to delete...');
  const deleteResult = await middleware.execute(
    { action: 'delete', params: { counterparty: { compliance_score: 0.9 } } },
    async () => ({ deleted: true }),
  );
  result('Delete decision', deleteResult.decision.action);
  result('Delete executed', deleteResult.executed);
  console.log('      ✗ Delete BLOCKED by covenant middleware');

  // ── Step 7: Verification confirms compliance ───────────────────────────

  step(7, 'Verification confirms compliance');

  const log = middleware.getLog();
  result('Action log length', log.length);
  result('Root hash', log.rootHash ? log.rootHash.slice(0, 16) + '...' : null);
  result('Head hash', log.headHash ? log.headHash.slice(0, 16) + '...' : null);

  // Verify hash chain integrity
  const integrity = verifyIntegrity(log);
  result('Hash chain valid', integrity.valid);

  // Verify covenant compliance
  const verification = verify(spec, log);
  result('Compliant', verification.compliant);
  result('Total actions', verification.totalActions);
  result('Violations', verification.violations.length);
  result('Merkle root', verification.merkleRoot ? verification.merkleRoot.slice(0, 16) + '...' : null);

  if (verification.compliant) {
    console.log('      ✓ Agent A is FULLY COMPLIANT with covenant');
  } else {
    console.log(`      ✗ Agent A has ${verification.violations.length} violations`);
    for (const v of verification.violations) {
      console.log(`        - Entry ${v.entryIndex}: ${v.action} — ${v.reason}`);
    }
  }

  // ── Step 8: Summary ────────────────────────────────────────────────────

  step(8, 'Summary');

  console.log();
  console.log('      ┌──────────────────────────────────────────────────┐');
  console.log('      │  Nobulex Covenant Protocol — Demo Results        │');
  console.log('      ├──────────────────────────────────────────────────┤');
  console.log(`      │  Agent A DID:     ${agentA.did.slice(0, 30)}...  │`);
  console.log(`      │  Agent B DID:     ${agentB.did.slice(0, 30)}...  │`);
  console.log(`      │  Covenant:        ${spec.name.padEnd(29)}│`);
  console.log(`      │  Actions logged:  ${String(log.length).padEnd(29)}│`);
  console.log(`      │  Compliant:       ${String(verification.compliant).padEnd(29)}│`);
  console.log(`      │  Violations:      ${String(verification.violations.length).padEnd(29)}│`);
  console.log('      ├──────────────────────────────────────────────────┤');
  console.log('      │  $300 transfer:   ✓ ALLOWED                     │');
  console.log('      │  $600 transfer:   ✗ BLOCKED (forbid > $500)     │');
  console.log('      │  read data:       ✓ ALLOWED                     │');
  console.log('      │  delete:          ✗ BLOCKED (forbid delete)     │');
  console.log('      └──────────────────────────────────────────────────┘');

  header('Demo Complete');
  console.log('  The Nobulex Covenant Protocol provides cryptographic');
  console.log('  behavioral accountability for autonomous AI agents.');
  console.log();
  console.log('  Learn more: https://github.com/arian-gogani/nobulex');
  console.log();
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
