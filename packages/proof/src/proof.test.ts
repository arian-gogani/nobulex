import { describe, it, expect } from 'vitest';
import { sha256String } from '@stele/crypto';
import type { HashHex } from '@stele/crypto';
import {
  poseidonHash,
  hashToField,
  fieldToHex,
  FIELD_PRIME,
  computeAuditCommitment,
  computeConstraintCommitment,
  generateComplianceProof,
  verifyComplianceProof,
} from './index';
import type { AuditEntryData, ComplianceProof } from './index';

// ─── Shared fixtures ───────────────────────────────────────────────────────────

const COVENANT_ID: HashHex = 'a'.repeat(64);

const CONSTRAINTS = [
  "permit file.read on '/data/**'",
  "deny file.write on '/system/**' severity critical",
].join('\n');

function makeAuditEntry(
  action: string,
  resource: string,
  outcome: 'EXECUTED' | 'DENIED' | 'IMPOSSIBLE' = 'EXECUTED',
): AuditEntryData {
  const entryContent = JSON.stringify({ action, resource, outcome, ts: Date.now() });
  return {
    action,
    resource,
    outcome,
    timestamp: new Date().toISOString(),
    hash: sha256String(entryContent),
  };
}

// ─── Poseidon primitives ───────────────────────────────────────────────────────

describe('poseidonHash', () => {
  it('produces consistent (deterministic) results', () => {
    const a = poseidonHash([1n, 2n]);
    const b = poseidonHash([1n, 2n]);
    expect(a).toBe(b);
  });

  it('produces different results for different inputs', () => {
    const a = poseidonHash([1n, 2n]);
    const b = poseidonHash([3n, 4n]);
    expect(a).not.toBe(b);
  });

  it('returns a bigint within the field', () => {
    const result = poseidonHash([42n]);
    expect(result).toBeGreaterThanOrEqual(0n);
    expect(result).toBeLessThan(FIELD_PRIME);
  });

  it('works with a single input', () => {
    const result = poseidonHash([0n]);
    expect(typeof result).toBe('bigint');
    expect(result).toBeGreaterThanOrEqual(0n);
    expect(result).toBeLessThan(FIELD_PRIME);
  });

  it('works with more than 2 inputs (sponge mode)', () => {
    const result = poseidonHash([1n, 2n, 3n, 4n, 5n]);
    expect(typeof result).toBe('bigint');
    expect(result).toBeGreaterThanOrEqual(0n);
    expect(result).toBeLessThan(FIELD_PRIME);
  });

  it('throws on empty input', () => {
    expect(() => poseidonHash([])).toThrow('at least one input');
  });

  it('throws on out-of-range inputs (negative)', () => {
    expect(() => poseidonHash([-1n])).toThrow('out of field range');
  });

  it('throws on out-of-range inputs (>= FIELD_PRIME)', () => {
    expect(() => poseidonHash([FIELD_PRIME])).toThrow('out of field range');
  });

  it('input order matters', () => {
    const ab = poseidonHash([1n, 2n]);
    const ba = poseidonHash([2n, 1n]);
    expect(ab).not.toBe(ba);
  });
});

// ─── hashToField ───────────────────────────────────────────────────────────────

describe('hashToField', () => {
  it('converts a hex hash to a field element less than FIELD_PRIME', () => {
    const hash = sha256String('hello world');
    const field = hashToField(hash);
    expect(field).toBeGreaterThanOrEqual(0n);
    expect(field).toBeLessThan(FIELD_PRIME);
  });

  it('produces consistent results for the same input', () => {
    const hash = sha256String('test data');
    const a = hashToField(hash);
    const b = hashToField(hash);
    expect(a).toBe(b);
  });

  it('produces different results for different inputs', () => {
    const hash1 = sha256String('input1');
    const hash2 = sha256String('input2');
    const field1 = hashToField(hash1);
    const field2 = hashToField(hash2);
    expect(field1).not.toBe(field2);
  });

  it('throws on a hash that is too short', () => {
    expect(() => hashToField('a')).toThrow('too short');
  });
});

// ─── fieldToHex ────────────────────────────────────────────────────────────────

