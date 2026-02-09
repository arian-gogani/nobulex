import { describe, it, expect } from 'vitest';
import { sha256Object } from '@stele/crypto';
import {
  createMetaCovenant,
  verifyRecursively,
  proveTermination,
  trustBase,
  addLayer,
} from './index';
import type {
  MetaCovenant,
  VerificationEntity,
  MetaTargetType,
  TrustBase,
} from './types';

// ---------------------------------------------------------------------------
// createMetaCovenant
// ---------------------------------------------------------------------------
describe('createMetaCovenant', () => {
  it('creates a covenant with the given targetType', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    expect(mc.targetType).toBe('monitor');
  });

  it('creates a covenant with the given constraints', () => {
    const mc = createMetaCovenant('attestor', ['c1', 'c2']);
    expect(mc.constraints).toEqual(['c1', 'c2']);
  });

  it('starts with recursionDepth 0', () => {
    const mc = createMetaCovenant('governance', ['c1']);
    expect(mc.recursionDepth).toBe(0);
  });

  it('populates terminationProof for base case (no dependencies)', () => {
    const mc = createMetaCovenant('reputation', ['c1']);
    expect(mc.terminationProof).toContain('Base case');
    expect(mc.terminationProof.length).toBeGreaterThan(0);
  });

  it('leaves terminationProof empty when dependencies are provided', () => {
    const mc = createMetaCovenant('monitor', ['c1'], ['dep-1']);
    expect(mc.terminationProof).toBe('');
  });

  it('stores dependsOn when provided', () => {
    const mc = createMetaCovenant('monitor', ['c1'], ['dep-1', 'dep-2']);
    expect(mc.dependsOn).toEqual(['dep-1', 'dep-2']);
  });

  it('generates a deterministic id from content', () => {
    const mc1 = createMetaCovenant('canary', ['c1', 'c2']);
    const mc2 = createMetaCovenant('canary', ['c1', 'c2']);
    expect(mc1.id).toBe(mc2.id);
  });

  it('generates different ids for different constraints', () => {
    const mc1 = createMetaCovenant('monitor', ['c1']);
    const mc2 = createMetaCovenant('monitor', ['c2']);
    expect(mc1.id).not.toBe(mc2.id);
  });

  it('generates different ids for different target types', () => {
    const mc1 = createMetaCovenant('monitor', ['c1']);
    const mc2 = createMetaCovenant('attestor', ['c1']);
    expect(mc1.id).not.toBe(mc2.id);
  });

  it('id is a valid 64-character hex string (sha256)', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    expect(mc.id.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(mc.id)).toBe(true);
  });

  it('id matches sha256Object of canonical content', () => {
    const mc = createMetaCovenant('governance', ['x', 'y']);
    const expected = sha256Object({
      targetType: 'governance',
      constraints: ['x', 'y'],
      recursionDepth: 0,
      terminationProof: '',
    });
    expect(mc.id).toBe(expected);
  });

  it('does not mutate the input constraints array', () => {
    const constraints = ['c1', 'c2'];
    createMetaCovenant('monitor', constraints);
    expect(constraints).toEqual(['c1', 'c2']);
  });

  it('works with empty constraints', () => {
    const mc = createMetaCovenant('monitor', []);
    expect(mc.constraints).toEqual([]);
    expect(mc.id.length).toBe(64);
  });

  it('accepts all valid MetaTargetType values', () => {
    const types: MetaTargetType[] = ['monitor', 'attestor', 'governance', 'reputation', 'canary'];
    for (const t of types) {
      const mc = createMetaCovenant(t, ['c1']);
      expect(mc.targetType).toBe(t);
    }
  });
});

