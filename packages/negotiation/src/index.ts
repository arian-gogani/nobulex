import { generateId } from '@stele/crypto';

export type {
  NegotiationSession,
  Proposal,
  NegotiationPolicy,
  UtilityFunction,
  Outcome,
  NashBargainingSolution,
  ParetoOutcome,
} from './types.js';

import type {
  NegotiationSession,
  Proposal,
  NegotiationPolicy,
  UtilityFunction,
  Outcome,
  NashBargainingSolution,
  ParetoOutcome,
} from './types.js';

/**
 * Validate a proposal has non-empty constraints and valid format.
 */
function validateProposal(proposal: Proposal): void {
  if (!proposal.from || typeof proposal.from !== 'string') {
    throw new Error('Proposal must have a non-empty "from" field');
  }
  if (!Array.isArray(proposal.constraints)) {
    throw new Error('Proposal constraints must be an array');
  }
  if (!Array.isArray(proposal.requirements)) {
    throw new Error('Proposal requirements must be an array');
  }
  if (typeof proposal.timestamp !== 'number' || proposal.timestamp < 0) {
    throw new Error('Proposal timestamp must be a non-negative number');
  }
}

/**
 * Check that a session is not in a terminal state (agreed or failed).
 */
function assertNotTerminal(session: NegotiationSession): void {
  if (session.status === 'agreed') {
    throw new Error('Cannot modify an agreed session');
  }
  if (session.status === 'failed') {
    throw new Error('Cannot modify a failed session');
  }
}

/**
 * Parse a constraint into its type prefix and resource pattern.
 * e.g. "deny:exfiltrate-data" -> { type: 'deny', resource: 'exfiltrate-data' }
 */
function parseConstraint(constraint: string): { type: string; resource: string } {
  const colonIdx = constraint.indexOf(':');
  if (colonIdx === -1) {
    return { type: 'unknown', resource: constraint };
  }
  return {
    type: constraint.slice(0, colonIdx),
    resource: constraint.slice(colonIdx + 1),
  };
}

/**
 * Initiate a new negotiation session between two parties.
 *
 * Creates a NegotiationSession with status 'proposing' and an initial proposal
 * from the initiator containing their required and preferred constraints.
 */
export function initiate(
  initiatorId: string,
  responderId: string,
  policy: NegotiationPolicy,
): NegotiationSession {
  if (!initiatorId || typeof initiatorId !== 'string') {
    throw new Error('initiatorId must be a non-empty string');
  }
  if (!responderId || typeof responderId !== 'string') {
    throw new Error('responderId must be a non-empty string');
  }
  if (policy.maxRounds < 1) {
    throw new Error('maxRounds must be at least 1');
  }
  if (policy.timeoutMs < 0) {
    throw new Error('timeoutMs must be non-negative');
  }

  const now = Date.now();
  const initialProposal: Proposal = {
    from: initiatorId,
    constraints: [...policy.requiredConstraints, ...policy.preferredConstraints],
    requirements: [...policy.requiredConstraints],
    timestamp: now,
  };

  return {
    id: generateId(),
    initiator: initiatorId,
    responder: responderId,
    status: 'proposing',
    proposals: [initialProposal],
    timeoutMs: policy.timeoutMs,
    createdAt: now,
    maxRounds: policy.maxRounds,
  };
}

/**
 * Add a proposal to an existing negotiation session.
 *
 * Appends the proposal to the session's proposals array and returns the
 * updated session. Does not change the session status.
 */
export function propose(
  session: NegotiationSession,
  proposal: Proposal,
): NegotiationSession {
  assertNotTerminal(session);
  validateProposal(proposal);

  return {
    ...session,
    proposals: [...session.proposals, proposal],
  };
}

/**
 * Add a counter-proposal to the session.
 *
 * Sets the status to 'countering' and appends the counter-proposal. Throws
 * an error if the maximum number of rounds has been exceeded.
 */
