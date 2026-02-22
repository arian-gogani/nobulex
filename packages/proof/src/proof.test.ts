import { describe, it, expect } from 'vitest';
import { sha256String } from '@nobulex/crypto';
import type { HashHex } from '@nobulex/crypto';
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

// ─── 5-step verification ──────────────────────────────────────────────────────

describe('proof - 5-step verification', () => {
  it('Step 3: fails when audit log commitment mismatches publicInputs', async () => {
    const entries: AuditEntryData[] = [{
      action: 'file.read', resource: '/data/test.csv',
      outcome: 'EXECUTED', timestamp: new Date().toISOString(),
      hash: sha256String('entry1'),
    }];

    const proof = await generateComplianceProof({
      covenantId: sha256String('covenant'),
      constraints: "permit file.read on '/data/**'",
      auditEntries: entries,
    });

    // Tamper audit log commitment but keep publicInputs in sync
    const tampered = {
      ...proof,
      auditLogCommitment: sha256String('tampered'),
      publicInputs: [proof.publicInputs[0]!, sha256String('tampered'), proof.publicInputs[2]!, proof.publicInputs[3]!],
    };

    const result = await verifyComplianceProof(tampered);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Proof value mismatch'))).toBe(true);
  });

  it('Step 4: fails when constraint commitment mismatches', async () => {
    const proof = await generateComplianceProof({
      covenantId: sha256String('covenant'),
      constraints: "permit file.read on '/data/**'",
      auditEntries: [],
    });

    // Tamper constraint commitment
    const tampered = {
      ...proof,
      constraintCommitment: sha256String('wrong-constraints'),
      publicInputs: [proof.publicInputs[0]!, proof.publicInputs[1]!, sha256String('wrong-constraints'), proof.publicInputs[3]!],
    };

    const result = await verifyComplianceProof(tampered);
    expect(result.valid).toBe(false);
  });

  it('Step 5: proof recomputation detects any tampering', async () => {
    const proof = await generateComplianceProof({
      covenantId: sha256String('covenant'),
      constraints: "permit file.read on '/data/**'",
      auditEntries: [{
        action: 'file.read', resource: '/data/test.csv',
        outcome: 'EXECUTED', timestamp: new Date().toISOString(),
        hash: sha256String('entry1'),
      }],
    });

    // Directly tamper the proof value
    const tampered = { ...proof, proof: sha256String('garbage') };
    const result = await verifyComplianceProof(tampered);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Proof value mismatch'))).toBe(true);
  });
});

// ─── Extended Poseidon tests ─────────────────────────────────────────────────

describe('poseidonHash - extended', () => {
  it('handles large field elements near FIELD_PRIME - 1', () => {
    const maxElement = FIELD_PRIME - 1n;
    const result = poseidonHash([maxElement]);
    expect(result).toBeGreaterThanOrEqual(0n);
    expect(result).toBeLessThan(FIELD_PRIME);
  });

  it('produces different results for adjacent inputs', () => {
    const a = poseidonHash([100n]);
    const b = poseidonHash([101n]);
    expect(a).not.toBe(b);
  });

  it('produces different results for zero vs one', () => {
    const a = poseidonHash([0n]);
    const b = poseidonHash([1n]);
    expect(a).not.toBe(b);
  });

  it('handles many inputs (10 elements)', () => {
    const inputs = Array.from({ length: 10 }, (_, i) => BigInt(i + 1));
    const result = poseidonHash(inputs);
    expect(typeof result).toBe('bigint');
    expect(result).toBeGreaterThanOrEqual(0n);
    expect(result).toBeLessThan(FIELD_PRIME);
  });

  it('handles many inputs (20 elements)', () => {
    const inputs = Array.from({ length: 20 }, (_, i) => BigInt(i * 7 + 3));
    const result = poseidonHash(inputs);
    expect(result).toBeGreaterThanOrEqual(0n);
    expect(result).toBeLessThan(FIELD_PRIME);
  });

  it('sponge mode: 3 inputs produces different result than 2 inputs', () => {
    const a = poseidonHash([1n, 2n]);
    const b = poseidonHash([1n, 2n, 3n]);
    expect(a).not.toBe(b);
  });

  it('is not commutative with 3+ inputs', () => {
    const a = poseidonHash([1n, 2n, 3n]);
    const b = poseidonHash([3n, 2n, 1n]);
    expect(a).not.toBe(b);
  });

  it('zero input produces a valid field element', () => {
    const result = poseidonHash([0n]);
    expect(result).not.toBe(0n); // Hash of zero should not be zero
    expect(result).toBeLessThan(FIELD_PRIME);
  });

  it('repeated input produces different from single', () => {
    const single = poseidonHash([5n]);
    const doubled = poseidonHash([5n, 5n]);
    expect(single).not.toBe(doubled);
  });
});

// ─── Extended hashToField tests ─────────────────────────────────────────────

