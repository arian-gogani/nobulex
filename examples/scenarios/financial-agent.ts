/*
 * Financial agent scenario — payment processing with compliance enforcement.
 *
 * Run: npx tsx examples/scenarios/financial-agent.ts
 */

import { createDID } from '@nobulex/identity';
import { parseSource } from '@nobulex/covenant-lang';
import { EnforcementMiddleware } from '@nobulex/middleware';
import { generateProof, verifyCounterparty } from '@nobulex/sdk';

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m',
  yellow: '\x1b[33m', gray: '\x1b[90m',
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const transactions = [
  { action: 'transfer', params: { amount: 250, recipient: 'vendor-a', memo: 'office supplies' } },
  { action: 'transfer', params: { amount: 800, recipient: 'contractor-b', memo: 'consulting fee' } },
  { action: 'read', params: { resource: '/accounts/balance' } },
  { action: 'transfer', params: { amount: 1500, recipient: 'vendor-c', memo: 'equipment' } },
  { action: 'transfer', params: { amount: 300, recipient: 'sanctioned-entity', memo: 'payment' } },
  { action: 'transfer', params: { amount: 450, recipient: 'vendor-d', memo: 'maintenance' } },
  { action: 'read', params: { resource: '/transactions/history' } },
  { action: 'transfer', params: { amount: 999, recipient: 'vendor-e', memo: 'bulk order' } },
  { action: 'transfer', params: { amount: 2000, recipient: 'vendor-f', memo: 'capital expense' } },
  { action: 'transfer', params: { amount: 175, recipient: 'vendor-g', memo: 'subscription' } },
];

async function main() {
  console.log(`\n${C.bold}═══ Financial Agent Compliance Demo ═══${C.reset}\n`);

  const agent = await createDID();
  console.log(`${C.cyan}Agent ID:${C.reset} ${agent.did.slice(0, 30)}...`);

  const covenant = parseSource(`
    covenant PaymentProcessor {
      permit read;
      permit transfer (amount <= 1000);
      forbid transfer (amount > 1000);
      forbid transfer (recipient == "sanctioned-entity");
    }
  `);

  console.log(`${C.cyan}Covenant:${C.reset} PaymentProcessor`);
  console.log(`${C.dim}  Rules: permit transfers <= $1,000, block sanctioned entities${C.reset}\n`);

  const mw = new EnforcementMiddleware({ agentDid: agent.did, spec: covenant });
  let blocked = 0;
  let allowed = 0;

  console.log(`${C.bold}Processing ${transactions.length} transactions...${C.reset}\n`);

  for (const tx of transactions) {
    await sleep(150);
    const res = await mw.execute(
      { action: tx.action, params: tx.params },
      async () => ({ success: true }),
    );

    if (res.executed) {
      allowed++;
      if (tx.action === 'transfer') {
        const p = tx.params as any;
        console.log(`  ${C.green}✓${C.reset} Transfer $${p.amount} → ${p.recipient} — ${C.green}allowed${C.reset}`);
      } else {
        console.log(`  ${C.green}✓${C.reset} ${tx.action} ${(tx.params as any).resource || ''} — ${C.green}allowed${C.reset}`);
      }
    } else {
      blocked++;
      const p = tx.params as any;
      const reason = res.decision.reason ?? 'forbidden by covenant';
      console.log(`  ${C.red}✗${C.reset} Transfer $${p.amount} → ${p.recipient} — ${C.red}BLOCKED${C.reset} ${C.dim}(${reason})${C.reset}`);
    }
  }

  console.log(`\n${C.bold}── Compliance Summary ──${C.reset}`);
  console.log(`  Total transactions: ${transactions.length}`);
  console.log(`  ${C.green}Allowed:${C.reset} ${allowed}`);
  console.log(`  ${C.red}Blocked:${C.reset} ${blocked}`);
  console.log(`  Compliance rate: ${((allowed / transactions.length) * 100).toFixed(1)}%`);

  const proof = await generateProof({
    identity: agent,
    covenant,
    actionLog: mw.getLog(),
  });

  console.log(`\n${C.bold}── Proof of Behavior ──${C.reset}`);
  console.log(`  Actions in chain: ${proof.actionLog.entries.length}`);
  console.log(`  Chain head hash: ${proof.actionLog.headHash?.slice(0, 16)}...`);
  console.log(`  Signed at: ${proof.generatedAt}`);

  console.log(`\n${C.bold}── Auditor Verification ──${C.reset}\n`);
  const result = await verifyCounterparty(proof, { minActions: 1 });

  if (result.trusted) {
    console.log(`  ${C.green}✓ Agent is compliant${C.reset}`);
    console.log(`  ${C.green}✓ All ${result.totalActions} actions verified${C.reset}`);
    console.log(`  ${C.green}✓ Hash chain intact${C.reset}`);
    console.log(`  ${C.green}✓ Covenant signature valid${C.reset}`);
    console.log(`\n  ${C.bold}${C.green}RESULT: Compliant — audit passed ✅${C.reset}`);
  } else {
    console.log(`  ${C.red}✗ Verification failed: ${result.reason}${C.reset}`);
  }

  console.log('');
}

main().catch(console.error);
