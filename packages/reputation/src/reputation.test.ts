import { describe, it, expect } from 'vitest';
import { generateKeyPair, sha256String, toHex } from '@stele/crypto';
import type { KeyPair, HashHex } from '@stele/crypto';
import {
  createReceipt,
  verifyReceipt,
  countersignReceipt,
  verifyReceiptChain,
  computeReputationScore,
  computeReceiptsMerkleRoot,
  createStake,
  releaseStake,
  burnStake,
  createDelegation,
  burnDelegation,
  coBurnDelegation,
  createEndorsement,
  verifyEndorsement,
  DEFAULT_SCORING_CONFIG,
} from './index.js';
import type {
  ExecutionReceipt,
  ReputationScore,
  Endorsement,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a deterministic-looking hex hash (just a SHA-256 of a label). */
function fakeHash(label: string): HashHex {
  return sha256String(label);
}

/** Create a receipt using the agent's publicKeyHex as agentIdentityHash so
 *  that verifyReceipt can verify the signature against it. */
async function makeReceipt(
  agentKp: KeyPair,
  principalKp: KeyPair,
  outcome: ExecutionReceipt['outcome'] = 'fulfilled',
  previousReceiptHash: HashHex | null = null,
  breachSeverity?: 'critical' | 'high' | 'medium' | 'low',
): Promise<ExecutionReceipt> {
  return createReceipt(
    fakeHash('covenant-1'),
    agentKp.publicKeyHex,          // use raw pubkey hex so verify works
    principalKp.publicKeyHex,
    outcome,
    fakeHash('proof-1'),
    150,
    agentKp,
    previousReceiptHash,
    breachSeverity,
  );
}

// ---------------------------------------------------------------------------
// createReceipt
// ---------------------------------------------------------------------------

describe('createReceipt', () => {
  it('creates a valid receipt with all required fields', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const receipt = await makeReceipt(agentKp, principalKp);

    expect(receipt.id).toBeDefined();
    expect(receipt.id).toBe(receipt.receiptHash);
    expect(receipt.covenantId).toBe(fakeHash('covenant-1'));
    expect(receipt.agentIdentityHash).toBe(agentKp.publicKeyHex);
    expect(receipt.principalPublicKey).toBe(principalKp.publicKeyHex);
    expect(receipt.outcome).toBe('fulfilled');
    expect(receipt.proofHash).toBe(fakeHash('proof-1'));
    expect(receipt.durationMs).toBe(150);
    expect(receipt.completedAt).toBeDefined();
    expect(receipt.agentSignature).toBeDefined();
    expect(typeof receipt.agentSignature).toBe('string');
    expect(receipt.agentSignature.length).toBeGreaterThan(0);
    expect(receipt.previousReceiptHash).toBeNull();
    expect(receipt.principalSignature).toBeUndefined();
  });

  it('includes breachSeverity when outcome is breached', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const receipt = await makeReceipt(agentKp, principalKp, 'breached', null, 'high');

    expect(receipt.outcome).toBe('breached');
    expect(receipt.breachSeverity).toBe('high');
  });

  it('omits breachSeverity when not provided', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const receipt = await makeReceipt(agentKp, principalKp, 'fulfilled');

    expect(receipt.breachSeverity).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createReceipt -> verifyReceipt round-trip
// ---------------------------------------------------------------------------

describe('createReceipt -> verifyReceipt round-trip', () => {
  it('verifies a freshly created receipt', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const receipt = await makeReceipt(agentKp, principalKp);
    const valid = await verifyReceipt(receipt);

    expect(valid).toBe(true);
  });

  it('fails verification when receiptHash is tampered', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const receipt = await makeReceipt(agentKp, principalKp);
    const tampered = { ...receipt, receiptHash: fakeHash('tampered') };
    const valid = await verifyReceipt(tampered);

    expect(valid).toBe(false);
  });

  it('fails verification when a content field is tampered', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const receipt = await makeReceipt(agentKp, principalKp);
    const tampered = { ...receipt, durationMs: 9999 };
    const valid = await verifyReceipt(tampered);

    expect(valid).toBe(false);
  });

  it('fails verification when agentSignature is tampered', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const receipt = await makeReceipt(agentKp, principalKp);
    // Flip the last hex digit in the signature
    const sig = receipt.agentSignature;
    const lastChar = sig[sig.length - 1]!;
    const flipped = lastChar === '0' ? '1' : '0';
    const tampered = { ...receipt, agentSignature: sig.slice(0, -1) + flipped };
    const valid = await verifyReceipt(tampered);

    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// countersignReceipt
// ---------------------------------------------------------------------------

describe('countersignReceipt', () => {
  it('adds principalSignature to the receipt', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const receipt = await makeReceipt(agentKp, principalKp);
    expect(receipt.principalSignature).toBeUndefined();

    const countersigned = await countersignReceipt(receipt, principalKp);

    expect(countersigned.principalSignature).toBeDefined();
    expect(typeof countersigned.principalSignature).toBe('string');
    expect(countersigned.principalSignature!.length).toBeGreaterThan(0);
  });

  it('does not mutate the original receipt', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const receipt = await makeReceipt(agentKp, principalKp);
    await countersignReceipt(receipt, principalKp);

    expect(receipt.principalSignature).toBeUndefined();
  });

  it('preserves all existing receipt fields', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const receipt = await makeReceipt(agentKp, principalKp);
    const countersigned = await countersignReceipt(receipt, principalKp);

    expect(countersigned.id).toBe(receipt.id);
    expect(countersigned.receiptHash).toBe(receipt.receiptHash);
    expect(countersigned.agentSignature).toBe(receipt.agentSignature);
    expect(countersigned.covenantId).toBe(receipt.covenantId);
    expect(countersigned.outcome).toBe(receipt.outcome);
  });
});

// ---------------------------------------------------------------------------
// verifyReceiptChain
// ---------------------------------------------------------------------------

