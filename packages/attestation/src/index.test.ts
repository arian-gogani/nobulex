import { describe, it, expect } from 'vitest';
import { generateKeyPair, toHex, sha256Object } from '@stele/crypto';
import {
  createAttestation,
  signAttestation,
  reconcile,
  getDiscrepancies,
} from './index';
import type { ExternalAttestation, ReceiptSummary } from './types';

// ---------------------------------------------------------------------------
// createAttestation
// ---------------------------------------------------------------------------
describe('createAttestation', () => {
  it('produces a valid ExternalAttestation object', () => {
    const att = createAttestation('agent-1', 'counter-1', '/api/chat', 'inhash', 'outhash', 'ixhash', 1000);
    expect(att.agentId).toBe('agent-1');
    expect(att.counterpartyId).toBe('counter-1');
    expect(att.endpoint).toBe('/api/chat');
    expect(att.inputHash).toBe('inhash');
    expect(att.outputHash).toBe('outhash');
    expect(att.interactionHash).toBe('ixhash');
    expect(att.timestamp).toBe(1000);
  });

  it('produces a deterministic ID based on content', () => {
    const att1 = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 500);
    const att2 = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 500);
    expect(att1.id).toBe(att2.id);
  });

  it('produces different IDs for different content', () => {
    const att1 = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 500);
    const att2 = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 501);
    expect(att1.id).not.toBe(att2.id);
  });

  it('ID is a valid 64-character hex string (sha256)', () => {
    const att = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 0);
    expect(att.id.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(att.id)).toBe(true);
  });

  it('counterpartySignature is initially empty string', () => {
    const att = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 0);
    expect(att.counterpartySignature).toBe('');
  });

  it('ID matches sha256Object of canonical content', () => {
    const att = createAttestation('agent', 'counter', '/e', 'ih', 'oh', 'xh', 999);
    const expectedId = sha256Object({
      agentId: 'agent',
      counterpartyId: 'counter',
      endpoint: '/e',
      inputHash: 'ih',
      outputHash: 'oh',
      interactionHash: 'xh',
      timestamp: 999,
    });
    expect(att.id).toBe(expectedId);
  });

  it('works with empty strings for all string fields', () => {
    const att = createAttestation('', '', '', '', '', '', 0);
    expect(att.agentId).toBe('');
    expect(att.id.length).toBe(64);
  });

  it('works when agentId and counterpartyId are the same', () => {
    const att = createAttestation('same', 'same', '/ep', 'in', 'out', 'ix', 100);
    expect(att.agentId).toBe('same');
    expect(att.counterpartyId).toBe('same');
    expect(att.id.length).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// signAttestation
// ---------------------------------------------------------------------------
describe('signAttestation', () => {
  it('adds a non-empty counterpartySignature', async () => {
    const kp = await generateKeyPair();
    const att = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 0);
    const signed = await signAttestation(att, kp.privateKey);
    expect(signed.counterpartySignature).not.toBe('');
    expect(signed.counterpartySignature.length).toBeGreaterThan(0);
  });

  it('returns a new object without mutating the original', async () => {
    const kp = await generateKeyPair();
    const att = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 0);
    const signed = await signAttestation(att, kp.privateKey);
    expect(att.counterpartySignature).toBe('');
    expect(signed.counterpartySignature).not.toBe('');
  });

  it('preserves all original fields', async () => {
    const kp = await generateKeyPair();
    const att = createAttestation('agent', 'counter', '/api', 'input', 'output', 'interact', 42);
    const signed = await signAttestation(att, kp.privateKey);
    expect(signed.id).toBe(att.id);
    expect(signed.agentId).toBe(att.agentId);
    expect(signed.counterpartyId).toBe(att.counterpartyId);
    expect(signed.endpoint).toBe(att.endpoint);
    expect(signed.inputHash).toBe(att.inputHash);
    expect(signed.outputHash).toBe(att.outputHash);
    expect(signed.interactionHash).toBe(att.interactionHash);
    expect(signed.timestamp).toBe(att.timestamp);
  });

  it('produces a hex-encoded signature (128 hex chars for Ed25519)', async () => {
    const kp = await generateKeyPair();
    const att = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 0);
    const signed = await signAttestation(att, kp.privateKey);
    expect(signed.counterpartySignature.length).toBe(128);
    expect(/^[0-9a-f]{128}$/.test(signed.counterpartySignature)).toBe(true);
  });

  it('produces deterministic signature for same key and attestation', async () => {
    const kp = await generateKeyPair();
    const att = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 0);
    const signed1 = await signAttestation(att, kp.privateKey);
    const signed2 = await signAttestation(att, kp.privateKey);
    expect(signed1.counterpartySignature).toBe(signed2.counterpartySignature);
  });
});

