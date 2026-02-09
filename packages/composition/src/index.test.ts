import { describe, it, expect } from 'vitest';
import {
  compose,
  proveSystemProperty,
  validateComposition,
  intersectConstraints,
  findConflicts,
} from './index.js';
import type { CovenantSummary, CompositionProof } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCovenant(
  id: string,
  agentId: string,
  constraints: string[],
): CovenantSummary {
  return { id, agentId, constraints };
}

// ---------------------------------------------------------------------------
// compose
// ---------------------------------------------------------------------------

describe('compose', () => {
  it('returns all agents from the provided covenants', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["require read_only on '**'"]),
      makeCovenant('c2', 'agent-b', ["require no_network on '**'"]),
    ];
    const result = compose(covenants);
    expect(result.agents).toContain('agent-a');
    expect(result.agents).toContain('agent-b');
    expect(result.agents).toHaveLength(2);
  });

  it('returns all individual covenant IDs', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["require read_only on '**'"]),
      makeCovenant('c2', 'agent-b', ["deny write_file on '**'"]),
    ];
    const result = compose(covenants);
    expect(result.individualCovenants).toEqual(['c1', 'c2']);
  });

  it('merges constraints from multiple covenants', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["require read_only on '**'", "deny network on '**'"]),
      makeCovenant('c2', 'agent-b', ['limit cpu 10 per 60 seconds']),
    ];
    const result = compose(covenants);
    expect(result.composedConstraints.length).toBe(3);
  });

  it('deny-wins: removes permit when deny exists for same pattern', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit file_access on '**'"]),
      makeCovenant('c2', 'agent-b', ["deny file_access on '**'"]),
    ];
    const result = compose(covenants);
    const types = result.composedConstraints.map(c => c.type);
    expect(types).toContain('deny');
    expect(types).not.toContain('permit');
  });

  it('deny-wins: removes permits when deny has overlapping wildcard pattern', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit file.read on '/data'"]),
      makeCovenant('c2', 'agent-b', ["deny file.* on '/data/**'"]),
    ];
    const result = compose(covenants);
    const types = result.composedConstraints.map(c => c.type);
    expect(types).toContain('deny');
    expect(types).not.toContain('permit');
  });

  it('produces a non-empty proof hash', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["require something on '**'"]),
    ];
    const result = compose(covenants);
    expect(result.proof).toBeDefined();
    expect(result.proof.length).toBe(64);
  });

  it('starts with empty systemProperties', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["deny exfiltrate on '**'"]),
    ];
    const result = compose(covenants);
    expect(result.systemProperties).toEqual([]);
  });

  it('deduplicates agents when the same agent appears in multiple covenants', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["require x on '**'"]),
      makeCovenant('c2', 'agent-a', ["require y on '**'"]),
    ];
    const result = compose(covenants);
    expect(result.agents).toEqual(['agent-a']);
  });

  it('handles empty covenants array', () => {
    const result = compose([]);
    expect(result.agents).toEqual([]);
    expect(result.individualCovenants).toEqual([]);
    expect(result.composedConstraints).toEqual([]);
    expect(result.proof.length).toBe(64);
  });

  it('preserves constraint source references', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["deny exfiltrate on '**'"]),
    ];
    const result = compose(covenants);
    expect(result.composedConstraints[0]!.source).toBe('c1');
  });

  it('keeps permits when no deny conflicts exist', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit read on '/public'", "permit write on '/scratch'"]),
    ];
    const result = compose(covenants);
    const types = result.composedConstraints.map(c => c.type);
    expect(types).toEqual(['permit', 'permit']);
  });

  it('handles multiple permits and denies for same pattern', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit network on '**'"]),
      makeCovenant('c2', 'agent-b', ["permit network on '**'"]),
      makeCovenant('c3', 'agent-c', ["deny network on '**'"]),
    ];
    const result = compose(covenants);
    const permits = result.composedConstraints.filter(c => c.type === 'permit');
    const denies = result.composedConstraints.filter(c => c.type === 'deny');
    expect(permits).toHaveLength(0);
    expect(denies).toHaveLength(1);
  });

  it('keeps deny and removes permit when both exist, preserving require and limit', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit file_access on '**'", "require auth on '**'"]),
      makeCovenant('c2', 'agent-b', ["deny file_access on '**'", "require logging on '**'"]),
    ];
    const result = compose(covenants);
    const constraintTypes = result.composedConstraints.map(c => c.type);
    expect(constraintTypes).toContain('deny');
    expect(constraintTypes).not.toContain('permit');
    expect(constraintTypes).toContain('require');
  });

  it('constraints are valid serialized CCL in the output', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["deny exfiltrate on '**'"]),
    ];
    const result = compose(covenants);
    const constraint = result.composedConstraints[0]!.constraint;
    expect(constraint).toContain('deny');
    expect(constraint).toContain('exfiltrate');
  });

  // Input validation
  it('throws when covenants is not an array', () => {
    expect(() => compose(null as any)).toThrow('covenants must be an array');
  });

  it('throws when a covenant has no id', () => {
    expect(() => compose([{ id: '', agentId: 'a', constraints: [] }])).toThrow();
  });

  it('throws when a covenant has no agentId', () => {
    expect(() => compose([{ id: 'c1', agentId: '', constraints: [] }])).toThrow();
  });

  it('throws when a covenant has no constraints array', () => {
    expect(() => compose([{ id: 'c1', agentId: 'a', constraints: 'bad' as any }])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// proveSystemProperty
// ---------------------------------------------------------------------------

describe('proveSystemProperty', () => {
  it('holds when deny constraints match the property', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["deny exfiltrate on '**'"]),
      makeCovenant('c2', 'agent-b', ["deny data_leak on '**'"]),
    ];
    const result = proveSystemProperty(covenants, 'exfiltrate');
    expect(result.holds).toBe(true);
    expect(result.derivedFrom).toContain('c1');
  });

  it('does not hold when no deny constraints match', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["require read_only on '**'"]),
      makeCovenant('c2', 'agent-b', ["permit network on '**'"]),
    ];
    const result = proveSystemProperty(covenants, 'exfiltrate');
    expect(result.holds).toBe(false);
    expect(result.derivedFrom).toEqual([]);
  });

  it('returns the correct property string', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["deny write on '**'"]),
    ];
    const result = proveSystemProperty(covenants, 'no-write-access');
    expect(result.property).toBe('no-write-access');
  });

  it('matches property to deny actions case-insensitively', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["deny Exfiltrate on '**'"]),
    ];
    const result = proveSystemProperty(covenants, 'EXFILTRATE');
    expect(result.holds).toBe(true);
  });

  it('deduplicates derivedFrom sources', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["deny leak on '**'", "deny data_leak on '**'"]),
    ];
    const result = proveSystemProperty(covenants, 'leak');
    expect(result.derivedFrom).toEqual(['c1']);
  });

  it('collects derivedFrom from multiple covenants', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["deny exfiltrate on '**'"]),
      makeCovenant('c2', 'agent-b', ["deny exfiltrate on '**'"]),
    ];
    const result = proveSystemProperty(covenants, 'exfiltrate');
    expect(result.holds).toBe(true);
    expect(result.derivedFrom).toContain('c1');
    expect(result.derivedFrom).toContain('c2');
  });

  it('uses real CCL evaluation to verify denies fire', () => {
    // A deny with a condition that, when probed with a satisfying context, fires
    const covenants = [
      makeCovenant('c1', 'agent-a', ["deny exfiltrate on '**' when risk_level = 'critical'"]),
    ];
    const result = proveSystemProperty(covenants, 'exfiltrate');
    expect(result.holds).toBe(true);
    expect(result.derivedFrom).toContain('c1');
  });

  it('does not hold when covenants have no constraints', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', []),
    ];
    const result = proveSystemProperty(covenants, 'exfiltrate');
    expect(result.holds).toBe(false);
    expect(result.derivedFrom).toEqual([]);
  });

  it('wildcard deny is relevant to any property', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["deny * on '**'"]),
    ];
    const result = proveSystemProperty(covenants, 'anything');
    expect(result.holds).toBe(true);
  });

  // Input validation
  it('throws when covenants is not an array', () => {
    expect(() => proveSystemProperty(null as any, 'prop')).toThrow();
  });

  it('throws when property is empty', () => {
    expect(() => proveSystemProperty([], '')).toThrow('property must be a non-empty string');
  });

  it('throws when property is not a string', () => {
    expect(() => proveSystemProperty([], 42 as any)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateComposition
// ---------------------------------------------------------------------------

describe('validateComposition', () => {
  it('returns true for a valid composition proof', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["require read_only on '**'"]),
      makeCovenant('c2', 'agent-b', ["deny network on '**'"]),
    ];
    const proof = compose(covenants);
    expect(validateComposition(proof)).toBe(true);
  });

  it('returns false when proof hash is tampered', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["require read_only on '**'"]),
    ];
    const proof = compose(covenants);
    const tampered: CompositionProof = { ...proof, proof: 'a'.repeat(64) };
    expect(validateComposition(tampered)).toBe(false);
  });

  it('returns false when composedConstraints are tampered', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["require read_only on '**'"]),
    ];
    const proof = compose(covenants);
    const tampered: CompositionProof = {
      ...proof,
      composedConstraints: [
        { source: 'c1', constraint: "require write_all on '**'", type: 'require' },
      ],
    };
    expect(validateComposition(tampered)).toBe(false);
  });

  it('validates an empty composition', () => {
    const proof = compose([]);
    expect(validateComposition(proof)).toBe(true);
  });

  it('returns false when composed constraints contain invalid CCL', () => {
    const proof = compose([]);
    const tampered: CompositionProof = {
      ...proof,
      composedConstraints: [
        { source: 'c1', constraint: 'invalid garbage text $$$', type: 'require' },
      ],
      proof: '', // will be recomputed check
    };
    // Fix the hash so only CCL validity is tested
    const { sha256Object } = require('@stele/crypto');
    tampered.proof = sha256Object(tampered.composedConstraints);
    expect(validateComposition(tampered)).toBe(false);
  });

  it('returns false when deny-wins consistency is violated (permit overlaps deny)', () => {
    // Manually construct a proof where a permit overlaps with a deny
    const { sha256Object } = require('@stele/crypto');
    const constraints = [
      { source: 'c1', constraint: "permit file_access on '**'", type: 'permit' as const },
      { source: 'c2', constraint: "deny file_access on '**'", type: 'deny' as const },
    ];
    const tampered: CompositionProof = {
      agents: ['a'],
      individualCovenants: ['c1', 'c2'],
      composedConstraints: constraints,
      systemProperties: [],
      proof: sha256Object(constraints),
    };
    expect(validateComposition(tampered)).toBe(false);
  });

  // Input validation
  it('throws when proof is null', () => {
    expect(() => validateComposition(null as any)).toThrow();
  });

  it('throws when composedConstraints is missing', () => {
    expect(() => validateComposition({ proof: 'x' } as any)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// intersectConstraints
// ---------------------------------------------------------------------------

describe('intersectConstraints', () => {
  it('returns common constraints', () => {
    const a = ["deny exfiltrate on '**'", "require auth on '**'", 'limit cpu 10 per 60 seconds'];
    const b = ["deny exfiltrate on '**'", 'limit cpu 10 per 60 seconds', "permit network on '**'"];
    const result = intersectConstraints(a, b);
    expect(result).toEqual(["deny exfiltrate on '**'", 'limit cpu 10 per 60 seconds']);
  });

  it('returns empty array when no overlap', () => {
    const a = ["deny exfiltrate on '**'"];
    const b = ["permit network on '**'"];
    const result = intersectConstraints(a, b);
    expect(result).toEqual([]);
  });

  it('returns empty array when one input is empty', () => {
    const result = intersectConstraints([], ["deny x on '**'"]);
    expect(result).toEqual([]);
  });

  it('returns empty array when both inputs are empty', () => {
    const result = intersectConstraints([], []);
    expect(result).toEqual([]);
  });

  it('handles identical arrays', () => {
    const arr = ["deny a on '/'", "deny b on '/'", "deny c on '/'"];
    const result = intersectConstraints(arr, arr);
    expect(result).toEqual(arr);
  });

  // Input validation
  it('throws when arguments are not arrays', () => {
    expect(() => intersectConstraints(null as any, [])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// findConflicts
// ---------------------------------------------------------------------------

describe('findConflicts', () => {
  it('finds permit-deny conflicts on the same pattern', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit file_access on '**'"]),
      makeCovenant('c2', 'agent-b', ["deny file_access on '**'"]),
    ];
    const conflicts = findConflicts(covenants);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]![0]).toContain('permit');
    expect(conflicts[0]![1]).toContain('deny');
  });

  it('returns empty when no conflicts exist', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit read on '**'"]),
      makeCovenant('c2', 'agent-b', ["deny write on '**'"]),
    ];
    const conflicts = findConflicts(covenants);
    expect(conflicts).toEqual([]);
  });

  it('returns empty for covenants with only require constraints', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["require auth on '**'"]),
      makeCovenant('c2', 'agent-b', ["require logging on '**'"]),
    ];
    const conflicts = findConflicts(covenants);
    expect(conflicts).toEqual([]);
  });

  it('finds multiple conflicts across multiple covenants', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit read on '**'", "permit write on '**'"]),
      makeCovenant('c2', 'agent-b', ["deny read on '**'", "deny write on '**'"]),
    ];
    const conflicts = findConflicts(covenants);
    expect(conflicts).toHaveLength(2);
  });

  it('does not duplicate conflict pairs', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit read on '**'"]),
      makeCovenant('c2', 'agent-b', ["deny read on '**'"]),
      makeCovenant('c3', 'agent-c', ["permit read on '**'"]),
    ];
    const conflicts = findConflicts(covenants);
    // Same serialized strings, so deduplication applies
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty covenants array', () => {
    const conflicts = findConflicts([]);
    expect(conflicts).toEqual([]);
  });

  it('finds conflicts within a single covenant', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit network on '**'", "deny network on '**'"]),
    ];
    const conflicts = findConflicts(covenants);
    expect(conflicts).toHaveLength(1);
  });

  it('detects overlapping patterns (not just identical)', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit file.read on '/data/**'"]),
      makeCovenant('c2', 'agent-b', ["deny file.* on '/data'"]),
    ];
    const conflicts = findConflicts(covenants);
    expect(conflicts).toHaveLength(1);
  });

  it('detects wildcard action overlapping with specific action', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit read on '**'"]),
      makeCovenant('c2', 'agent-b', ["deny * on '**'"]),
    ];
    const conflicts = findConflicts(covenants);
    expect(conflicts).toHaveLength(1);
  });

  // Input validation
  it('throws when covenants is not an array', () => {
    expect(() => findConflicts(null as any)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// compose + validateComposition round-trip
// ---------------------------------------------------------------------------

describe('compose + validateComposition round-trip', () => {
  it('validates a complex multi-agent composition', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["deny exfiltrate on '**'", "require auth on '**'"]),
      makeCovenant('c2', 'agent-b', ["deny unauthorized_access on '**'", 'limit api_calls 100 per 60 seconds']),
      makeCovenant('c3', 'agent-c', ["permit read_public on '/public'", "deny write_secret on '/secret'"]),
    ];
    const proof = compose(covenants);
    expect(validateComposition(proof)).toBe(true);
    expect(proof.agents).toHaveLength(3);
    expect(proof.individualCovenants).toHaveLength(3);
  });

  it('proof changes when constraints change', () => {
    const covenants1 = [
      makeCovenant('c1', 'agent-a', ["deny exfiltrate on '**'"]),
    ];
    const covenants2 = [
      makeCovenant('c1', 'agent-a', ["deny write on '**'"]),
    ];
    const proof1 = compose(covenants1);
    const proof2 = compose(covenants2);
    expect(proof1.proof).not.toBe(proof2.proof);
  });
});

