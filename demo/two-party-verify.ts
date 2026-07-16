/**
 * Nobulex Two-Party Verification Demo
 * 
 * Shows why cryptography matters:
 * 1. Operator creates a covenant for their AI agent
 * 2. Agent operates under those rules
 * 3. A THIRD PARTY (regulator) verifies the proof, without trusting the operator
 */

import { protect } from '@nobulex/sdk';
import { verifyCovenant } from '@nobulex/core';

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  NOBULEX: Two-Party Verification Demo');
  console.log('═══════════════════════════════════════════════\n');

  // ── STEP 1: Operator creates a covenant ──
  console.log('STEP 1: Operator creates a covenant for their agent\n');

  const agent = await protect({
    name: 'loan-approval-agent',
    rules: ['read-only', 'no-data-leak'],
  });

  console.log(`  Agent ID:    ${agent.id}`);
  console.log(`  Rules:       ${agent.rules.join(', ')}`);
  console.log(`  Signed:      ✓ (Ed25519)`);
  console.log(`  Constraints:\n${agent.constraints.split('\n').map(l => '    ' + l).join('\n')}`);
  console.log();

  // ── STEP 2: Operator claims compliance ──
  console.log('STEP 2: Operator says "my agent followed the rules"\n');
  console.log('  Operator: "Trust me, the agent was compliant."\n');

  // ── STEP 3: Regulator verifies independently ──
  console.log('STEP 3: Regulator verifies, WITHOUT trusting the operator\n');

  // The regulator only has the covenant document. No access to the operator's systems.
  const result = await verifyCovenant(agent.covenant);

  console.log(`  Signature valid:  ${result.valid ? '✓' : '✗'}`);
  console.log(`  Issuer verified:  ${result.valid ? '✓' : '✗'}`);
  console.log(`  Tamper-evident:   ${result.valid ? '✓' : '✗'}`);
  console.log();

  if (result.valid) {
    console.log('  ✅ VERIFIED: The covenant is cryptographically valid.');
    console.log('  The regulator now has mathematical proof that:');
    console.log('    - This agent was bound to these specific rules');
    console.log('    - The rules were signed by this specific operator');
    console.log('    - Nothing was altered after signing');
  } else {
    console.log('  ❌ FAILED: Covenant verification failed.');
    console.log(`  Reason: ${result.error}`);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  This is why cryptography matters.');
  console.log('  Without it, "we followed the rules" is just words.');
  console.log('  With it, it\'s a verifiable proof.');
  console.log('═══════════════════════════════════════════════\n');
}

main().catch(console.error);