describe('fieldToHex', () => {
  it('converts a field element to a 64-char hex string', () => {
    const hex = fieldToHex(42n);
    expect(hex).toHaveLength(64);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('zero-pads small values', () => {
    const hex = fieldToHex(0n);
    expect(hex).toBe('0'.repeat(64));
  });

  it('round-trips with hashToField', () => {
    const original = sha256String('round trip test');
    const field = hashToField(original);
    const hex = fieldToHex(field);
    // The hex should be a valid 64-char hex string
    expect(hex).toHaveLength(64);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws for negative values', () => {
    expect(() => fieldToHex(-1n)).toThrow('out of field range');
  });

  it('throws for values >= FIELD_PRIME', () => {
    expect(() => fieldToHex(FIELD_PRIME)).toThrow('out of field range');
  });
});

// ─── computeAuditCommitment ────────────────────────────────────────────────────

describe('computeAuditCommitment', () => {
  it('produces consistent commitment for same entries', () => {
    const entries = [
      makeAuditEntry('file.read', '/data/a'),
      makeAuditEntry('file.read', '/data/b'),
    ];

    const a = computeAuditCommitment(entries);
    const b = computeAuditCommitment(entries);
    expect(a).toBe(b);
  });

  it('produces different commitment for different entries', () => {
    const entries1 = [makeAuditEntry('file.read', '/data/a')];
    const entries2 = [makeAuditEntry('file.write', '/system/b')];

    const a = computeAuditCommitment(entries1);
    const b = computeAuditCommitment(entries2);
    expect(a).not.toBe(b);
  });

  it('produces a valid hex string commitment', () => {
    const entries = [makeAuditEntry('file.read', '/data/a')];
    const commitment = computeAuditCommitment(entries);
    expect(commitment).toHaveLength(64);
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles empty entries with a defined commitment', () => {
    const commitment = computeAuditCommitment([]);
    expect(commitment).toHaveLength(64);
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is order-dependent (different order = different commitment)', () => {
    const entry1 = makeAuditEntry('file.read', '/data/a');
    const entry2 = makeAuditEntry('file.read', '/data/b');

    const forward = computeAuditCommitment([entry1, entry2]);
    const reversed = computeAuditCommitment([entry2, entry1]);
    expect(forward).not.toBe(reversed);
  });
});

// ─── computeConstraintCommitment ───────────────────────────────────────────────

describe('computeConstraintCommitment', () => {
  it('produces consistent commitment for same constraints', () => {
    const a = computeConstraintCommitment(CONSTRAINTS);
    const b = computeConstraintCommitment(CONSTRAINTS);
    expect(a).toBe(b);
  });

  it('produces different commitment for different constraints', () => {
    const a = computeConstraintCommitment(CONSTRAINTS);
    const b = computeConstraintCommitment("permit file.delete on '**'");
    expect(a).not.toBe(b);
  });

  it('produces a valid hex string commitment', () => {
    const commitment = computeConstraintCommitment(CONSTRAINTS);
    expect(commitment).toHaveLength(64);
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── generateComplianceProof → verifyComplianceProof ───────────────────────────

describe('generateComplianceProof', () => {
  it('produces a valid ComplianceProof structure', async () => {
    const entries = [
      makeAuditEntry('file.read', '/data/a'),
      makeAuditEntry('file.read', '/data/b'),
    ];

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    expect(proof.version).toBe('1.0');
    expect(proof.covenantId).toBe(COVENANT_ID);
    expect(proof.proofSystem).toBe('poseidon_hash');
    expect(proof.entryCount).toBe(2);
    expect(proof.generatedAt).toBeTruthy();
    expect(proof.auditLogCommitment).toHaveLength(64);
    expect(proof.constraintCommitment).toHaveLength(64);
    expect(proof.proof).toBeTruthy();
    expect(proof.publicInputs).toHaveLength(4);
    expect(proof.publicInputs[0]).toBe(COVENANT_ID);
    expect(proof.publicInputs[1]).toBe(proof.auditLogCommitment);
    expect(proof.publicInputs[2]).toBe(proof.constraintCommitment);
    expect(proof.publicInputs[3]).toBe('2');
  });

  it('throws when covenantId is missing', async () => {
    await expect(
      generateComplianceProof({
        covenantId: '' as HashHex,
        constraints: CONSTRAINTS,
        auditEntries: [],
      }),
    ).rejects.toThrow('covenantId is required');
  });

  it('throws when constraints are missing', async () => {
    await expect(
      generateComplianceProof({
        covenantId: COVENANT_ID,
        constraints: '',
        auditEntries: [],
      }),
    ).rejects.toThrow('constraints string is required');
  });
});

describe('verifyComplianceProof', () => {
  it('successfully verifies a validly generated proof', async () => {
    const entries = [
      makeAuditEntry('file.read', '/data/a'),
      makeAuditEntry('file.read', '/data/b'),
      makeAuditEntry('file.read', '/data/c'),
    ];

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    const result = await verifyComplianceProof(proof);

    expect(result.valid).toBe(true);
    expect(result.covenantId).toBe(COVENANT_ID);
    expect(result.entryCount).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when the proof value is tampered', async () => {
    const entries = [makeAuditEntry('file.read', '/data/a')];

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    // Tamper with the proof value
    proof.proof = 'f'.repeat(64);

    const result = await verifyComplianceProof(proof);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('Proof value mismatch'))).toBe(true);
  });

  it('fails when the audit log commitment is tampered', async () => {
    const entries = [makeAuditEntry('file.read', '/data/a')];

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    // Tamper with the audit log commitment — also update publicInputs to stay internally consistent
    const tamperedCommitment = 'b'.repeat(64) as HashHex;
    proof.auditLogCommitment = tamperedCommitment;
    proof.publicInputs[1] = tamperedCommitment;

    const result = await verifyComplianceProof(proof);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Proof value mismatch'))).toBe(true);
  });

  it('fails when the covenantId in publicInputs does not match', async () => {
    const entries = [makeAuditEntry('file.read', '/data/a')];

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    // Tamper with publicInputs covenantId only
    proof.publicInputs[0] = 'b'.repeat(64);

    const result = await verifyComplianceProof(proof);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('covenantId') && e.includes('mismatch'))).toBe(true);
  });

  it('fails when publicInputs entryCount does not match', async () => {
    const entries = [makeAuditEntry('file.read', '/data/a')];

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    // Tamper with publicInputs entryCount
    proof.publicInputs[3] = '999';

    const result = await verifyComplianceProof(proof);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('entryCount') && e.includes('mismatch'))).toBe(true);
  });

  it('fails when publicInputs has wrong length', async () => {
    const entries = [makeAuditEntry('file.read', '/data/a')];

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    // Remove one element
    proof.publicInputs = proof.publicInputs.slice(0, 2);

    const result = await verifyComplianceProof(proof);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exactly 4 elements'))).toBe(true);
  });

  it('fails when version is wrong', async () => {
    const entries = [makeAuditEntry('file.read', '/data/a')];

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    // Tamper with version
    (proof as unknown as { version: string }).version = '2.0';

    const result = await verifyComplianceProof(proof);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Unsupported proof version'))).toBe(true);
  });

  it('fails when proofSystem is unsupported', async () => {
    const entries = [makeAuditEntry('file.read', '/data/a')];

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    // Tamper with proof system
    (proof as unknown as { proofSystem: string }).proofSystem = 'unknown_system';

    const result = await verifyComplianceProof(proof);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Unsupported proof system'))).toBe(true);
  });
});

