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

/**
 * Derive a category from a violated constraint string.
 * Extracts the first segment before a colon, hyphen, or dot.
 * Falls back to the full constraint as the category.
 */
function deriveCategory(violatedConstraint: string): string {
  // Try to extract a meaningful category from the constraint
  // e.g. "deny:exfiltrate-data" -> "exfiltrate"
  // e.g. "must-not-read-secrets" -> "must-not-read-secrets"
  const withoutPrefix = violatedConstraint.replace(/^(deny|permit|require|limit):/, '');
  const segments = withoutPrefix.split(/[-._]/);
  return segments[0] || violatedConstraint;
}

/**
 * Generate a CCL constraint that would prevent the class of breach described.
 * Maps the violated constraint into a deny-type constraint to block similar breaches.
 */
function generateConstraintForBreach(violatedConstraint: string): string {
  // If the constraint already has a type prefix, derive the denial from its pattern
  const prefixes = ['deny:', 'permit:', 'require:', 'limit:'];
  for (const prefix of prefixes) {
    if (violatedConstraint.startsWith(prefix)) {
      const pattern = violatedConstraint.slice(prefix.length);
      return `deny:${pattern}`;
    }
  }
  // For unprefixed constraints, wrap in a deny
  return `deny:${violatedConstraint}`;
}

/**
 * Analyze a breach and generate a new antibody (constraint) to prevent this
 * class of breach from recurring.
 *
 * The category is derived from the violated constraint (or the explicit
 * category field on the breach). Returns a BreachAntibody with status
 * 'proposed' and zero adoption votes.
 */
export function generateAntibody(breach: BreachSummary): BreachAntibody {
  const category = breach.category ?? deriveCategory(breach.violatedConstraint);
  const proposedConstraint = generateConstraintForBreach(breach.violatedConstraint);

  return {
    id: generateId(),
    derivedFromBreach: breach.id,
    proposedConstraint,
    category,
    status: 'proposed',
    adoptionVotes: 0,
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
 */
export function adoptAntibody(antibody: BreachAntibody): BreachAntibody {
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
  return { ...antibody, adoptionVotes: antibody.adoptionVotes + 1 };
}
