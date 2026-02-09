import { describe, it, expect, vi } from 'vitest';
import {
  initiate,
  propose,
  counter,
  agree,
  evaluate,
  isExpired,
  fail,
  roundCount,
  computeNashBargainingSolution,
  paretoFrontier,
} from './index.js';
import type {
  NegotiationSession,
  Proposal,
  NegotiationPolicy,
  UtilityFunction,
  Outcome,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicy(overrides?: Partial<NegotiationPolicy>): NegotiationPolicy {
  return {
    requiredConstraints: ['deny:exfiltrate', 'require:auth'],
    preferredConstraints: ['limit:cpu-50', 'require:logging'],
    dealbreakers: ['permit:unrestricted-network'],
    maxRounds: 5,
    timeoutMs: 60000,
    ...overrides,
  };
}

function makeProposal(
  from: string,
  constraints: string[],
  requirements: string[] = [],
): Proposal {
  return {
    from,
    constraints,
    requirements,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// initiate
// ---------------------------------------------------------------------------

describe('initiate', () => {
  it('creates a session with status proposing', () => {
    const session = initiate('alice', 'bob', makePolicy());
    expect(session.status).toBe('proposing');
  });

  it('sets the correct initiator and responder', () => {
    const session = initiate('alice', 'bob', makePolicy());
    expect(session.initiator).toBe('alice');
    expect(session.responder).toBe('bob');
  });

  it('generates a unique session ID', () => {
    const s1 = initiate('alice', 'bob', makePolicy());
    const s2 = initiate('alice', 'bob', makePolicy());
    expect(s1.id).not.toBe(s2.id);
  });

  it('includes an initial proposal from the initiator', () => {
    const policy = makePolicy();
    const session = initiate('alice', 'bob', policy);
    expect(session.proposals).toHaveLength(1);
    expect(session.proposals[0]!.from).toBe('alice');
  });

  it('initial proposal includes required + preferred constraints', () => {
    const policy = makePolicy({
      requiredConstraints: ['deny:exfiltrate'],
      preferredConstraints: ['limit:cpu'],
    });
    const session = initiate('alice', 'bob', policy);
    expect(session.proposals[0]!.constraints).toContain('deny:exfiltrate');
    expect(session.proposals[0]!.constraints).toContain('limit:cpu');
  });

  it('sets maxRounds from the policy', () => {
    const policy = makePolicy({ maxRounds: 10 });
    const session = initiate('alice', 'bob', policy);
    expect(session.maxRounds).toBe(10);
  });

  it('sets timeoutMs from the policy', () => {
    const policy = makePolicy({ timeoutMs: 30000 });
    const session = initiate('alice', 'bob', policy);
    expect(session.timeoutMs).toBe(30000);
  });

  it('does not have resultingConstraints initially', () => {
    const session = initiate('alice', 'bob', makePolicy());
    expect(session.resultingConstraints).toBeUndefined();
  });

  it('throws on empty initiatorId', () => {
    expect(() => initiate('', 'bob', makePolicy())).toThrow('initiatorId must be a non-empty string');
  });

  it('throws on empty responderId', () => {
    expect(() => initiate('alice', '', makePolicy())).toThrow('responderId must be a non-empty string');
  });

  it('throws on invalid maxRounds', () => {
    expect(() => initiate('alice', 'bob', makePolicy({ maxRounds: 0 }))).toThrow('maxRounds must be at least 1');
  });

  it('throws on negative timeoutMs', () => {
    expect(() => initiate('alice', 'bob', makePolicy({ timeoutMs: -1 }))).toThrow('timeoutMs must be non-negative');
  });
});

// ---------------------------------------------------------------------------
// propose
// ---------------------------------------------------------------------------

describe('propose', () => {
  it('adds a proposal to the session', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const proposal = makeProposal('bob', ['deny:exfiltrate', 'require:auth']);
    const updated = propose(session, proposal);
    expect(updated.proposals).toHaveLength(2);
    expect(updated.proposals[1]!.from).toBe('bob');
  });

  it('does not mutate the original session', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const proposal = makeProposal('bob', ['deny:exfiltrate']);
    propose(session, proposal);
    expect(session.proposals).toHaveLength(1);
  });

  it('preserves existing proposals', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const proposal = makeProposal('bob', ['deny:exfiltrate']);
    const updated = propose(session, proposal);
    expect(updated.proposals[0]!.from).toBe('alice');
  });

  it('throws on proposal with empty from field', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const proposal: Proposal = { from: '', constraints: ['deny:x'], requirements: [], timestamp: Date.now() };
    expect(() => propose(session, proposal)).toThrow('Proposal must have a non-empty "from" field');
  });

  it('throws when session is already agreed', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const agreed = agree(session);
    const proposal = makeProposal('bob', ['deny:x']);
    expect(() => propose(agreed, proposal)).toThrow('Cannot modify an agreed session');
  });

  it('throws when session is already failed', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const failed = fail(session, 'test');
    const proposal = makeProposal('bob', ['deny:x']);
    expect(() => propose(failed, proposal)).toThrow('Cannot modify a failed session');
  });
});

