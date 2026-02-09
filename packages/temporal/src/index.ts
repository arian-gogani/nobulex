import { sha256Object, generateId } from '@stele/crypto';

export type {
  TriggerType,
  TriggerAction,
  EvolutionPolicy,
  EvolutionTrigger,
  TransitionFunction,
  EvolutionEvent,
  AgentState,
  CovenantState,
} from './types';

import type {
  TriggerType,
  TriggerAction,
  EvolutionPolicy,
  EvolutionTrigger,
  TransitionFunction,
  EvolutionEvent,
  AgentState,
  CovenantState,
} from './types';

const VALID_TRIGGER_TYPES: TriggerType[] = [
  'capability_change',
  'time_elapsed',
  'reputation_threshold',
  'breach_event',
  'governance_vote',
];

const VALID_TRIGGER_ACTIONS: TriggerAction[] = [
  'tighten',
  'relax',
  'add_constraint',
  'remove_constraint',
];

/**
 * Validate a single trigger's condition format. Throws on malformed conditions.
 */
function validateTriggerCondition(trigger: EvolutionTrigger): void {
  if (!trigger.type || !VALID_TRIGGER_TYPES.includes(trigger.type)) {
    throw new Error(`Invalid trigger type: ${trigger.type}`);
  }
  if (!trigger.action || !VALID_TRIGGER_ACTIONS.includes(trigger.action)) {
    throw new Error(`Invalid trigger action: ${trigger.action}`);
  }
  if (typeof trigger.condition !== 'string') {
    throw new Error('Trigger condition must be a string');
  }

  switch (trigger.type) {
    case 'time_elapsed': {
      const conditionMs = parseFloat(trigger.condition);
      if (isNaN(conditionMs) || conditionMs < 0) {
        throw new Error(
          `Invalid time_elapsed condition: "${trigger.condition}". Must be a non-negative number (milliseconds).`,
        );
      }
      break;
    }
    case 'reputation_threshold': {
      const match = trigger.condition.match(/^([><]=?)(\d+(?:\.\d+)?)$/);
      if (!match) {
        throw new Error(
          `Invalid reputation_threshold condition: "${trigger.condition}". Must be ">N", "<N", ">=N", or "<=N".`,
        );
      }
      break;
    }
    case 'breach_event': {
      // breach_event accepts any condition string (e.g. 'any')
      if (trigger.condition.length === 0) {
        throw new Error('breach_event condition must not be empty');
      }
      break;
    }
    case 'capability_change': {
      // Must be a comma-separated list, possibly empty (meaning "no capabilities expected")
      // but the string itself must be present
      if (typeof trigger.condition !== 'string') {
        throw new Error('capability_change condition must be a string');
      }
      break;
    }
    case 'governance_vote': {
      if (trigger.condition.length === 0) {
        throw new Error('governance_vote condition must not be empty (should be proposal ID)');
      }
      break;
    }
  }
}

/**
 * Validate a transition function. Throws on invalid values.
 */
function validateTransition(transition: TransitionFunction): void {
  if (!transition.fromConstraint || typeof transition.fromConstraint !== 'string') {
    throw new Error('Transition fromConstraint must be a non-empty string');
  }
  if (!transition.toConstraint || typeof transition.toConstraint !== 'string') {
    throw new Error('Transition toConstraint must be a non-empty string');
  }
  if (typeof transition.cooldown !== 'number' || transition.cooldown < 0) {
    throw new Error(`Transition cooldown must be a non-negative number, got: ${transition.cooldown}`);
  }
}

/**
 * Create an EvolutionPolicy for a covenant.
 * Validates all triggers and transitions before creating the policy.
 */
export function defineEvolution(
  covenantId: string,
  triggers: EvolutionTrigger[],
  transitions: TransitionFunction[],
  governanceApproval: boolean = false,
): EvolutionPolicy {
  if (!covenantId || typeof covenantId !== 'string') {
    throw new Error('covenantId must be a non-empty string');
  }

  for (const trigger of triggers) {
    validateTriggerCondition(trigger);
  }

  for (const transition of transitions) {
    validateTransition(transition);
  }

  return {
    covenantId,
    triggers,
    transitions,
    governanceApproval,
  };
}

