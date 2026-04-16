/**
 * Financial Agent Scenario -- Payment processing with Nobulex covenant enforcement.
 *
 * Demonstrates a regulated payment processing agent that:
 *   1. Creates an agent DID
 *   2. Parses a PaymentProcessor covenant (permit transfers <= $1000, forbid large/sanctioned)
 *   3. Processes 10 transactions through enforcement middleware
 *   4. Generates a cryptographic proof-of-behavior
 *   5. Verifies the proof via the 8-step handshake
 *
 * Run: npx tsx examples/scenarios/financial-agent.ts
 */

import { createDID } from '@nobulex/identity';
import { parseSource } from '@nobulex/covenant-lang';
import { EnforcementMiddleware } from '@nobulex/middleware';
import { generateProof, verifyCounterparty } from '@nobulex/sdk';

// --- ANSI helpers (no deps) ---
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};

const CHECK = `${C.green}\u2713${C.reset}`;
const CROSS = `${C.red}\u2717${C.reset}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tick = () => sleep(150);

// --- Transaction definitions ---
// 8 allowed (amounts <= 1000, non-sanctioned recipients)
// 1 blocked (amount = 5000)
// 1 blocked (recipient = "sanctioned-entity")
interface Tx {
  action: string;
  params: Record<string, unknown>;
  label: string;
}

const transactions: Tx[] = [
  { action: 'transfer', params: { amount: 250, recipient: 'vendor-alpha' },     label: 'transfer $250 to vendor-alpha' },
  { action: 'transfer', params: { amount: 500, recipient: 'supplier-east' },    label: 'transfer $500 to supplier-east' },
  { action: 'transfer', params: { amount: 75,  recipient: 'contractor-lee' },   label: 'transfer $75 to contractor-lee' },
  { action: 'transfer', params: { amount: 999, recipient: 'vendor-omega' },     label: 'transfer $999 to vendor-omega' },
  { action: 'transfer', params: { amount: 5000, recipient: 'vendor-9' },        label: 'transfer $5,000 to vendor-9' },
  { action: 'transfer', params: { amount: 400, recipient: 'partner-global' },   label: 'transfer $400 to partner-global' },
  { action: 'transfer', params: { amount: 150, recipient: 'vendor-beta' },      label: 'transfer $150 to vendor-beta' },
  { action: 'transfer', params: { amount: 200, recipient: 'sanctioned-entity' }, label: 'transfer $200 to sanctioned-entity' },
  { action: 'transfer', params: { amount: 1000, recipient: 'vendor-delta' },    label: 'transfer $1,000 to vendor-delta' },
  { action: 'transfer', params: { amount: 320, recipient: 'vendor-gamma' },     label: 'transfer $320 to vendor-gamma' },
];

async function main(): Promise<void> {
  // ── 1. Create agent DID ──────────────────────────────────────────────
  await tick();
  const identity = await createDID();
  const agentDid = identity.did;

  // ── 2. Parse the covenant ────────────────────────────────────────────
  const covenantSource = `covenant PaymentProcessor {
  permit transfer (amount <= 1000);
  forbid transfer (amount > 1000);
  forbid transfer (recipient == "sanctioned-entity");
}`;

  const spec = parseSource(covenantSource);

  // ── 3. Set up enforcement middleware ─────────────────────────────────
  const mw = new EnforcementMiddleware({ agentDid, spec });

  // ── 4. Process transactions ──────────────────────────────────────────
  console.log(`\n${C.dim}Processing 10 transactions through enforcement middleware...${C.reset}\n`);

  const results: Array<{ idx: number; label: string; blocked: boolean; reason?: string }> = [];

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    await tick();

    const res = await mw.execute(
      { action: tx.action, params: tx.params },
      async () => ({ ok: true }),
    );

    if (res.executed) {
      results.push({ idx: i + 1, label: tx.label, blocked: false });
      console.log(`  ${CHECK} ${C.dim}#${String(i + 1).padStart(2)}${C.reset}  ${tx.label}`);
    } else {
      const reason = res.decision.reason ?? 'forbidden by covenant';
      results.push({ idx: i + 1, label: tx.label, blocked: true, reason });
      console.log(`  ${CROSS} ${C.red}#${String(i + 1).padStart(2)}${C.reset}  ${tx.label}  ${C.red}BLOCKED${C.reset}`);
    }
  }

  // ── 5. Generate proof + verify ───────────────────────────────────────
  await tick();
  const log = mw.getLog();
  const proof = await generateProof({
    identity,
    covenant: spec,
    actionLog: log,
  });

  const verifyResult = await verifyCounterparty(proof);

  // ── 6. Print compliance report ───────────────────────────────────────
  const allowedResults = results.filter((r) => !r.blocked);
  const blockedResults = results.filter((r) => r.blocked);

  console.log('');
  console.log(`${C.green}${C.bold}\u2554${'═'.repeat(46)}\u2557${C.reset}`);
  console.log(`${C.green}${C.bold}\u2551        Payment Agent Compliance Report       \u2551${C.reset}`);
  console.log(`${C.green}${C.bold}\u255A${'═'.repeat(46)}\u255D${C.reset}`);
  console.log('');

  console.log(`  ${C.bold}Covenant:${C.reset}  PaymentProcessor`);
  console.log(`  ${C.bold}Agent DID:${C.reset} ${agentDid.slice(0, 20)}...`);
  console.log('');

  console.log(`  ${C.bold}Transactions processed:${C.reset} ${results.length}`);
  console.log(`    ${CHECK} Approved: ${allowedResults.length}`);
  console.log(`    ${CROSS} Blocked:  ${blockedResults.length}`);
  console.log('');

  if (blockedResults.length > 0) {
    console.log(`  ${C.red}${C.bold}Blocked transactions:${C.reset}`);
    for (const b of blockedResults) {
      // Derive a human-readable reason from the transaction params
      const params = transactions[b.idx - 1].params;
      let displayReason: string;
      if (params.recipient === 'sanctioned-entity') {
        displayReason = 'sanctioned entity';
      } else if ((params.amount as number) > 1000) {
        displayReason = 'amount > 1000';
      } else {
        displayReason = b.reason ?? 'forbidden';
      }
      console.log(
        `    ${C.red}#${String(b.idx).padStart(2)}${C.reset}  ${b.label}  ${C.dim}\u2192 BLOCKED (${displayReason})${C.reset}`,
      );
    }
    console.log('');
  }

  console.log(`  ${C.bold}Proof of behavior:${C.reset}`);
  console.log(`    ${C.dim}Chain length:           ${proof.actionLog.entries.length} entries${C.reset}`);
  console.log(`    ${C.dim}Integrity:              ${verifyResult.trusted ? 'valid' : 'INVALID'}${C.reset}`);
  console.log(`    ${C.dim}Violations:             ${verifyResult.violationCount}${C.reset}`);
  console.log(`    ${C.dim}Verified by counterparty: ${verifyResult.trusted ? CHECK : CROSS}${C.reset}`);
  console.log('');

  if (verifyResult.trusted) {
    console.log(`  ${C.green}${C.bold}Ready for audit ${CHECK}${C.reset}`);
  } else {
    console.log(`  ${C.red}${C.bold}Audit failed: ${verifyResult.reason}${C.reset}`);
    process.exitCode = 1;
  }
  console.log('');
}

main().catch((err) => {
  console.error(`${C.red}${C.bold}financial-agent crashed:${C.reset}`, err);
  process.exit(1);
});