// ---------------------------------------------------------------------------
// counter
// ---------------------------------------------------------------------------

describe('counter', () => {
  it('sets status to countering', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const cp = makeProposal('bob', ['deny:exfiltrate', 'require:auth']);
    const updated = counter(session, cp);
    expect(updated.status).toBe('countering');
  });

  it('adds the counter-proposal to proposals', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const cp = makeProposal('bob', ['deny:exfiltrate']);
    const updated = counter(session, cp);
    expect(updated.proposals).toHaveLength(2);
  });

  it('throws when maxRounds is exceeded', () => {
    const policy = makePolicy({ maxRounds: 1 });
    const session = initiate('alice', 'bob', policy);
    const cp = makeProposal('bob', ['deny:exfiltrate']);
    expect(() => counter(session, cp)).toThrow('Maximum rounds');
  });

  it('does not throw when within maxRounds', () => {
    const policy = makePolicy({ maxRounds: 3 });
    const session = initiate('alice', 'bob', policy);
    const cp = makeProposal('bob', ['deny:exfiltrate']);
    expect(() => counter(session, cp)).not.toThrow();
  });

  it('does not mutate the original session', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const cp = makeProposal('bob', ['deny:exfiltrate']);
    counter(session, cp);
    expect(session.status).toBe('proposing');
    expect(session.proposals).toHaveLength(1);
  });

  it('throws when session is already agreed', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const agreed = agree(session);
    const cp = makeProposal('bob', ['deny:x']);
    expect(() => counter(agreed, cp)).toThrow('Cannot modify an agreed session');
  });
});

// ---------------------------------------------------------------------------
// agree
// ---------------------------------------------------------------------------