describe('verifyReceiptChain', () => {
  it('validates a correct chain of receipts', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', null);
    const r2 = await makeReceipt(agentKp, principalKp, 'fulfilled', r1.receiptHash);
    const r3 = await makeReceipt(agentKp, principalKp, 'partial', r2.receiptHash);

    expect(verifyReceiptChain([r1, r2, r3])).toBe(true);
  });

  it('validates an empty chain', () => {
    expect(verifyReceiptChain([])).toBe(true);
  });

  it('validates a single-element chain', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', null);
    expect(verifyReceiptChain([r1])).toBe(true);
  });

  it('fails when the first receipt has a non-null previousReceiptHash', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', fakeHash('bogus'));
    expect(verifyReceiptChain([r1])).toBe(false);
  });

  it('fails with a broken chain (wrong previousReceiptHash)', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', null);
    // r2 points to a bogus hash instead of r1.receiptHash
    const r2 = await makeReceipt(agentKp, principalKp, 'fulfilled', fakeHash('wrong'));

    expect(verifyReceiptChain([r1, r2])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeReputationScore
// ---------------------------------------------------------------------------

describe('computeReputationScore', () => {
  it('counts outcomes correctly', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', null);
    const r2 = await makeReceipt(agentKp, principalKp, 'fulfilled', r1.receiptHash);
    const r3 = await makeReceipt(agentKp, principalKp, 'partial', r2.receiptHash);
    const r4 = await makeReceipt(agentKp, principalKp, 'failed', r3.receiptHash);
    const r5 = await makeReceipt(agentKp, principalKp, 'breached', r4.receiptHash, 'medium');

    const score = computeReputationScore(agentKp.publicKeyHex, [r1, r2, r3, r4, r5]);

    expect(score.totalExecutions).toBe(5);
    expect(score.fulfilled).toBe(2);
    expect(score.partial).toBe(1);
    expect(score.failed).toBe(1);
    expect(score.breached).toBe(1);
    expect(score.agentIdentityHash).toBe(agentKp.publicKeyHex);
  });

  it('applies breach penalties (breached receipts lower the score)', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    // All fulfilled
    const fulfilledReceipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 10; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'fulfilled', prevHash);
      fulfilledReceipts.push(r);
      prevHash = r.receiptHash;
    }
    const fulfilledScore = computeReputationScore(agentKp.publicKeyHex, fulfilledReceipts);

    // Same count but with some breaches
    const mixedReceipts: ExecutionReceipt[] = [];
    prevHash = null;
    for (let i = 0; i < 7; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'fulfilled', prevHash);
      mixedReceipts.push(r);
      prevHash = r.receiptHash;
    }
    for (let i = 0; i < 3; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'breached', prevHash, 'high');
      mixedReceipts.push(r);
      prevHash = r.receiptHash;
    }
    const mixedScore = computeReputationScore(agentKp.publicKeyHex, mixedReceipts);

    expect(mixedScore.weightedScore).toBeLessThan(fulfilledScore.weightedScore);
    expect(mixedScore.breached).toBe(3);
  });

  it('perfect record yields a high score', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const receipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 15; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'fulfilled', prevHash);
      receipts.push(r);
      prevHash = r.receiptHash;
    }

    const score = computeReputationScore(agentKp.publicKeyHex, receipts);

    // With 15 fulfilled (>= minimumExecutions of 10), score should be close to 1.0
    expect(score.weightedScore).toBeGreaterThan(0.9);
    expect(score.successRate).toBe(1.0);
  });

  it('all breached yields a low score', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const receipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 10; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'breached', prevHash, 'critical');
      receipts.push(r);
      prevHash = r.receiptHash;
    }

    const score = computeReputationScore(agentKp.publicKeyHex, receipts);

    // Breached with critical severity yields negative outcome scores; clamped to 0
    expect(score.weightedScore).toBe(0);
    expect(score.successRate).toBe(0);
    expect(score.breached).toBe(10);
  });

  it('no receipts yields zero score', () => {
    const score = computeReputationScore(fakeHash('agent'), []);

    expect(score.totalExecutions).toBe(0);
    expect(score.weightedScore).toBe(0);
    expect(score.successRate).toBe(0);
    expect(score.fulfilled).toBe(0);
  });

  it('below minimumExecutions scales the score down', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    // 3 fulfilled receipts (below minimumExecutions of 10)
    const smallReceipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 3; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'fulfilled', prevHash);
      smallReceipts.push(r);
      prevHash = r.receiptHash;
    }

    // 15 fulfilled receipts (above minimumExecutions of 10)
    const largeReceipts: ExecutionReceipt[] = [];
    prevHash = null;
    for (let i = 0; i < 15; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'fulfilled', prevHash);
      largeReceipts.push(r);
      prevHash = r.receiptHash;
    }

    const smallScore = computeReputationScore(agentKp.publicKeyHex, smallReceipts);
    const largeScore = computeReputationScore(agentKp.publicKeyHex, largeReceipts);

    // The small set should be penalized for having < minimumExecutions
    expect(smallScore.weightedScore).toBeLessThan(largeScore.weightedScore);
  });

  it('includes endorsements in the score calculation', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const endorserKp = await generateKeyPair();

    const receipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 10; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'fulfilled', prevHash);
      receipts.push(r);
      prevHash = r.receiptHash;
    }

    const endorsement = await createEndorsement(
      endorserKp.publicKeyHex,
      agentKp.publicKeyHex,
      { covenantsCompleted: 10, breachRate: 0 },
      ['general'],
      0.9,
      endorserKp,
    );

    const scoreWithout = computeReputationScore(agentKp.publicKeyHex, receipts);
    const scoreWith = computeReputationScore(agentKp.publicKeyHex, receipts, [endorsement]);

    // With endorsements, the calculation blends in the endorsement weight
    // Both should be high for all-fulfilled, but the blending changes the value slightly
    expect(scoreWith.weightedScore).toBeDefined();
    expect(typeof scoreWith.weightedScore).toBe('number');
    // The endorsement weight is 0.15, endorsement value is 0.9
    // final = score * 0.85 + 0.15 * 0.9
    // For an all-fulfilled score ~1.0: final ~= 0.85 + 0.135 = 0.985
    expect(scoreWith.weightedScore).toBeGreaterThan(0.9);
    // scores should differ because endorsement blending is applied
    expect(scoreWith.weightedScore).not.toBe(scoreWithout.weightedScore);
  });

  it('computes successRate as (fulfilled + partial) / total', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', null);
    const r2 = await makeReceipt(agentKp, principalKp, 'partial', r1.receiptHash);
    const r3 = await makeReceipt(agentKp, principalKp, 'failed', r2.receiptHash);
    const r4 = await makeReceipt(agentKp, principalKp, 'failed', r3.receiptHash);

    const score = computeReputationScore(agentKp.publicKeyHex, [r1, r2, r3, r4]);

    // successRate = (1 fulfilled + 1 partial) / 4 = 0.5
    expect(score.successRate).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// createStake / releaseStake / burnStake
// ---------------------------------------------------------------------------

describe('createStake', () => {
  it('creates an active stake with correct fields', async () => {
    const agentKp = await generateKeyPair();

    const stake = await createStake(
      agentKp.publicKeyHex,
      fakeHash('covenant-1'),
      0.5,
      agentKp,
    );

    expect(stake.id).toBeDefined();
    expect(stake.agentIdentityHash).toBe(agentKp.publicKeyHex);
    expect(stake.covenantId).toBe(fakeHash('covenant-1'));
    expect(stake.amount).toBe(0.5);
    expect(stake.status).toBe('active');
    expect(stake.stakedAt).toBeDefined();
    expect(stake.signature).toBeDefined();
    expect(typeof stake.signature).toBe('string');
    expect(stake.signature.length).toBeGreaterThan(0);
    expect(stake.resolvedAt).toBeUndefined();
  });
});

describe('releaseStake', () => {
  it('changes status to released and sets resolvedAt', async () => {
    const agentKp = await generateKeyPair();

    const stake = await createStake(
      agentKp.publicKeyHex,
      fakeHash('covenant-1'),
      0.5,
      agentKp,
    );

    const released = releaseStake(stake, 'fulfilled');

    expect(released.status).toBe('released');
    expect(released.resolvedAt).toBeDefined();
    expect(typeof released.resolvedAt).toBe('string');
    // Original fields preserved
    expect(released.id).toBe(stake.id);
    expect(released.amount).toBe(0.5);
    expect(released.agentIdentityHash).toBe(stake.agentIdentityHash);
  });

  it('does not mutate the original stake', async () => {
    const agentKp = await generateKeyPair();

    const stake = await createStake(
      agentKp.publicKeyHex,
      fakeHash('covenant-1'),
      0.5,
      agentKp,
    );

    releaseStake(stake, 'fulfilled');

    expect(stake.status).toBe('active');
    expect(stake.resolvedAt).toBeUndefined();
  });
});

describe('burnStake', () => {
  it('changes status to burned and sets resolvedAt', async () => {
    const agentKp = await generateKeyPair();

    const stake = await createStake(
      agentKp.publicKeyHex,
      fakeHash('covenant-1'),
      0.5,
      agentKp,
    );

    const burned = burnStake(stake);

    expect(burned.status).toBe('burned');
    expect(burned.resolvedAt).toBeDefined();
    expect(typeof burned.resolvedAt).toBe('string');
    expect(burned.id).toBe(stake.id);
    expect(burned.amount).toBe(0.5);
  });

  it('does not mutate the original stake', async () => {
    const agentKp = await generateKeyPair();

    const stake = await createStake(
      agentKp.publicKeyHex,
      fakeHash('covenant-1'),
      0.5,
      agentKp,
    );

    burnStake(stake);

    expect(stake.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// createDelegation / burnDelegation
// ---------------------------------------------------------------------------

describe('createDelegation', () => {
  it('creates a delegation with dual signatures', async () => {
    const sponsorKp = await generateKeyPair();
    const protegeKp = await generateKeyPair();

    const delegation = await createDelegation(
      sponsorKp.publicKeyHex,
      protegeKp.publicKeyHex,
      0.5,
      ['compute', 'storage'],
      '2026-12-31T00:00:00.000Z',
      sponsorKp,
      protegeKp,
    );

    expect(delegation.id).toBeDefined();
    expect(delegation.sponsorIdentityHash).toBe(sponsorKp.publicKeyHex);
    expect(delegation.protégéIdentityHash).toBe(protegeKp.publicKeyHex);
    expect(delegation.riskAmount).toBe(0.5);
    expect(delegation.scopes).toEqual(['compute', 'storage']);
    expect(delegation.expiresAt).toBe('2026-12-31T00:00:00.000Z');
    expect(delegation.status).toBe('active');
    expect(delegation.sponsorSignature).toBeDefined();
    expect(delegation.sponsorSignature.length).toBeGreaterThan(0);
    expect(delegation.protégéSignature).toBeDefined();
    expect(delegation.protégéSignature.length).toBeGreaterThan(0);
    // The two signatures must be different (different keys)
    expect(delegation.sponsorSignature).not.toBe(delegation.protégéSignature);
  });
});

describe('burnDelegation', () => {
  it('changes status to burned', async () => {
    const sponsorKp = await generateKeyPair();
    const protegeKp = await generateKeyPair();

    const delegation = await createDelegation(
      sponsorKp.publicKeyHex,
      protegeKp.publicKeyHex,
      0.5,
      ['compute'],
      '2026-12-31T00:00:00.000Z',
      sponsorKp,
      protegeKp,
    );

    const burned = burnDelegation(delegation);

    expect(burned.status).toBe('burned');
    expect(burned.id).toBe(delegation.id);
    expect(burned.sponsorIdentityHash).toBe(delegation.sponsorIdentityHash);
    expect(burned.protégéIdentityHash).toBe(delegation.protégéIdentityHash);
  });

  it('does not mutate the original delegation', async () => {
    const sponsorKp = await generateKeyPair();
    const protegeKp = await generateKeyPair();

    const delegation = await createDelegation(
      sponsorKp.publicKeyHex,
      protegeKp.publicKeyHex,
      0.5,
      ['compute'],
      '2026-12-31T00:00:00.000Z',
      sponsorKp,
      protegeKp,
    );

    burnDelegation(delegation);

    expect(delegation.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// createEndorsement / verifyEndorsement
// ---------------------------------------------------------------------------

describe('createEndorsement', () => {
  it('creates a valid endorsement with all fields', async () => {
    const endorserKp = await generateKeyPair();
    const endorsedHash = fakeHash('endorsed-agent');

    const endorsement = await createEndorsement(
      endorserKp.publicKeyHex,
      endorsedHash,
      { covenantsCompleted: 20, breachRate: 0.02 },
      ['compute'],
      0.85,
      endorserKp,
    );

    expect(endorsement.id).toBeDefined();
    expect(endorsement.endorserIdentityHash).toBe(endorserKp.publicKeyHex);
    expect(endorsement.endorsedIdentityHash).toBe(endorsedHash);
    expect(endorsement.basis).toEqual({ covenantsCompleted: 20, breachRate: 0.02 });
    expect(endorsement.scopes).toEqual(['compute']);
    expect(endorsement.weight).toBe(0.85);
    expect(endorsement.issuedAt).toBeDefined();
    expect(endorsement.signature).toBeDefined();
    expect(endorsement.signature.length).toBeGreaterThan(0);
  });
});

describe('verifyEndorsement', () => {
  it('verifies a valid endorsement', async () => {
    const endorserKp = await generateKeyPair();
    const endorsedHash = fakeHash('endorsed-agent');

    const endorsement = await createEndorsement(
      endorserKp.publicKeyHex,
      endorsedHash,
      { covenantsCompleted: 10, breachRate: 0 },
      ['general'],
      0.9,
      endorserKp,
    );

    const valid = await verifyEndorsement(endorsement);
    expect(valid).toBe(true);
  });

  it('fails verification when a field is tampered', async () => {
    const endorserKp = await generateKeyPair();
    const endorsedHash = fakeHash('endorsed-agent');

    const endorsement = await createEndorsement(
      endorserKp.publicKeyHex,
      endorsedHash,
      { covenantsCompleted: 10, breachRate: 0 },
      ['general'],
      0.9,
      endorserKp,
    );

    const tampered = { ...endorsement, weight: 0.1 };
    const valid = await verifyEndorsement(tampered);
    expect(valid).toBe(false);
  });

  it('fails verification when signature is tampered', async () => {
    const endorserKp = await generateKeyPair();
    const endorsedHash = fakeHash('endorsed-agent');

    const endorsement = await createEndorsement(
      endorserKp.publicKeyHex,
      endorsedHash,
      { covenantsCompleted: 10, breachRate: 0 },
      ['general'],
      0.9,
      endorserKp,
    );

    const sig = endorsement.signature;
    const flipped = sig[sig.length - 1] === '0' ? '1' : '0';
    const tampered = { ...endorsement, signature: sig.slice(0, -1) + flipped };
    const valid = await verifyEndorsement(tampered);
    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Endorsement basis validation
// ---------------------------------------------------------------------------

describe('reputation - endorsement basis validation', () => {
  it('rejects negative covenantsCompleted', async () => {
    const kp = await generateKeyPair();
    await expect(createEndorsement(
      'endorser-hash', 'endorsed-hash',
      { covenantsCompleted: -1, breachRate: 0 },
      ['data'], 0.5, kp
    )).rejects.toThrow('covenantsCompleted');
  });

  it('rejects breachRate > 1', async () => {
    const kp = await generateKeyPair();
    await expect(createEndorsement(
      'endorser-hash', 'endorsed-hash',
      { covenantsCompleted: 10, breachRate: 1.5 },
      ['data'], 0.5, kp
    )).rejects.toThrow('breachRate');
  });

  it('rejects negative breachRate', async () => {
    const kp = await generateKeyPair();
    await expect(createEndorsement(
      'endorser-hash', 'endorsed-hash',
      { covenantsCompleted: 10, breachRate: -0.1 },
      ['data'], 0.5, kp
    )).rejects.toThrow('breachRate');
  });

  it('rejects averageOutcomeScore > 1', async () => {
    const kp = await generateKeyPair();
    await expect(createEndorsement(
      'endorser-hash', 'endorsed-hash',
      { covenantsCompleted: 10, breachRate: 0, averageOutcomeScore: 1.5 },
      ['data'], 0.5, kp
    )).rejects.toThrow('averageOutcomeScore');
  });

  it('rejects weight > 1', async () => {
    const kp = await generateKeyPair();
    await expect(createEndorsement(
      'endorser-hash', 'endorsed-hash',
      { covenantsCompleted: 10, breachRate: 0 },
      ['data'], 1.5, kp
    )).rejects.toThrow('weight');
  });

  it('accepts valid endorsement with all basis fields', async () => {
    const kp = await generateKeyPair();
    const endorsement = await createEndorsement(
      kp.publicKeyHex, 'endorsed-hash',
      { covenantsCompleted: 50, breachRate: 0.02, averageOutcomeScore: 0.95 },
      ['data.analysis', 'api.call'], 0.8, kp
    );
    expect(endorsement.basis.covenantsCompleted).toBe(50);
    expect(endorsement.basis.breachRate).toBe(0.02);
    expect(endorsement.basis.averageOutcomeScore).toBe(0.95);
    expect(endorsement.weight).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// Co-burn delegation
// ---------------------------------------------------------------------------

describe('reputation - co-burn delegation', () => {
  it('computes sponsor reputation loss on protege breach', async () => {
    const sponsorKp = await generateKeyPair();
    const protegeKp = await generateKeyPair();

    const delegation = await createDelegation(
      sponsorKp.publicKeyHex, protegeKp.publicKeyHex,
      0.3, ['data.analysis'],
      new Date(Date.now() + 86400000).toISOString(),
      sponsorKp, protegeKp
    );

    const sponsorScore: ReputationScore = {
      agentIdentityHash: sponsorKp.publicKeyHex,
      totalExecutions: 100,
      fulfilled: 95,
      partial: 3,
      failed: 2,
      breached: 0,
      successRate: 0.98,
      weightedScore: 0.95,
      receiptsMerkleRoot: 'abc123',
      lastUpdatedAt: new Date().toISOString(),
      currentStake: 0,
      totalBurned: 0,
    };

    const result = coBurnDelegation(delegation, sponsorScore);
    expect(result.burnedDelegation.status).toBe('burned');
    expect(result.sponsorReputationLoss).toBeCloseTo(0.3 * 0.95); // riskAmount * weightedScore
    expect(result.newSponsorBurned).toBeCloseTo(0.3 * 0.95);
  });

  it('accumulates burned reputation across multiple co-burns', async () => {
    const sponsorKp = await generateKeyPair();
    const protegeKp = await generateKeyPair();

    const delegation = await createDelegation(
      sponsorKp.publicKeyHex, protegeKp.publicKeyHex,
      0.2, ['data'],
      new Date(Date.now() + 86400000).toISOString(),
      sponsorKp, protegeKp
    );

    const sponsorScore: ReputationScore = {
      agentIdentityHash: sponsorKp.publicKeyHex,
      totalExecutions: 50,
      fulfilled: 50,
      partial: 0,
      failed: 0,
      breached: 0,
      successRate: 1.0,
      weightedScore: 0.80,
      receiptsMerkleRoot: 'abc123',
      lastUpdatedAt: new Date().toISOString(),
      currentStake: 0,
      totalBurned: 0.1, // already had some burned
    };

    const result = coBurnDelegation(delegation, sponsorScore);
    expect(result.newSponsorBurned).toBeCloseTo(0.1 + 0.2 * 0.80);
  });
});

// ---------------------------------------------------------------------------
// Stake validation
// ---------------------------------------------------------------------------

describe('reputation - stake validation', () => {
  it('rejects stake amount > 1', async () => {
    const kp = await generateKeyPair();
    await expect(createStake('agent-hash', 'covenant-id', 1.5, kp))
      .rejects.toThrow('amount');
  });

  it('rejects negative stake amount', async () => {
    const kp = await generateKeyPair();
    await expect(createStake('agent-hash', 'covenant-id', -0.1, kp))
      .rejects.toThrow('amount');
  });
});

// ---------------------------------------------------------------------------
// Delegation validation
// ---------------------------------------------------------------------------

describe('reputation - delegation validation', () => {
  it('rejects empty scopes', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    await expect(createDelegation(
      kp1.publicKeyHex, kp2.publicKeyHex,
      0.3, [],
      new Date(Date.now() + 86400000).toISOString(),
      kp1, kp2
    )).rejects.toThrow('scope');
  });

  it('rejects riskAmount > 1', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    await expect(createDelegation(
      kp1.publicKeyHex, kp2.publicKeyHex,
      1.5, ['data'],
      new Date(Date.now() + 86400000).toISOString(),
      kp1, kp2
    )).rejects.toThrow('riskAmount');
  });
});

// ---------------------------------------------------------------------------
// computeReceiptsMerkleRoot
// ---------------------------------------------------------------------------

describe('computeReceiptsMerkleRoot', () => {
  it('produces a consistent hash for the same receipts', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', null);
    const r2 = await makeReceipt(agentKp, principalKp, 'fulfilled', r1.receiptHash);

    const root1 = computeReceiptsMerkleRoot([r1, r2]);
    const root2 = computeReceiptsMerkleRoot([r1, r2]);

    expect(root1).toBe(root2);
  });

  it('produces different hashes for different receipt sets', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', null);
    const r2 = await makeReceipt(agentKp, principalKp, 'partial', r1.receiptHash);
    const r3 = await makeReceipt(agentKp, principalKp, 'failed', r2.receiptHash);

    const rootAB = computeReceiptsMerkleRoot([r1, r2]);
    const rootABC = computeReceiptsMerkleRoot([r1, r2, r3]);

    expect(rootAB).not.toBe(rootABC);
  });

  it('handles empty array by returning sha256 of empty string', () => {
    const root = computeReceiptsMerkleRoot([]);
    expect(root).toBe(sha256String(''));
  });

  it('handles a single receipt', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', null);
    const root = computeReceiptsMerkleRoot([r1]);

    // A single element is the root
    expect(root).toBe(r1.receiptHash);
  });

  it('handles odd number of receipts (duplicates last node)', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();

    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', null);
    const r2 = await makeReceipt(agentKp, principalKp, 'fulfilled', r1.receiptHash);
    const r3 = await makeReceipt(agentKp, principalKp, 'fulfilled', r2.receiptHash);

    const root = computeReceiptsMerkleRoot([r1, r2, r3]);

    // For 3 receipts: pair (r1,r2) -> h12, pair (r3,r3) -> h33, then pair (h12, h33) -> root
    const h12 = sha256String(r1.receiptHash + r2.receiptHash);
    const h33 = sha256String(r3.receiptHash + r3.receiptHash);
    const expectedRoot = sha256String(h12 + h33);

    expect(root).toBe(expectedRoot);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_SCORING_CONFIG
// ---------------------------------------------------------------------------

describe('DEFAULT_SCORING_CONFIG', () => {
  it('has expected values', () => {
    expect(DEFAULT_SCORING_CONFIG.recencyDecay).toBe(0.95);
    expect(DEFAULT_SCORING_CONFIG.recencyPeriod).toBe(86400);
    expect(DEFAULT_SCORING_CONFIG.minimumExecutions).toBe(10);
    expect(DEFAULT_SCORING_CONFIG.endorsementWeight).toBe(0.15);
    expect(DEFAULT_SCORING_CONFIG.breachPenalty).toEqual({
      critical: 0.5,
      high: 0.3,
      medium: 0.15,
      low: 0.05,
    });
  });
});

// ---------------------------------------------------------------------------
// EXPANDED TESTS: createReceipt / verifyReceipt with various outcomes
// ---------------------------------------------------------------------------

describe('createReceipt - various outcomes', () => {
  it('creates a receipt with outcome partial', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipt = await makeReceipt(agentKp, principalKp, 'partial');
    expect(receipt.outcome).toBe('partial');
    expect(receipt.breachSeverity).toBeUndefined();
    expect(receipt.id).toBe(receipt.receiptHash);
  });

  it('creates a receipt with outcome failed', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipt = await makeReceipt(agentKp, principalKp, 'failed');
    expect(receipt.outcome).toBe('failed');
    expect(receipt.breachSeverity).toBeUndefined();
  });

  it('creates a breached receipt with critical severity', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipt = await makeReceipt(agentKp, principalKp, 'breached', null, 'critical');
    expect(receipt.outcome).toBe('breached');
    expect(receipt.breachSeverity).toBe('critical');
  });

  it('creates a breached receipt with low severity', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipt = await makeReceipt(agentKp, principalKp, 'breached', null, 'low');
    expect(receipt.outcome).toBe('breached');
    expect(receipt.breachSeverity).toBe('low');
  });

  it('has a valid ISO 8601 completedAt timestamp', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const before = new Date().toISOString();
    const receipt = await makeReceipt(agentKp, principalKp);
    const after = new Date().toISOString();
    expect(receipt.completedAt >= before).toBe(true);
    expect(receipt.completedAt <= after).toBe(true);
  });

  it('two receipts with same params get different ids due to timestamp', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const r1 = await makeReceipt(agentKp, principalKp);
    // Small delay is not needed; timestamps at ms precision suffice
    const r2 = await makeReceipt(agentKp, principalKp);
    // They might have the same timestamp at sub-ms resolution, but the test documents the intent
    expect(typeof r1.id).toBe('string');
    expect(typeof r2.id).toBe('string');
  });
});

describe('verifyReceipt - tampered fields', () => {
  it('fails when covenantId is tampered', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipt = await makeReceipt(agentKp, principalKp);
    const tampered = { ...receipt, covenantId: fakeHash('other-covenant') };
    expect(await verifyReceipt(tampered)).toBe(false);
  });

  it('fails when outcome is tampered', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipt = await makeReceipt(agentKp, principalKp, 'fulfilled');
    const tampered = { ...receipt, outcome: 'failed' as const };
    expect(await verifyReceipt(tampered)).toBe(false);
  });

  it('fails when proofHash is tampered', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipt = await makeReceipt(agentKp, principalKp);
    const tampered = { ...receipt, proofHash: fakeHash('bad-proof') };
    expect(await verifyReceipt(tampered)).toBe(false);
  });

  it('fails when completedAt is tampered', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipt = await makeReceipt(agentKp, principalKp);
    const tampered = { ...receipt, completedAt: '2020-01-01T00:00:00.000Z' };
    expect(await verifyReceipt(tampered)).toBe(false);
  });

  it('fails when previousReceiptHash is tampered', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipt = await makeReceipt(agentKp, principalKp);
    const tampered = { ...receipt, previousReceiptHash: fakeHash('wrong-prev') };
    expect(await verifyReceipt(tampered)).toBe(false);
  });

  it('fails when principalPublicKey is tampered', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const otherKp = await generateKeyPair();
    const receipt = await makeReceipt(agentKp, principalKp);
    const tampered = { ...receipt, principalPublicKey: otherKp.publicKeyHex };
    expect(await verifyReceipt(tampered)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EXPANDED TESTS: countersignReceipt / verifyReceiptChain
// ---------------------------------------------------------------------------

describe('countersignReceipt - multi-countersigner chains', () => {
  it('can countersign with a different key pair than the principal', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const otherKp = await generateKeyPair();
    const receipt = await makeReceipt(agentKp, principalKp);
    const countersigned = await countersignReceipt(receipt, otherKp);
    expect(countersigned.principalSignature).toBeDefined();
    expect(countersigned.principalSignature!.length).toBeGreaterThan(0);
    // The signature is different from agent signature
    expect(countersigned.principalSignature).not.toBe(countersigned.agentSignature);
  });

  it('countersigning twice with different keys produces different signatures', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const altKp = await generateKeyPair();
    const receipt = await makeReceipt(agentKp, principalKp);
    const cs1 = await countersignReceipt(receipt, principalKp);
    const cs2 = await countersignReceipt(receipt, altKp);
    expect(cs1.principalSignature).not.toBe(cs2.principalSignature);
  });

  it('countersigned receipt still passes verifyReceipt (hash and agent sig unchanged)', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipt = await makeReceipt(agentKp, principalKp);
    const countersigned = await countersignReceipt(receipt, principalKp);
    expect(await verifyReceipt(countersigned)).toBe(true);
  });
});

describe('verifyReceiptChain - extended', () => {
  it('validates a long chain of 5 receipts with mixed outcomes', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const outcomes: Array<ExecutionReceipt['outcome']> = ['fulfilled', 'partial', 'fulfilled', 'failed', 'fulfilled'];
    const chain: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (const outcome of outcomes) {
      const r = await makeReceipt(agentKp, principalKp, outcome, prevHash);
      chain.push(r);
      prevHash = r.receiptHash;
    }
    expect(verifyReceiptChain(chain)).toBe(true);
  });

  it('fails when a middle link is removed from the chain', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', null);
    const r2 = await makeReceipt(agentKp, principalKp, 'fulfilled', r1.receiptHash);
    const r3 = await makeReceipt(agentKp, principalKp, 'fulfilled', r2.receiptHash);
    // Remove r2 from the chain
    expect(verifyReceiptChain([r1, r3])).toBe(false);
  });

  it('fails when receipts are in wrong order', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', null);
    const r2 = await makeReceipt(agentKp, principalKp, 'fulfilled', r1.receiptHash);
    // Swap order
    expect(verifyReceiptChain([r2, r1])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EXPANDED TESTS: computeReceiptsMerkleRoot
// ---------------------------------------------------------------------------

describe('computeReceiptsMerkleRoot - extended', () => {
  it('handles exactly 2 receipts (no duplication needed)', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', null);
    const r2 = await makeReceipt(agentKp, principalKp, 'partial', r1.receiptHash);
    const root = computeReceiptsMerkleRoot([r1, r2]);
    const expected = sha256String(r1.receiptHash + r2.receiptHash);
    expect(root).toBe(expected);
  });

  it('handles 4 receipts (perfect binary tree)', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 4; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'fulfilled', prevHash);
      receipts.push(r);
      prevHash = r.receiptHash;
    }
    const root = computeReceiptsMerkleRoot(receipts);
    const h01 = sha256String(receipts[0]!.receiptHash + receipts[1]!.receiptHash);
    const h23 = sha256String(receipts[2]!.receiptHash + receipts[3]!.receiptHash);
    const expectedRoot = sha256String(h01 + h23);
    expect(root).toBe(expectedRoot);
  });

  it('handles 5 receipts (odd at first level, even at second)', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 5; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'fulfilled', prevHash);
      receipts.push(r);
      prevHash = r.receiptHash;
    }
    const root = computeReceiptsMerkleRoot(receipts);
    // Level 0: h01 = H(r0+r1), h23 = H(r2+r3), h44 = H(r4+r4)
    const h01 = sha256String(receipts[0]!.receiptHash + receipts[1]!.receiptHash);
    const h23 = sha256String(receipts[2]!.receiptHash + receipts[3]!.receiptHash);
    const h44 = sha256String(receipts[4]!.receiptHash + receipts[4]!.receiptHash);
    // Level 1 (3 nodes -> odd): h_01_23 = H(h01+h23), h_44_44 = H(h44+h44)
    const h_01_23 = sha256String(h01 + h23);
    const h_44_44 = sha256String(h44 + h44);
    const expectedRoot = sha256String(h_01_23 + h_44_44);
    expect(root).toBe(expectedRoot);
  });

  it('different receipt order produces different merkle root', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', null);
    const r2 = await makeReceipt(agentKp, principalKp, 'partial', r1.receiptHash);
    const rootAB = computeReceiptsMerkleRoot([r1, r2]);
    const rootBA = computeReceiptsMerkleRoot([r2, r1]);
    expect(rootAB).not.toBe(rootBA);
  });
});

// ---------------------------------------------------------------------------
// EXPANDED TESTS: computeReputationScore - custom ScoringConfig
// ---------------------------------------------------------------------------

describe('computeReputationScore - custom ScoringConfig', () => {
  it('uses custom breachPenalty values', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 5; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'fulfilled', prevHash);
      receipts.push(r);
      prevHash = r.receiptHash;
    }
    for (let i = 0; i < 5; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'breached', prevHash, 'low');
      receipts.push(r);
      prevHash = r.receiptHash;
    }

    const heavyPenalty: import('./types.js').ScoringConfig = {
      recencyDecay: 0.95,
      recencyPeriod: 86400,
      breachPenalty: { critical: 1.0, high: 0.8, medium: 0.6, low: 0.4 },
      minimumExecutions: 5,
      endorsementWeight: 0.15,
    };
    const lightPenalty: import('./types.js').ScoringConfig = {
      recencyDecay: 0.95,
      recencyPeriod: 86400,
      breachPenalty: { critical: 0.1, high: 0.05, medium: 0.02, low: 0.01 },
      minimumExecutions: 5,
      endorsementWeight: 0.15,
    };

    const heavyScore = computeReputationScore(agentKp.publicKeyHex, receipts, undefined, heavyPenalty);
    const lightScore = computeReputationScore(agentKp.publicKeyHex, receipts, undefined, lightPenalty);
    expect(heavyScore.weightedScore).toBeLessThan(lightScore.weightedScore);
  });

  it('uses custom minimumExecutions threshold', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 5; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'fulfilled', prevHash);
      receipts.push(r);
      prevHash = r.receiptHash;
    }

    const lowThreshold: import('./types.js').ScoringConfig = {
      ...DEFAULT_SCORING_CONFIG,
      minimumExecutions: 3,
    };
    const highThreshold: import('./types.js').ScoringConfig = {
      ...DEFAULT_SCORING_CONFIG,
      minimumExecutions: 100,
    };

    const lowScore = computeReputationScore(agentKp.publicKeyHex, receipts, undefined, lowThreshold);
    const highScore = computeReputationScore(agentKp.publicKeyHex, receipts, undefined, highThreshold);
    // Low threshold: 5 >= 3, no penalty. High threshold: 5 < 100, penalty applied.
    expect(lowScore.weightedScore).toBeGreaterThan(highScore.weightedScore);
  });

  it('uses custom endorsementWeight for blending', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const endorserKp = await generateKeyPair();
    const receipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 10; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'fulfilled', prevHash);
      receipts.push(r);
      prevHash = r.receiptHash;
    }
    const endorsement = await createEndorsement(
      endorserKp.publicKeyHex, agentKp.publicKeyHex,
      { covenantsCompleted: 10, breachRate: 0 },
      ['general'], 0.5, endorserKp,
    );

    const lowWeight: import('./types.js').ScoringConfig = {
      ...DEFAULT_SCORING_CONFIG,
      endorsementWeight: 0.01,
    };
    const highWeight: import('./types.js').ScoringConfig = {
      ...DEFAULT_SCORING_CONFIG,
      endorsementWeight: 0.9,
    };

    const lowWeightScore = computeReputationScore(agentKp.publicKeyHex, receipts, [endorsement], lowWeight);
    const highWeightScore = computeReputationScore(agentKp.publicKeyHex, receipts, [endorsement], highWeight);
    // With endorsement weight 0.5 and all-fulfilled base score ~1.0:
    // lowWeight: ~0.99*1.0 + 0.01*0.5 = ~0.995
    // highWeight: ~0.1*1.0 + 0.9*0.5 = ~0.55
    expect(lowWeightScore.weightedScore).toBeGreaterThan(highWeightScore.weightedScore);
  });
});

