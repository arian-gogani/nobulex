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
  createEndorsement,
  verifyEndorsement,
  DEFAULT_SCORING_CONFIG,
} from './index.js';
import type {
  ExecutionReceipt,
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
      100,
      agentKp,
    );

    expect(stake.id).toBeDefined();
    expect(stake.agentIdentityHash).toBe(agentKp.publicKeyHex);
    expect(stake.covenantId).toBe(fakeHash('covenant-1'));
    expect(stake.amount).toBe(100);
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
      100,
      agentKp,
    );

    const released = releaseStake(stake, 'fulfilled');

    expect(released.status).toBe('released');
    expect(released.resolvedAt).toBeDefined();
    expect(typeof released.resolvedAt).toBe('string');
    // Original fields preserved
    expect(released.id).toBe(stake.id);
    expect(released.amount).toBe(100);
    expect(released.agentIdentityHash).toBe(stake.agentIdentityHash);
  });

  it('does not mutate the original stake', async () => {
    const agentKp = await generateKeyPair();

    const stake = await createStake(
      agentKp.publicKeyHex,
      fakeHash('covenant-1'),
      100,
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
      100,
      agentKp,
    );

    const burned = burnStake(stake);

    expect(burned.status).toBe('burned');
    expect(burned.resolvedAt).toBeDefined();
    expect(typeof burned.resolvedAt).toBe('string');
    expect(burned.id).toBe(stake.id);
    expect(burned.amount).toBe(100);
  });

  it('does not mutate the original stake', async () => {
    const agentKp = await generateKeyPair();

    const stake = await createStake(
      agentKp.publicKeyHex,
      fakeHash('covenant-1'),
      100,
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
      50,
      ['compute', 'storage'],
      '2026-12-31T00:00:00.000Z',
      sponsorKp,
      protegeKp,
    );

    expect(delegation.id).toBeDefined();
    expect(delegation.sponsorIdentityHash).toBe(sponsorKp.publicKeyHex);
    expect(delegation.protégéIdentityHash).toBe(protegeKp.publicKeyHex);
    expect(delegation.riskAmount).toBe(50);
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
      50,
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
      50,
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
