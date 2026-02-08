import { describe, it, expect } from 'vitest';
import {
  generateAntibody,
  proposeToGovernance,
  networkHealth,
  adoptAntibody,
  rejectAntibody,
  voteForAntibody,
} from './index.js';
import type { BreachAntibody, BreachSummary } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBreach(
  id: string,
  violatedConstraint: string,
  severity: BreachSummary['severity'] = 'high',
  category?: string,
): BreachSummary {
  return { id, violatedConstraint, severity, category };
}

// ---------------------------------------------------------------------------
// generateAntibody
// ---------------------------------------------------------------------------

describe('generateAntibody', () => {
  it('creates an antibody with status proposed', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'critical');
    const antibody = generateAntibody(breach);
    expect(antibody.status).toBe('proposed');
  });

  it('creates an antibody with zero adoption votes', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach);
    expect(antibody.adoptionVotes).toBe(0);
  });

  it('derives category from the violated constraint', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate-data', 'medium');
    const antibody = generateAntibody(breach);
    expect(antibody.category).toBe('exfiltrate');
  });

  it('uses explicit category from the breach when provided', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate-data', 'medium', 'data-loss');
    const antibody = generateAntibody(breach);
    expect(antibody.category).toBe('data-loss');
  });

  it('generates a deny constraint from the violated constraint', () => {
    const breach = makeBreach('b1', 'permit:file-access', 'high');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe('deny:file-access');
  });

  it('preserves deny prefix in proposed constraint', () => {
    const breach = makeBreach('b1', 'deny:network-call', 'critical');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe('deny:network-call');
  });

  it('wraps unprefixed constraints in deny', () => {
    const breach = makeBreach('b1', 'read-secrets', 'low');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe('deny:read-secrets');
  });

  it('generates a unique ID', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody1 = generateAntibody(breach);
    const antibody2 = generateAntibody(breach);
    expect(antibody1.id).not.toBe(antibody2.id);
  });

  it('references the breach ID', () => {
    const breach = makeBreach('breach-123', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach);
    expect(antibody.derivedFromBreach).toBe('breach-123');
  });
});

// ---------------------------------------------------------------------------
// proposeToGovernance
// ---------------------------------------------------------------------------

describe('proposeToGovernance', () => {
  it('creates a governance proposal with a unique ID', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach);
    const proposal = proposeToGovernance(antibody);
    expect(proposal.id).toBeDefined();
    expect(proposal.id.length).toBeGreaterThan(0);
  });

  it('references the antibody ID', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach);
    const proposal = proposeToGovernance(antibody);
    expect(proposal.antibodyId).toBe(antibody.id);
  });

  it('includes a timestamp', () => {
    const before = Date.now();
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach);
    const proposal = proposeToGovernance(antibody);
    const after = Date.now();
    expect(proposal.proposedAt).toBeGreaterThanOrEqual(before);
    expect(proposal.proposedAt).toBeLessThanOrEqual(after);
  });

  it('includes a human-readable description', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach);
    const proposal = proposeToGovernance(antibody);
    expect(proposal.description).toContain(antibody.proposedConstraint);
    expect(proposal.description).toContain(antibody.category);
  });

  it('generates unique IDs for different proposals', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach);
    const p1 = proposeToGovernance(antibody);
    const p2 = proposeToGovernance(antibody);
    expect(p1.id).not.toBe(p2.id);
  });
});

// ---------------------------------------------------------------------------
// networkHealth
// ---------------------------------------------------------------------------

