import { describe, it, expect } from 'vitest';
import {
  generateAntibody,
  proposeToGovernance,
  networkHealth,
  adoptAntibody,
  forceAdopt,
  rejectAntibody,
  voteForAntibody,
  antibodyExists,
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

/**
 * Helper: generate an antibody and vote it up to threshold so it can be adopted.
 */
function makeAdoptable(breach: BreachSummary, threshold = 3): BreachAntibody {
  let antibody = generateAntibody(breach, threshold);
  for (let i = 0; i < threshold; i++) {
    antibody = voteForAntibody(antibody);
  }
  return antibody;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('input validation', () => {
  it('rejects empty violatedConstraint', () => {
    expect(() => generateAntibody(makeBreach('b1', '', 'high'))).toThrow(
      'violatedConstraint must be a non-empty string',
    );
  });

  it('rejects whitespace-only violatedConstraint', () => {
    expect(() => generateAntibody(makeBreach('b1', '   ', 'high'))).toThrow(
      'violatedConstraint must be a non-empty string',
    );
  });

  it('rejects invalid severity', () => {
    expect(() =>
      generateAntibody(makeBreach('b1', 'deny:x', 'extreme' as BreachSummary['severity'])),
    ).toThrow('severity must be one of');
  });

  it('rejects negative adoptionThreshold', () => {
    expect(() => generateAntibody(makeBreach('b1', 'deny:x', 'high'), -1)).toThrow(
      'adoptionThreshold must be non-negative',
    );
  });

  it('rejects negative adoptionVotes in voteForAntibody', () => {
    const antibody = generateAntibody(makeBreach('b1', 'deny:x', 'high'));
    const tampered = { ...antibody, adoptionVotes: -1 };
    expect(() => voteForAntibody(tampered)).toThrow('adoptionVotes must be non-negative');
  });

  it('rejects negative adoptionVotes in adoptAntibody', () => {
    const antibody = generateAntibody(makeBreach('b1', 'deny:x', 'high'));
    const tampered = { ...antibody, adoptionVotes: -1 };
    expect(() => adoptAntibody(tampered)).toThrow('adoptionVotes must be non-negative');
  });

  it('rejects empty violatedConstraint in antibodyExists', () => {
    expect(() => antibodyExists([], makeBreach('b1', '', 'high'))).toThrow(
      'violatedConstraint must be a non-empty string',
    );
  });
});

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

  it('sets adoptionThreshold to the provided value', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach, 5);
    expect(antibody.adoptionThreshold).toBe(5);
  });

  it('sets adoptionThreshold to default of 3', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach);
    expect(antibody.adoptionThreshold).toBe(3);
  });

  // ---- Category derivation via keywords ----

  it('derives data-security category from exfiltrate keyword', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate-data', 'medium');
    const antibody = generateAntibody(breach);
    expect(antibody.category).toBe('data-security');
  });

  it('derives secrets category from secret keyword', () => {
    const breach = makeBreach('b1', 'read-secrets', 'low');
    const antibody = generateAntibody(breach);
    expect(antibody.category).toBe('secrets');
  });

  it('derives network category from network keyword', () => {
    const breach = makeBreach('b1', 'deny:network-call', 'critical');
    const antibody = generateAntibody(breach);
    expect(antibody.category).toBe('network');
  });

  it('derives file-system category from file keyword', () => {
    const breach = makeBreach('b1', 'permit:file-access', 'high');
    const antibody = generateAntibody(breach);
    expect(antibody.category).toBe('file-system');
  });

  it('derives access-control category from auth keyword', () => {
    const breach = makeBreach('b1', 'require:authentication', 'critical');
    const antibody = generateAntibody(breach);
    expect(antibody.category).toBe('access-control');
  });

  it('derives rate-limiting category from rate keyword', () => {
    const breach = makeBreach('b1', 'limit:api-rate-500', 'high');
    const antibody = generateAntibody(breach);
    expect(antibody.category).toBe('rate-limiting');
  });

  it('derives resource category from memory keyword', () => {
    const breach = makeBreach('b1', 'limit:memory-usage-8192', 'medium');
    const antibody = generateAntibody(breach);
    expect(antibody.category).toBe('resource');
  });

  it('derives execution category from exec keyword', () => {
    const breach = makeBreach('b1', 'deny:exec-untrusted', 'critical');
    const antibody = generateAntibody(breach);
    expect(antibody.category).toBe('execution');
  });

  it('falls back to constraint body when no keywords match', () => {
    const breach = makeBreach('b1', 'deny:foobar-unknown', 'low');
    const antibody = generateAntibody(breach);
    expect(antibody.category).toBe('foobar-unknown');
  });

  it('uses explicit category from the breach when provided', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate-data', 'medium', 'data-loss');
    const antibody = generateAntibody(breach);
    expect(antibody.category).toBe('data-loss');
  });

  // ---- Constraint generation (severity-aware) ----

  it('generates tighter deny for bypassed deny (critical)', () => {
    const breach = makeBreach('b1', 'deny:network-call', 'critical');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe("deny strict on 'network-call'");
  });

  it('generates enforced deny for bypassed deny (high)', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe("deny enforced on 'exfiltrate'");
  });

  it('generates standard deny for bypassed deny (medium)', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate-data', 'medium');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe("deny standard on 'exfiltrate-data'");
  });

  it('generates advisory deny for bypassed deny (low)', () => {
    const breach = makeBreach('b1', 'deny:minor-issue', 'low');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe("deny advisory on 'minor-issue'");
  });

  it('revokes permit to deny with severity strength', () => {
    const breach = makeBreach('b1', 'permit:file-access', 'high');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe("deny enforced on 'file-access'");
  });

  it('reduces limit values based on severity (high = 50%)', () => {
    const breach = makeBreach('b1', 'limit:api-rate-500', 'high');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe('limit enforced api-rate-250');
  });

  it('reduces limit values based on severity (critical = 25%)', () => {
    const breach = makeBreach('b1', 'limit:api-rate-1000', 'critical');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe('limit strict api-rate-250');
  });

  it('reduces limit values based on severity (medium = 75%)', () => {
    const breach = makeBreach('b1', 'limit:api-rate-1000', 'medium');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe('limit standard api-rate-750');
  });

  it('reduces limit values based on severity (low = 90%)', () => {
    const breach = makeBreach('b1', 'limit:api-rate-1000', 'low');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe('limit advisory api-rate-900');
  });

  it('handles limit without numeric value', () => {
    const breach = makeBreach('b1', 'limit:something', 'high');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe('limit enforced something');
  });

  it('enforces skipped require constraints', () => {
    const breach = makeBreach('b1', 'require:authentication', 'critical');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe("require strict enforce 'authentication'");
  });

  it('wraps unprefixed constraints in deny with strength', () => {
    const breach = makeBreach('b1', 'read-secrets', 'low');
    const antibody = generateAntibody(breach);
    expect(antibody.proposedConstraint).toBe("deny advisory on 'read-secrets'");
  });

  // ---- ID and reference ----

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
      makeBreach('b2', 'deny:write-disk', 'medium'),
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
    const antibody = forceAdopt(
      generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high')),
    );
    const health = networkHealth([antibody], []);
    expect(health.antibodiesAdopted).toBe(1);
  });

  it('computes resistanceScore as adopted / max(1, breaches)', () => {
    const breach1 = makeBreach('b1', 'deny:exfiltrate', 'high', 'data-security');
    const breach2 = makeBreach('b2', 'deny:write-disk', 'medium', 'file-system');
    const antibody = forceAdopt(generateAntibody(breach1));
    const health = networkHealth([antibody], [breach1, breach2]);
    expect(health.resistanceScore).toBeCloseTo(1 / 2);
  });

  it('resistanceScore is 0 when no antibodies are adopted', () => {
    const breaches = [makeBreach('b1', 'deny:exfiltrate', 'high')];
    const health = networkHealth([], breaches);
    expect(health.resistanceScore).toBe(0);
  });

  it('resistanceScore handles zero breaches', () => {
    const antibody = forceAdopt(
      generateAntibody(makeBreach('b1', 'deny:exfiltrate', 'high')),
    );
    const health = networkHealth([antibody], []);
    // adopted / max(1, 0) = 1 / 1 = 1
    expect(health.resistanceScore).toBe(1);
  });

  it('identifies vulnerable categories (no adopted antibody)', () => {
    const breach1 = makeBreach('b1', 'deny:exfiltrate', 'high', 'data-loss');
    const breach2 = makeBreach('b2', 'deny:write-disk', 'medium', 'file-access');
    const antibody = forceAdopt(generateAntibody(breach1));
    const health = networkHealth(
      [{ ...antibody, category: 'data-loss' }],
      [breach1, breach2],
    );
    expect(health.vulnerableCategories).toContain('file-access');
    expect(health.vulnerableCategories).not.toContain('data-loss');
  });

  it('returns empty vulnerable categories when all are covered', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high', 'exfiltrate');
    const antibody = forceAdopt(generateAntibody(breach));
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
// adoptAntibody (with governance threshold)
// ---------------------------------------------------------------------------

describe('adoptAntibody', () => {
  it('adopts when votes meet threshold', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = makeAdoptable(breach, 3);
    const adopted = adoptAntibody(antibody);
    expect(adopted.status).toBe('adopted');
  });

  it('adopts when votes exceed threshold', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    let antibody = makeAdoptable(breach, 2);
    antibody = voteForAntibody(antibody); // one extra vote
    const adopted = adoptAntibody(antibody);
    expect(adopted.status).toBe('adopted');
  });

  it('throws when votes are below threshold', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach, 3); // 0 votes, threshold 3
    expect(() => adoptAntibody(antibody)).toThrow('Cannot adopt antibody');
    expect(() => adoptAntibody(antibody)).toThrow('Use forceAdopt()');
  });

  it('throws with informative message showing vote count and threshold', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    let antibody = generateAntibody(breach, 5);
    antibody = voteForAntibody(antibody); // 1 vote, threshold 5
    expect(() => adoptAntibody(antibody)).toThrow('1 votes < threshold 5');
  });

  it('does not mutate the original antibody', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = makeAdoptable(breach);
    adoptAntibody(antibody);
    expect(antibody.status).toBe('proposed');
  });

  it('preserves all other fields', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = makeAdoptable(breach);
    const adopted = adoptAntibody(antibody);
    expect(adopted.id).toBe(antibody.id);
    expect(adopted.derivedFromBreach).toBe(antibody.derivedFromBreach);
    expect(adopted.proposedConstraint).toBe(antibody.proposedConstraint);
    expect(adopted.category).toBe(antibody.category);
    expect(adopted.adoptionVotes).toBe(antibody.adoptionVotes);
    expect(adopted.adoptionThreshold).toBe(antibody.adoptionThreshold);
  });

  it('works with threshold of 0 (no votes needed)', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach, 0);
    const adopted = adoptAntibody(antibody);
    expect(adopted.status).toBe('adopted');
  });
});