export function counter(
  session: NegotiationSession,
  counterProposal: Proposal,
): NegotiationSession {
  assertNotTerminal(session);
  validateProposal(counterProposal);

  if (session.proposals.length >= session.maxRounds) {
    throw new Error(
      `Maximum rounds (${session.maxRounds}) exceeded. Cannot add counter-proposal.`,
    );
  }

  return {
    ...session,
    status: 'countering',
    proposals: [...session.proposals, counterProposal],
  };
}

/**
 * Finalize a negotiation as agreed.
 *
 * Sets the status to 'agreed' and computes the resulting constraints using
 * constraint intersection that respects deny-wins semantics:
 * - All 'deny:' constraints from either proposal are included (deny-wins)
 * - All 'require:' constraints present in both proposals are included
 * - Other constraints are included only if present in both proposals (intersection)
 */
export function agree(session: NegotiationSession): NegotiationSession {
  const proposals = session.proposals;
  let resultingConstraints: string[] = [];

  if (proposals.length >= 2) {
    const lastProposal = proposals[proposals.length - 1]!;
    const secondLastProposal = proposals[proposals.length - 2]!;

    const lastSet = new Set(lastProposal.constraints);
    const secondLastSet = new Set(secondLastProposal.constraints);

    // Collect all deny constraints from both sides (deny-wins semantics)
    const denyConstraints = new Set<string>();
    for (const c of lastProposal.constraints) {
      if (c.startsWith('deny:')) {
        denyConstraints.add(c);
      }
    }
    for (const c of secondLastProposal.constraints) {
      if (c.startsWith('deny:')) {
        denyConstraints.add(c);
      }
    }

    // Intersection of non-deny constraints
    const intersection: string[] = [];
    for (const c of secondLastProposal.constraints) {
      if (!c.startsWith('deny:') && lastSet.has(c)) {
        intersection.push(c);
      }
    }

    // Merge: deny-wins + intersection
    resultingConstraints = [...denyConstraints, ...intersection];
  } else if (proposals.length === 1) {
    resultingConstraints = [...proposals[0]!.constraints];
  }

  return {
    ...session,
    status: 'agreed',
    resultingConstraints,
  };
}

/**
 * Evaluate a proposal against a negotiation policy.
 *
 * Returns:
 * - 'accept' if all required constraints are satisfied and no dealbreakers are found
 * - 'reject' if any dealbreaker constraint is present in the proposal
 * - 'counter' if some required constraints are missing but no dealbreakers
 *
 * Checks each constraint against the policy with proper matching:
 * - Dealbreakers are checked by both exact match and resource pattern matching
 * - Required constraints are checked with type-aware matching
 */
export function evaluate(
  proposal: Proposal,
  policy: NegotiationPolicy,
): 'accept' | 'reject' | 'counter' {
  const constraintSet = new Set(proposal.constraints);

  // Parse proposal constraints for pattern matching
  const proposalParsed = proposal.constraints.map(parseConstraint);

  // Check for dealbreakers: exact match or resource pattern match
  for (const dealbreaker of policy.dealbreakers) {
    // Exact match
    if (constraintSet.has(dealbreaker)) {
      return 'reject';
    }
    // Pattern match: check if any proposal constraint's resource matches the dealbreaker's resource
    const dbParsed = parseConstraint(dealbreaker);
    for (const pc of proposalParsed) {
      if (pc.type === dbParsed.type && pc.resource === dbParsed.resource) {
        return 'reject';
      }
    }
  }

  // Check if all required constraints are present (exact or type-compatible match)
  let allRequiredPresent = true;
  for (const required of policy.requiredConstraints) {
    if (constraintSet.has(required)) {
      continue;
    }
    // Try type-aware matching
    const reqParsed = parseConstraint(required);
    const found = proposalParsed.some(
      pc => pc.type === reqParsed.type && pc.resource === reqParsed.resource,
    );
    if (!found) {
      allRequiredPresent = false;
      break;
    }
  }

  if (allRequiredPresent) {
    return 'accept';
  }

  return 'counter';
}

/**
 * Check if a negotiation session has expired.
 *
 * Returns true if the current time exceeds the session's createdAt + timeoutMs.
 */
export function isExpired(session: NegotiationSession): boolean {
  return Date.now() > session.createdAt + session.timeoutMs;
}