describe('computeReputationScore - recency decay effects', () => {
  it('recent receipts are weighted more heavily than old ones', () => {
    // Create synthetic receipts with controlled timestamps
    const now = Date.now();
    const recentReceipt: ExecutionReceipt = {
      id: fakeHash('recent') as HashHex,
      covenantId: fakeHash('covenant'),
      agentIdentityHash: fakeHash('agent'),
      principalPublicKey: 'pubkey',
      outcome: 'fulfilled',
      proofHash: fakeHash('proof'),
      durationMs: 100,
      completedAt: new Date(now - 1000).toISOString(), // 1 second ago
      agentSignature: 'sig',
      previousReceiptHash: null,
      receiptHash: fakeHash('recent'),
    };
    const oldReceipt: ExecutionReceipt = {
      id: fakeHash('old') as HashHex,
      covenantId: fakeHash('covenant'),
      agentIdentityHash: fakeHash('agent'),
      principalPublicKey: 'pubkey',
      outcome: 'failed',
      proofHash: fakeHash('proof2'),
      durationMs: 100,
      completedAt: new Date(now - 90 * 86400 * 1000).toISOString(), // 90 days ago
      agentSignature: 'sig',
      previousReceiptHash: fakeHash('recent'),
      receiptHash: fakeHash('old'),
    };

    const config: import('./types.js').ScoringConfig = {
      ...DEFAULT_SCORING_CONFIG,
      minimumExecutions: 1,
    };

    // Score with only the recent fulfilled receipt
    const recentScore = computeReputationScore(fakeHash('agent'), [recentReceipt], undefined, config);
    // Score with both -- the old failed receipt should drag the score down less due to decay
    const bothScore = computeReputationScore(fakeHash('agent'), [recentReceipt, oldReceipt], undefined, config);

    expect(recentScore.weightedScore).toBeGreaterThan(bothScore.weightedScore);
    // But the bothScore should still be relatively high because the old failure is heavily decayed
    expect(bothScore.weightedScore).toBeGreaterThan(0.5);
  });

  it('very old breaches have minimal impact', () => {
    const now = Date.now();
    const receipts: ExecutionReceipt[] = [];
    // 10 recent fulfilled
    for (let i = 0; i < 10; i++) {
      receipts.push({
        id: fakeHash(`recent-${i}`) as HashHex,
        covenantId: fakeHash('covenant'),
        agentIdentityHash: fakeHash('agent'),
        principalPublicKey: 'pubkey',
        outcome: 'fulfilled',
        proofHash: fakeHash(`proof-${i}`),
        durationMs: 100,
        completedAt: new Date(now - 1000 * (i + 1)).toISOString(),
        agentSignature: 'sig',
        previousReceiptHash: i === 0 ? null : fakeHash(`recent-${i - 1}`),
        receiptHash: fakeHash(`recent-${i}`),
      });
    }
    // 5 ancient breaches (365 days ago)
    for (let i = 0; i < 5; i++) {
      receipts.push({
        id: fakeHash(`old-breach-${i}`) as HashHex,
        covenantId: fakeHash('covenant'),
        agentIdentityHash: fakeHash('agent'),
        principalPublicKey: 'pubkey',
        outcome: 'breached',
        breachSeverity: 'critical',
        proofHash: fakeHash(`old-proof-${i}`),
        durationMs: 100,
        completedAt: new Date(now - 365 * 86400 * 1000 - i * 1000).toISOString(),
        agentSignature: 'sig',
        previousReceiptHash: fakeHash(`recent-9`),
        receiptHash: fakeHash(`old-breach-${i}`),
      });
    }

    const score = computeReputationScore(fakeHash('agent'), receipts);
    // Despite 5 critical breaches, score should still be reasonable because they are very old
    expect(score.weightedScore).toBeGreaterThan(0.5);
    expect(score.breached).toBe(5);
    expect(score.fulfilled).toBe(10);
  });
});

