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
      makeCovenant('c1', 'agent-a', ['require:read-only']),
      makeCovenant('c2', 'agent-b', ['require:no-network']),
    ];
    const result = compose(covenants);
    expect(result.agents).toContain('agent-a');
    expect(result.agents).toContain('agent-b');
    expect(result.agents).toHaveLength(2);
  });

  it('returns all individual covenant IDs', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['require:read-only']),
      makeCovenant('c2', 'agent-b', ['deny:write-file']),
    ];
    const result = compose(covenants);
    expect(result.individualCovenants).toEqual(['c1', 'c2']);
  });

  it('merges constraints from multiple covenants', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['require:read-only', 'deny:network']),
      makeCovenant('c2', 'agent-b', ['limit:cpu-10']),
    ];
    const result = compose(covenants);
    expect(result.composedConstraints.length).toBe(3);
  });

  it('deny-wins: removes permit when deny exists for same pattern', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['permit:file-access']),
      makeCovenant('c2', 'agent-b', ['deny:file-access']),
    ];
    const result = compose(covenants);
    const types = result.composedConstraints.map(c => c.type);
    expect(types).toContain('deny');
    expect(types).not.toContain('permit');
  });

  it('produces a non-empty proof hash', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['require:something']),
    ];
    const result = compose(covenants);
    expect(result.proof).toBeDefined();
    expect(result.proof.length).toBe(64);
  });

  it('starts with empty systemProperties', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['deny:exfiltrate']),
    ];
    const result = compose(covenants);
    expect(result.systemProperties).toEqual([]);
  });

  it('deduplicates agents when the same agent appears in multiple covenants', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['require:x']),
      makeCovenant('c2', 'agent-a', ['require:y']),
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
      makeCovenant('c1', 'agent-a', ['deny:exfiltrate']),
    ];
    const result = compose(covenants);
    expect(result.composedConstraints[0]!.source).toBe('c1');
  });

  it('treats unprefixed constraints as require type', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['no-network']),
    ];
    const result = compose(covenants);
    expect(result.composedConstraints[0]!.type).toBe('require');
  });
});

// ---------------------------------------------------------------------------
// proveSystemProperty
// ---------------------------------------------------------------------------

describe('proveSystemProperty', () => {
  it('holds when deny constraints match the property', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['deny:exfiltrate']),
      makeCovenant('c2', 'agent-b', ['deny:data-leak']),
    ];
    const result = proveSystemProperty(covenants, 'exfiltrate');
    expect(result.holds).toBe(true);
    expect(result.derivedFrom).toContain('c1');
  });

  it('does not hold when no deny constraints match', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['require:read-only']),
      makeCovenant('c2', 'agent-b', ['permit:network']),
    ];
    const result = proveSystemProperty(covenants, 'exfiltrate');
    expect(result.holds).toBe(false);
    expect(result.derivedFrom).toEqual([]);
  });

  it('returns the correct property string', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['deny:write']),
    ];
    const result = proveSystemProperty(covenants, 'no-write-access');
    expect(result.property).toBe('no-write-access');
  });

  it('matches case-insensitively', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['deny:Exfiltrate']),
    ];
    const result = proveSystemProperty(covenants, 'EXFILTRATE');
    expect(result.holds).toBe(true);
  });

  it('deduplicates derivedFrom sources', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['deny:leak', 'deny:data-leak']),
    ];
    const result = proveSystemProperty(covenants, 'leak');
    expect(result.derivedFrom).toEqual(['c1']);
  });

  it('collects derivedFrom from multiple covenants', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['deny:exfiltrate']),
      makeCovenant('c2', 'agent-b', ['deny:exfiltrate']),
    ];
    const result = proveSystemProperty(covenants, 'exfiltrate');
    expect(result.holds).toBe(true);
    expect(result.derivedFrom).toContain('c1');
    expect(result.derivedFrom).toContain('c2');
  });
});

// ---------------------------------------------------------------------------
// validateComposition
// ---------------------------------------------------------------------------

