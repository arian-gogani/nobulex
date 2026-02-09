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
  DecayPoint,
  ViolationRecord,
  ExpirationForecastResult,
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
  DecayPoint,
  ViolationRecord,
  ExpirationForecastResult,
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

/**
 * Compute a decay schedule showing how a covenant's enforcement weight
 * decreases over its lifetime.
 *
 * Uses an exponential decay model: value(t) = initialWeight * e^(-decayRate * t)
 *
 * The schedule is sampled at `steps` evenly-spaced time points from 0 to `lifetimeMs`.
 *
 * @param initialWeight - The starting enforcement weight (must be > 0)
 * @param decayRate - The exponential decay rate (must be >= 0). Higher = faster decay.
 * @param lifetimeMs - The total lifetime in milliseconds (must be > 0)
 * @param steps - The number of sample points (must be >= 2)
 * @returns Array of (time, value) pairs
 */
export function computeDecaySchedule(
  initialWeight: number,
  decayRate: number,
  lifetimeMs: number,
  steps: number,
): DecayPoint[] {
  if (initialWeight <= 0) {
    throw new Error('initialWeight must be positive');
  }
  if (decayRate < 0) {
    throw new Error('decayRate must be non-negative');
  }
  if (lifetimeMs <= 0) {
    throw new Error('lifetimeMs must be positive');
  }
  if (steps < 2) {
    throw new Error('steps must be at least 2');
  }

  const schedule: DecayPoint[] = [];
  const stepSize = lifetimeMs / (steps - 1);

  for (let i = 0; i < steps; i++) {
    const time = i * stepSize;
    // Normalize time to [0, 1] for the decay calculation
    const normalizedTime = time / lifetimeMs;
    const value = initialWeight * Math.exp(-decayRate * normalizedTime);
    schedule.push({ time, value });
  }

  return schedule;
}

/**
 * Predict when a covenant will functionally expire based on violation patterns.
 *
 * Analyzes the history of violations to estimate:
 * 1. The current enforcement weight (decayed from initial)
 * 2. The trend in violations (accelerating, stable, or decelerating)
 * 3. The predicted time when enforcement weight drops below a functional threshold
 *
 * The model considers:
 * - Each violation reduces the effective weight by (severity * violationImpact)
 * - Natural decay reduces weight over time via exponential decay
 * - Violation frequency trends are used to extrapolate future violations
 *
 * @param initialWeight - The starting enforcement weight (must be > 0)
 * @param decayRate - The exponential decay rate (must be >= 0)
 * @param violations - Array of violation records with timestamps and severities
 * @param currentTime - The current time in milliseconds
 * @param threshold - The weight below which the covenant is considered expired (default 0.1)
 * @param violationImpact - How much each unit of severity reduces weight (default 0.05)
 * @returns ExpirationForecastResult with predicted expiration time and metadata
 */