/**
 * Evaluate all triggers in the covenant's policy against the current agent state.
 * Returns an array of EvolutionTriggers that have fired.
 *
 * Trigger evaluation rules:
 *  - time_elapsed: condition is a number (ms). Fires if currentTime - lastTransitionAt > conditionMs.
 *  - reputation_threshold: condition is '>N', '<N', '>=N', or '<=N'. Fires if reputation matches.
 *  - breach_event: fires if agentState.breachCount > 0.
 *  - capability_change: condition is a comma-separated list of expected capabilities.
 *    Fires if the agent's current capabilities differ from the expected set.
 *  - governance_vote: fires if governanceVotes exist and the trigger's condition key is voted true.
 *
 * Throws on malformed conditions instead of silently ignoring them.
 * Validates that agentState fields exist before evaluating triggers.
 */
export function evaluateTriggers(
  covenant: CovenantState,
  agentState: AgentState,
): EvolutionTrigger[] {
  if (!covenant.policy) return [];

  // Validate agentState fields
  if (typeof agentState.reputationScore !== 'number') {
    throw new Error('agentState.reputationScore must be a number');
  }
  if (!Array.isArray(agentState.capabilities)) {
    throw new Error('agentState.capabilities must be an array');
  }
  if (typeof agentState.breachCount !== 'number') {
    throw new Error('agentState.breachCount must be a number');
  }
  if (typeof agentState.currentTime !== 'number') {
    throw new Error('agentState.currentTime must be a number');
  }

  const fired: EvolutionTrigger[] = [];

  for (const trigger of covenant.policy.triggers) {
    switch (trigger.type) {
      case 'time_elapsed': {
        const conditionMs = parseFloat(trigger.condition);
        if (isNaN(conditionMs)) {
          throw new Error(
            `Malformed time_elapsed condition: "${trigger.condition}". Expected a number.`,
          );
        }
        const lastTransition = covenant.lastTransitionAt ?? 0;
        if (agentState.currentTime - lastTransition > conditionMs) {
          fired.push(trigger);
        }
        break;
      }
      case 'reputation_threshold': {
        const match = trigger.condition.match(/^([><]=?)(\d+(?:\.\d+)?)$/);
        if (!match) {
          throw new Error(
            `Malformed reputation_threshold condition: "${trigger.condition}". Expected ">N", "<N", ">=N", or "<=N".`,
          );
        }
        const operator = match[1]!;
        const threshold = parseFloat(match[2]!);
        if (operator === '>' && agentState.reputationScore > threshold) {
          fired.push(trigger);
        } else if (operator === '<' && agentState.reputationScore < threshold) {
          fired.push(trigger);
        } else if (operator === '>=' && agentState.reputationScore >= threshold) {
          fired.push(trigger);
        } else if (operator === '<=' && agentState.reputationScore <= threshold) {
          fired.push(trigger);
        }
        break;
      }
      case 'breach_event': {
        if (agentState.breachCount > 0) {
          fired.push(trigger);
        }
        break;
      }
      case 'capability_change': {
        const expected = trigger.condition
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .sort();
        const actual = [...agentState.capabilities].sort();
        const differs =
          expected.length !== actual.length ||
          expected.some((cap, i) => cap !== actual[i]);
        if (differs) {
          fired.push(trigger);
        }
        break;
      }
      case 'governance_vote': {
        if (
          agentState.governanceVotes &&
          agentState.governanceVotes[trigger.condition] === true
        ) {
          fired.push(trigger);
        }
        break;
      }
      default: {
        throw new Error(`Unknown trigger type: ${(trigger as EvolutionTrigger).type}`);
      }
    }
  }

  return fired;
}

/**
 * Check whether a trigger can be applied to a covenant, respecting cooldown
 * periods and governance approval requirements.
 *
 * Cooldown check: matches transitions by fromConstraint/toConstraint
 * against the covenant's current constraints, not by trigger vs condition.
 */