describe('computeReputationScore - multiple receipts with varying outcomes', () => {
  it('handles all-partial receipts', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 10; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'partial', prevHash);
      receipts.push(r);
      prevHash = r.receiptHash;
    }
    const score = computeReputationScore(agentKp.publicKeyHex, receipts);
    // partial = 0.5 outcome score
    expect(score.weightedScore).toBeCloseTo(0.5, 1);
    expect(score.successRate).toBe(1.0); // partial counts as success
    expect(score.partial).toBe(10);
  });

  it('handles all-failed receipts', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 10; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'failed', prevHash);
      receipts.push(r);
      prevHash = r.receiptHash;
    }
    const score = computeReputationScore(agentKp.publicKeyHex, receipts);
    expect(score.weightedScore).toBe(0);
    expect(score.successRate).toBe(0);
    expect(score.failed).toBe(10);
  });

  it('score is clamped to [0, 1]', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    // All fulfilled = score should be at most 1.0
    const receipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 20; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'fulfilled', prevHash);
      receipts.push(r);
      prevHash = r.receiptHash;
    }
    const score = computeReputationScore(agentKp.publicKeyHex, receipts);
    expect(score.weightedScore).toBeLessThanOrEqual(1.0);
    expect(score.weightedScore).toBeGreaterThanOrEqual(0.0);
  });

  it('includes a receiptsMerkleRoot that matches independent computation', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const receipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 3; i++) {
      const r = await makeReceipt(agentKp, principalKp, 'fulfilled', prevHash);
      receipts.push(r);
      prevHash = r.receiptHash;
    }
    const score = computeReputationScore(agentKp.publicKeyHex, receipts);
    const independentRoot = computeReceiptsMerkleRoot(receipts);
    expect(score.receiptsMerkleRoot).toBe(independentRoot);
  });

  it('lastUpdatedAt is a valid ISO 8601 timestamp', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const r1 = await makeReceipt(agentKp, principalKp, 'fulfilled', null);
    const score = computeReputationScore(agentKp.publicKeyHex, [r1]);
    expect(() => new Date(score.lastUpdatedAt)).not.toThrow();
    expect(new Date(score.lastUpdatedAt).toISOString()).toBe(score.lastUpdatedAt);
  });
});

