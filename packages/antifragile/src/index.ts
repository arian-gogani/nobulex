import { generateId } from '@stele/crypto';

export type {
  BreachAntibody,
  NetworkHealth,
  GovernanceProposal,
  BreachSummary,
} from './types.js';

import type {
  BreachAntibody,
  NetworkHealth,
  GovernanceProposal,
  BreachSummary,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = new Set<string>(['critical', 'high', 'medium', 'low']);

/**
 * Category keyword mappings ordered from most specific to most general.
 * The first matching category wins, so more specific categories appear first.
 */
const CATEGORY_KEYWORDS: Array<{ category: string; keywords: string[] }> = [
  { category: 'secrets', keywords: ['secret', 'key', 'token', 'password', 'encrypt', 'decrypt'] },
  { category: 'data-security', keywords: ['data', 'exfiltrate', 'leak', 'export', 'transfer'] },
  { category: 'file-system', keywords: ['file', 'disk', 'storage', 'directory', 'path'] },
  { category: 'access-control', keywords: ['access', 'permission', 'auth', 'login', 'credential', 'role'] },
  { category: 'rate-limiting', keywords: ['rate', 'throttle', 'quota', 'bandwidth'] },
  { category: 'network', keywords: ['network', 'connect', 'request', 'call', 'socket', 'http'] },
  { category: 'execution', keywords: ['exec', 'run', 'process', 'spawn', 'command', 'shell'] },
  { category: 'resource', keywords: ['memory', 'cpu', 'resource', 'consumption', 'usage'] },
];

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate a BreachSummary, throwing on invalid inputs.
 */
function validateBreach(breach: BreachSummary): void {
  if (!breach.violatedConstraint || breach.violatedConstraint.trim().length === 0) {
    throw new Error('BreachSummary.violatedConstraint must be a non-empty string');
  }
  if (!VALID_SEVERITIES.has(breach.severity)) {
    throw new Error(
      `BreachSummary.severity must be one of: ${[...VALID_SEVERITIES].join(', ')}. Got: "${breach.severity}"`,
    );
  }
}

/**
 * Validate a BreachAntibody, throwing on invalid inputs.
 */
function validateAntibody(antibody: BreachAntibody): void {
  if (antibody.adoptionVotes < 0) {
    throw new Error('BreachAntibody.adoptionVotes must be non-negative');
  }
}

// ---------------------------------------------------------------------------
// Category derivation
// ---------------------------------------------------------------------------

/**
 * Derive a category from a violated constraint string using keyword matching.
 * Scans the lowercased constraint for known domain keywords and returns the
 * first matching category. Falls back to the constraint body (without any
 * type prefix) when no keywords match.
 */
function deriveCategory(violatedConstraint: string): string {
  const lower = violatedConstraint.toLowerCase();
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some(kw => lower.includes(kw))) {
      return category;
    }
  }
  // Fallback: strip prefix and return the remainder
  const withoutPrefix = violatedConstraint.replace(/^(deny|permit|require|limit):/, '');
  return withoutPrefix || violatedConstraint;
}

// ---------------------------------------------------------------------------
// Constraint generation
// ---------------------------------------------------------------------------

/**
 * Map breach severity to a constraint strength modifier.
 */
function severityStrength(severity: BreachSummary['severity']): string {
  switch (severity) {
    case 'critical': return 'strict';
    case 'high': return 'enforced';
    case 'medium': return 'standard';
    case 'low': return 'advisory';
  }
}

/**
 * Generate a CCL constraint that would prevent the class of breach described.
 *
 * Analyzes the violated constraint type and breach severity to produce an
 * appropriate countermeasure:
 *
 *  - deny bypassed   -> tighter deny with severity-based strength modifier
 *  - limit exceeded   -> propose a lower limit (reduced by severity factor)
 *  - require skipped  -> propose enforcement
 *  - permit abused    -> revoke to deny
 *  - unprefixed       -> wrap in deny with strength
 */