export function expirationForecast(
  initialWeight: number,
  decayRate: number,
  violations: ViolationRecord[],
  currentTime: number,
  threshold: number = 0.1,
  violationImpact: number = 0.05,
): ExpirationForecastResult {
  if (initialWeight <= 0) {
    throw new Error('initialWeight must be positive');
  }
  if (decayRate < 0) {
    throw new Error('decayRate must be non-negative');
  }
  if (threshold < 0 || threshold >= initialWeight) {
    throw new Error('threshold must be in [0, initialWeight)');
  }
  if (violationImpact < 0) {
    throw new Error('violationImpact must be non-negative');
  }

  // Sort violations by timestamp
  const sorted = [...violations].sort((a, b) => a.timestamp - b.timestamp);

  // Compute cumulative violation damage
  let totalViolationDamage = 0;
  for (const v of sorted) {
    if (v.timestamp <= currentTime) {
      totalViolationDamage += v.severity * violationImpact;
    }
  }

  // Compute current weight considering both natural decay and violation damage
  // Use 1 year as reference lifetime for normalization
  const referenceLifetime = 365 * 24 * 60 * 60 * 1000;
  const normalizedCurrentTime = currentTime / referenceLifetime;
  const naturalDecayWeight = initialWeight * Math.exp(-decayRate * normalizedCurrentTime);
  const remainingWeight = Math.max(0, naturalDecayWeight - totalViolationDamage);

  // Determine violation trend by comparing intervals between recent violations
  let violationTrend: 'accelerating' | 'stable' | 'decelerating' = 'stable';
  const recentViolations = sorted.filter(v => v.timestamp <= currentTime);

  if (recentViolations.length >= 3) {
    // Compare average interval of first half vs second half
    const mid = Math.floor(recentViolations.length / 2);
    const firstHalfIntervals: number[] = [];
    const secondHalfIntervals: number[] = [];

    for (let i = 1; i < recentViolations.length; i++) {
      const interval = recentViolations[i]!.timestamp - recentViolations[i - 1]!.timestamp;
      if (i <= mid) {
        firstHalfIntervals.push(interval);
      } else {
        secondHalfIntervals.push(interval);
      }
    }

    const avgFirst = firstHalfIntervals.length > 0
      ? firstHalfIntervals.reduce((a, b) => a + b, 0) / firstHalfIntervals.length
      : Infinity;
    const avgSecond = secondHalfIntervals.length > 0
      ? secondHalfIntervals.reduce((a, b) => a + b, 0) / secondHalfIntervals.length
      : Infinity;

    // If intervals are getting shorter, violations are accelerating
    if (avgSecond < avgFirst * 0.8) {
      violationTrend = 'accelerating';
    } else if (avgSecond > avgFirst * 1.2) {
      violationTrend = 'decelerating';
    }
  }

  // If already below threshold, covenant is already expired
  if (remainingWeight <= threshold) {
    return {
      predictedExpirationTime: currentTime,
      confidence: 1.0,
      remainingWeight,
      violationTrend,
    };
  }

  // Predict future expiration by projecting violation rate and natural decay
  // Estimate violation rate (violations per ms)
  let violationRate = 0;
  if (recentViolations.length >= 2) {
    const timeSpan = recentViolations[recentViolations.length - 1]!.timestamp - recentViolations[0]!.timestamp;
    if (timeSpan > 0) {
      violationRate = recentViolations.length / timeSpan;
      // Adjust rate based on trend
      if (violationTrend === 'accelerating') {
        violationRate *= 1.5;
      } else if (violationTrend === 'decelerating') {
        violationRate *= 0.7;
      }
    }
  }

  // Average severity of violations
  const avgSeverity = recentViolations.length > 0
    ? recentViolations.reduce((sum, v) => sum + v.severity, 0) / recentViolations.length
    : 0;

  // Binary search for when remaining weight hits threshold
  let low = currentTime;
  let high = currentTime + referenceLifetime * 10; // Search up to 10x reference lifetime
  const maxIterations = 100;

  for (let iter = 0; iter < maxIterations; iter++) {
    const mid = (low + high) / 2;
    const dt = mid - currentTime;

    // Project natural decay from current time
    const futureNormalizedTime = mid / referenceLifetime;
    const futureNaturalWeight = initialWeight * Math.exp(-decayRate * futureNormalizedTime);

    // Project additional violation damage
    const projectedNewViolations = violationRate * dt;
    const projectedAdditionalDamage = projectedNewViolations * avgSeverity * violationImpact;
    const projectedWeight = Math.max(0, futureNaturalWeight - totalViolationDamage - projectedAdditionalDamage);

    if (Math.abs(projectedWeight - threshold) < threshold * 0.001) {
      low = mid;
      break;
    }

    if (projectedWeight > threshold) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const predictedExpirationTime = low;

  // Confidence is higher with more violation data
  const confidence = Math.min(1.0, 0.3 + 0.1 * recentViolations.length);

  return {
    predictedExpirationTime,
    confidence,
    remainingWeight,
    violationTrend,
  };
}
