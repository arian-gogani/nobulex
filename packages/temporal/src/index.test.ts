import { describe, it, expect, vi } from 'vitest';
import {
  defineEvolution,
  evaluateTriggers,
  evolve,
  evolutionHistory,
  canEvolve,
  computeDecaySchedule,
  expirationForecast,
} from './index';
import type {
  EvolutionTrigger,
  TransitionFunction,
  CovenantState,
  AgentState,
  EvolutionPolicy,
  DecayPoint,
  ViolationRecord,
} from './types';

// ---------------------------------------------------------------------------
// Helper factory functions
// ---------------------------------------------------------------------------
function makePolicy(overrides?: Partial<EvolutionPolicy>): EvolutionPolicy {
  return {
    covenantId: 'cov-1',
    triggers: [],
    transitions: [],
    governanceApproval: false,
    ...overrides,
  };
}

function makeCovenant(overrides?: Partial<CovenantState>): CovenantState {
  return {
    id: 'cov-1',
    constraints: ['c1', 'c2'],
    history: [],
    ...overrides,
  };
}

function makeAgent(overrides?: Partial<AgentState>): AgentState {
  return {
    reputationScore: 0.8,
    capabilities: ['read', 'write'],
    breachCount: 0,
    currentTime: 10000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// defineEvolution
// ---------------------------------------------------------------------------
describe('defineEvolution', () => {
  it('creates an EvolutionPolicy with the given covenantId', () => {
    const policy = defineEvolution('cov-abc', [], []);
    expect(policy.covenantId).toBe('cov-abc');
  });

  it('includes the provided triggers', () => {
    const triggers: EvolutionTrigger[] = [
      { type: 'breach_event', condition: 'any', action: 'tighten' },
    ];
    const policy = defineEvolution('cov-1', triggers, []);
    expect(policy.triggers).toHaveLength(1);
    expect(policy.triggers[0]!.type).toBe('breach_event');
  });

  it('includes the provided transitions', () => {
    const transitions: TransitionFunction[] = [
      { fromConstraint: 'c1', toConstraint: 'c2', trigger: 'upgrade', reversible: true, cooldown: 1000 },
    ];
    const policy = defineEvolution('cov-1', [], transitions);
    expect(policy.transitions).toHaveLength(1);
  });

  it('defaults governanceApproval to false', () => {
    const policy = defineEvolution('cov-1', [], []);
    expect(policy.governanceApproval).toBe(false);
  });

  it('sets governanceApproval to true when specified', () => {
    const policy = defineEvolution('cov-1', [], [], true);
    expect(policy.governanceApproval).toBe(true);
  });

  it('throws on empty covenantId', () => {
    expect(() => defineEvolution('', [], [])).toThrow('covenantId must be a non-empty string');
  });

  it('throws on invalid trigger type', () => {
    const triggers = [{ type: 'invalid_type' as any, condition: 'x', action: 'tighten' as const }];
    expect(() => defineEvolution('cov-1', triggers, [])).toThrow('Invalid trigger type');
  });

  it('throws on invalid trigger action', () => {
    const triggers = [{ type: 'breach_event' as const, condition: 'any', action: 'invalid_action' as any }];
    expect(() => defineEvolution('cov-1', triggers, [])).toThrow('Invalid trigger action');
  });

  it('throws on malformed time_elapsed condition', () => {
    const triggers: EvolutionTrigger[] = [
      { type: 'time_elapsed', condition: 'not-a-number', action: 'relax' },
    ];
    expect(() => defineEvolution('cov-1', triggers, [])).toThrow('Invalid time_elapsed condition');
  });

  it('throws on negative time_elapsed condition', () => {
    const triggers: EvolutionTrigger[] = [
      { type: 'time_elapsed', condition: '-100', action: 'relax' },
    ];
    expect(() => defineEvolution('cov-1', triggers, [])).toThrow('Invalid time_elapsed condition');
  });

  it('throws on malformed reputation_threshold condition', () => {
    const triggers: EvolutionTrigger[] = [
      { type: 'reputation_threshold', condition: 'bad', action: 'relax' },
    ];
    expect(() => defineEvolution('cov-1', triggers, [])).toThrow('Invalid reputation_threshold condition');
  });

  it('throws on empty breach_event condition', () => {
    const triggers: EvolutionTrigger[] = [
      { type: 'breach_event', condition: '', action: 'tighten' },
    ];
    expect(() => defineEvolution('cov-1', triggers, [])).toThrow('breach_event condition must not be empty');
  });

  it('throws on empty governance_vote condition', () => {
    const triggers: EvolutionTrigger[] = [
      { type: 'governance_vote', condition: '', action: 'relax' },
    ];
    expect(() => defineEvolution('cov-1', triggers, [])).toThrow('governance_vote condition must not be empty');
  });

  it('throws on negative transition cooldown', () => {
    const transitions: TransitionFunction[] = [
      { fromConstraint: 'c1', toConstraint: 'c2', trigger: 'x', reversible: true, cooldown: -1 },
    ];
    expect(() => defineEvolution('cov-1', [], transitions)).toThrow('cooldown must be a non-negative number');
  });

  it('throws on empty transition fromConstraint', () => {
    const transitions: TransitionFunction[] = [
      { fromConstraint: '', toConstraint: 'c2', trigger: 'x', reversible: true, cooldown: 100 },
    ];
    expect(() => defineEvolution('cov-1', [], transitions)).toThrow('fromConstraint must be a non-empty string');
  });

  it('accepts valid >= and <= reputation_threshold conditions', () => {
    const triggers: EvolutionTrigger[] = [
      { type: 'reputation_threshold', condition: '>=0.5', action: 'relax' },
      { type: 'reputation_threshold', condition: '<=0.3', action: 'tighten' },
    ];
    const policy = defineEvolution('cov-1', triggers, []);
    expect(policy.triggers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// evaluateTriggers
// ---------------------------------------------------------------------------
describe('evaluateTriggers', () => {
  it('returns empty array when covenant has no policy', () => {
    const covenant = makeCovenant({ policy: undefined });
    const agent = makeAgent();
    expect(evaluateTriggers(covenant, agent)).toEqual([]);
  });

  it('fires time_elapsed trigger when enough time has passed', () => {
    const trigger: EvolutionTrigger = { type: 'time_elapsed', condition: '5000', action: 'relax' };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy, lastTransitionAt: 1000 });
    const agent = makeAgent({ currentTime: 7000 });
    const fired = evaluateTriggers(covenant, agent);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.type).toBe('time_elapsed');
  });

  it('does not fire time_elapsed trigger when not enough time has passed', () => {
    const trigger: EvolutionTrigger = { type: 'time_elapsed', condition: '5000', action: 'relax' };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy, lastTransitionAt: 5000 });
    const agent = makeAgent({ currentTime: 7000 });
    const fired = evaluateTriggers(covenant, agent);
    expect(fired).toHaveLength(0);
  });

  it('uses 0 as lastTransitionAt when undefined', () => {
    const trigger: EvolutionTrigger = { type: 'time_elapsed', condition: '5000', action: 'relax' };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy, lastTransitionAt: undefined });
    const agent = makeAgent({ currentTime: 6000 });
    const fired = evaluateTriggers(covenant, agent);
    expect(fired).toHaveLength(1);
  });

  it('fires reputation_threshold trigger with > operator', () => {
    const trigger: EvolutionTrigger = { type: 'reputation_threshold', condition: '>0.5', action: 'relax' };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = makeAgent({ reputationScore: 0.8 });
    const fired = evaluateTriggers(covenant, agent);
    expect(fired).toHaveLength(1);
  });

  it('fires reputation_threshold trigger with < operator', () => {
    const trigger: EvolutionTrigger = { type: 'reputation_threshold', condition: '<0.3', action: 'tighten' };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = makeAgent({ reputationScore: 0.2 });
    const fired = evaluateTriggers(covenant, agent);
    expect(fired).toHaveLength(1);
  });

  it('fires reputation_threshold trigger with >= operator', () => {
    const trigger: EvolutionTrigger = { type: 'reputation_threshold', condition: '>=0.5', action: 'relax' };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = makeAgent({ reputationScore: 0.5 });
    const fired = evaluateTriggers(covenant, agent);
    expect(fired).toHaveLength(1);
  });

  it('fires reputation_threshold trigger with <= operator', () => {
    const trigger: EvolutionTrigger = { type: 'reputation_threshold', condition: '<=0.3', action: 'tighten' };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = makeAgent({ reputationScore: 0.3 });
    const fired = evaluateTriggers(covenant, agent);
    expect(fired).toHaveLength(1);
  });

  it('does not fire reputation_threshold when condition not met', () => {
    const trigger: EvolutionTrigger = { type: 'reputation_threshold', condition: '>0.9', action: 'relax' };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = makeAgent({ reputationScore: 0.5 });
    const fired = evaluateTriggers(covenant, agent);
    expect(fired).toHaveLength(0);
  });

  it('throws on malformed reputation_threshold condition during evaluation', () => {
    const trigger: EvolutionTrigger = { type: 'reputation_threshold', condition: 'bad', action: 'relax' };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = makeAgent();
    expect(() => evaluateTriggers(covenant, agent)).toThrow('Malformed reputation_threshold condition');
  });

  it('throws on malformed time_elapsed condition during evaluation', () => {
    const trigger: EvolutionTrigger = { type: 'time_elapsed', condition: 'abc', action: 'relax' };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = makeAgent();
    expect(() => evaluateTriggers(covenant, agent)).toThrow('Malformed time_elapsed condition');
  });

  it('fires breach_event trigger when breachCount > 0', () => {
    const trigger: EvolutionTrigger = { type: 'breach_event', condition: 'any', action: 'tighten' };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = makeAgent({ breachCount: 3 });
    const fired = evaluateTriggers(covenant, agent);
    expect(fired).toHaveLength(1);
  });

  it('does not fire breach_event when breachCount is 0', () => {
    const trigger: EvolutionTrigger = { type: 'breach_event', condition: 'any', action: 'tighten' };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = makeAgent({ breachCount: 0 });
    const fired = evaluateTriggers(covenant, agent);
    expect(fired).toHaveLength(0);
  });

  it('fires capability_change trigger when capabilities differ', () => {
    const trigger: EvolutionTrigger = {
      type: 'capability_change',
      condition: 'read,write',
      action: 'tighten',
    };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = makeAgent({ capabilities: ['read', 'write', 'execute'] });
    const fired = evaluateTriggers(covenant, agent);
    expect(fired).toHaveLength(1);
  });

  it('does not fire capability_change when capabilities match', () => {
    const trigger: EvolutionTrigger = {
      type: 'capability_change',
      condition: 'read,write',
      action: 'tighten',
    };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = makeAgent({ capabilities: ['read', 'write'] });
    const fired = evaluateTriggers(covenant, agent);
    expect(fired).toHaveLength(0);
  });

  it('fires governance_vote trigger when vote exists and is true', () => {
    const trigger: EvolutionTrigger = {
      type: 'governance_vote',
      condition: 'proposal-42',
      action: 'relax',
    };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = makeAgent({ governanceVotes: { 'proposal-42': true } });
    const fired = evaluateTriggers(covenant, agent);
    expect(fired).toHaveLength(1);
  });

  it('does not fire governance_vote trigger when vote is false', () => {
    const trigger: EvolutionTrigger = {
      type: 'governance_vote',
      condition: 'proposal-42',
      action: 'relax',
    };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = makeAgent({ governanceVotes: { 'proposal-42': false } });
    const fired = evaluateTriggers(covenant, agent);
    expect(fired).toHaveLength(0);
  });

  it('throws when agentState.reputationScore is not a number', () => {
    const trigger: EvolutionTrigger = { type: 'breach_event', condition: 'any', action: 'tighten' };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = { reputationScore: 'bad' as any, capabilities: [], breachCount: 0, currentTime: 100 };
    expect(() => evaluateTriggers(covenant, agent)).toThrow('agentState.reputationScore must be a number');
  });

  it('throws when agentState.capabilities is not an array', () => {
    const trigger: EvolutionTrigger = { type: 'breach_event', condition: 'any', action: 'tighten' };
    const policy = makePolicy({ triggers: [trigger] });
    const covenant = makeCovenant({ policy });
    const agent = { reputationScore: 0.5, capabilities: 'bad' as any, breachCount: 0, currentTime: 100 };
    expect(() => evaluateTriggers(covenant, agent)).toThrow('agentState.capabilities must be an array');
  });
});

