/**
 * Trust Capital Demo
 *
 * Shows how an AI agent earns credit through verified behavior.
 * The agent starts restricted, builds a receipt chain, and
 * progressively unlocks higher capabilities.
 *
 * Run: npx tsx examples/trust-capital-demo.ts
 */

import {
  createDID,
  parseSource,
  EnforcementMiddleware,
  TrustCapitalLedger,
} from '../packages/core/src/index';

async function main() {
  console.log('\n=== Trust Capital Demo ===\n');
  console.log('An agent earns credit through verified behavior.\n');

  // 1. Create agent identity
  const agent = await createDID();
  console.log(`Agent: ${agent.did}\n`);

  // 2. Define behavioral rules
  const spec = parseSource(`
    covenant CustomerService {
      permit read;
      permit respond;
      permit refund (amount <= 200);
      forbid refund (amount > 200);
      forbid delete;
    }
  `);

  // 3. Create middleware with Trust Capital tracking
  const mw = new EnforcementMiddleware({
    agentDid: agent.did,
    spec,
    signer: {
      privateKey: agent.privateKey,
      publicKeyHex: agent.publicKeyHex,
    },
    trackTrustCapital: true,
  });

  // 4. Check starting credit
  console.log('--- Starting Credit ---');
  const startScore = mw.trustCapital!;
  console.log(`Score: ${startScore.score}`);
  console.log(`Tier: ${startScore.tier}`);
  console.log(`Capabilities: ${startScore.capabilities.join(', ')}`);
  console.log(`Can approve transactions? ${mw.canDo('approve_transactions')}`);
  console.log();

  // 5. Agent performs actions, building credit
  console.log('--- Building Credit ---');
  const actions = [
    { action: 'read', params: { resource: '/tickets/1234' } },
    { action: 'respond', params: { ticketId: '1234', message: 'How can I help?' } },
    { action: 'read', params: { resource: '/orders/5678' } },
    { action: 'refund', params: { amount: 50, orderId: '5678' } },
    { action: 'read', params: { resource: '/customers/9012' } },
    { action: 'respond', params: { ticketId: '9012', message: 'Your refund is processed.' } },
  ];

  for (const ctx of actions) {
    const result = await mw.execute(ctx, async () => `Executed: ${ctx.action}`);
    const score = mw.trustCapital!;

    // Record to ledger (the middleware tracks this automatically)
    if (mw.ledger && result.receipt) {
      mw.ledger.record(result.receipt.authorizationHash, result.decision.action === 'allow');
    }

    const symbol = result.executed ? '\u2713' : '\u2717';
    console.log(`  ${symbol} ${ctx.action} ${JSON.stringify(ctx.params)}`);
    console.log(`    Score: ${score.score} | Tier: ${score.tier}`);
  }

  // 6. Try a forbidden action
  console.log('\n--- Forbidden Action ---');
  const blocked = await mw.execute(
    { action: 'delete', params: { resource: '/customers/9012' } },
    async () => 'should not run'
  );
  if (mw.ledger && blocked.receipt) {
    mw.ledger.record(blocked.receipt.authorizationHash, blocked.decision.action === 'allow');
  }
  console.log(`  \u2717 delete /customers/9012 -> BLOCKED`);
  console.log(`    Score: ${mw.trustCapital!.score} | Tier: ${mw.trustCapital!.tier}`);

  // 7. Show final credit state
  console.log('\n--- Final Credit State ---');
  const final = mw.trustCapital!;
  console.log(`Score: ${final.score}/1000`);
  console.log(`Tier: ${final.tier}`);
  console.log(`Receipts: ${final.receiptsEvaluated}`);
  console.log(`Compliance rate: ${(final.complianceRate * 100).toFixed(1)}%`);
  console.log(`Capabilities: ${final.capabilities.join(', ')}`);

  // 8. Show progression
  const next = mw.ledger?.receiptsToNextTier();
  if (next) {
    console.log(`\nNext tier: ${next.nextTier}`);
    console.log(`Receipts needed: ${next.receiptsNeeded}`);
  }

  console.log('\n--- What This Means ---');
  console.log('This agent has started building credit.');
  console.log('After enough clean receipts, it earns higher capabilities.');
  console.log('Its credit history is cryptographically verifiable by any third party.');
  console.log('That verified history has real economic value:');
  console.log('  - Lower insurance premiums');
  console.log('  - Higher transaction limits');
  console.log('  - Enterprise approval');
  console.log('  - Better routing in agent marketplaces');
  console.log('\nAutonomy earned, not granted.\n');
}

main().catch(console.error);
