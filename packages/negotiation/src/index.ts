import { generateId } from '@stele/crypto';

export type {
  NegotiationSession,
  Proposal,
  NegotiationPolicy,
} from './types.js';

import type {
  NegotiationSession,
  Proposal,
  NegotiationPolicy,
} from './types.js';

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
 * Sets the status to 'agreed' and computes the resulting constraints as the
 * intersection of the last two proposals' constraints.
 */
export function agree(session: NegotiationSession): NegotiationSession {
  const proposals = session.proposals;
  let resultingConstraints: string[] = [];

  if (proposals.length >= 2) {
    const lastProposal = proposals[proposals.length - 1]!;
    const secondLastProposal = proposals[proposals.length - 2]!;
    const lastSet = new Set(lastProposal.constraints);
    resultingConstraints = secondLastProposal.constraints.filter(c => lastSet.has(c));
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
 * - 'accept' if all required constraints are present and no dealbreakers are found
 * - 'reject' if any dealbreaker constraint is present in the proposal
 * - 'counter' if some required constraints are missing but no dealbreakers
 */
export function evaluate(
  proposal: Proposal,
  policy: NegotiationPolicy,
): 'accept' | 'reject' | 'counter' {
  const constraintSet = new Set(proposal.constraints);

  // Check for dealbreakers first
  for (const dealbreaker of policy.dealbreakers) {
    if (constraintSet.has(dealbreaker)) {
      return 'reject';
    }
  }

  // Check if all required constraints are present
  const allRequiredPresent = policy.requiredConstraints.every(rc =>
    constraintSet.has(rc),
  );

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
 * Mark a negotiation session as failed.
 *
 * Returns a copy of the session with status set to 'failed'.
 */
export function fail(
  session: NegotiationSession,
  _reason?: string,
): NegotiationSession {
  return {
    ...session,
    status: 'failed',
  };
}