describe('generateComplianceProof → verifyComplianceProof round-trip', () => {
  it('round-trips successfully with multiple entries', async () => {
    const entries = [
      makeAuditEntry('file.read', '/data/a'),
      makeAuditEntry('file.read', '/data/b'),
      makeAuditEntry('file.write', '/system/c', 'DENIED'),
    ];

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    const result = await verifyComplianceProof(proof);

    expect(result.valid).toBe(true);
    expect(result.entryCount).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it('round-trips successfully with empty audit entries', async () => {
    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: [],
    });

    expect(proof.entryCount).toBe(0);
    expect(proof.publicInputs[3]).toBe('0');

    const result = await verifyComplianceProof(proof);

    expect(result.valid).toBe(true);
    expect(result.entryCount).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('round-trips successfully with a single entry', async () => {
    const entries = [makeAuditEntry('file.read', '/data/x')];

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    const result = await verifyComplianceProof(proof);

    expect(result.valid).toBe(true);
    expect(result.entryCount).toBe(1);
  });

  it('different covenants produce different proofs', async () => {
    const entries = [makeAuditEntry('file.read', '/data/a')];

    const proof1 = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    const proof2 = await generateComplianceProof({
      covenantId: 'b'.repeat(64) as HashHex,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    expect(proof1.proof).not.toBe(proof2.proof);

    // Both should individually verify
    expect((await verifyComplianceProof(proof1)).valid).toBe(true);
    expect((await verifyComplianceProof(proof2)).valid).toBe(true);
  });

  it('different constraints produce different proofs', async () => {
    const entries = [makeAuditEntry('file.read', '/data/a')];

    const proof1 = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    const proof2 = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: "permit file.delete on '**'",
      auditEntries: entries,
    });

    expect(proof1.constraintCommitment).not.toBe(proof2.constraintCommitment);
    expect(proof1.proof).not.toBe(proof2.proof);
  });
});