describe('agree', () => {
  it('sets status to agreed', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const proposal = makeProposal('bob', ['deny:exfiltrate', 'require:auth']);
    const withProposal = propose(session, proposal);
    const agreed = agree(withProposal);
    expect(agreed.status).toBe('agreed');
  });

  it('includes all deny constraints from both proposals (deny-wins)', () => {
    const session = initiate('alice', 'bob', makePolicy({
      requiredConstraints: ['deny:exfiltrate'],
      preferredConstraints: ['deny:write-secrets'],
    }));
    const counterProposal = makeProposal('bob', [
      'deny:exfiltrate',
      'deny:network-call',
      'require:auth',
    ]);
    const withCounter = propose(session, counterProposal);
    const agreed = agree(withCounter);
    // All deny constraints from both sides should be included
    expect(agreed.resultingConstraints).toContain('deny:exfiltrate');
    expect(agreed.resultingConstraints).toContain('deny:write-secrets');
    expect(agreed.resultingConstraints).toContain('deny:network-call');
  });

  it('intersects non-deny constraints', () => {
    const session = initiate('alice', 'bob', makePolicy({
      requiredConstraints: ['deny:exfiltrate', 'require:auth'],
      preferredConstraints: ['limit:cpu'],
    }));
    const counterProposal = makeProposal('bob', [
      'deny:exfiltrate',
      'require:auth',
      'require:logging',
    ]);
    const withCounter = propose(session, counterProposal);
    const agreed = agree(withCounter);
    expect(agreed.resultingConstraints).toContain('deny:exfiltrate');
    expect(agreed.resultingConstraints).toContain('require:auth');
    expect(agreed.resultingConstraints).not.toContain('limit:cpu');
    expect(agreed.resultingConstraints).not.toContain('require:logging');
  });

  it('handles single proposal by using all its constraints', () => {
    const session = initiate('alice', 'bob', makePolicy({
      requiredConstraints: ['deny:exfiltrate'],
      preferredConstraints: [],
    }));
    const agreed = agree(session);
    expect(agreed.resultingConstraints).toEqual(['deny:exfiltrate']);
  });

  it('does not mutate the original session', () => {
    const session = initiate('alice', 'bob', makePolicy());
    agree(session);
    expect(session.status).toBe('proposing');
    expect(session.resultingConstraints).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// evaluate
// ---------------------------------------------------------------------------

describe('evaluate', () => {
  it('returns accept when all required constraints present and no dealbreakers', () => {
    const policy = makePolicy({
      requiredConstraints: ['deny:exfiltrate', 'require:auth'],
      dealbreakers: ['permit:unrestricted'],
    });
    const proposal = makeProposal('bob', [
      'deny:exfiltrate',
      'require:auth',
      'limit:cpu',
    ]);
    expect(evaluate(proposal, policy)).toBe('accept');
  });

  it('returns reject when dealbreakers are present', () => {
    const policy = makePolicy({
      requiredConstraints: ['deny:exfiltrate'],
      dealbreakers: ['permit:unrestricted'],
    });
    const proposal = makeProposal('bob', [
      'deny:exfiltrate',
      'permit:unrestricted',
    ]);
    expect(evaluate(proposal, policy)).toBe('reject');
  });

  it('returns counter when required constraints are missing but no dealbreakers', () => {
    const policy = makePolicy({
      requiredConstraints: ['deny:exfiltrate', 'require:auth'],
      dealbreakers: ['permit:unrestricted'],
    });
    const proposal = makeProposal('bob', ['deny:exfiltrate']);
    expect(evaluate(proposal, policy)).toBe('counter');
  });

  it('dealbreakers take priority over required constraints being present', () => {
    const policy = makePolicy({
      requiredConstraints: ['deny:exfiltrate'],
      dealbreakers: ['permit:unrestricted'],
    });
    const proposal = makeProposal('bob', [
      'deny:exfiltrate',
      'permit:unrestricted',
    ]);
    expect(evaluate(proposal, policy)).toBe('reject');
  });

  it('returns accept when no required constraints and no dealbreakers', () => {
    const policy = makePolicy({
      requiredConstraints: [],
      dealbreakers: [],
    });
    const proposal = makeProposal('bob', ['limit:cpu']);
    expect(evaluate(proposal, policy)).toBe('accept');
  });

  it('returns accept when empty proposal matches empty requirements', () => {
    const policy = makePolicy({
      requiredConstraints: [],
      dealbreakers: [],
    });
    const proposal = makeProposal('bob', []);
    expect(evaluate(proposal, policy)).toBe('accept');
  });
});

// ---------------------------------------------------------------------------
// isExpired
// ---------------------------------------------------------------------------

describe('isExpired', () => {
  it('returns false for a fresh session', () => {
    const session = initiate('alice', 'bob', makePolicy({ timeoutMs: 60000 }));
    expect(isExpired(session)).toBe(false);
  });

  it('returns true for an expired session', () => {
    const session = initiate('alice', 'bob', makePolicy({ timeoutMs: 1 }));
    const expired: NegotiationSession = {
      ...session,
      createdAt: Date.now() - 1000,
      timeoutMs: 1,
    };
    expect(isExpired(expired)).toBe(true);
  });

  it('handles zero timeout', () => {
    const session = initiate('alice', 'bob', makePolicy({ timeoutMs: 0 }));
    const expired: NegotiationSession = {
      ...session,
      createdAt: Date.now() - 1,
      timeoutMs: 0,
    };
    expect(isExpired(expired)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fail
// ---------------------------------------------------------------------------

describe('fail', () => {
  it('sets status to failed', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const failed = fail(session);
    expect(failed.status).toBe('failed');
  });

  it('stores the failure reason', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const failed = fail(session, 'dealbreaker detected');
    expect(failed.failureReason).toBe('dealbreaker detected');
  });

  it('failureReason is undefined when no reason provided', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const failed = fail(session);
    expect(failed.failureReason).toBeUndefined();
  });

  it('does not mutate the original session', () => {
    const session = initiate('alice', 'bob', makePolicy());
    fail(session);
    expect(session.status).toBe('proposing');
  });

  it('preserves all other fields', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const failed = fail(session, 'timeout');
    expect(failed.id).toBe(session.id);
    expect(failed.initiator).toBe(session.initiator);
    expect(failed.responder).toBe(session.responder);
    expect(failed.proposals).toEqual(session.proposals);
    expect(failed.timeoutMs).toBe(session.timeoutMs);
  });
});

// ---------------------------------------------------------------------------
// roundCount
// ---------------------------------------------------------------------------

describe('roundCount', () => {
  it('returns 1 for a fresh session', () => {
    const session = initiate('alice', 'bob', makePolicy());
    expect(roundCount(session)).toBe(1);
  });

  it('returns 2 after one counter', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const cp = makeProposal('bob', ['deny:exfiltrate']);
    const updated = counter(session, cp);
    expect(roundCount(updated)).toBe(2);
  });

  it('returns correct count after multiple rounds', () => {
    const policy = makePolicy({ maxRounds: 10 });
    let session = initiate('alice', 'bob', policy);
    session = counter(session, makeProposal('bob', ['deny:a']));
    session = counter(session, makeProposal('alice', ['deny:b']));
    session = counter(session, makeProposal('bob', ['deny:c']));
    expect(roundCount(session)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Full negotiation flow tests
// ---------------------------------------------------------------------------

describe('full negotiation flow', () => {
  it('successful negotiation: initiate -> counter -> agree', () => {
    const alicePolicy = makePolicy({
      requiredConstraints: ['deny:exfiltrate', 'require:auth'],
      preferredConstraints: ['limit:cpu-50'],
      dealbreakers: ['permit:unrestricted-network'],
      maxRounds: 5,
      timeoutMs: 60000,
    });

    let session = initiate('alice', 'bob', alicePolicy);
    expect(session.status).toBe('proposing');

    const bobProposal = makeProposal('bob', [
      'deny:exfiltrate',
      'require:auth',
      'require:logging',
    ]);
    session = counter(session, bobProposal);
    expect(session.status).toBe('countering');

    session = agree(session);
    expect(session.status).toBe('agreed');
    expect(session.resultingConstraints).toContain('deny:exfiltrate');
    expect(session.resultingConstraints).toContain('require:auth');
  });

  it('failed negotiation: dealbreaker causes rejection', () => {
    const alicePolicy = makePolicy({
      requiredConstraints: ['deny:exfiltrate'],
      dealbreakers: ['permit:unrestricted-network'],
    });

    const session = initiate('alice', 'bob', alicePolicy);
    const bobProposal = makeProposal('bob', [
      'deny:exfiltrate',
      'permit:unrestricted-network',
    ]);

    const decision = evaluate(bobProposal, alicePolicy);
    expect(decision).toBe('reject');

    const failed = fail(session, 'dealbreaker detected');
    expect(failed.status).toBe('failed');
    expect(failed.failureReason).toBe('dealbreaker detected');
  });

  it('negotiation fails when maxRounds exceeded', () => {
    const policy = makePolicy({ maxRounds: 2 });
    let session = initiate('alice', 'bob', policy);

    const cp1 = makeProposal('bob', ['deny:exfiltrate']);
    session = counter(session, cp1);

    const cp2 = makeProposal('alice', ['deny:exfiltrate', 'require:auth']);
    expect(() => counter(session, cp2)).toThrow('Maximum rounds');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('agree with empty proposals returns empty resultingConstraints', () => {
    const session: NegotiationSession = {
      id: 'test-session',
      initiator: 'alice',
      responder: 'bob',
      status: 'proposing',
      proposals: [],
      timeoutMs: 60000,
      createdAt: Date.now(),
      maxRounds: 5,
    };
    const agreed = agree(session);
    expect(agreed.resultingConstraints).toEqual([]);
  });

  it('propose does not change session status', () => {
    const session = initiate('alice', 'bob', makePolicy());
    const proposal = makeProposal('bob', ['deny:x']);
    const updated = propose(session, proposal);
    expect(updated.status).toBe('proposing');
  });

  it('multiple counters alternate correctly', () => {
    const policy = makePolicy({ maxRounds: 10 });
    let session = initiate('alice', 'bob', policy);

    session = counter(session, makeProposal('bob', ['deny:a']));
    expect(session.proposals).toHaveLength(2);

    session = counter(session, makeProposal('alice', ['deny:b']));
    expect(session.proposals).toHaveLength(3);

    session = counter(session, makeProposal('bob', ['deny:c']));
    expect(session.proposals).toHaveLength(4);
  });

  it('evaluate handles proposal with empty constraints', () => {
    const policy = makePolicy({
      requiredConstraints: ['deny:exfiltrate'],
      dealbreakers: [],
    });
    const emptyProposal = makeProposal('bob', []);
    expect(evaluate(emptyProposal, policy)).toBe('counter');
  });

  it('evaluate handles policy with empty dealbreakers', () => {
    const policy = makePolicy({
      requiredConstraints: ['deny:exfiltrate'],
      dealbreakers: [],
    });
    const proposal = makeProposal('bob', ['deny:exfiltrate']);
    expect(evaluate(proposal, policy)).toBe('accept');
  });
});

// ---------------------------------------------------------------------------
// computeNashBargainingSolution
// ---------------------------------------------------------------------------
describe('computeNashBargainingSolution', () => {
  function makeUtility(
    partyId: string,
    evalFn: (outcome: Outcome) => number,
    disagreementValue: number,
  ): UtilityFunction {
    return { partyId, evaluate: evalFn, disagreementValue };
  }

  it('returns null for empty outcomes', () => {
    const uA = makeUtility('A', () => 1, 0);
    const uB = makeUtility('B', () => 1, 0);
    const result = computeNashBargainingSolution([], uA, uB);
    expect(result).toBeNull();
  });

  it('returns the single outcome when only one is individually rational', () => {
    const outcomes: Outcome[] = [
      { constraints: ['c1'] },
    ];
    const uA = makeUtility('A', () => 5, 0);
    const uB = makeUtility('B', () => 3, 0);
    const result = computeNashBargainingSolution(outcomes, uA, uB);
    expect(result).not.toBeNull();
    expect(result!.utilityA).toBe(5);
    expect(result!.utilityB).toBe(3);
    expect(result!.nashProduct).toBe(15);
  });

  it('selects outcome that maximizes Nash product', () => {
    const outcomes: Outcome[] = [
      { constraints: ['c1'], id: 'o1' },
      { constraints: ['c2'], id: 'o2' },
      { constraints: ['c3'], id: 'o3' },
    ];
    const uA = makeUtility('A', (o) => {
      if (o.id === 'o1') return 8;
      if (o.id === 'o2') return 5;
      return 3;
    }, 0);
    const uB = makeUtility('B', (o) => {
      if (o.id === 'o1') return 2;
      if (o.id === 'o2') return 6;
      return 7;
    }, 0);
    const result = computeNashBargainingSolution(outcomes, uA, uB);
    // o1: 8*2=16, o2: 5*6=30, o3: 3*7=21
    expect(result).not.toBeNull();
    expect(result!.outcome.id).toBe('o2');
    expect(result!.nashProduct).toBe(30);
  });

  it('respects disagreement values', () => {
    const outcomes: Outcome[] = [
      { constraints: ['c1'], id: 'o1' },
      { constraints: ['c2'], id: 'o2' },
    ];
    const uA = makeUtility('A', (o) => o.id === 'o1' ? 10 : 6, 4);
    const uB = makeUtility('B', (o) => o.id === 'o1' ? 3 : 8, 2);
    const result = computeNashBargainingSolution(outcomes, uA, uB);
    // o1: (10-4)*(3-2) = 6*1 = 6
    // o2: (6-4)*(8-2) = 2*6 = 12
    expect(result).not.toBeNull();
    expect(result!.outcome.id).toBe('o2');
    expect(result!.nashProduct).toBe(12);
  });

  it('excludes outcomes where party A gets less than disagreement value', () => {
    const outcomes: Outcome[] = [
      { constraints: ['c1'], id: 'o1' },
      { constraints: ['c2'], id: 'o2' },
    ];
    const uA = makeUtility('A', (o) => o.id === 'o1' ? 1 : 5, 3);
    const uB = makeUtility('B', (o) => o.id === 'o1' ? 10 : 4, 0);
    const result = computeNashBargainingSolution(outcomes, uA, uB);
    // o1: A gets 1 < 3 (disagreement) -> excluded
    // o2: (5-3)*(4-0) = 2*4 = 8
    expect(result).not.toBeNull();
    expect(result!.outcome.id).toBe('o2');
  });

  it('excludes outcomes where party B gets less than disagreement value', () => {
    const outcomes: Outcome[] = [
      { constraints: ['c1'], id: 'o1' },
    ];
    const uA = makeUtility('A', () => 10, 0);
    const uB = makeUtility('B', () => 1, 5);
    const result = computeNashBargainingSolution(outcomes, uA, uB);
    // B gets 1 < 5 -> excluded
    expect(result).toBeNull();
  });

  it('returns null when no outcome is individually rational', () => {
    const outcomes: Outcome[] = [
      { constraints: ['c1'], id: 'o1' },
      { constraints: ['c2'], id: 'o2' },
    ];
    const uA = makeUtility('A', () => 1, 5);
    const uB = makeUtility('B', () => 1, 5);
    const result = computeNashBargainingSolution(outcomes, uA, uB);
    expect(result).toBeNull();
  });

  it('handles zero surplus correctly (product is zero)', () => {
    const outcomes: Outcome[] = [
      { constraints: ['c1'], id: 'o1' },
      { constraints: ['c2'], id: 'o2' },
    ];
    const uA = makeUtility('A', (o) => o.id === 'o1' ? 5 : 5, 5);
    const uB = makeUtility('B', (o) => o.id === 'o1' ? 3 : 10, 0);
    const result = computeNashBargainingSolution(outcomes, uA, uB);
    // o1: (5-5)*(3-0) = 0, o2: (5-5)*(10-0) = 0
    expect(result).not.toBeNull();
    expect(result!.nashProduct).toBe(0);
  });

  it('returns correct utility values for the selected outcome', () => {
    const outcomes: Outcome[] = [
      { constraints: ['c1'] },
    ];
    const uA = makeUtility('A', () => 7, 2);
    const uB = makeUtility('B', () => 9, 3);
    const result = computeNashBargainingSolution(outcomes, uA, uB);
    expect(result!.utilityA).toBe(7);
    expect(result!.utilityB).toBe(9);
    expect(result!.nashProduct).toBe((7 - 2) * (9 - 3));
  });

  it('handles many outcomes efficiently', () => {
    const outcomes: Outcome[] = Array.from({ length: 100 }, (_, i) => ({
      constraints: [`c${i}`],
      id: `o${i}`,
    }));
    const uA = makeUtility('A', (o) => {
      const idx = parseInt(o.id!.slice(1));
      return 100 - idx;
    }, 0);
    const uB = makeUtility('B', (o) => {
      const idx = parseInt(o.id!.slice(1));
      return idx;
    }, 0);
    const result = computeNashBargainingSolution(outcomes, uA, uB);
    expect(result).not.toBeNull();
    // Nash product maximized around where both utilities are balanced
    expect(result!.nashProduct).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// paretoFrontier
// ---------------------------------------------------------------------------
describe('paretoFrontier', () => {
  function makeUtility(
    partyId: string,
    evalFn: (outcome: Outcome) => number,
  ): UtilityFunction {
    return { partyId, evaluate: evalFn, disagreementValue: 0 };
  }

  it('returns empty for empty outcomes', () => {
    const uA = makeUtility('A', () => 1);
    const result = paretoFrontier([], [uA]);
    expect(result).toEqual([]);
  });

  it('returns empty for empty utility functions', () => {
    const outcomes: Outcome[] = [{ constraints: ['c1'] }];
    const result = paretoFrontier(outcomes, []);
    expect(result).toEqual([]);
  });

  it('single outcome is always Pareto-optimal', () => {
    const outcomes: Outcome[] = [{ constraints: ['c1'] }];
    const uA = makeUtility('A', () => 5);
    const uB = makeUtility('B', () => 3);
    const result = paretoFrontier(outcomes, [uA, uB]);
    expect(result).toHaveLength(1);
    expect(result[0]!.dominated).toBe(false);
    expect(result[0]!.utilities).toEqual([5, 3]);
  });

  it('marks dominated outcomes correctly', () => {
    const outcomes: Outcome[] = [
      { constraints: ['c1'], id: 'o1' },
      { constraints: ['c2'], id: 'o2' },
    ];
    const uA = makeUtility('A', (o) => o.id === 'o1' ? 5 : 3);
    const uB = makeUtility('B', (o) => o.id === 'o1' ? 5 : 3);
    const result = paretoFrontier(outcomes, [uA, uB]);
    const o1 = result.find(r => r.outcome.id === 'o1')!;
    const o2 = result.find(r => r.outcome.id === 'o2')!;
    expect(o1.dominated).toBe(false);
    expect(o2.dominated).toBe(true);
  });

  it('identifies trade-offs as non-dominated (Pareto frontier)', () => {
    const outcomes: Outcome[] = [
      { constraints: ['c1'], id: 'o1' },
      { constraints: ['c2'], id: 'o2' },
    ];
    // o1 is better for A, o2 is better for B => neither dominates
    const uA = makeUtility('A', (o) => o.id === 'o1' ? 8 : 3);
    const uB = makeUtility('B', (o) => o.id === 'o1' ? 2 : 9);
    const result = paretoFrontier(outcomes, [uA, uB]);
    expect(result.every(r => !r.dominated)).toBe(true);
  });

  it('correctly handles three outcomes with mixed dominance', () => {
    const outcomes: Outcome[] = [
      { constraints: ['c1'], id: 'o1' },
      { constraints: ['c2'], id: 'o2' },
      { constraints: ['c3'], id: 'o3' },
    ];
    // o1: (10, 1) -- best for A
    // o2: (5, 5)  -- moderate for both
    // o3: (1, 10) -- best for B
    // None dominates another since there are trade-offs
    const uA = makeUtility('A', (o) => {
      if (o.id === 'o1') return 10;
      if (o.id === 'o2') return 5;
      return 1;
    });
    const uB = makeUtility('B', (o) => {
      if (o.id === 'o1') return 1;
      if (o.id === 'o2') return 5;
      return 10;
    });
    const result = paretoFrontier(outcomes, [uA, uB]);
    const frontier = result.filter(r => !r.dominated);
    expect(frontier).toHaveLength(3);
  });

  it('correctly identifies dominated outcome among three', () => {
    const outcomes: Outcome[] = [
      { constraints: ['c1'], id: 'o1' },
      { constraints: ['c2'], id: 'o2' },
      { constraints: ['c3'], id: 'o3' },
    ];
    // o1: (10, 5), o2: (3, 3), o3: (5, 10)
    // o2 is dominated by o1 (10>3, 5>3)
    const uA = makeUtility('A', (o) => {
      if (o.id === 'o1') return 10;
      if (o.id === 'o2') return 3;
      return 5;
    });
    const uB = makeUtility('B', (o) => {
      if (o.id === 'o1') return 5;
      if (o.id === 'o2') return 3;
      return 10;
    });
    const result = paretoFrontier(outcomes, [uA, uB]);
    const o2 = result.find(r => r.outcome.id === 'o2')!;
    expect(o2.dominated).toBe(true);
    const frontier = result.filter(r => !r.dominated);
    expect(frontier).toHaveLength(2);
  });

  it('handles equal utilities (no strict domination)', () => {
    const outcomes: Outcome[] = [
      { constraints: ['c1'], id: 'o1' },
      { constraints: ['c2'], id: 'o2' },
    ];
    const uA = makeUtility('A', () => 5);
    const uB = makeUtility('B', () => 5);
    const result = paretoFrontier(outcomes, [uA, uB]);
    // Neither dominates the other (need strictly better in at least one)
    expect(result.every(r => !r.dominated)).toBe(true);
  });

  it('utilities array has correct length', () => {
    const outcomes: Outcome[] = [{ constraints: ['c1'] }];
    const uA = makeUtility('A', () => 1);
    const uB = makeUtility('B', () => 2);
    const uC = makeUtility('C', () => 3);
    const result = paretoFrontier(outcomes, [uA, uB, uC]);
    expect(result[0]!.utilities).toEqual([1, 2, 3]);
  });

  it('works with three-party utility functions', () => {
    const outcomes: Outcome[] = [
      { constraints: ['c1'], id: 'o1' },
      { constraints: ['c2'], id: 'o2' },
    ];
    const uA = makeUtility('A', (o) => o.id === 'o1' ? 10 : 1);
    const uB = makeUtility('B', (o) => o.id === 'o1' ? 1 : 10);
    const uC = makeUtility('C', (o) => o.id === 'o1' ? 5 : 5);
    const result = paretoFrontier(outcomes, [uA, uB, uC]);
    // o1: (10,1,5), o2: (1,10,5) -- neither dominates
    expect(result.every(r => !r.dominated)).toBe(true);
  });

  it('preserves the outcome reference in result', () => {
    const outcome: Outcome = { constraints: ['c1', 'c2'] };
    const uA = makeUtility('A', () => 5);
    const result = paretoFrontier([outcome], [uA]);
    expect(result[0]!.outcome).toBe(outcome);
  });
});