// ---------------------------------------------------------------------------
// verifyRecursively
// ---------------------------------------------------------------------------
describe('verifyRecursively', () => {
  it('returns empty array for empty entities', () => {
    const results = verifyRecursively([], 3);
    expect(results).toEqual([]);
  });

  it('returns a single layer for a single unverified entity', () => {
    const entities: VerificationEntity[] = [
      { id: 'e1', type: 'monitor', covenantId: 'cov1' },
    ];
    const results = verifyRecursively(entities, 3);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const first = results[0]!;
    expect(first.entityId).toBe('e1');
    expect(first.verified).toBe(false);
    expect(first.verifiedBy).toBe('');
  });

  it('verifies an entity that has a verifier', () => {
    const entities: VerificationEntity[] = [
      { id: 'e1', type: 'monitor', covenantId: 'cov1', verifierId: 'e2', verifierCovenantId: 'cov2' },
      { id: 'e2', type: 'attestor', covenantId: 'cov2' },
    ];
    const results = verifyRecursively(entities, 3);
    const e1Result = results.find((r) => r.entityId === 'e1');
    expect(e1Result).toBeDefined();
    expect(e1Result!.verified).toBe(true);
    expect(e1Result!.verifiedBy).toBe('e2');
  });

  it('follows the verification chain through multiple layers', () => {
    const entities: VerificationEntity[] = [
      { id: 'e1', type: 'monitor', covenantId: 'cov1', verifierId: 'e2', verifierCovenantId: 'cov2' },
      { id: 'e2', type: 'attestor', covenantId: 'cov2', verifierId: 'e3', verifierCovenantId: 'cov3' },
      { id: 'e3', type: 'governance', covenantId: 'cov3' },
    ];
    const results = verifyRecursively(entities, 5);
    expect(results.length).toBeGreaterThanOrEqual(3);
    const layers = results.filter((r) => r.entityId === 'e1' || r.entityId === 'e2' || r.entityId === 'e3');
    expect(layers.length).toBe(3);
  });

  it('respects maxDepth limit', () => {
    const entities: VerificationEntity[] = [
      { id: 'e1', type: 'monitor', covenantId: 'cov1', verifierId: 'e2', verifierCovenantId: 'cov2' },
      { id: 'e2', type: 'attestor', covenantId: 'cov2', verifierId: 'e3', verifierCovenantId: 'cov3' },
      { id: 'e3', type: 'governance', covenantId: 'cov3' },
    ];
    const results = verifyRecursively(entities, 1);
    const maxLayer = Math.max(...results.map((r) => r.layer));
    expect(maxLayer).toBeLessThanOrEqual(1);
  });

  it('detects and stops on cycles', () => {
    const entities: VerificationEntity[] = [
      { id: 'e1', type: 'monitor', covenantId: 'cov1', verifierId: 'e2', verifierCovenantId: 'cov2' },
      { id: 'e2', type: 'attestor', covenantId: 'cov2', verifierId: 'e1', verifierCovenantId: 'cov1' },
    ];
    const results = verifyRecursively(entities, 10);
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('includes correct covenantId for each entity', () => {
    const entities: VerificationEntity[] = [
      { id: 'e1', type: 'monitor', covenantId: 'cov-abc' },
    ];
    const results = verifyRecursively(entities, 1);
    expect(results[0]!.covenantId).toBe('cov-abc');
  });

  it('includes correct entityType for each entity', () => {
    const entities: VerificationEntity[] = [
      { id: 'e1', type: 'canary', covenantId: 'cov1' },
    ];
    const results = verifyRecursively(entities, 1);
    expect(results[0]!.entityType).toBe('canary');
  });
});

// ---------------------------------------------------------------------------
// proveTermination
// ---------------------------------------------------------------------------
describe('proveTermination', () => {
  it('returns converges=true for an empty chain', () => {
    const proof = proveTermination([]);
    expect(proof.converges).toBe(true);
    expect(proof.maxDepth).toBe(0);
  });

  it('returns converges=true for a single covenant', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    const proof = proveTermination([mc]);
    expect(proof.converges).toBe(true);
    expect(proof.maxDepth).toBe(0);
  });

  it('returns the correct maxDepth for a chain', () => {
    const mc0 = createMetaCovenant('monitor', ['c1']);
    const mc1 = addLayer(mc0, ['c2']);
    const mc2 = addLayer(mc1, ['c3']);
    const proof = proveTermination([mc0, mc1, mc2]);
    expect(proof.maxDepth).toBe(2);
  });

  it('detects cycles (duplicate ids)', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    const proof = proveTermination([mc, mc]);
    expect(proof.converges).toBe(false);
  });

  it('detects cycles via DAG when dependsOn creates a cycle', () => {
    const mc1: MetaCovenant = {
      id: 'a',
      targetType: 'monitor',
      constraints: ['c1'],
      recursionDepth: 0,
      terminationProof: '',
      dependsOn: ['b'],
    };
    const mc2: MetaCovenant = {
      id: 'b',
      targetType: 'monitor',
      constraints: ['c2'],
      recursionDepth: 0,
      terminationProof: '',
      dependsOn: ['a'],
    };
    const proof = proveTermination([mc1, mc2]);
    expect(proof.converges).toBe(false);
    expect(proof.proof).toContain('Cycle');
  });

  it('returns converges=true for valid DAG with dependsOn', () => {
    const base: MetaCovenant = {
      id: 'base',
      targetType: 'monitor',
      constraints: ['c1'],
      recursionDepth: 0,
      terminationProof: 'base',
    };
    const layer1: MetaCovenant = {
      id: 'layer1',
      targetType: 'monitor',
      constraints: ['c1', 'c2'],
      recursionDepth: 1,
      terminationProof: 'layer1',
      dependsOn: ['base'],
    };
    const proof = proveTermination([base, layer1]);
    expect(proof.converges).toBe(true);
  });

  it('includes trustAssumption as structured object', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    const proof = proveTermination([mc]);
    expect(proof.trustAssumption).toHaveProperty('assumptions');
    expect(proof.trustAssumption).toHaveProperty('cryptographicPrimitives');
    expect(proof.trustAssumption).toHaveProperty('description');
    expect(proof.trustAssumption.assumptions.length).toBeGreaterThan(0);
  });

  it('proof string describes DAG analysis for valid chain', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    const proof = proveTermination([mc]);
    expect(proof.proof).toContain('DAG analysis');
    expect(proof.proof).toContain('no cycles detected');
  });

  it('proof string describes cycle for invalid chain', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    const proof = proveTermination([mc, mc]);
    expect(proof.proof).toContain('Cycle');
  });
});

