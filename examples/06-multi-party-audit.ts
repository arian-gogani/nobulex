/**
 * Example 06: Multi-Party Audit
 *
 * Demonstrates how multiple parties can participate in covenant verification:
 * - Creating issuer, beneficiary, and 2 auditor key pairs
 * - Building a covenant document
 * - Adding countersignatures from both auditors
 * - Using the Verifier to verify the full document including countersignatures
 * - Inspecting countersignature details
 *
 * Run: npx tsx examples/06-multi-party-audit.ts
 */

import {
  NobulexClient,
  generateKeyPair,
  countersignCovenant,
  type Issuer,
  type Beneficiary,
  type CovenantDocument,
} from '@nobulex/sdk';

import { Verifier } from '@nobulex/verifier';

async function main() {
  console.log('========================================');
  console.log('  Example 06: Multi-Party Audit');
  console.log('========================================\n');

  // ── Step 1: Generate key pairs for all parties ──────────────────────────
  // In a real scenario, each party generates and controls their own key pair.

  console.log('--- Step 1: Generate Key Pairs ---\n');

  const issuerKeys = await generateKeyPair();
  const beneficiaryKeys = await generateKeyPair();
  const auditor1Keys = await generateKeyPair();
  const auditor2Keys = await generateKeyPair();

  console.log('Issuer public key:      ', issuerKeys.publicKeyHex.slice(0, 32) + '...');
  console.log('Beneficiary public key: ', beneficiaryKeys.publicKeyHex.slice(0, 32) + '...');
  console.log('Auditor 1 public key:   ', auditor1Keys.publicKeyHex.slice(0, 32) + '...');
  console.log('Auditor 2 public key:   ', auditor2Keys.publicKeyHex.slice(0, 32) + '...');

  // ── Step 2: Build the covenant ──────────────────────────────────────────

  console.log('\n--- Step 2: Build Covenant ---\n');

  const issuer: Issuer = {
    id: 'org:financial-services-corp',
    publicKey: issuerKeys.publicKeyHex,
    role: 'issuer',
    name: 'Financial Services Corp',
  };

  const beneficiary: Beneficiary = {
    id: 'agent:trading-bot-v2',
    publicKey: beneficiaryKeys.publicKeyHex,
    role: 'beneficiary',
    name: 'Trading Bot v2',
  };

  const client = new NobulexClient({ keyPair: issuerKeys });

  const covenant = await client.createCovenant({
    issuer,
    beneficiary,
    constraints: [
      "permit read on '/market-data/**'",
      "permit execute on '/trades/small/**'",
      "deny execute on '/trades/large/**'",
      "deny delete on '**'",
      'limit trade.execute 100 per 1 hours',
    ].join('\n'),
    enforcement: {
      type: 'audit',
      config: { auditFrequency: 'hourly', retentionDays: 365 },
    },
    proof: {
      type: 'audit_log',
      config: { merkleTree: true, hashChain: true },
    },
    metadata: {
      name: 'Trading Bot Operational Constraints',
      description: 'Limits trading bot to small trades with read access to market data',
      tags: ['trading', 'compliance', 'production'],
    },
  });

  console.log('Covenant ID:        ', covenant.id.slice(0, 32) + '...');
  console.log('Countersignatures:  ', covenant.countersignatures?.length ?? 0);

  // ── Step 3: Verify before countersigning ────────────────────────────────
  // The document should be valid even without countersignatures.

  console.log('\n--- Step 3: Verify Before Countersigning ---\n');

  const verifier = new Verifier({ verifierId: 'audit-verifier-001', strictMode: false });

  const preAuditReport = await verifier.verify(covenant);
  console.log('Pre-audit valid:', preAuditReport.valid);
  console.log('Verifier ID:    ', preAuditReport.verifierId);

  for (const check of preAuditReport.checks) {
    const icon = check.passed ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${check.name}: ${check.message}`);
  }

  if (preAuditReport.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of preAuditReport.warnings) {
      console.log(`  - ${w}`);
    }
  }

  // ── Step 4: Auditor 1 countersigns ──────────────────────────────────────
  // The first auditor reviews the covenant and adds their signature.

  console.log('\n--- Step 4: Auditor 1 Countersigns ---\n');

  const afterAuditor1 = await countersignCovenant(covenant, auditor1Keys, 'auditor');

  console.log('Countersignatures after Auditor 1:', afterAuditor1.countersignatures?.length ?? 0);

  const cs1 = afterAuditor1.countersignatures![0]!;
  console.log('  Signer public key:', cs1.signerPublicKey.slice(0, 32) + '...');
  console.log('  Signer role:      ', cs1.signerRole);
  console.log('  Timestamp:        ', cs1.timestamp);
  console.log('  Signature:        ', cs1.signature.slice(0, 32) + '...');

  // ── Step 5: Auditor 2 countersigns ──────────────────────────────────────
  // The second auditor independently reviews and countersigns.

  console.log('\n--- Step 5: Auditor 2 Countersigns ---\n');

  const afterAuditor2 = await countersignCovenant(afterAuditor1, auditor2Keys, 'auditor');

  console.log('Countersignatures after Auditor 2:', afterAuditor2.countersignatures?.length ?? 0);

  const cs2 = afterAuditor2.countersignatures![1]!;
  console.log('  Signer public key:', cs2.signerPublicKey.slice(0, 32) + '...');
  console.log('  Signer role:      ', cs2.signerRole);
  console.log('  Timestamp:        ', cs2.timestamp);
  console.log('  Signature:        ', cs2.signature.slice(0, 32) + '...');

  // ── Step 6: Verify the fully countersigned document ─────────────────────
  // Verification now checks both the issuer signature AND all countersignatures.

  console.log('\n--- Step 6: Verify Fully Countersigned Document ---\n');

  const finalReport = await verifier.verify(afterAuditor2);
  console.log('Final verification valid:', finalReport.valid);
  console.log('Duration:               ', finalReport.durationMs, 'ms');

  for (const check of finalReport.checks) {
    const icon = check.passed ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${check.name}: ${check.message}`);
  }

  // ── Step 7: Show all countersignature details ───────────────────────────

  console.log('\n--- Step 7: Countersignature Details ---\n');

  const countersigs = afterAuditor2.countersignatures ?? [];
  console.log(`Total countersignatures: ${countersigs.length}\n`);

  for (let i = 0; i < countersigs.length; i++) {
    const cs = countersigs[i]!;
    const isAuditor1 = cs.signerPublicKey === auditor1Keys.publicKeyHex;
    const label = isAuditor1 ? 'Auditor 1 (Compliance)' : 'Auditor 2 (Risk)';

    console.log(`  Countersignature ${i + 1}: ${label}`);
    console.log(`    Public key: ${cs.signerPublicKey.slice(0, 32)}...`);
    console.log(`    Role:       ${cs.signerRole}`);
    console.log(`    Timestamp:  ${cs.timestamp}`);
    console.log(`    Signature:  ${cs.signature.slice(0, 32)}...`);
    console.log('');
  }

  // ── Step 8: Verify actions against the audited covenant ─────────────────
  // The verifier can also check if specific actions are permitted.

  console.log('--- Step 8: Verify Actions ---\n');

  const actionTests = [
    { action: 'read', resource: '/market-data/btc-usd' },
    { action: 'execute', resource: '/trades/small/buy-btc' },
    { action: 'execute', resource: '/trades/large/sell-all' },
    { action: 'delete', resource: '/market-data/history' },
  ];

  for (const { action, resource } of actionTests) {
    const report = await verifier.verifyAction(afterAuditor2, action, resource);
    const status = report.permitted ? 'PERMITTED' : 'DENIED';
    const docValid = report.documentValid ? 'valid' : 'INVALID';
    console.log(`  ${action} ${resource} => ${status} (document: ${docValid})`);
  }

  // ── Step 9: Verification history ────────────────────────────────────────

  console.log('\n--- Step 9: Verification History ---\n');

  const history = verifier.getHistory();
  console.log(`Verifier has ${history.length} records:\n`);

  for (const record of history) {
    const ids = record.documentIds.map((id) => id.slice(0, 16) + '...').join(', ');
    const status = record.valid ? 'VALID' : 'INVALID';
    console.log(`  [${record.kind}] ${status} - ${ids} (${record.durationMs}ms)`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log('\n--- Summary ---\n');
  console.log('Parties involved:      4 (issuer, beneficiary, 2 auditors)');
  console.log('Countersignatures:    ', countersigs.length);
  console.log('All checks passed:    ', finalReport.valid);
  console.log('Verification records: ', history.length);

  console.log('\n========================================');
  console.log('  Example complete!');
  console.log('========================================');
}

main().catch(console.error);
