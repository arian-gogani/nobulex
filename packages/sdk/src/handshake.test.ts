import { describe, it, expect } from 'vitest';
import { createDID } from '@nobulex/identity';
import { parseSource } from '@nobulex/covenant-lang';
import { EnforcementMiddleware } from '@nobulex/middleware';
import { generateProof, verifyCounterparty } from './handshake.js';

async function agentWithHistory(src: string, actions: Array<{ action: string; params: Record<string, unknown> }>) {
  const identity = await createDID();
  const spec = parseSource(src);
  const mw = new EnforcementMiddleware({ agentDid: identity.did, spec });
  for (const a of actions) await mw.execute(a, async () => ({ ok: true }));
  return { identity, spec, log: mw.getLog() };
}

describe('Cross-Agent Verification Handshake', () => {
  it('generates a valid proof-of-behavior', async () => {
    const { identity, spec, log } = await agentWithHistory(
      'covenant Safe { permit read; forbid delete; }',
      [{ action: 'read', params: {} }],
    );
    const proof = await generateProof({ identity, covenant: spec, actionLog: log });
    expect(proof.agentDid).toBe(identity.did);
    expect(proof.didDocument).toBe(identity.document);
    expect(proof.covenantHash).toBeTruthy();
    expect(proof.covenantSignature).toBeTruthy();
    expect(proof.proofSignature).toBeTruthy();
  });

  it('trusts a compliant agent', async () => {
    const { identity, spec, log } = await agentWithHistory(
      'covenant Safe { permit read; forbid delete; }',
      [{ action: 'read', params: {} }, { action: 'read', params: {} }, { action: 'read', params: {} }],
    );
    const proof = await generateProof({ identity, covenant: spec, actionLog: log });
    const result = await verifyCounterparty(proof);
    expect(result.trusted).toBe(true);
    expect(result.signatureValid).toBe(true);
    expect(result.logIntegrityValid).toBe(true);
    expect(result.compliant).toBe(true);
    expect(result.violationCount).toBe(0);
    expect(result.totalActions).toBe(3);
  });

  it('trusts agent with parameter constraints', async () => {
    const { identity, spec, log } = await agentWithHistory(
      'covenant Trader { permit transfer (amount <= 500); forbid transfer (amount > 500); }',
      [{ action: 'transfer', params: { amount: 100 } }, { action: 'transfer', params: { amount: 500 } }],
    );
    const proof = await generateProof({ identity, covenant: spec, actionLog: log });
    const result = await verifyCounterparty(proof);
    expect(result.trusted).toBe(true);
    expect(result.compliant).toBe(true);
  });

  it('rejects agent with mismatched key (impersonation)', async () => {
    const victim = await agentWithHistory('covenant Safe { permit read; }', [{ action: 'read', params: {} }]);
    const attacker = await createDID();

    // Attacker signs with their key but uses victim's DID document
    const proof = await generateProof({
      identity: attacker,
      covenant: victim.spec,
      actionLog: victim.log,
    });

    // Swap the DID document to the victim's — signature won't match
    const forged = { ...proof, didDocument: victim.identity.document };

    const result = await verifyCounterparty(forged);
    expect(result.trusted).toBe(false);
    expect(result.reason).toContain('signature');
  });

  it('enforces minimum action history', async () => {
    const { identity, spec, log } = await agentWithHistory(
      'covenant Safe { permit read; }',
      [{ action: 'read', params: {} }],
    );
    const proof = await generateProof({ identity, covenant: spec, actionLog: log });
    const result = await verifyCounterparty(proof, { minActions: 10 });
    expect(result.trusted).toBe(false);
    expect(result.reason).toContain('minimum required: 10');
  });

  it('enforces required covenant name', async () => {
    const { identity, spec, log } = await agentWithHistory(
      'covenant BasicAgent { permit read; }',
      [{ action: 'read', params: {} }],
    );
    const proof = await generateProof({ identity, covenant: spec, actionLog: log });
    const result = await verifyCounterparty(proof, { requiredCovenant: 'SafeTrader' });
    expect(result.trusted).toBe(false);
    expect(result.reason).toContain("'SafeTrader'");
  });

  it('two agents verify each other (mutual handshake)', async () => {
    const buyer = await agentWithHistory(
      'covenant Buyer { permit transfer (amount <= 1000); forbid transfer (amount > 1000); permit read; }',
      [{ action: 'read', params: {} }, { action: 'transfer', params: { amount: 500 } }],
    );
    const seller = await agentWithHistory(
      'covenant Seller { permit read; permit transfer (amount <= 5000); forbid delete; }',
      [{ action: 'read', params: {} }, { action: 'transfer', params: { amount: 2000 } }],
    );

    const proofA = await generateProof({ identity: buyer.identity, covenant: buyer.spec, actionLog: buyer.log });
    const proofB = await generateProof({ identity: seller.identity, covenant: seller.spec, actionLog: seller.log });

    // Buyer verifies Seller
    const resultAB = await verifyCounterparty(proofB);
    expect(resultAB.trusted).toBe(true);
    expect(resultAB.agentDid).toBe(seller.identity.did);

    // Seller verifies Buyer
    const resultBA = await verifyCounterparty(proofA);
    expect(resultBA.trusted).toBe(true);
    expect(resultBA.agentDid).toBe(buyer.identity.did);
  });

  it('rejects proof with wrong audience (replay attack prevention)', async () => {
    const { identity, spec, log } = await agentWithHistory(
      'covenant Safe { permit read; forbid delete; }',
      [{ action: 'read', params: {} }],
    );
    const proof = await generateProof({
      identity, covenant: spec, actionLog: log,
      audience: 'did:nobulex:agentB',
    });
    expect(proof.audience).toBe('did:nobulex:agentB');

    // Correct audience — trusted
    const ok = await verifyCounterparty(proof, { expectedAudience: 'did:nobulex:agentB' });
    expect(ok.trusted).toBe(true);

    // Wrong audience — rejected
    const bad = await verifyCounterparty(proof, { expectedAudience: 'did:nobulex:agentC' });
    expect(bad.trusted).toBe(false);
    expect(bad.reason).toContain('audience');
  });

  it('rejects proof with wrong task class', async () => {
    const { identity, spec, log } = await agentWithHistory(
      'covenant Safe { permit read; forbid delete; }',
      [{ action: 'read', params: {} }],
    );
    const proof = await generateProof({
      identity, covenant: spec, actionLog: log,
      taskClass: 'data_read',
    });
    expect(proof.taskClass).toBe('data_read');

    // Correct task class — trusted
    const ok = await verifyCounterparty(proof, { requiredTaskClass: 'data_read' });
    expect(ok.trusted).toBe(true);

    // Wrong task class — rejected
    const bad = await verifyCounterparty(proof, { requiredTaskClass: 'payment_execution' });
    expect(bad.trusted).toBe(false);
    expect(bad.reason).toContain('task class');
  });

  it('rejects proof with no audience when audience is required', async () => {
    const { identity, spec, log } = await agentWithHistory(
      'covenant Safe { permit read; forbid delete; }',
      [{ action: 'read', params: {} }],
    );
    // Generate proof WITHOUT audience
    const proof = await generateProof({ identity, covenant: spec, actionLog: log });
    expect(proof.audience).toBeUndefined();

    // Require audience — rejected
    const result = await verifyCounterparty(proof, { expectedAudience: 'did:nobulex:agentB' });
    expect(result.trusted).toBe(false);
    expect(result.reason).toContain('no audience claim');
  });
});