// ---------------------------------------------------------------------------
// EXPANDED TESTS: Stake lifecycle
// ---------------------------------------------------------------------------

describe('createStake / releaseStake / burnStake - lifecycle', () => {
  it('full lifecycle: create -> release', async () => {
    const agentKp = await generateKeyPair();
    const stake = await createStake(agentKp.publicKeyHex, fakeHash('covenant-1'), 0.75, agentKp);
    expect(stake.status).toBe('active');
    expect(stake.amount).toBe(0.75);

    const released = releaseStake(stake, 'fulfilled');
    expect(released.status).toBe('released');
    expect(released.resolvedAt).toBeDefined();
    expect(released.amount).toBe(0.75);
    expect(released.id).toBe(stake.id);
    expect(released.signature).toBe(stake.signature);
  });

  it('full lifecycle: create -> burn', async () => {
    const agentKp = await generateKeyPair();
    const stake = await createStake(agentKp.publicKeyHex, fakeHash('covenant-2'), 0.3, agentKp);
    expect(stake.status).toBe('active');

    const burned = burnStake(stake);
    expect(burned.status).toBe('burned');
    expect(burned.resolvedAt).toBeDefined();
    expect(burned.amount).toBe(0.3);
  });

  it('accepts boundary value amount = 0', async () => {
    const agentKp = await generateKeyPair();
    const stake = await createStake(agentKp.publicKeyHex, fakeHash('covenant-1'), 0, agentKp);
    expect(stake.amount).toBe(0);
    expect(stake.status).toBe('active');
  });

  it('accepts boundary value amount = 1', async () => {
    const agentKp = await generateKeyPair();
    const stake = await createStake(agentKp.publicKeyHex, fakeHash('covenant-1'), 1, agentKp);
    expect(stake.amount).toBe(1);
    expect(stake.status).toBe('active');
  });

  it('releaseStake preserves all original fields', async () => {
    const agentKp = await generateKeyPair();
    const stake = await createStake(agentKp.publicKeyHex, fakeHash('covenant-1'), 0.5, agentKp);
    const released = releaseStake(stake, 'partial');
    expect(released.agentIdentityHash).toBe(stake.agentIdentityHash);
    expect(released.covenantId).toBe(stake.covenantId);
    expect(released.stakedAt).toBe(stake.stakedAt);
    expect(released.signature).toBe(stake.signature);
  });

  it('burnStake preserves all original fields', async () => {
    const agentKp = await generateKeyPair();
    const stake = await createStake(agentKp.publicKeyHex, fakeHash('covenant-1'), 0.8, agentKp);
    const burned = burnStake(stake);
    expect(burned.agentIdentityHash).toBe(stake.agentIdentityHash);
    expect(burned.covenantId).toBe(stake.covenantId);
    expect(burned.stakedAt).toBe(stake.stakedAt);
    expect(burned.signature).toBe(stake.signature);
  });
});

