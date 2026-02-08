import { sha256Object, generateId } from '@stele/crypto';

export type {
  CompositionProof,
  ComposedConstraint,
  SystemProperty,
  CovenantSummary,
} from './types.js';

import type {
  CompositionProof,
  ComposedConstraint,
  SystemProperty,
  CovenantSummary,
} from './types.js';

/**
 * Parse a constraint string into its type and pattern.
 * Constraints follow the format "type:pattern", e.g. "deny:exfiltrate-data".
 * If no prefix is found, the constraint defaults to type 'require'.
 */
function parseConstraint(constraint: string): { type: ComposedConstraint['type']; pattern: string } {
  const prefixes: ComposedConstraint['type'][] = ['permit', 'deny', 'require', 'limit'];
  for (const prefix of prefixes) {
    if (constraint.startsWith(`${prefix}:`)) {
      return { type: prefix, pattern: constraint.slice(prefix.length + 1) };
    }
  }
  return { type: 'require', pattern: constraint };
}

/**
 * Compose multiple covenant summaries into a single CompositionProof.
 *
 * Takes an array of covenant summaries and merges their constraints. Uses a
 * deny-wins strategy: if any covenant denies a pattern that another permits,
 * the deny takes precedence. The proof field is a SHA-256 hash of the composed
 * constraints for integrity verification.
 */
export function compose(covenants: CovenantSummary[]): CompositionProof {
  const agents = [...new Set(covenants.map(c => c.agentId))];
  const individualCovenants = covenants.map(c => c.id);

  // Build composed constraints from all covenants
  const composedConstraints: ComposedConstraint[] = [];
  const denyPatterns = new Set<string>();
  const permitPatterns = new Map<string, ComposedConstraint>();

  // First pass: collect all constraints and identify denies
  for (const covenant of covenants) {
    for (const constraintStr of covenant.constraints) {
      const { type, pattern } = parseConstraint(constraintStr);
      if (type === 'deny') {
        denyPatterns.add(pattern);
      }
      if (type === 'permit') {
        permitPatterns.set(pattern, {
          source: covenant.id,
          constraint: constraintStr,
          type,
        });
      }
    }
  }

  // Second pass: build final constraint list with deny-wins semantics
  for (const covenant of covenants) {
    for (const constraintStr of covenant.constraints) {
      const { type, pattern } = parseConstraint(constraintStr);

      // If this is a permit but a deny exists for the same pattern, skip the permit
      if (type === 'permit' && denyPatterns.has(pattern)) {
        continue;
      }

      composedConstraints.push({
        source: covenant.id,
        constraint: constraintStr,
        type,
      });
    }
  }

  const proof = sha256Object(composedConstraints);

  return {
    agents,
    individualCovenants,
    composedConstraints,
    systemProperties: [],
    proof,
  };
}

/**
 * Prove whether a system property holds across a set of covenants.
 *
 * Checks if the described property (behavior) is prevented by deny constraints
 * present across the covenant chain. Returns a SystemProperty indicating whether
 * the property holds and which covenants contribute to that determination.
 */
export function proveSystemProperty(
  covenants: CovenantSummary[],
  property: string,
): SystemProperty {
  const propertyLower = property.toLowerCase();
  const derivedFrom: string[] = [];
  let holds = false;

  // Check if deny constraints across covenants collectively prevent the described behavior
  for (const covenant of covenants) {
    for (const constraintStr of covenant.constraints) {
      const { type, pattern } = parseConstraint(constraintStr);
      if (type === 'deny') {
        // Check if the deny constraint is relevant to the property
        const patternLower = pattern.toLowerCase();
        if (
          propertyLower.includes(patternLower) ||
          patternLower.includes(propertyLower)
        ) {
          derivedFrom.push(covenant.id);
          holds = true;
        }
      }
    }
  }

  return {
    property,
    holds,
    derivedFrom: [...new Set(derivedFrom)],
  };
}

/**
 * Validate a composition proof by recomputing the hash and comparing.
 *
 * Returns true if the proof field matches the SHA-256 hash of the composed
 * constraints, indicating the proof has not been tampered with.
 */
export function validateComposition(proof: CompositionProof): boolean {
  const recomputed = sha256Object(proof.composedConstraints);
  return recomputed === proof.proof;
}

/**
 * Return constraints present in both arrays (simple string equality).
 */
export function intersectConstraints(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter(c => setB.has(c));
}

/**
 * Find pairs of constraints that may conflict (permit vs deny on same pattern).
 *
 * Returns an array of [permit, deny] constraint string pairs where the same
 * pattern appears with both a permit and a deny across the covenants.
 */
export function findConflicts(
  covenants: CovenantSummary[],
): Array<[string, string]> {
  const permits: Array<{ constraint: string; pattern: string }> = [];
  const denies: Array<{ constraint: string; pattern: string }> = [];

  for (const covenant of covenants) {
    for (const constraintStr of covenant.constraints) {
      const { type, pattern } = parseConstraint(constraintStr);
      if (type === 'permit') {
        permits.push({ constraint: constraintStr, pattern });
      } else if (type === 'deny') {
        denies.push({ constraint: constraintStr, pattern });
      }
    }
  }

  const conflicts: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const permit of permits) {
    for (const deny of denies) {
      if (permit.pattern === deny.pattern) {
        const key = `${permit.constraint}|${deny.constraint}`;
        if (!seen.has(key)) {
          seen.add(key);
          conflicts.push([permit.constraint, deny.constraint]);
        }
      }
    }
  }

  return conflicts;
}