/**
 * Mark a negotiation session as failed, storing the failure reason.
 *
 * Returns a copy of the session with status set to 'failed' and failureReason populated.
 */
export function fail(
  session: NegotiationSession,
  reason?: string,
): NegotiationSession {
  return {
    ...session,
    status: 'failed',
    failureReason: reason,
  };
}

/**
 * Return the number of rounds (proposals) that have occurred in the session.
 */
export function roundCount(session: NegotiationSession): number {
  return session.proposals.length;
}

/**
 * Compute the Nash Bargaining Solution between two parties.
 *
 * The Nash Bargaining Solution maximizes the product:
 *   (utilityA(outcome) - disagreementA) * (utilityB(outcome) - disagreementB)
 *
 * over all feasible outcomes, where disagreementA and disagreementB are
 * the utilities each party receives if negotiation fails.
 *
 * Only outcomes where both parties receive utility above their disagreement
 * value are considered (individual rationality constraint).
 *
 * @param outcomes - Array of possible outcomes to evaluate
 * @param utilityA - Utility function for party A (includes disagreement value)
 * @param utilityB - Utility function for party B (includes disagreement value)
 * @returns NashBargainingSolution or null if no individually rational outcome exists
 */
export function computeNashBargainingSolution(
  outcomes: Outcome[],
  utilityA: UtilityFunction,
  utilityB: UtilityFunction,
): NashBargainingSolution | null {
  if (outcomes.length === 0) {
    return null;
  }

  let bestSolution: NashBargainingSolution | null = null;
  let bestProduct = -Infinity;

  for (const outcome of outcomes) {
    const uA = utilityA.evaluate(outcome);
    const uB = utilityB.evaluate(outcome);

    // Individual rationality: both parties must be at least as well off
    // as their disagreement point
    const surplusA = uA - utilityA.disagreementValue;
    const surplusB = uB - utilityB.disagreementValue;

    if (surplusA < 0 || surplusB < 0) {
      continue;
    }

    const nashProduct = surplusA * surplusB;

    if (nashProduct > bestProduct) {
      bestProduct = nashProduct;
      bestSolution = {
        outcome,
        utilityA: uA,
        utilityB: uB,
        nashProduct,
      };
    }
  }

  return bestSolution;
}

/**
 * Compute the Pareto frontier from a set of possible outcomes.
 *
 * An outcome is Pareto-optimal if no other outcome exists that makes
 * at least one party better off without making any party worse off.
 *
 * @param outcomes - Array of possible outcomes
 * @param utilityFunctions - Array of utility functions (one per party)
 * @returns Array of ParetoOutcome objects, with `dominated` flag set appropriately
 */
export function paretoFrontier(
  outcomes: Outcome[],
  utilityFunctions: UtilityFunction[],
): ParetoOutcome[] {
  if (outcomes.length === 0 || utilityFunctions.length === 0) {
    return [];
  }

  // Compute utilities for all outcomes
  const evaluated: ParetoOutcome[] = outcomes.map(outcome => ({
    outcome,
    utilities: utilityFunctions.map(uf => uf.evaluate(outcome)),
    dominated: false,
  }));

  // Mark dominated outcomes
  for (let i = 0; i < evaluated.length; i++) {
    if (evaluated[i]!.dominated) continue;

    for (let j = 0; j < evaluated.length; j++) {
      if (i === j) continue;
      if (evaluated[j]!.dominated) continue;

      // Check if j dominates i:
      // j is at least as good in all dimensions and strictly better in at least one
      let atLeastAsGood = true;
      let strictlyBetter = false;

      for (let k = 0; k < utilityFunctions.length; k++) {
        if (evaluated[j]!.utilities[k]! < evaluated[i]!.utilities[k]!) {
          atLeastAsGood = false;
          break;
        }
        if (evaluated[j]!.utilities[k]! > evaluated[i]!.utilities[k]!) {
          strictlyBetter = true;
        }
      }

      if (atLeastAsGood && strictlyBetter) {
        evaluated[i]!.dominated = true;
        break;
      }
    }
  }

  return evaluated;
}