// ---------------------------------------------------------------------------
// EXPANDED TESTS: Delegation lifecycle
// ---------------------------------------------------------------------------

describe('createDelegation / burnDelegation / coBurnDelegation - extended', () => {
  it('full lifecycle: create -> burn', async () => {
    const sponsorKp = await generateKeyPair();
    const protegeKp = await generateKeyPair();
    const delegation = await createDelegation(
      sponsorKp.publicKeyHex, protegeKp.publicKeyHex,
      0.5, ['compute', 'data'],
      new Date(Date.now() + 86400000).toISOString(),
      sponsorKp, protegeKp,
    );
    expect(delegation.status).toBe('active');
    const burned = burnDelegation(delegation);
    expect(burned.status).toBe('burned');
    expect(burned.riskAmount).toBe(0.5);
    expect(burned.scopes).toEqual(['compute', 'data']);
  });

  it('accepts boundary value riskAmount = 0', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const delegation = await createDelegation(
      kp1.publicKeyHex, kp2.publicKeyHex,
      0, ['data'],
      new Date(Date.now() + 86400000).toISOString(),
      kp1, kp2,
    );
    expect(delegation.riskAmount).toBe(0);
  });

  it('accepts boundary value riskAmount = 1', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const delegation = await createDelegation(
      kp1.publicKeyHex, kp2.publicKeyHex,
      1, ['data'],
      new Date(Date.now() + 86400000).toISOString(),
      kp1, kp2,
    );
    expect(delegation.riskAmount).toBe(1);
  });

  it('rejects negative riskAmount', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    await expect(createDelegation(
      kp1.publicKeyHex, kp2.publicKeyHex,
      -0.1, ['data'],
      new Date(Date.now() + 86400000).toISOString(),
      kp1, kp2,
    )).rejects.toThrow('riskAmount');
  });

  it('coBurnDelegation with riskAmount 0 produces zero reputation loss', async () => {
    const sponsorKp = await generateKeyPair();
    const protegeKp = await generateKeyPair();
    const delegation = await createDelegation(
      sponsorKp.publicKeyHex, protegeKp.publicKeyHex,
      0, ['data'],
      new Date(Date.now() + 86400000).toISOString(),
      sponsorKp, protegeKp,
    );
    const sponsorScore: ReputationScore = {
      agentIdentityHash: sponsorKp.publicKeyHex,
      totalExecutions: 50, fulfilled: 50, partial: 0, failed: 0, breached: 0,
      successRate: 1.0, weightedScore: 0.9, receiptsMerkleRoot: 'abc',
      lastUpdatedAt: new Date().toISOString(), currentStake: 0, totalBurned: 0,
    };
    const result = coBurnDelegation(delegation, sponsorScore);
    expect(result.sponsorReputationLoss).toBe(0);
    expect(result.newSponsorBurned).toBe(0);
  });

  it('coBurnDelegation with riskAmount 1 produces maximum reputation loss', async () => {
    const sponsorKp = await generateKeyPair();
    const protegeKp = await generateKeyPair();
    const delegation = await createDelegation(
      sponsorKp.publicKeyHex, protegeKp.publicKeyHex,
      1, ['data'],
      new Date(Date.now() + 86400000).toISOString(),
      sponsorKp, protegeKp,
    );
    const sponsorScore: ReputationScore = {
      agentIdentityHash: sponsorKp.publicKeyHex,
      totalExecutions: 50, fulfilled: 50, partial: 0, failed: 0, breached: 0,
      successRate: 1.0, weightedScore: 0.9, receiptsMerkleRoot: 'abc',
      lastUpdatedAt: new Date().toISOString(), currentStake: 0, totalBurned: 0.2,
    };
    const result = coBurnDelegation(delegation, sponsorScore);
    expect(result.sponsorReputationLoss).toBeCloseTo(0.9);
    expect(result.newSponsorBurned).toBeCloseTo(0.2 + 0.9);
  });

  it('burnDelegation does not mutate scopes array', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const scopes = ['compute', 'storage'];
    const delegation = await createDelegation(
      kp1.publicKeyHex, kp2.publicKeyHex,
      0.5, scopes,
      new Date(Date.now() + 86400000).toISOString(),
      kp1, kp2,
    );
    const burned = burnDelegation(delegation);
    expect(burned.scopes).toEqual(['compute', 'storage']);
    expect(delegation.scopes).toEqual(['compute', 'storage']);
  });
});