// ---------------------------------------------------------------------------
// trustBase
// ---------------------------------------------------------------------------
describe('trustBase', () => {
  it('returns a structured TrustBase object', () => {
    const tb = trustBase();
    expect(tb).toHaveProperty('assumptions');
    expect(tb).toHaveProperty('cryptographicPrimitives');
    expect(tb).toHaveProperty('description');
  });

  it('includes Ed25519 in assumptions', () => {
    const tb = trustBase();
    expect(tb.assumptions.some(a => a.includes('Ed25519'))).toBe(true);
  });

  it('includes SHA-256 in assumptions', () => {
    const tb = trustBase();
    expect(tb.assumptions.some(a => a.includes('SHA-256'))).toBe(true);
  });

  it('includes Ed25519 in cryptographicPrimitives', () => {
    const tb = trustBase();
    expect(tb.cryptographicPrimitives).toContain('Ed25519');
  });

  it('includes SHA-256 in cryptographicPrimitives', () => {
    const tb = trustBase();
    expect(tb.cryptographicPrimitives).toContain('SHA-256');
  });

  it('has a non-empty description', () => {
    const tb = trustBase();
    expect(tb.description.length).toBeGreaterThan(0);
    expect(tb.description).toContain('Ed25519');
    expect(tb.description).toContain('SHA-256');
  });
});

// ---------------------------------------------------------------------------
// addLayer
// ---------------------------------------------------------------------------
describe('addLayer', () => {
  it('increments recursionDepth by 1', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    const next = addLayer(mc, ['c2']);
    expect(next.recursionDepth).toBe(1);
  });

  it('merges constraints from existing and new', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    const next = addLayer(mc, ['c2', 'c3']);
    expect(next.constraints).toEqual(['c1', 'c2', 'c3']);
  });

  it('preserves targetType from existing covenant', () => {
    const mc = createMetaCovenant('attestor', ['c1']);
    const next = addLayer(mc, ['c2']);
    expect(next.targetType).toBe('attestor');
  });

  it('generates a new id different from the existing one', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    const next = addLayer(mc, ['c2']);
    expect(next.id).not.toBe(mc.id);
  });

  it('generates a deterministic id for the same inputs', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    const next1 = addLayer(mc, ['c2']);
    const next2 = addLayer(mc, ['c2']);
    expect(next1.id).toBe(next2.id);
  });

  it('supports multiple layers of nesting', () => {
    const mc0 = createMetaCovenant('monitor', ['c1']);
    const mc1 = addLayer(mc0, ['c2']);
    const mc2 = addLayer(mc1, ['c3']);
    const mc3 = addLayer(mc2, ['c4']);
    expect(mc3.recursionDepth).toBe(3);
    expect(mc3.constraints).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('does not mutate the existing covenant', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    const originalId = mc.id;
    const originalDepth = mc.recursionDepth;
    addLayer(mc, ['c2']);
    expect(mc.id).toBe(originalId);
    expect(mc.recursionDepth).toBe(originalDepth);
    expect(mc.constraints).toEqual(['c1']);
  });

  it('id is a valid 64-character hex string', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    const next = addLayer(mc, ['c2']);
    expect(next.id.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(next.id)).toBe(true);
  });

  it('populates terminationProof with layer information', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    const next = addLayer(mc, ['c2']);
    expect(next.terminationProof).toContain('Layer 1');
    expect(next.terminationProof).toContain('additional constraints');
  });

  it('sets dependsOn to include parent id', () => {
    const mc = createMetaCovenant('monitor', ['c1']);
    const next = addLayer(mc, ['c2']);
    expect(next.dependsOn).toBeDefined();
    expect(next.dependsOn).toContain(mc.id);
  });

  it('accumulates dependsOn through multiple layers', () => {
    const mc0 = createMetaCovenant('monitor', ['c1']);
    const mc1 = addLayer(mc0, ['c2']);
    const mc2 = addLayer(mc1, ['c3']);
    expect(mc2.dependsOn).toContain(mc1.id);
    expect(mc2.dependsOn).toContain(mc0.id);
  });
});
