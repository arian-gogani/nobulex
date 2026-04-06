import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  deprecated,
  wrapDeprecated,
  resetDeprecationWarnings,
  getEmittedWarnings,
} from './deprecation';
import type { DeprecationWarning } from './deprecation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

afterEach(() => {
  warnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// deprecated()
// ---------------------------------------------------------------------------
describe('deprecated', () => {
  it('emits a warning to console.warn', () => {
    deprecated(sampleWarning);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('warning message includes the API name', () => {
    deprecated(sampleWarning);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('NobulexSDK.sign');
  });

  it('warning message includes the since version', () => {
    deprecated(sampleWarning);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('v0.2.0');
  });

  it('warning message includes the removeIn version', () => {
    deprecated(sampleWarning);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('v1.0.0');
  });

  it('warning message includes the alternative', () => {
    deprecated(sampleWarning);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('Use NobulexSDK.signCovenant() instead');
  });

  it('warning message starts with [DEPRECATED]', () => {
    deprecated(sampleWarning);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toMatch(/^\[DEPRECATED\]/);
  });

  it('only emits once per API', () => {
    deprecated(sampleWarning);
    deprecated(sampleWarning);
    deprecated(sampleWarning);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('emits separately for different APIs', () => {
    deprecated(sampleWarning);
    deprecated({
      api: 'NobulexSDK.verify',
      since: '0.3.0',
      removeIn: '1.0.0',
      alternative: 'Use NobulexSDK.verifyCovenant() instead',
    });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// wrapDeprecated()
// ---------------------------------------------------------------------------
describe('wrapDeprecated', () => {
  it('calls the original function and returns its result', () => {
    const fn = (a: number, b: number): number => a + b;
    const wrapped = wrapDeprecated(fn as (...args: unknown[]) => unknown, {
      api: 'add',
      since: '0.1.0',
      removeIn: '0.5.0',
      alternative: 'Use sum() instead',
    });
    const result = wrapped(2, 3);
    expect(result).toBe(5);
  });

  it('emits a deprecation warning on first call', () => {
    const fn = (): string => 'hello';
    const wrapped = wrapDeprecated(fn as (...args: unknown[]) => unknown, {
      api: 'greet',
      since: '0.1.0',
      removeIn: '0.5.0',
      alternative: 'Use sayHello() instead',
    });
    wrapped();
    expect(warnSpy).toHaveBeenCalledOnce();
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('greet');
  });

  it('only emits warning once even with multiple calls', () => {
    const fn = (): number => 42;
    const wrapped = wrapDeprecated(fn as (...args: unknown[]) => unknown, {
      api: 'getAnswer',
      since: '0.1.0',
      removeIn: '1.0.0',
      alternative: 'Use computeAnswer() instead',
    });
    wrapped();
    wrapped();
    wrapped();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('preserves the function behavior for each call', () => {
    let callCount = 0;
    const fn = (): number => ++callCount;
    const wrapped = wrapDeprecated(fn as (...args: unknown[]) => unknown, {
      api: 'counter',
      since: '0.1.0',
      removeIn: '0.5.0',
      alternative: 'Use increment() instead',
    });
    expect(wrapped()).toBe(1);
    expect(wrapped()).toBe(2);
    expect(wrapped()).toBe(3);
  });

  it('passes arguments through to the original function', () => {
    const fn = vi.fn((...args: unknown[]) => args);
    const wrapped = wrapDeprecated(fn, {
      api: 'echo',
      since: '0.1.0',
      removeIn: '0.5.0',
      alternative: 'Use mirror() instead',
    });
    wrapped('a', 'b', 'c');
    expect(fn).toHaveBeenCalledWith('a', 'b', 'c');
  });
});

// ---------------------------------------------------------------------------
// resetDeprecationWarnings()
// ---------------------------------------------------------------------------
describe('resetDeprecationWarnings', () => {
  it('clears the emitted set so warnings can fire again', () => {
    deprecated(sampleWarning);
    expect(warnSpy).toHaveBeenCalledOnce();
    resetDeprecationWarnings();
    deprecated(sampleWarning);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('clears the emitted messages list', () => {
    deprecated(sampleWarning);
    expect(getEmittedWarnings()).toHaveLength(1);
    resetDeprecationWarnings();
    expect(getEmittedWarnings()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getEmittedWarnings()
// ---------------------------------------------------------------------------
describe('getEmittedWarnings', () => {
  it('returns an empty array when no warnings have been emitted', () => {
    expect(getEmittedWarnings()).toEqual([]);
  });

  it('returns emitted warning messages', () => {
    deprecated(sampleWarning);
    const warnings = getEmittedWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('NobulexSDK.sign');
  });

  it('returns multiple warnings in order', () => {
    deprecated(sampleWarning);
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
  });

  it('returns a copy (modifying the array does not affect internal state)', () => {
    deprecated(sampleWarning);
    const warnings = getEmittedWarnings();
    warnings.push('injected');
    expect(getEmittedWarnings()).toHaveLength(1);
  });

  it('does not include duplicate warnings for repeated deprecated() calls', () => {
    deprecated(sampleWarning);
    deprecated(sampleWarning);
    deprecated(sampleWarning);
    expect(getEmittedWarnings()).toHaveLength(1);
  });
});