export function canEvolve(covenant: CovenantState, trigger: EvolutionTrigger): boolean {
  if (!covenant.policy) return false;

  // Check governance approval requirement
  if (covenant.policy.governanceApproval) {
    if (trigger.type !== 'governance_vote') {
      return false;
    }
  }

  // Check cooldown: find matching transitions by fromConstraint/toConstraint
  // A transition matches if its fromConstraint is in the current constraints
  // and its toConstraint matches the trigger's constraintId (or action target).
  const now = Date.now();
  const lastTransition = covenant.lastTransitionAt ?? 0;

  for (const transition of covenant.policy.transitions) {
    const fromMatch = covenant.constraints.includes(transition.fromConstraint);
    const toMatch = trigger.constraintId === transition.toConstraint ||
      (trigger.action === 'tighten' && covenant.constraints.includes(transition.fromConstraint)) ||
      (trigger.action === 'relax' && trigger.constraintId === transition.fromConstraint);

    if (fromMatch && toMatch) {
      if (now - lastTransition < transition.cooldown) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Apply a trigger action to the covenant constraints.
 * Returns the updated covenant state and the evolution event.
 *
 * Actions:
 *  - tighten: add a new restriction constraint (generates a new constraint ID).
 *  - relax: remove the constraint specified by trigger.constraintId.
 *  - add_constraint: add trigger.constraintId to the constraints.
 *  - remove_constraint: remove trigger.constraintId from the constraints.
 *
 * Respects cooldown periods by checking transitions using fromConstraint/toConstraint matching.
 * If governance approval is required and trigger is not governance_vote, the event
 * is marked as not approved with governanceStatus='pending' and no changes are made.
 */
export function evolve(
  covenant: CovenantState,
  trigger: EvolutionTrigger,
): { covenant: CovenantState; event: EvolutionEvent } {
  const previousConstraints = [...covenant.constraints];
  const timestamp = Date.now();
  let approved = true;

  // Check governance approval
  if (covenant.policy?.governanceApproval && trigger.type !== 'governance_vote') {
    approved = false;
    const event: EvolutionEvent = {
      covenantId: covenant.id,
      trigger,
      previousConstraints,
      newConstraints: previousConstraints,
      timestamp,
      approved,
      governanceStatus: 'pending',
    };
    return {
      covenant: {
        ...covenant,
        history: [...covenant.history, event],
      },
      event,
    };
  }

  // Check cooldown: match transitions by fromConstraint/toConstraint
  if (covenant.policy) {
    for (const transition of covenant.policy.transitions) {
      const fromMatch = covenant.constraints.includes(transition.fromConstraint);
      const toMatch = trigger.constraintId === transition.toConstraint ||
        (trigger.action === 'tighten' && covenant.constraints.includes(transition.fromConstraint)) ||
        (trigger.action === 'relax' && trigger.constraintId === transition.fromConstraint);

      if (fromMatch && toMatch) {
        const lastTransition = covenant.lastTransitionAt ?? 0;
        if (timestamp - lastTransition < transition.cooldown) {
          approved = false;
          const event: EvolutionEvent = {
            covenantId: covenant.id,
            trigger,
            previousConstraints,
            newConstraints: previousConstraints,
            timestamp,
            approved,
          };
          return {
            covenant: {
              ...covenant,
              history: [...covenant.history, event],
            },
            event,
          };
        }
      }
    }
  }

  // Apply the action
  let newConstraints = [...previousConstraints];

  switch (trigger.action) {
    case 'tighten': {
      const newId = trigger.constraintId ?? `tightened-${generateId(8)}`;
      newConstraints.push(newId);
      break;
    }
    case 'relax': {
      if (trigger.constraintId) {
        newConstraints = newConstraints.filter((c) => c !== trigger.constraintId);
      }
      break;
    }
    case 'add_constraint': {
      if (trigger.constraintId && !newConstraints.includes(trigger.constraintId)) {
        newConstraints.push(trigger.constraintId);
      }
      break;
    }
    case 'remove_constraint': {
      if (trigger.constraintId) {
        newConstraints = newConstraints.filter((c) => c !== trigger.constraintId);
      }
      break;
    }
  }

  const governanceStatus = covenant.policy?.governanceApproval && trigger.type === 'governance_vote'
    ? 'approved' as const
    : undefined;

  const event: EvolutionEvent = {
    covenantId: covenant.id,
    trigger,
    previousConstraints,
    newConstraints,
    timestamp,
    approved: true,
    ...(governanceStatus ? { governanceStatus } : {}),
  };

  return {
    covenant: {
      ...covenant,
      constraints: newConstraints,
      history: [...covenant.history, event],
      lastTransitionAt: timestamp,
    },
    event,
  };
}

/**
 * Return the evolution history for a covenant.
 */
export function evolutionHistory(covenant: CovenantState): EvolutionEvent[] {
  return covenant.history;
}
