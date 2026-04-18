import { describe, it, expect } from 'vitest';
import {
  ActionLogBuilder,
  computeOutcomeHash,
  computeFailureHash,
  verifyIntegrity,
  computeEntryHash,
} from './index';

describe('outcome hash', () => {
  it('is stored on an entry when provided', () => {
    const b = new ActionLogBuilder('did:nobulex:agent');
    const hash = computeOutcomeHash({ balance: 100 });
    const entry = b.append({
      action: 'read',
      resource: '/account',
      params: {},
      outcome: 'success',
      outcomeHash: hash,
    });
    expect(entry.outcomeHash).toBe(hash);
  });

  it('deterministic for equivalent values', () => {
    expect(computeOutcomeHash({ a: 1, b: 2 })).toBe(computeOutcomeHash({ b: 2, a: 1 }));
    expect(computeOutcomeHash('hello')).toBe(computeOutcomeHash('hello'));
  });

  it('different values produce different hashes', () => {
    expect(computeOutcomeHash({ n: 1 })).not.toBe(computeOutcomeHash({ n: 2 }));
  });

  it('is covered by the entry hash (tampering breaks integrity)', () => {
    const b = new ActionLogBuilder('did:nobulex:agent');
    b.append({
      action: 'read',
      resource: '/a',
      params: {},
      outcome: 'success',
      outcomeHash: computeOutcomeHash({ answer: 42 }),
    });
    const log = b.toLog();
    expect(verifyIntegrity(log).valid).toBe(true);

    // Mutate the outcome hash; chain should no longer verify.
    const tampered = {
      ...log,
      entries: log.entries.map((e, i) =>
        i === 0 ? { ...e, outcomeHash: computeOutcomeHash({ answer: 0 }) } : e,
      ),
    };
    expect(verifyIntegrity(tampered).valid).toBe(false);
  });

  it('entries without outcomeHash still verify (backwards compatible)', () => {
    const b = new ActionLogBuilder('did:nobulex:agent');
    b.append({ action: 'noop', resource: '*', params: {}, outcome: 'blocked' });
    b.append({ action: 'noop', resource: '*', params: {}, outcome: 'halted' });
    expect(verifyIntegrity(b.toLog()).valid).toBe(true);
  });

  it('failure hash distinguishes error messages', () => {
    const h1 = computeFailureHash('timeout');
    const h2 = computeFailureHash('permission denied');
    expect(h1).not.toBe(h2);
  });

  it('computeEntryHash is stable when outcomeHash is undefined vs absent', () => {
    const base = {
      index: 0,
      timestamp: '2025-01-01T00:00:00.000Z',
      agentDid: 'did:x',
      action: 'a',
      resource: '*',
      params: {},
      outcome: 'success' as const,
      previousHash: null,
    };
    expect(computeEntryHash(base)).toBe(computeEntryHash({ ...base, outcomeHash: undefined }));
  });
});
