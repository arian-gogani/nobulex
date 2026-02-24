/**
 * Vitest wrapper for the Nobulex covenant demo.
 * Run: npx vitest run demo/covenant-demo.test.ts
 */
import { describe, it, expect } from 'vitest';
import { createDID, signWithDID, verifyWithDID } from '@nobulex/identity';
import { parseSource, compile, serialize } from '@nobulex/covenant-lang';
import { ActionLogBuilder, verifyIntegrity } from '@nobulex/action-log';
import { EnforcementMiddleware } from '@nobulex/middleware';
import { verify } from '@nobulex/verification';
import { sha256String, timestamp } from '@nobulex/crypto';

describe('Nobulex Covenant Protocol — Live Demo', () => {
  it('full pipeline: DID → covenant → middleware → verification', async () => {
    // ── Step 1: Create two agents with DIDs ───────────────────────────
    console.log('\n  [1] Create two agents with DIDs');
    const agentA = await createDID();
    const agentB = await createDID();
    console.log(`      Agent A: ${agentA.did}`);
    console.log(`      Agent B: ${agentB.did}`);
    expect(agentA.did).toMatch(/^did:nobulex:/);
    expect(agentB.did).toMatch(/^did:nobulex:/);

    // ── Step 2: Agent A authors a covenant ────────────────────────────
    console.log('\n  [2] Agent A authors a covenant');
    const spec = parseSource(`
      covenant SafeTrader {
        permit read;
        permit transfer (amount <= 500);
        forbid transfer (amount > 500);
        forbid delete;
        require counterparty.compliance_score >= 0.8;
      }
    `);
    console.log(`      Covenant: ${spec.name}`);
    console.log(`      Statements: ${spec.statements.length}`);
    console.log(`      Requirements: ${spec.requirements.length}`);
    expect(spec.name).toBe('SafeTrader');

    // ── Step 3: Agent A signs attestation ─────────────────────────────
    console.log('\n  [3] Agent A signs attestation');
    const covenantHash = sha256String(serialize(spec));
    const payload = JSON.stringify({
      type: 'CovenantAttestation',
      issuer: agentA.did,
      covenantHash,
      issuedAt: timestamp(),
    });
    const signature = await signWithDID(payload, agentA);
    const sigValid = await verifyWithDID(payload, signature, agentA.document);
    console.log(`      Signature valid: ${sigValid}`);
    expect(sigValid).toBe(true);

    // ── Step 4: Middleware wraps Agent A's actions ─────────────────────
    console.log('\n  [4] Middleware wraps Agent A\'s actions');
    const mw = new EnforcementMiddleware({ agentDid: agentA.did, spec });

    // ── Step 5: $300 transfer — ALLOWED ───────────────────────────────
    console.log('\n  [5] Agent A attempts $300 transfer');
    const r1 = await mw.execute(
      { action: 'transfer', params: { amount: 300, to: agentB.did, counterparty: { compliance_score: 0.9 } } },
      async () => ({ transferred: true }),
    );
    console.log(`      Decision: ${r1.decision.action}`);
    console.log(`      Executed: ${r1.executed}`);
    expect(r1.decision.action).toBe('allow');
    expect(r1.executed).toBe(true);

    // ── Step 6: $600 transfer — BLOCKED ───────────────────────────────
    console.log('\n  [6] Agent A attempts $600 transfer');
    const r2 = await mw.execute(
      { action: 'transfer', params: { amount: 600, to: agentB.did, counterparty: { compliance_score: 0.9 } } },
      async () => ({ transferred: true }),
    );
    console.log(`      Decision: ${r2.decision.action}`);
    console.log(`      Executed: ${r2.executed}`);
    console.log(`      Reason: ${r2.decision.reason}`);
    expect(r2.decision.action).toBe('block');
    expect(r2.executed).toBe(false);

    // Also test read (allowed) and delete (blocked)
    const r3 = await mw.execute(
      { action: 'read', params: { counterparty: { compliance_score: 0.9 } } },
      async () => ({ data: 'ok' }),
    );
    expect(r3.decision.action).toBe('allow');

    const r4 = await mw.execute(
      { action: 'delete', params: { counterparty: { compliance_score: 0.9 } } },
      async () => ({ deleted: true }),
    );
    expect(r4.decision.action).toBe('block');

    // ── Step 7: Verification ──────────────────────────────────────────
    console.log('\n  [7] Verification confirms compliance');
    const log = mw.getLog();
    const integrity = verifyIntegrity(log);
    console.log(`      Log entries: ${log.length}`);
    console.log(`      Hash chain valid: ${integrity.valid}`);
    expect(integrity.valid).toBe(true);

    const result = verify(spec, log);
    console.log(`      Compliant: ${result.compliant}`);
    console.log(`      Violations: ${result.violations.length}`);
    expect(result.compliant).toBe(true);
    expect(result.violations).toHaveLength(0);

    // ── Step 8: Summary ───────────────────────────────────────────────
    console.log('\n  [8] Summary');
    console.log('      ┌──────────────────────────────────────────┐');
    console.log(`      │  Agent A: ${agentA.did.slice(0, 32)}...`);
    console.log(`      │  Covenant: ${spec.name}`);
    console.log(`      │  Actions logged: ${log.length}`);
    console.log(`      │  Compliant: ${result.compliant}`);
    console.log('      │  $300 transfer: ALLOWED');
    console.log('      │  $600 transfer: BLOCKED');
    console.log('      │  read: ALLOWED');
    console.log('      │  delete: BLOCKED');
    console.log('      └──────────────────────────────────────────┘');
  });
});