describe('networkHealth', () => {
  it('computes correct total breaches', () => {
    const breaches = [
      makeBreach('b1', 'deny:exfiltrate', 'high'),
      makeBreach('b2', 'deny:write', 'medium'),
    ];
    const health = networkHealth([], breaches);
    expect(health.totalBreaches).toBe(2);
  });

  it('computes correct antibodies generated count', () => {
    const antibody = generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high'));
    const health = networkHealth([antibody], []);
    expect(health.antibodiesGenerated).toBe(1);
  });

  it('computes correct antibodies adopted count', () => {
    const antibody = adoptAntibody(
      generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high')),
    );
    const health = networkHealth([antibody], []);
    expect(health.antibodiesAdopted).toBe(1);
  });

  it('computes resistanceScore as adopted / max(1, breaches)', () => {
    const breach1 = makeBreach('b1', 'deny:exfiltrate', 'high', 'exfiltrate');
    const breach2 = makeBreach('b2', 'deny:write', 'medium', 'write');
    const antibody = adoptAntibody(generateAntibody(breach1));
    const health = networkHealth([antibody], [breach1, breach2]);
    expect(health.resistanceScore).toBeCloseTo(1 / 2);
  });

  it('resistanceScore is 0 when no antibodies are adopted', () => {
    const breaches = [makeBreach('b1', 'deny:exfiltrate', 'high')];
    const health = networkHealth([], breaches);
    expect(health.resistanceScore).toBe(0);
  });

  it('resistanceScore handles zero breaches', () => {
    const antibody = adoptAntibody(
      generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high')),
    );
    const health = networkHealth([antibody], []);
    // adopted / max(1, 0) = 1 / 1 = 1
    expect(health.resistanceScore).toBe(1);
  });

  it('identifies vulnerable categories (no adopted antibody)', () => {
    const breach1 = makeBreach('b1', 'deny:exfiltrate', 'high', 'data-loss');
    const breach2 = makeBreach('b2', 'deny:write', 'medium', 'file-access');
    const antibody = adoptAntibody(generateAntibody(breach1));
    // antibody category derived from breach1: 'data-loss' (explicit)
    // but the adopted antibody's category is 'data-loss'
    const health = networkHealth(
      [{ ...antibody, category: 'data-loss' }],
      [breach1, breach2],
    );
    expect(health.vulnerableCategories).toContain('file-access');
    expect(health.vulnerableCategories).not.toContain('data-loss');
  });

  it('returns empty vulnerable categories when all are covered', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high', 'exfiltrate');
    const antibody = adoptAntibody(
      generateAntibody(breach),
    );
    const health = networkHealth(
      [{ ...antibody, category: 'exfiltrate' }],
      [breach],
    );
    expect(health.vulnerableCategories).toEqual([]);
  });

  it('handles empty arrays', () => {
    const health = networkHealth([], []);
    expect(health.totalBreaches).toBe(0);
    expect(health.antibodiesGenerated).toBe(0);
    expect(health.antibodiesAdopted).toBe(0);
    expect(health.resistanceScore).toBe(0);
    expect(health.vulnerableCategories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// adoptAntibody
// ---------------------------------------------------------------------------

describe('adoptAntibody', () => {
  it('returns a copy with status adopted', () => {
    const antibody = generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high'));
    const adopted = adoptAntibody(antibody);
    expect(adopted.status).toBe('adopted');
  });

  it('does not mutate the original antibody', () => {
    const antibody = generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high'));
    adoptAntibody(antibody);
    expect(antibody.status).toBe('proposed');
  });

  it('preserves all other fields', () => {
    const antibody = generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high'));
    const adopted = adoptAntibody(antibody);
    expect(adopted.id).toBe(antibody.id);
    expect(adopted.derivedFromBreach).toBe(antibody.derivedFromBreach);
    expect(adopted.proposedConstraint).toBe(antibody.proposedConstraint);
    expect(adopted.category).toBe(antibody.category);
    expect(adopted.adoptionVotes).toBe(antibody.adoptionVotes);
  });
});

// ---------------------------------------------------------------------------
// rejectAntibody
// ---------------------------------------------------------------------------

describe('rejectAntibody', () => {
  it('returns a copy with status rejected', () => {
    const antibody = generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high'));
    const rejected = rejectAntibody(antibody);
    expect(rejected.status).toBe('rejected');
  });

  it('does not mutate the original antibody', () => {
    const antibody = generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high'));
    rejectAntibody(antibody);
    expect(antibody.status).toBe('proposed');
  });

  it('preserves all other fields', () => {
    const antibody = generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high'));
    const rejected = rejectAntibody(antibody);
    expect(rejected.id).toBe(antibody.id);
    expect(rejected.derivedFromBreach).toBe(antibody.derivedFromBreach);
    expect(rejected.proposedConstraint).toBe(antibody.proposedConstraint);
  });
});

// ---------------------------------------------------------------------------
// voteForAntibody
// ---------------------------------------------------------------------------

describe('voteForAntibody', () => {
  it('increments adoption votes by 1', () => {
    const antibody = generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high'));
    const voted = voteForAntibody(antibody);
    expect(voted.adoptionVotes).toBe(1);
  });

  it('does not mutate the original antibody', () => {
    const antibody = generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high'));
    voteForAntibody(antibody);
    expect(antibody.adoptionVotes).toBe(0);
  });

  it('can be called multiple times to accumulate votes', () => {
    let antibody = generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high'));
    antibody = voteForAntibody(antibody);
    antibody = voteForAntibody(antibody);
    antibody = voteForAntibody(antibody);
    expect(antibody.adoptionVotes).toBe(3);
  });

  it('preserves status when voting', () => {
    const antibody = generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high'));
    const voted = voteForAntibody(antibody);
    expect(voted.status).toBe('proposed');
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle tests
// ---------------------------------------------------------------------------

describe('antifragile lifecycle', () => {
  it('breach -> antibody -> vote -> adopt -> health improvement', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate-data', 'critical', 'data-loss');
    const antibody = generateAntibody(breach);
    expect(antibody.status).toBe('proposed');

    const voted = voteForAntibody(voteForAntibody(antibody));
    expect(voted.adoptionVotes).toBe(2);

    const adopted = adoptAntibody(voted);
    expect(adopted.status).toBe('adopted');
    expect(adopted.adoptionVotes).toBe(2);

    const health = networkHealth([adopted], [breach]);
    expect(health.resistanceScore).toBe(1);
    expect(health.vulnerableCategories).toEqual([]);
  });

  it('multiple breaches with partial coverage', () => {
    const breach1 = makeBreach('b1', 'deny:exfiltrate', 'critical', 'data-loss');
    const breach2 = makeBreach('b2', 'deny:unauthorized-write', 'high', 'file-access');
    const breach3 = makeBreach('b3', 'deny:network-call', 'medium', 'network');

    const ab1 = adoptAntibody(generateAntibody(breach1));
    const ab2 = generateAntibody(breach2); // not adopted
    const ab3 = rejectAntibody(generateAntibody(breach3));

    const health = networkHealth(
      [
        { ...ab1, category: 'data-loss' },
        ab2,
        ab3,
      ],
      [breach1, breach2, breach3],
    );

    expect(health.totalBreaches).toBe(3);
    expect(health.antibodiesGenerated).toBe(3);
    expect(health.antibodiesAdopted).toBe(1);
    expect(health.resistanceScore).toBeCloseTo(1 / 3);
    expect(health.vulnerableCategories).toContain('file-access');
    expect(health.vulnerableCategories).toContain('network');
    expect(health.vulnerableCategories).not.toContain('data-loss');
  });

  it('governance proposal references antibody correctly', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach);
    const proposal = proposeToGovernance(antibody);
    expect(proposal.antibodyId).toBe(antibody.id);
    expect(proposal.description).toContain(antibody.derivedFromBreach);
  });
});
