import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  deprecated,
  wrapDeprecated,
  resetDeprecationWarnings,
  getEmittedWarnings,
} from './deprecation';
import type { DeprecationWarning } from './deprecation';

const sampleWarning: DeprecationWarning = {
  api: 'NobulexSDK.sign',
  since: '0.2.0',
  removeIn: '1.0.0',
  alternative: 'Use NobulexSDK.signCovenant() instead',
};

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetDeprecationWarnings();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

describe('deprecated', () => {
  it('emits one [DEPRECATED] console.warn containing api, since, removeIn, and alternative', () => {
    deprecated(sampleWarning);
    expect(warnSpy).toHaveBeenCalledOnce();
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toMatch(/^\[DEPRECATED\]/);
    expect(msg).toContain('NobulexSDK.sign');
    expect(msg).toContain('v0.2.0');
    expect(msg).toContain('v1.0.0');
    expect(msg).toContain('Use NobulexSDK.signCovenant() instead');
  });

  it('dedupes per API, but fires separately for distinct APIs', () => {
    deprecated(sampleWarning);
    deprecated(sampleWarning);
    deprecated(sampleWarning);
    expect(warnSpy).toHaveBeenCalledOnce();

    deprecated({
      api: 'NobulexSDK.verify',
      since: '0.3.0',
      removeIn: '1.0.0',
      alternative: 'Use NobulexSDK.verifyCovenant() instead',
    });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});

describe('wrapDeprecated', () => {
  it('passes args through, returns the wrapped result, and emits the warning only once', () => {
    const fn = vi.fn((a: number, b: number) => a + b);
    const wrapped = wrapDeprecated(fn as (...args: unknown[]) => unknown, {
      api: 'add',
      since: '0.1.0',
      removeIn: '0.5.0',
      alternative: 'Use sum() instead',
    });
    expect(wrapped(2, 3)).toBe(5);
    expect(wrapped(1, 1)).toBe(2);
    expect(wrapped(0, 0)).toBe(0);
    expect(fn).toHaveBeenCalledWith(2, 3);
    expect(fn).toHaveBeenCalledWith(1, 1);
    expect(warnSpy).toHaveBeenCalledOnce();
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('add');
  });
});

describe('resetDeprecationWarnings / getEmittedWarnings', () => {
  it('getEmittedWarnings starts empty, accumulates unique warnings in order, returns a copy', () => {
    expect(getEmittedWarnings()).toEqual([]);

    deprecated(sampleWarning);
    deprecated(sampleWarning); // dedup
    deprecated({
      api: 'NobulexSDK.verify',
      since: '0.3.0',
      removeIn: '1.0.0',
      alternative: 'Use verifyCovenant() instead',
    });
    const warnings = getEmittedWarnings();
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('NobulexSDK.sign');
    expect(warnings[1]).toContain('NobulexSDK.verify');

    // Mutation of returned array does not affect internal state
    warnings.push('injected');
    expect(getEmittedWarnings()).toHaveLength(2);
  });

  it('reset clears the emitted set (warnings can fire again) and the history list', () => {
    deprecated(sampleWarning);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(getEmittedWarnings()).toHaveLength(1);

    resetDeprecationWarnings();
    expect(getEmittedWarnings()).toHaveLength(0);
    deprecated(sampleWarning);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