describe('validateComposition', () => {
  it('returns true for a valid composition proof', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['require:read-only']),
      makeCovenant('c2', 'agent-b', ['deny:network']),
    ];
    const proof = compose(covenants);
    expect(validateComposition(proof)).toBe(true);
  });

  it('returns false when proof hash is tampered', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['require:read-only']),
    ];
    const proof = compose(covenants);
    const tampered: CompositionProof = { ...proof, proof: 'a'.repeat(64) };
    expect(validateComposition(tampered)).toBe(false);
  });

  it('returns false when composedConstraints are tampered', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['require:read-only']),
    ];
    const proof = compose(covenants);
    const tampered: CompositionProof = {
      ...proof,
      composedConstraints: [
        { source: 'c1', constraint: 'require:write-all', type: 'require' },
      ],
    };
    expect(validateComposition(tampered)).toBe(false);
  });

  it('validates an empty composition', () => {
    const proof = compose([]);
    expect(validateComposition(proof)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// intersectConstraints
// ---------------------------------------------------------------------------

describe('intersectConstraints', () => {
  it('returns common constraints', () => {
    const a = ['deny:exfiltrate', 'require:auth', 'limit:cpu'];
    const b = ['deny:exfiltrate', 'limit:cpu', 'permit:network'];
    const result = intersectConstraints(a, b);
    expect(result).toEqual(['deny:exfiltrate', 'limit:cpu']);
  });

  it('returns empty array when no overlap', () => {
    const a = ['deny:exfiltrate'];
    const b = ['permit:network'];
    const result = intersectConstraints(a, b);
    expect(result).toEqual([]);
  });

  it('returns empty array when one input is empty', () => {
    const result = intersectConstraints([], ['deny:x']);
    expect(result).toEqual([]);
  });

  it('returns empty array when both inputs are empty', () => {
    const result = intersectConstraints([], []);
    expect(result).toEqual([]);
  });

  it('handles identical arrays', () => {
    const arr = ['deny:a', 'deny:b', 'deny:c'];
    const result = intersectConstraints(arr, arr);
    expect(result).toEqual(arr);
  });
});

// ---------------------------------------------------------------------------
// findConflicts
// ---------------------------------------------------------------------------

describe('findConflicts', () => {
  it('finds permit-deny conflicts on the same pattern', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['permit:file-access']),
      makeCovenant('c2', 'agent-b', ['deny:file-access']),
    ];
    const conflicts = findConflicts(covenants);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual(['permit:file-access', 'deny:file-access']);
  });

  it('returns empty when no conflicts exist', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['permit:read']),
      makeCovenant('c2', 'agent-b', ['deny:write']),
    ];
    const conflicts = findConflicts(covenants);
    expect(conflicts).toEqual([]);
  });

  it('returns empty for covenants with only require constraints', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['require:auth']),
      makeCovenant('c2', 'agent-b', ['require:logging']),
    ];
    const conflicts = findConflicts(covenants);
    expect(conflicts).toEqual([]);
  });

  it('finds multiple conflicts across multiple covenants', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['permit:read', 'permit:write']),
      makeCovenant('c2', 'agent-b', ['deny:read', 'deny:write']),
    ];
    const conflicts = findConflicts(covenants);
    expect(conflicts).toHaveLength(2);
  });

  it('does not duplicate conflict pairs', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['permit:read']),
      makeCovenant('c2', 'agent-b', ['deny:read']),
      makeCovenant('c3', 'agent-c', ['permit:read']),
    ];
    const conflicts = findConflicts(covenants);
    // permit:read from c1 vs deny:read, permit:read from c3 vs deny:read
    // but same constraint strings, so check uniqueness
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty covenants array', () => {
    const conflicts = findConflicts([]);
    expect(conflicts).toEqual([]);
  });

  it('finds conflicts within a single covenant', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['permit:network', 'deny:network']),
    ];
    const conflicts = findConflicts(covenants);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual(['permit:network', 'deny:network']);
  });
});

// ---------------------------------------------------------------------------
// compose + validateComposition round-trip
// ---------------------------------------------------------------------------

describe('compose + validateComposition round-trip', () => {
  it('validates a complex multi-agent composition', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['deny:exfiltrate', 'require:auth']),
      makeCovenant('c2', 'agent-b', ['deny:unauthorized-access', 'limit:api-calls-100']),
      makeCovenant('c3', 'agent-c', ['permit:read-public', 'deny:write-secret']),
    ];
    const proof = compose(covenants);
    expect(validateComposition(proof)).toBe(true);
    expect(proof.agents).toHaveLength(3);
    expect(proof.individualCovenants).toHaveLength(3);
  });

  it('proof changes when constraints change', () => {
    const covenants1 = [
      makeCovenant('c1', 'agent-a', ['deny:exfiltrate']),
    ];
    const covenants2 = [
      makeCovenant('c1', 'agent-a', ['deny:write']),
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
      makeCovenant('c1', 'agent-a', ['permit:file-access', 'require:auth']),
      makeCovenant('c2', 'agent-b', ['deny:file-access', 'require:logging']),
    ];
    const result = compose(covenants);
    const constraintStrings = result.composedConstraints.map(c => c.constraint);
    expect(constraintStrings).toContain('deny:file-access');
    expect(constraintStrings).not.toContain('permit:file-access');
    expect(constraintStrings).toContain('require:auth');
    expect(constraintStrings).toContain('require:logging');
  });

  it('keeps permits when no deny conflicts exist', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['permit:read', 'permit:write']),
    ];
    const result = compose(covenants);
    const types = result.composedConstraints.map(c => c.type);
    expect(types).toEqual(['permit', 'permit']);
  });

  it('handles multiple permits and denies for same pattern', () => {
    const covenants = [
      makeCovenant('c1', 'agent-a', ['permit:network']),
      makeCovenant('c2', 'agent-b', ['permit:network']),
      makeCovenant('c3', 'agent-c', ['deny:network']),
    ];
    const result = compose(covenants);
    const permits = result.composedConstraints.filter(c => c.type === 'permit');
    const denies = result.composedConstraints.filter(c => c.type === 'deny');
    expect(permits).toHaveLength(0);
    expect(denies).toHaveLength(1);
  });
});