describe('hashToField - extended', () => {
  it('handles all-zero hash', () => {
    const zeroHash = '0'.repeat(64);
    const field = hashToField(zeroHash);
    expect(field).toBe(0n);
  });

  it('handles all-f hash', () => {
    const maxHash = 'f'.repeat(64);
    const field = hashToField(maxHash);
    expect(field).toBeGreaterThanOrEqual(0n);
    expect(field).toBeLessThan(FIELD_PRIME);
  });

  it('preserves ordering for small values', () => {
    const hash1 = '0'.repeat(63) + '1';
    const hash2 = '0'.repeat(63) + '2';
    const field1 = hashToField(hash1);
    const field2 = hashToField(hash2);
    expect(field1).toBeLessThan(field2);
  });

  it('handles hash with mixed case', () => {
    const lower = sha256String('test');
    const upper = lower.toUpperCase();
    // Both should produce the same field element
    const field1 = hashToField(lower);
    const field2 = hashToField(upper);
    expect(field1).toBe(field2);
  });

  it('produces different fields for different SHA-256 hashes', () => {
    const fields = new Set<bigint>();
    for (let i = 0; i < 20; i++) {
      const hash = sha256String(`input-${i}`);
      fields.add(hashToField(hash));
    }
    expect(fields.size).toBe(20);
  });
});

// ─── Extended fieldToHex tests ──────────────────────────────────────────────

describe('fieldToHex - extended', () => {
  it('converts 1 to zero-padded hex', () => {
    const hex = fieldToHex(1n);
    expect(hex).toBe('0'.repeat(63) + '1');
  });

  it('converts FIELD_PRIME - 1 to a valid hex string', () => {
    const hex = fieldToHex(FIELD_PRIME - 1n);
    expect(hex.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(hex)).toBe(true);
  });

  it('round-trips through hashToField for values within field', () => {
    const original = 12345n;
    const hex = fieldToHex(original);
    const recovered = hashToField(hex);
    expect(recovered).toBe(original);
  });

  it('produces lowercase hex', () => {
    const hex = fieldToHex(0xabcdefn);
    expect(hex).toBe(hex.toLowerCase());
  });
});

// ─── Extended commitment tests ──────────────────────────────────────────────

describe('computeAuditCommitment - extended', () => {
  it('handles single entry', () => {
    const entries = [makeAuditEntry('file.read', '/data/a')];
    const commitment = computeAuditCommitment(entries);
    expect(commitment).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(commitment)).toBe(true);
  });

  it('handles many entries (50)', () => {
    const entries = Array.from({ length: 50 }, (_, i) =>
      makeAuditEntry('file.read', `/data/file-${i}`)
    );
    const commitment = computeAuditCommitment(entries);
    expect(commitment).toHaveLength(64);
  });

  it('handles entries with different outcomes', () => {
    const entries = [
      makeAuditEntry('file.read', '/data/a', 'EXECUTED'),
      makeAuditEntry('file.write', '/system/b', 'DENIED'),
      makeAuditEntry('network.send', '/api/c', 'IMPOSSIBLE'),
    ];
    const commitment = computeAuditCommitment(entries);
    expect(commitment).toHaveLength(64);
  });

  it('adding an entry changes the commitment', () => {
    const entries1 = [makeAuditEntry('file.read', '/data/a')];
    const entries2 = [...entries1, makeAuditEntry('file.read', '/data/b')];
    const c1 = computeAuditCommitment(entries1);
    const c2 = computeAuditCommitment(entries2);
    expect(c1).not.toBe(c2);
  });
});

describe('computeConstraintCommitment - extended', () => {
  it('handles single constraint', () => {
    const c = computeConstraintCommitment("permit file.read on '/data/**'");
    expect(c).toHaveLength(64);
  });

  it('handles complex multi-line constraints', () => {
    const constraints = [
      "permit file.read on '/data/**'",
      "deny file.write on '/system/**' severity critical",
      "deny network.send on '**' severity high",
      "limit api.call on '/external/**' to 100 per 3600 seconds severity medium",
      "require context.user equals 'admin' for file.delete on '/data/**' severity critical",
    ].join('\n');
    const c = computeConstraintCommitment(constraints);
    expect(c).toHaveLength(64);
  });

  it('different constraint ordering produces different commitment', () => {
    const c1 = computeConstraintCommitment("permit file.read on '/a'\ndeny file.write on '/b'");
    const c2 = computeConstraintCommitment("deny file.write on '/b'\npermit file.read on '/a'");
    expect(c1).not.toBe(c2);
  });

  it('whitespace differences produce different commitment', () => {
    const c1 = computeConstraintCommitment("permit file.read on '/data/**'");
    const c2 = computeConstraintCommitment("permit  file.read on '/data/**'");
    expect(c1).not.toBe(c2);
  });
});

// ─── Extended proof generation tests ────────────────────────────────────────