// ---------------------------------------------------------------------------
// forceAdopt (governance override)
// ---------------------------------------------------------------------------

describe('forceAdopt', () => {
  it('adopts regardless of vote count', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach, 10); // threshold 10, 0 votes
    const adopted = forceAdopt(antibody);
    expect(adopted.status).toBe('adopted');
  });

  it('does not mutate the original antibody', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach);
    forceAdopt(antibody);
    expect(antibody.status).toBe('proposed');
  });

  it('preserves all other fields', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach);
    const adopted = forceAdopt(antibody);
    expect(adopted.id).toBe(antibody.id);
    expect(adopted.derivedFromBreach).toBe(antibody.derivedFromBreach);
    expect(adopted.proposedConstraint).toBe(antibody.proposedConstraint);
    expect(adopted.category).toBe(antibody.category);
    expect(adopted.adoptionVotes).toBe(0);
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
// antibodyExists
// ---------------------------------------------------------------------------

describe('antibodyExists', () => {
  it('returns true when antibody with same breach ID exists', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    const antibody = generateAntibody(breach);
    expect(antibodyExists([antibody], breach)).toBe(true);
  });

  it('returns true when antibody with same category exists', () => {
    const breach1 = makeBreach('b1', 'deny:exfiltrate', 'high');
    const breach2 = makeBreach('b2', 'deny:data-leak', 'medium'); // same category: data-security
    const antibody = generateAntibody(breach1);
    expect(antibodyExists([antibody], breach2)).toBe(true);
  });

  it('returns false when no matching antibody exists', () => {
    const breach1 = makeBreach('b1', 'deny:exfiltrate', 'high'); // data-security
    const breach2 = makeBreach('b2', 'deny:network-call', 'medium'); // network
    const antibody = generateAntibody(breach1);
    expect(antibodyExists([antibody], breach2)).toBe(false);
  });

  it('returns false for empty antibodies list', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'high');
    expect(antibodyExists([], breach)).toBe(false);
  });

  it('matches using explicit breach category', () => {
    const breach1 = makeBreach('b1', 'deny:exfiltrate', 'high', 'custom-cat');
    const breach2 = makeBreach('b2', 'deny:something-else', 'medium', 'custom-cat');
    const antibody = generateAntibody(breach1);
    expect(antibodyExists([antibody], breach2)).toBe(true);
  });

  it('validates the breach input', () => {
    expect(() => antibodyExists([], makeBreach('b1', '', 'high'))).toThrow(
      'violatedConstraint must be a non-empty string',
    );
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle tests
// ---------------------------------------------------------------------------

describe('antifragile lifecycle', () => {
  it('breach -> antibody -> vote to threshold -> adopt -> health improvement', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate-data', 'critical', 'data-loss');
    const antibody = generateAntibody(breach);
    expect(antibody.status).toBe('proposed');
    expect(antibody.adoptionThreshold).toBe(3);

    let voted = antibody;
    voted = voteForAntibody(voted);
    voted = voteForAntibody(voted);
    voted = voteForAntibody(voted);
    expect(voted.adoptionVotes).toBe(3);

    const adopted = adoptAntibody(voted);
    expect(adopted.status).toBe('adopted');
    expect(adopted.adoptionVotes).toBe(3);

    const health = networkHealth([adopted], [breach]);
    expect(health.resistanceScore).toBe(1);
    expect(health.vulnerableCategories).toEqual([]);
  });

  it('multiple breaches with partial coverage', () => {
    const breach1 = makeBreach('b1', 'deny:exfiltrate', 'critical', 'data-loss');
    const breach2 = makeBreach('b2', 'deny:unauthorized-write', 'high', 'file-access');
    const breach3 = makeBreach('b3', 'deny:network-call', 'medium', 'network');

    const ab1 = forceAdopt(generateAntibody(breach1));
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

  it('forceAdopt bypasses threshold when governance decides', () => {
    const breach = makeBreach('b1', 'deny:exfiltrate', 'critical');
    const antibody = generateAntibody(breach, 100); // very high threshold
    expect(() => adoptAntibody(antibody)).toThrow('Cannot adopt antibody');
    const adopted = forceAdopt(antibody);
    expect(adopted.status).toBe('adopted');
  });

  it('antibodyExists prevents duplicate generation', () => {
    const breach1 = makeBreach('b1', 'deny:exfiltrate', 'high');
    const ab1 = generateAntibody(breach1);

    const breach2 = makeBreach('b2', 'deny:data-leak', 'medium');
    // Same category (data-security) so duplicate exists
    expect(antibodyExists([ab1], breach2)).toBe(true);

    const breach3 = makeBreach('b3', 'deny:network-call', 'low');
    // Different category (network) so no duplicate
    expect(antibodyExists([ab1], breach3)).toBe(false);
  });
});