// ---------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------
describe('reconcile', () => {
  it('returns match=true when all hashes match', () => {
    const receipt: ReceiptSummary = {
      id: 'receipt-1',
      interactionHash: 'ix',
      inputHash: 'in',
      outputHash: 'out',
      endpoint: '/ep',
      timestamp: 100,
    };
    const att = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 100);
    const result = reconcile(receipt, att);
    expect(result.match).toBe(true);
    expect(result.discrepancies).toHaveLength(0);
    expect(result.agentReceiptId).toBe('receipt-1');
    expect(result.attestationId).toBe(att.id);
  });

  it('returns match=false when interactionHash differs', () => {
    const receipt: ReceiptSummary = {
      id: 'r1',
      interactionHash: 'ix-agent',
      inputHash: 'in',
      outputHash: 'out',
      endpoint: '/ep',
      timestamp: 100,
    };
    const att = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix-counter', 100);
    const result = reconcile(receipt, att);
    expect(result.match).toBe(false);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]!.field).toBe('interactionHash');
    expect(result.discrepancies[0]!.severity).toBe('critical');
  });

  it('returns match=false with multiple discrepancies when all hashes differ', () => {
    const receipt: ReceiptSummary = {
      id: 'r1',
      interactionHash: 'a-ix',
      inputHash: 'a-in',
      outputHash: 'a-out',
      endpoint: '/ep',
      timestamp: 100,
    };
    const att = createAttestation('a', 'b', '/ep', 'c-in', 'c-out', 'c-ix', 100);
    const result = reconcile(receipt, att);
    expect(result.match).toBe(false);
    expect(result.discrepancies).toHaveLength(3);
  });

  it('correctly populates agentClaimed and counterpartyClaimed', () => {
    const receipt: ReceiptSummary = {
      id: 'r1',
      interactionHash: 'agent-ix',
      inputHash: 'in',
      outputHash: 'out',
      endpoint: '/ep',
      timestamp: 100,
    };
    const att = createAttestation('a', 'b', '/ep', 'in', 'out', 'counter-ix', 100);
    const result = reconcile(receipt, att);
    expect(result.discrepancies[0]!.agentClaimed).toBe('agent-ix');
    expect(result.discrepancies[0]!.counterpartyClaimed).toBe('counter-ix');
  });
});

// ---------------------------------------------------------------------------
// getDiscrepancies
// ---------------------------------------------------------------------------
describe('getDiscrepancies', () => {
  it('returns empty array when all hashes match', () => {
    const receipt: ReceiptSummary = {
      id: 'r1',
      interactionHash: 'ix',
      inputHash: 'in',
      outputHash: 'out',
      endpoint: '/ep',
      timestamp: 100,
    };
    const att = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 100);
    const discs = getDiscrepancies(receipt, att);
    expect(discs).toHaveLength(0);
  });

  it('returns critical severity for interactionHash mismatch', () => {
    const receipt: ReceiptSummary = {
      id: 'r1',
      interactionHash: 'DIFFERENT',
      inputHash: 'in',
      outputHash: 'out',
      endpoint: '/ep',
      timestamp: 100,
    };
    const att = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 100);
    const discs = getDiscrepancies(receipt, att);
    expect(discs).toHaveLength(1);
    expect(discs[0]!.field).toBe('interactionHash');
    expect(discs[0]!.severity).toBe('critical');
  });

  it('returns major severity for inputHash mismatch', () => {
    const receipt: ReceiptSummary = {
      id: 'r1',
      interactionHash: 'ix',
      inputHash: 'DIFFERENT',
      outputHash: 'out',
      endpoint: '/ep',
      timestamp: 100,
    };
    const att = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 100);
    const discs = getDiscrepancies(receipt, att);
    expect(discs).toHaveLength(1);
    expect(discs[0]!.field).toBe('inputHash');
    expect(discs[0]!.severity).toBe('major');
  });

  it('returns major severity for outputHash mismatch', () => {
    const receipt: ReceiptSummary = {
      id: 'r1',
      interactionHash: 'ix',
      inputHash: 'in',
      outputHash: 'DIFFERENT',
      endpoint: '/ep',
      timestamp: 100,
    };
    const att = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 100);
    const discs = getDiscrepancies(receipt, att);
    expect(discs).toHaveLength(1);
    expect(discs[0]!.field).toBe('outputHash');
    expect(discs[0]!.severity).toBe('major');
  });

  it('returns discrepancies in order: interactionHash, inputHash, outputHash', () => {
    const receipt: ReceiptSummary = {
      id: 'r1',
      interactionHash: 'x',
      inputHash: 'x',
      outputHash: 'x',
      endpoint: '/ep',
      timestamp: 100,
    };
    const att = createAttestation('a', 'b', '/ep', 'y', 'y', 'y', 100);
    const discs = getDiscrepancies(receipt, att);
    expect(discs).toHaveLength(3);
    expect(discs[0]!.field).toBe('interactionHash');
    expect(discs[1]!.field).toBe('inputHash');
    expect(discs[2]!.field).toBe('outputHash');
  });

  it('handles empty string hashes matching', () => {
    const receipt: ReceiptSummary = {
      id: 'r1',
      interactionHash: '',
      inputHash: '',
      outputHash: '',
      endpoint: '/ep',
      timestamp: 0,
    };
    const att = createAttestation('a', 'b', '/ep', '', '', '', 0);
    const discs = getDiscrepancies(receipt, att);
    expect(discs).toHaveLength(0);
  });

  it('handles empty string vs non-empty string mismatch', () => {
    const receipt: ReceiptSummary = {
      id: 'r1',
      interactionHash: '',
      inputHash: 'in',
      outputHash: 'out',
      endpoint: '/ep',
      timestamp: 0,
    };
    const att = createAttestation('a', 'b', '/ep', 'in', 'out', 'ix', 0);
    const discs = getDiscrepancies(receipt, att);
    expect(discs).toHaveLength(1);
    expect(discs[0]!.field).toBe('interactionHash');
    expect(discs[0]!.agentClaimed).toBe('');
    expect(discs[0]!.counterpartyClaimed).toBe('ix');
  });
});