function generateConstraintForBreach(
  violatedConstraint: string,
  severity: BreachSummary['severity'],
): string {
  const strength = severityStrength(severity);

  if (violatedConstraint.startsWith('deny:')) {
    const pattern = violatedConstraint.slice('deny:'.length);
    return `deny ${strength} on '${pattern}'`;
  }

  if (violatedConstraint.startsWith('limit:')) {
    const pattern = violatedConstraint.slice('limit:'.length);
    const numMatch = pattern.match(/(\d+)/);
    if (numMatch) {
      const originalValue = parseInt(numMatch[1], 10);
      const reductionFactor =
        severity === 'critical' ? 0.25
        : severity === 'high' ? 0.5
        : severity === 'medium' ? 0.75
        : 0.9;
      const newValue = Math.floor(originalValue * reductionFactor);
      const reduced = pattern.replace(/\d+/, String(newValue));
      return `limit ${strength} ${reduced}`;
    }
    return `limit ${strength} ${pattern}`;
  }

  if (violatedConstraint.startsWith('require:')) {
    const pattern = violatedConstraint.slice('require:'.length);
    return `require ${strength} enforce '${pattern}'`;
  }

  if (violatedConstraint.startsWith('permit:')) {
    const pattern = violatedConstraint.slice('permit:'.length);
    return `deny ${strength} on '${pattern}'`;
  }

  // Unprefixed constraint
  return `deny ${strength} on '${violatedConstraint}'`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a breach and generate a new antibody (constraint) to prevent this
 * class of breach from recurring.
 *
 * The category is derived from keyword analysis of the violated constraint
 * (or the explicit category field on the breach). The proposed constraint is
 * generated based on the violated constraint type and breach severity.
 *
 * Returns a BreachAntibody with status 'proposed', zero adoption votes,
 * and the given adoption threshold (default 3).
 */
export function generateAntibody(breach: BreachSummary, adoptionThreshold = 3): BreachAntibody {
  validateBreach(breach);

  if (adoptionThreshold < 0) {
    throw new Error('adoptionThreshold must be non-negative');
  }

  const category = breach.category ?? deriveCategory(breach.violatedConstraint);
  const proposedConstraint = generateConstraintForBreach(breach.violatedConstraint, breach.severity);

  return {
    id: generateId(),
    derivedFromBreach: breach.id,
    proposedConstraint,
    category,
    status: 'proposed',
    adoptionVotes: 0,
    adoptionThreshold,
  };
}

/**
 * Create a governance proposal from a breach antibody.
 *
 * Wraps the antibody in a GovernanceProposal structure with a unique ID,
 * timestamp, and human-readable description.
 */
export function proposeToGovernance(antibody: BreachAntibody): GovernanceProposal {
  return {
    id: generateId(),
    antibodyId: antibody.id,
    proposedAt: Date.now(),
    description: `Proposal to adopt antibody "${antibody.proposedConstraint}" ` +
      `(category: ${antibody.category}) derived from breach ${antibody.derivedFromBreach}`,
  };
}

/**
 * Compute network health metrics from antibodies and breaches.
 *
 * - resistanceScore = antibodiesAdopted / max(1, totalBreaches)
 * - vulnerableCategories = breach categories that have no adopted antibody
 */
export function networkHealth(
  antibodies: BreachAntibody[],
  breaches: BreachSummary[],
): NetworkHealth {
  const totalBreaches = breaches.length;
  const antibodiesGenerated = antibodies.length;
  const antibodiesAdopted = antibodies.filter(a => a.status === 'adopted').length;
  const resistanceScore = antibodiesAdopted / Math.max(1, totalBreaches);

  // Gather all breach categories
  const breachCategories = new Set<string>();
  for (const breach of breaches) {
    const category = breach.category ?? deriveCategory(breach.violatedConstraint);
    breachCategories.add(category);
  }

  // Gather categories that have adopted antibodies
  const adoptedCategories = new Set<string>();
  for (const antibody of antibodies) {
    if (antibody.status === 'adopted') {
      adoptedCategories.add(antibody.category);
    }
  }

  // Vulnerable = breach categories without an adopted antibody
  const vulnerableCategories = [...breachCategories].filter(
    cat => !adoptedCategories.has(cat),
  );

  return {
    totalBreaches,
    antibodiesGenerated,
    antibodiesAdopted,
    resistanceScore,
    vulnerableCategories,
  };
}

/**
 * Return a copy of the antibody with status set to 'adopted'.
 * Requires adoptionVotes >= adoptionThreshold. Throws if threshold not met.
 * Use forceAdopt() for governance override.
 */
export function adoptAntibody(antibody: BreachAntibody): BreachAntibody {
  validateAntibody(antibody);
  if (antibody.adoptionVotes < antibody.adoptionThreshold) {
    throw new Error(
      `Cannot adopt antibody: ${antibody.adoptionVotes} votes < threshold ${antibody.adoptionThreshold}. ` +
      `Use forceAdopt() for governance override.`,
    );
  }
  return { ...antibody, status: 'adopted' };
}

/**
 * Force-adopt an antibody regardless of vote count (governance override).
 * Bypasses the adoption threshold check.
 */
export function forceAdopt(antibody: BreachAntibody): BreachAntibody {
  return { ...antibody, status: 'adopted' };
}

/**
 * Return a copy of the antibody with status set to 'rejected'.
 */
export function rejectAntibody(antibody: BreachAntibody): BreachAntibody {
  return { ...antibody, status: 'rejected' };
}

/**
 * Return a copy of the antibody with adoptionVotes incremented by 1.
 */
export function voteForAntibody(antibody: BreachAntibody): BreachAntibody {
  validateAntibody(antibody);
  return { ...antibody, adoptionVotes: antibody.adoptionVotes + 1 };
}

/**
 * Check if an antibody for a given breach already exists in the list.
 * Matches by derivedFromBreach ID or by matching category.
 */
export function antibodyExists(antibodies: BreachAntibody[], breach: BreachSummary): boolean {
  validateBreach(breach);
  const breachCategory = breach.category ?? deriveCategory(breach.violatedConstraint);
  return antibodies.some(
    ab => ab.derivedFromBreach === breach.id || ab.category === breachCategory,
  );
}
