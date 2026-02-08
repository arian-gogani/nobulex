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
  EvolutionPolicy,
  EvolutionTrigger,
  TransitionFunction,
  EvolutionEvent,
  AgentState,
  CovenantState,
} from './types';

/**
 * Create an EvolutionPolicy for a covenant.
 */
export function defineEvolution(
  covenantId: string,
  triggers: EvolutionTrigger[],
  transitions: TransitionFunction[],
  governanceApproval: boolean = false
): EvolutionPolicy {
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
 *  - reputation_threshold: condition is '>N' or '<N'. Fires if reputation matches.
 *  - breach_event: fires if agentState.breachCount > 0.
 *  - capability_change: condition is a comma-separated list of expected capabilities.
 *    Fires if the agent's current capabilities differ from the expected set.
 *  - governance_vote: fires if governanceVotes exist and the trigger's condition key is voted true.
 */
export function evaluateTriggers(
  covenant: CovenantState,
  agentState: AgentState
): EvolutionTrigger[] {
  if (!covenant.policy) return [];

  const fired: EvolutionTrigger[] = [];

  for (const trigger of covenant.policy.triggers) {
    switch (trigger.type) {
      case 'time_elapsed': {
        const conditionMs = parseFloat(trigger.condition);
        if (!isNaN(conditionMs)) {
          const lastTransition = covenant.lastTransitionAt ?? 0;
          if (agentState.currentTime - lastTransition > conditionMs) {
            fired.push(trigger);
          }
        }
        break;
      }
      case 'reputation_threshold': {
        const match = trigger.condition.match(/^([><])(\d+(?:\.\d+)?)$/);
        if (match) {
          const operator = match[1];
          const threshold = parseFloat(match[2]!);
          if (operator === '>' && agentState.reputationScore > threshold) {
            fired.push(trigger);
          } else if (operator === '<' && agentState.reputationScore < threshold) {
            fired.push(trigger);
          }
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
    }
  }

  return fired;
}

/**
 * Check whether a trigger can be applied to a covenant, respecting cooldown
 * periods and governance approval requirements.
 */
export function canEvolve(covenant: CovenantState, trigger: EvolutionTrigger): boolean {
  if (!covenant.policy) return false;

  // Check governance approval requirement
  if (covenant.policy.governanceApproval) {
    // Governance approval must be verified externally; if the policy requires it,
    // we require the trigger to be a governance_vote type or there must be
    // a matching transition that doesn't block it.
    // For simplicity: if governance is required and this isn't a governance_vote trigger,
    // we deny evolution.
    if (trigger.type !== 'governance_vote') {
      return false;
    }
  }

  // Check cooldown: find any matching transition and verify cooldown has elapsed.
  const now = Date.now();
  const lastTransition = covenant.lastTransitionAt ?? 0;

  for (const transition of covenant.policy.transitions) {
    if (transition.trigger === trigger.condition) {
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
 * Respects cooldown periods by checking transitions.
 * If governance approval is required and trigger is not governance_vote, the event
 * is marked as not approved and no changes are made.
 */
export function evolve(
  covenant: CovenantState,
  trigger: EvolutionTrigger
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
    };
    return {
      covenant: {
        ...covenant,
        history: [...covenant.history, event],
      },
      event,
    };
  }

  // Check cooldown
  if (covenant.policy) {
    for (const transition of covenant.policy.transitions) {
      if (transition.trigger === trigger.condition) {
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

  const event: EvolutionEvent = {
    covenantId: covenant.id,
    trigger,
    previousConstraints,
    newConstraints,
    timestamp,
    approved: true,
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