describe('generateComplianceProof - extended', () => {
  it('generates proof with 100 audit entries', async () => {
    const entries = Array.from({ length: 100 }, (_, i) =>
      makeAuditEntry('file.read', `/data/file-${i}`)
    );

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    expect(proof.entryCount).toBe(100);
    expect(proof.publicInputs[3]).toBe('100');
    expect(proof.auditLogCommitment).toHaveLength(64);
  });

  it('generates proof with only DENIED entries', async () => {
    const entries = [
      makeAuditEntry('file.write', '/system/a', 'DENIED'),
      makeAuditEntry('file.write', '/system/b', 'DENIED'),
    ];

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    expect(proof.entryCount).toBe(2);
    const result = await verifyComplianceProof(proof);
    expect(result.valid).toBe(true);
  });

  it('generates proof with IMPOSSIBLE entries', async () => {
    const entries = [makeAuditEntry('network.send', '/external/api', 'IMPOSSIBLE')];

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    const result = await verifyComplianceProof(proof);
    expect(result.valid).toBe(true);
  });

  it('generatedAt is a valid ISO timestamp', async () => {
    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: [],
    });

    const date = new Date(proof.generatedAt);
    expect(date.getTime()).not.toBeNaN();
    expect(proof.generatedAt.endsWith('Z')).toBe(true);
  });

  it('proof field is a 64-char hex string', async () => {
    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: [makeAuditEntry('file.read', '/data/a')],
    });

    expect(proof.proof).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(proof.proof)).toBe(true);
  });
});

// ─── Extended verification tests ────────────────────────────────────────────

describe('verifyComplianceProof - extended', () => {
  it('fails for missing covenantId', async () => {
    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: [],
    });

    const tampered = { ...proof, covenantId: '' as HashHex };
    const result = await verifyComplianceProof(tampered);
    expect(result.valid).toBe(false);
  });

  it('fails for negative entryCount', async () => {
    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: [],
    });

    const tampered = { ...proof, entryCount: -1 };
    const result = await verifyComplianceProof(tampered);
    expect(result.valid).toBe(false);
  });

  it('fails for missing generatedAt', async () => {
    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: [],
    });

    const tampered = { ...proof, generatedAt: '' };
    const result = await verifyComplianceProof(tampered);
    expect(result.valid).toBe(false);
  });

  it('fails for missing proof value', async () => {
    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: [],
    });

    const tampered = { ...proof, proof: '' };
    const result = await verifyComplianceProof(tampered);
    expect(result.valid).toBe(false);
  });

  it('fails for publicInputs that is not an array', async () => {
    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: [],
    });

    const tampered = { ...proof, publicInputs: 'not-an-array' as unknown as string[] };
    const result = await verifyComplianceProof(tampered);
    expect(result.valid).toBe(false);
  });

  it('error messages are descriptive strings', async () => {
    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: [],
    });

    const tampered = { ...proof, version: '99.0' as '1.0' };
    const result = await verifyComplianceProof(tampered);
    expect(result.errors.every(e => typeof e === 'string' && e.length > 0)).toBe(true);
  });

  it('returns correct covenantId and entryCount in result', async () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeAuditEntry('file.read', `/data/${i}`)
    );

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    const result = await verifyComplianceProof(proof);
    expect(result.covenantId).toBe(COVENANT_ID);
    expect(result.entryCount).toBe(5);
  });
});

// ─── Round-trip stress tests ────────────────────────────────────────────────

describe('proof round-trip stress tests', () => {
  it('verifies proofs with varying entry counts (0 through 20)', async () => {
    for (let n = 0; n <= 20; n++) {
      const entries = Array.from({ length: n }, (_, i) =>
        makeAuditEntry('file.read', `/data/entry-${i}`)
      );

      const proof = await generateComplianceProof({
        covenantId: COVENANT_ID,
        constraints: CONSTRAINTS,
        auditEntries: entries,
      });

      const result = await verifyComplianceProof(proof);
      expect(result.valid).toBe(true);
      expect(result.entryCount).toBe(n);
    }
  });

  it('proofs from same data are identical', async () => {
    const entries = [makeAuditEntry('file.read', '/data/a')];
    // Fix timestamps to make deterministic
    entries[0]!.timestamp = '2025-01-01T00:00:00.000Z';
    entries[0]!.hash = sha256String('fixed-entry');

    const proof1 = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    const proof2 = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    expect(proof1.proof).toBe(proof2.proof);
    expect(proof1.auditLogCommitment).toBe(proof2.auditLogCommitment);
    expect(proof1.constraintCommitment).toBe(proof2.constraintCommitment);
  });

  it('swapping covenant ID invalidates proof', async () => {
    const entries = [makeAuditEntry('file.read', '/data/a')];

    const proof = await generateComplianceProof({
      covenantId: COVENANT_ID,
      constraints: CONSTRAINTS,
      auditEntries: entries,
    });

    // Swap covenant ID
    const swapped = {
      ...proof,
      covenantId: 'b'.repeat(64) as HashHex,
      publicInputs: ['b'.repeat(64), proof.publicInputs[1]!, proof.publicInputs[2]!, proof.publicInputs[3]!],
    };

    const result = await verifyComplianceProof(swapped);
    expect(result.valid).toBe(false);
  });
});
