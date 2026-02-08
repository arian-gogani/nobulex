import { describe, it, expect, vi } from 'vitest';
import {
  initiate,
  propose,
  counter,
  agree,
  evaluate,
  isExpired,
  fail,
} from './index.js';
import type { NegotiationSession, Proposal, NegotiationPolicy } from './types.js';

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
    // session already has 1 proposal, maxRounds is 1
    const cp = makeProposal('bob', ['deny:exfiltrate']);
    expect(() => counter(session, cp)).toThrow('Maximum rounds');
  });

  it('does not throw when within maxRounds', () => {
    const policy = makePolicy({ maxRounds: 3 });
    const session = initiate('alice', 'bob', policy);
    // 1 proposal so far, maxRounds is 3
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

  it('computes resultingConstraints as intersection of last two proposals', () => {
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
    // Even though required is present, dealbreaker should cause reject
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
    // Force session to be in the past
    const expired: NegotiationSession = {
      ...session,
      createdAt: Date.now() - 1000,
      timeoutMs: 1,
    };
    expect(isExpired(expired)).toBe(true);
  });

  it('handles zero timeout', () => {
    const session = initiate('alice', 'bob', makePolicy({ timeoutMs: 0 }));
    // With timeout 0, it should be expired immediately (or very close to it)
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

    // Alice initiates
    let session = initiate('alice', 'bob', alicePolicy);
    expect(session.status).toBe('proposing');

    // Bob counters
    const bobProposal = makeProposal('bob', [
      'deny:exfiltrate',
      'require:auth',
      'require:logging',
    ]);
    session = counter(session, bobProposal);
    expect(session.status).toBe('countering');

    // Alice agrees
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
  });

  it('multi-round negotiation with evaluation', () => {
    const alicePolicy = makePolicy({
      requiredConstraints: ['deny:exfiltrate', 'require:auth'],
      preferredConstraints: ['limit:cpu-50'],
      dealbreakers: ['permit:unrestricted-network'],
      maxRounds: 10,
      timeoutMs: 60000,
    });

    const bobPolicy = makePolicy({
      requiredConstraints: ['require:logging'],
      preferredConstraints: ['limit:memory-1gb'],
      dealbreakers: ['deny:all-network'],
      maxRounds: 10,
      timeoutMs: 60000,
    });

    let session = initiate('alice', 'bob', alicePolicy);

    // Bob evaluates Alice's initial proposal
    const aliceEval = evaluate(session.proposals[0]!, bobPolicy);
    // Alice's proposal has deny:exfiltrate, require:auth, limit:cpu-50
    // Bob requires 'require:logging' which is not present -> counter
    expect(aliceEval).toBe('counter');

    // Bob counters
    const bobCounter = makeProposal('bob', [
      'deny:exfiltrate',
      'require:auth',
      'require:logging',
      'limit:memory-1gb',
    ]);
    session = counter(session, bobCounter);

    // Alice evaluates Bob's counter
    const bobEvalResult = evaluate(bobCounter, alicePolicy);
    // Bob's proposal has deny:exfiltrate and require:auth -> all required present, no dealbreakers
    expect(bobEvalResult).toBe('accept');

    // Alice agrees
    session = agree(session);
    expect(session.status).toBe('agreed');
    expect(session.resultingConstraints).toContain('deny:exfiltrate');
    expect(session.resultingConstraints).toContain('require:auth');
  });

  it('negotiation fails when maxRounds exceeded', () => {
    const policy = makePolicy({ maxRounds: 2 });
    let session = initiate('alice', 'bob', policy);
    // 1 proposal now. maxRounds=2

    const cp1 = makeProposal('bob', ['deny:exfiltrate']);
    session = counter(session, cp1);
    // 2 proposals now, next counter should fail

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