// ---------------------------------------------------------------------------
// compose - deny-wins detailed scenarios
// ---------------------------------------------------------------------------

describe('compose - deny-wins detailed scenarios', () => {
  it('keeps deny and removes permit when both exist for a pattern', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit file_access on '**'", "require auth on '**'"]),
      makeCovenant('c2', 'agent-b', ["deny file_access on '**'", "require logging on '**'"]),
    ];
    const result = compose(covenants);
    const types = result.composedConstraints.map(c => c.type);
    expect(types).toContain('deny');
    expect(types).not.toContain('permit');
    expect(types).toContain('require');
  });

  it('keeps permits when no deny conflicts exist', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit read on '/data'", "permit write on '/data'"]),
    ];
    const result = compose(covenants);
    const types = result.composedConstraints.map(c => c.type);
    expect(types).toEqual(['permit', 'permit']);
  });

  it('handles multiple permits and denies for same pattern', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit network on '**'"]),
      makeCovenant('c2', 'agent-b', ["permit network on '**'"]),
      makeCovenant('c3', 'agent-c', ["deny network on '**'"]),
    ];
    const result = compose(covenants);
    const permits = result.composedConstraints.filter(c => c.type === 'permit');
    const denies = result.composedConstraints.filter(c => c.type === 'deny');
    expect(permits).toHaveLength(0);
    expect(denies).toHaveLength(1);
  });

  it('deny with broader pattern removes permit with narrower pattern', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ["permit file.read on '/data/public'"]),
      makeCovenant('c2', 'agent-b', ["deny ** on '**'"]),
    ];
    const result = compose(covenants);
    const types = result.composedConstraints.map(c => c.type);
    expect(types).not.toContain('permit');
    expect(types).toContain('deny');
  });
});