// ---------------------------------------------------------------------------
// evolve
// ---------------------------------------------------------------------------
describe('evolve', () => {
  it('adds a constraint with tighten action', () => {
    const trigger: EvolutionTrigger = {
      type: 'breach_event',
      condition: 'any',
      action: 'tighten',
      constraintId: 'new-restriction',
    };
    const covenant = makeCovenant({ policy: makePolicy() });
    const result = evolve(covenant, trigger);
    expect(result.covenant.constraints).toContain('new-restriction');
    expect(result.event.approved).toBe(true);
  });

  it('removes a constraint with relax action', () => {
    const trigger: EvolutionTrigger = {
      type: 'reputation_threshold',
      condition: '>0.9',
      action: 'relax',
      constraintId: 'c1',
    };
    const covenant = makeCovenant({ policy: makePolicy() });
    const result = evolve(covenant, trigger);
    expect(result.covenant.constraints).not.toContain('c1');
    expect(result.covenant.constraints).toContain('c2');
  });

  it('adds a constraint with add_constraint action', () => {
    const trigger: EvolutionTrigger = {
      type: 'governance_vote',
      condition: 'vote-1',
      action: 'add_constraint',
      constraintId: 'c3',
    };
    const covenant = makeCovenant({ policy: makePolicy() });
    const result = evolve(covenant, trigger);
    expect(result.covenant.constraints).toContain('c3');
  });

  it('removes a constraint with remove_constraint action', () => {
    const trigger: EvolutionTrigger = {
      type: 'governance_vote',
      condition: 'vote-2',
      action: 'remove_constraint',
      constraintId: 'c2',
    };
    const covenant = makeCovenant({ policy: makePolicy() });
    const result = evolve(covenant, trigger);
    expect(result.covenant.constraints).not.toContain('c2');
  });

  it('records the event in the covenant history', () => {
    const trigger: EvolutionTrigger = {
      type: 'breach_event',
      condition: 'any',
      action: 'tighten',
      constraintId: 'added',
    };
    const covenant = makeCovenant({ policy: makePolicy() });
    const result = evolve(covenant, trigger);
    expect(result.covenant.history).toHaveLength(1);
    expect(result.covenant.history[0]!.trigger).toBe(trigger);
  });

  it('updates lastTransitionAt on successful evolution', () => {
    const trigger: EvolutionTrigger = {
      type: 'breach_event',
      condition: 'any',
      action: 'tighten',
      constraintId: 'x',
    };
    const covenant = makeCovenant({ policy: makePolicy(), lastTransitionAt: 0 });
    const result = evolve(covenant, trigger);
    expect(result.covenant.lastTransitionAt).toBeGreaterThan(0);
  });

  it('does not approve evolution when governance is required and trigger is not governance_vote', () => {
    const trigger: EvolutionTrigger = {
      type: 'breach_event',
      condition: 'any',
      action: 'tighten',
      constraintId: 'new',
    };
    const policy = makePolicy({ governanceApproval: true });
    const covenant = makeCovenant({ policy });
    const result = evolve(covenant, trigger);
    expect(result.event.approved).toBe(false);
    expect(result.covenant.constraints).toEqual(['c1', 'c2']);
  });

  it('sets governanceStatus to pending when governance required and trigger is not governance_vote', () => {
    const trigger: EvolutionTrigger = {
      type: 'breach_event',
      condition: 'any',
      action: 'tighten',
      constraintId: 'new',
    };
    const policy = makePolicy({ governanceApproval: true });
    const covenant = makeCovenant({ policy });
    const result = evolve(covenant, trigger);
    expect(result.event.governanceStatus).toBe('pending');
  });

  it('sets governanceStatus to approved when governance required and trigger is governance_vote', () => {
    const trigger: EvolutionTrigger = {
      type: 'governance_vote',
      condition: 'proposal-1',
      action: 'add_constraint',
      constraintId: 'c3',
    };
    const policy = makePolicy({ governanceApproval: true });
    const covenant = makeCovenant({ policy });
    const result = evolve(covenant, trigger);
    expect(result.event.approved).toBe(true);
    expect(result.event.governanceStatus).toBe('approved');
  });

  it('preserves previousConstraints in the event', () => {
    const trigger: EvolutionTrigger = {
      type: 'breach_event',
      condition: 'any',
      action: 'tighten',
      constraintId: 'new',
    };
    const covenant = makeCovenant({ policy: makePolicy() });
    const result = evolve(covenant, trigger);
    expect(result.event.previousConstraints).toEqual(['c1', 'c2']);
  });

  it('does not duplicate constraint when add_constraint with existing id', () => {
    const trigger: EvolutionTrigger = {
      type: 'governance_vote',
      condition: 'vote-1',
      action: 'add_constraint',
      constraintId: 'c1',
    };
    const covenant = makeCovenant({ policy: makePolicy() });
    const result = evolve(covenant, trigger);
    const c1Count = result.covenant.constraints.filter((c) => c === 'c1').length;
    expect(c1Count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// evolutionHistory
// ---------------------------------------------------------------------------
describe('evolutionHistory', () => {
  it('returns empty array for covenant with no history', () => {
    const covenant = makeCovenant();
    expect(evolutionHistory(covenant)).toEqual([]);
  });

  it('returns the history array from the covenant', () => {
    const trigger: EvolutionTrigger = {
      type: 'breach_event',
      condition: 'any',
      action: 'tighten',
      constraintId: 'added',
    };
    const covenant = makeCovenant({ policy: makePolicy() });
    const result = evolve(covenant, trigger);
    const history = evolutionHistory(result.covenant);
    expect(history).toHaveLength(1);
    expect(history[0]!.covenantId).toBe('cov-1');
  });
});

// ---------------------------------------------------------------------------
// canEvolve
// ---------------------------------------------------------------------------
describe('canEvolve', () => {
  it('returns false when covenant has no policy', () => {
    const trigger: EvolutionTrigger = {
      type: 'breach_event',
      condition: 'any',
      action: 'tighten',
    };
    const covenant = makeCovenant({ policy: undefined });
    expect(canEvolve(covenant, trigger)).toBe(false);
  });

  it('returns false when governance is required and trigger is not governance_vote', () => {
    const trigger: EvolutionTrigger = {
      type: 'breach_event',
      condition: 'any',
      action: 'tighten',
    };
    const policy = makePolicy({ governanceApproval: true });
    const covenant = makeCovenant({ policy });
    expect(canEvolve(covenant, trigger)).toBe(false);
  });

  it('returns true when governance is required and trigger is governance_vote', () => {
    const trigger: EvolutionTrigger = {
      type: 'governance_vote',
      condition: 'proposal-1',
      action: 'relax',
    };
    const policy = makePolicy({ governanceApproval: true });
    const covenant = makeCovenant({ policy });
    expect(canEvolve(covenant, trigger)).toBe(true);
  });

  it('returns true when no governance is required', () => {
    const trigger: EvolutionTrigger = {
      type: 'breach_event',
      condition: 'any',
      action: 'tighten',
    };
    const policy = makePolicy({ governanceApproval: false });
    const covenant = makeCovenant({ policy });
    expect(canEvolve(covenant, trigger)).toBe(true);
  });

  it('returns false when cooldown has not elapsed for matching transition (fromConstraint/toConstraint)', () => {
    const trigger: EvolutionTrigger = {
      type: 'breach_event',
      condition: 'any',
      action: 'add_constraint',
      constraintId: 'c3',
    };
    const transitions: TransitionFunction[] = [
      { fromConstraint: 'c1', toConstraint: 'c3', trigger: 'upgrade', reversible: true, cooldown: 999999999 },
    ];
    const policy = makePolicy({ transitions });
    const covenant = makeCovenant({ policy, lastTransitionAt: Date.now() });
    expect(canEvolve(covenant, trigger)).toBe(false);
  });

  it('returns true when cooldown has elapsed for matching transition', () => {
    const trigger: EvolutionTrigger = {
      type: 'breach_event',
      condition: 'any',
      action: 'add_constraint',
      constraintId: 'c3',
    };
    const transitions: TransitionFunction[] = [
      { fromConstraint: 'c1', toConstraint: 'c3', trigger: 'upgrade', reversible: true, cooldown: 100 },
    ];
    const policy = makePolicy({ transitions });
    const covenant = makeCovenant({ policy, lastTransitionAt: Date.now() - 200 });
    expect(canEvolve(covenant, trigger)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeDecaySchedule
// ---------------------------------------------------------------------------
describe('computeDecaySchedule', () => {
  it('returns the correct number of steps', () => {
    const schedule = computeDecaySchedule(1.0, 1.0, 10000, 5);
    expect(schedule).toHaveLength(5);
  });

  it('starts at the initial weight', () => {
    const schedule = computeDecaySchedule(2.0, 1.0, 10000, 10);
    expect(schedule[0]!.time).toBe(0);
    expect(schedule[0]!.value).toBeCloseTo(2.0, 10);
  });

  it('ends at time equal to lifetimeMs', () => {
    const schedule = computeDecaySchedule(1.0, 1.0, 5000, 10);
    expect(schedule[schedule.length - 1]!.time).toBeCloseTo(5000, 5);
  });

  it('values decay monotonically over time', () => {
    const schedule = computeDecaySchedule(1.0, 2.0, 10000, 20);
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i]!.value).toBeLessThanOrEqual(schedule[i - 1]!.value);
    }
  });

  it('with zero decay rate, values remain constant', () => {
    const schedule = computeDecaySchedule(1.0, 0, 10000, 5);
    for (const point of schedule) {
      expect(point.value).toBeCloseTo(1.0, 10);
    }
  });

  it('higher decay rate produces lower final value', () => {
    const scheduleSlow = computeDecaySchedule(1.0, 0.5, 10000, 10);
    const scheduleFast = computeDecaySchedule(1.0, 5.0, 10000, 10);
    const lastSlow = scheduleSlow[scheduleSlow.length - 1]!.value;
    const lastFast = scheduleFast[scheduleFast.length - 1]!.value;
    expect(lastFast).toBeLessThan(lastSlow);
  });

  it('throws on non-positive initialWeight', () => {
    expect(() => computeDecaySchedule(0, 1.0, 10000, 5)).toThrow('initialWeight must be positive');
    expect(() => computeDecaySchedule(-1, 1.0, 10000, 5)).toThrow('initialWeight must be positive');
  });

  it('throws on negative decayRate', () => {
    expect(() => computeDecaySchedule(1.0, -1.0, 10000, 5)).toThrow('decayRate must be non-negative');
  });

  it('throws on non-positive lifetimeMs', () => {
    expect(() => computeDecaySchedule(1.0, 1.0, 0, 5)).toThrow('lifetimeMs must be positive');
    expect(() => computeDecaySchedule(1.0, 1.0, -100, 5)).toThrow('lifetimeMs must be positive');
  });

  it('throws on steps less than 2', () => {
    expect(() => computeDecaySchedule(1.0, 1.0, 10000, 1)).toThrow('steps must be at least 2');
    expect(() => computeDecaySchedule(1.0, 1.0, 10000, 0)).toThrow('steps must be at least 2');
  });

  it('time points are evenly spaced', () => {
    const schedule = computeDecaySchedule(1.0, 1.0, 10000, 5);
    const expectedStep = 10000 / 4;
    for (let i = 0; i < schedule.length; i++) {
      expect(schedule[i]!.time).toBeCloseTo(i * expectedStep, 5);
    }
  });

  it('applies correct exponential decay formula', () => {
    const schedule = computeDecaySchedule(3.0, 2.0, 10000, 3);
    // At t=0: 3.0 * e^(0) = 3.0
    expect(schedule[0]!.value).toBeCloseTo(3.0, 10);
    // At t=5000 (normalized 0.5): 3.0 * e^(-2.0 * 0.5) = 3.0 * e^(-1.0)
    expect(schedule[1]!.value).toBeCloseTo(3.0 * Math.exp(-1.0), 10);
    // At t=10000 (normalized 1.0): 3.0 * e^(-2.0 * 1.0) = 3.0 * e^(-2.0)
    expect(schedule[2]!.value).toBeCloseTo(3.0 * Math.exp(-2.0), 10);
  });

  it('works with a large number of steps', () => {
    const schedule = computeDecaySchedule(1.0, 1.0, 10000, 1000);
    expect(schedule).toHaveLength(1000);
    expect(schedule[0]!.value).toBeCloseTo(1.0, 10);
    expect(schedule[999]!.value).toBeLessThan(1.0);
  });
});

// ---------------------------------------------------------------------------
// expirationForecast
// ---------------------------------------------------------------------------
describe('expirationForecast', () => {
  it('returns current time as expiration when weight is already below threshold', () => {
    // Very high decay rate so weight at currentTime is already tiny
    const violations: ViolationRecord[] = [
      { timestamp: 100, severity: 10 },
      { timestamp: 200, severity: 10 },
    ];
    const result = expirationForecast(1.0, 0, violations, 300, 0.1, 0.1);
    // Total damage = 10*0.1 + 10*0.1 = 2.0, which exceeds initialWeight 1.0
    expect(result.predictedExpirationTime).toBe(300);
    expect(result.remainingWeight).toBe(0);
    expect(result.confidence).toBe(1.0);
  });

  it('predicts a future expiration time with natural decay only', () => {
    const violations: ViolationRecord[] = [];
    const result = expirationForecast(1.0, 5.0, violations, 0, 0.1);
    expect(result.predictedExpirationTime).toBeGreaterThan(0);
    expect(result.remainingWeight).toBeCloseTo(1.0, 5);
  });

  it('violations reduce remaining weight', () => {
    const noViolations = expirationForecast(1.0, 0, [], 1000, 0.1, 0.05);
    const withViolations = expirationForecast(
      1.0, 0,
      [{ timestamp: 500, severity: 5 }],
      1000, 0.1, 0.05,
    );
    expect(withViolations.remainingWeight).toBeLessThan(noViolations.remainingWeight);
  });

  it('detects accelerating violation trend', () => {
    // Violations getting closer together
    const violations: ViolationRecord[] = [
      { timestamp: 100, severity: 1 },
      { timestamp: 200, severity: 1 },
      { timestamp: 250, severity: 1 },
      { timestamp: 270, severity: 1 },
      { timestamp: 280, severity: 1 },
    ];
    const result = expirationForecast(1.0, 0, violations, 300, 0.1, 0.01);
    expect(result.violationTrend).toBe('accelerating');
  });

  it('detects decelerating violation trend', () => {
    // Violations getting further apart
    const violations: ViolationRecord[] = [
      { timestamp: 100, severity: 1 },
      { timestamp: 110, severity: 1 },
      { timestamp: 120, severity: 1 },
      { timestamp: 200, severity: 1 },
      { timestamp: 400, severity: 1 },
    ];
    const result = expirationForecast(1.0, 0, violations, 500, 0.1, 0.01);
    expect(result.violationTrend).toBe('decelerating');
  });

  it('reports stable trend when violation intervals are consistent', () => {
    const violations: ViolationRecord[] = [
      { timestamp: 100, severity: 1 },
      { timestamp: 200, severity: 1 },
      { timestamp: 300, severity: 1 },
      { timestamp: 400, severity: 1 },
    ];
    const result = expirationForecast(1.0, 0, violations, 500, 0.1, 0.01);
    expect(result.violationTrend).toBe('stable');
  });

  it('confidence increases with more violation data', () => {
    const fewViolations: ViolationRecord[] = [
      { timestamp: 100, severity: 1 },
    ];
    const manyViolations: ViolationRecord[] = [
      { timestamp: 100, severity: 1 },
      { timestamp: 200, severity: 1 },
      { timestamp: 300, severity: 1 },
      { timestamp: 400, severity: 1 },
      { timestamp: 500, severity: 1 },
      { timestamp: 600, severity: 1 },
      { timestamp: 700, severity: 1 },
    ];
    const resultFew = expirationForecast(1.0, 0, fewViolations, 800, 0.1, 0.01);
    const resultMany = expirationForecast(1.0, 0, manyViolations, 800, 0.1, 0.01);
    expect(resultMany.confidence).toBeGreaterThan(resultFew.confidence);
  });

  it('throws on non-positive initialWeight', () => {
    expect(() => expirationForecast(0, 1.0, [], 1000)).toThrow('initialWeight must be positive');
  });

  it('throws on negative decayRate', () => {
    expect(() => expirationForecast(1.0, -1, [], 1000)).toThrow('decayRate must be non-negative');
  });

  it('throws on threshold >= initialWeight', () => {
    expect(() => expirationForecast(1.0, 0, [], 1000, 1.0)).toThrow('threshold must be in [0, initialWeight)');
    expect(() => expirationForecast(1.0, 0, [], 1000, 2.0)).toThrow('threshold must be in [0, initialWeight)');
  });

  it('throws on negative violationImpact', () => {
    expect(() => expirationForecast(1.0, 0, [], 1000, 0.1, -1)).toThrow('violationImpact must be non-negative');
  });

  it('more violations lead to earlier predicted expiration', () => {
    const fewViolations: ViolationRecord[] = [
      { timestamp: 100, severity: 2 },
    ];
    const manyViolations: ViolationRecord[] = [
      { timestamp: 100, severity: 2 },
      { timestamp: 200, severity: 2 },
      { timestamp: 300, severity: 2 },
      { timestamp: 400, severity: 2 },
    ];
    const resultFew = expirationForecast(1.0, 1.0, fewViolations, 500, 0.1, 0.05);
    const resultMany = expirationForecast(1.0, 1.0, manyViolations, 500, 0.1, 0.05);
    expect(resultMany.predictedExpirationTime).toBeLessThanOrEqual(resultFew.predictedExpirationTime);
  });

  it('remaining weight is never negative', () => {
    const violations: ViolationRecord[] = [
      { timestamp: 100, severity: 100 },
      { timestamp: 200, severity: 100 },
    ];
    const result = expirationForecast(1.0, 0, violations, 300, 0.1, 1.0);
    expect(result.remainingWeight).toBeGreaterThanOrEqual(0);
  });
});