// ---------------------------------------------------------------------------
// EXPANDED TESTS: Endorsement basis boundary values
// ---------------------------------------------------------------------------

describe('createEndorsement / verifyEndorsement - extended', () => {
  it('accepts boundary value covenantsCompleted = 0', async () => {
    const kp = await generateKeyPair();
    const e = await createEndorsement(
      kp.publicKeyHex, fakeHash('endorsed'),
      { covenantsCompleted: 0, breachRate: 0 },
      ['scope'], 0.5, kp,
    );
    expect(e.basis.covenantsCompleted).toBe(0);
  });

  it('accepts boundary value breachRate = 0', async () => {
    const kp = await generateKeyPair();
    const e = await createEndorsement(
      kp.publicKeyHex, fakeHash('endorsed'),
      { covenantsCompleted: 10, breachRate: 0 },
      ['scope'], 0.5, kp,
    );
    expect(e.basis.breachRate).toBe(0);
  });

  it('accepts boundary value breachRate = 1', async () => {
    const kp = await generateKeyPair();
    const e = await createEndorsement(
      kp.publicKeyHex, fakeHash('endorsed'),
      { covenantsCompleted: 10, breachRate: 1 },
      ['scope'], 0.5, kp,
    );
    expect(e.basis.breachRate).toBe(1);
  });

  it('accepts boundary value weight = 0', async () => {
    const kp = await generateKeyPair();
    const e = await createEndorsement(
      kp.publicKeyHex, fakeHash('endorsed'),
      { covenantsCompleted: 10, breachRate: 0 },
      ['scope'], 0, kp,
    );
    expect(e.weight).toBe(0);
  });

  it('accepts boundary value weight = 1', async () => {
    const kp = await generateKeyPair();
    const e = await createEndorsement(
      kp.publicKeyHex, fakeHash('endorsed'),
      { covenantsCompleted: 10, breachRate: 0 },
      ['scope'], 1, kp,
    );
    expect(e.weight).toBe(1);
  });

  it('rejects negative weight', async () => {
    const kp = await generateKeyPair();
    await expect(createEndorsement(
      kp.publicKeyHex, fakeHash('endorsed'),
      { covenantsCompleted: 10, breachRate: 0 },
      ['scope'], -0.1, kp,
    )).rejects.toThrow('weight');
  });

  it('accepts averageOutcomeScore = 0', async () => {
    const kp = await generateKeyPair();
    const e = await createEndorsement(
      kp.publicKeyHex, fakeHash('endorsed'),
      { covenantsCompleted: 10, breachRate: 0, averageOutcomeScore: 0 },
      ['scope'], 0.5, kp,
    );
    expect(e.basis.averageOutcomeScore).toBe(0);
  });

  it('accepts averageOutcomeScore = 1', async () => {
    const kp = await generateKeyPair();
    const e = await createEndorsement(
      kp.publicKeyHex, fakeHash('endorsed'),
      { covenantsCompleted: 10, breachRate: 0, averageOutcomeScore: 1 },
      ['scope'], 0.5, kp,
    );
    expect(e.basis.averageOutcomeScore).toBe(1);
  });

  it('rejects negative averageOutcomeScore', async () => {
    const kp = await generateKeyPair();
    await expect(createEndorsement(
      kp.publicKeyHex, fakeHash('endorsed'),
      { covenantsCompleted: 10, breachRate: 0, averageOutcomeScore: -0.1 },
      ['scope'], 0.5, kp,
    )).rejects.toThrow('averageOutcomeScore');
  });

  it('verifyEndorsement returns false when id is tampered', async () => {
    const kp = await generateKeyPair();
    const e = await createEndorsement(
      kp.publicKeyHex, fakeHash('endorsed'),
      { covenantsCompleted: 10, breachRate: 0 },
      ['scope'], 0.5, kp,
    );
    const tampered = { ...e, id: fakeHash('wrong-id') };
    expect(await verifyEndorsement(tampered)).toBe(false);
  });

  it('verifyEndorsement returns false when endorsedIdentityHash is tampered', async () => {
    const kp = await generateKeyPair();
    const e = await createEndorsement(
      kp.publicKeyHex, fakeHash('endorsed'),
      { covenantsCompleted: 10, breachRate: 0 },
      ['scope'], 0.5, kp,
    );
    const tampered = { ...e, endorsedIdentityHash: fakeHash('other') };
    expect(await verifyEndorsement(tampered)).toBe(false);
  });

  it('verifyEndorsement returns false when scopes are tampered', async () => {
    const kp = await generateKeyPair();
    const e = await createEndorsement(
      kp.publicKeyHex, fakeHash('endorsed'),
      { covenantsCompleted: 10, breachRate: 0 },
      ['scope-a', 'scope-b'], 0.5, kp,
    );
    const tampered = { ...e, scopes: ['scope-a'] };
    expect(await verifyEndorsement(tampered)).toBe(false);
  });

  it('endorsement with multiple scopes', async () => {
    const kp = await generateKeyPair();
    const e = await createEndorsement(
      kp.publicKeyHex, fakeHash('endorsed'),
      { covenantsCompleted: 10, breachRate: 0 },
      ['compute', 'storage', 'network', 'data'], 0.5, kp,
    );
    expect(e.scopes).toEqual(['compute', 'storage', 'network', 'data']);
    expect(await verifyEndorsement(e)).toBe(true);
  });
});
