import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isDebugEnabled, createDebugLogger } from './debug';

let originalDebug: string | undefined;

beforeEach(() => {
  originalDebug = process.env.DEBUG;
});
afterEach(() => {
  if (originalDebug === undefined) delete process.env.DEBUG;
  else process.env.DEBUG = originalDebug;
});

describe('isDebugEnabled', () => {
  it('returns false when DEBUG is unset/empty', () => {
    delete process.env.DEBUG;
    expect(isDebugEnabled()).toBe(false);
    expect(isDebugEnabled('nobulex:crypto')).toBe(false);
    process.env.DEBUG = '';
    expect(isDebugEnabled('nobulex:crypto')).toBe(false);
  });

  it('supports wildcards (nobulex, nobulex:*, *) and exact matches', () => {
    process.env.DEBUG = 'nobulex';
    expect(isDebugEnabled('nobulex:crypto')).toBe(true);
    expect(isDebugEnabled('nobulex:ccl')).toBe(true);
    expect(isDebugEnabled('express:router')).toBe(false);

    process.env.DEBUG = 'nobulex:*';
    expect(isDebugEnabled('nobulex:crypto')).toBe(true);
    expect(isDebugEnabled('nobulex:store')).toBe(true);

    process.env.DEBUG = '*';
    expect(isDebugEnabled('nobulex:crypto')).toBe(true);
    expect(isDebugEnabled('anything')).toBe(true);

    process.env.DEBUG = 'nobulex:crypto';
    expect(isDebugEnabled('nobulex:crypto')).toBe(true);
    expect(isDebugEnabled('nobulex:ccl')).toBe(false);
  });

  it('supports comma-separated patterns (with whitespace) and sub-namespace wildcards', () => {
    process.env.DEBUG = 'nobulex:crypto, nobulex:ccl';
    expect(isDebugEnabled('nobulex:crypto')).toBe(true);
    expect(isDebugEnabled('nobulex:ccl')).toBe(true);
    expect(isDebugEnabled('nobulex:store')).toBe(false);

    process.env.DEBUG = 'nobulex:crypto:*';
    expect(isDebugEnabled('nobulex:crypto')).toBe(true);
    expect(isDebugEnabled('nobulex:crypto:sign')).toBe(true);
    expect(isDebugEnabled('nobulex:ccl')).toBe(false);
  });
});

describe('createDebugLogger, disabled', () => {
  beforeEach(() => {
    delete process.env.DEBUG;
  });

  it('returns a no-op logger: log/warn/error/time never touch console', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createDebugLogger('nobulex:crypto');
    expect(typeof logger.log).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.time).toBe('function');

    logger.log('nope');
    logger.warn('nope');
    logger.error('nope');
    const stop = logger.time('op');
    stop();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('createDebugLogger, enabled', () => {
  beforeEach(() => {
    process.env.DEBUG = 'nobulex';
  });

  it('log/warn/error emit with ISO timestamp, namespace prefix, WARN/ERROR markers, and pass through args', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = createDebugLogger('nobulex:crypto');
    logger.log('key', 'value', 42);
    expect(logSpy).toHaveBeenCalledOnce();
    const logArgs = logSpy.mock.calls[0];
    expect(typeof logArgs[0]).toBe('string');
    expect(Number.isNaN(new Date(logArgs[0] as string).getTime())).toBe(false);
    expect(logArgs[1]).toBe('[nobulex:crypto]');
    expect(logArgs[2]).toBe('key');
    expect(logArgs[3]).toBe('value');
    expect(logArgs[4]).toBe(42);

    createDebugLogger('nobulex:ccl').warn('deprecated syntax');
    const warnArgs = warnSpy.mock.calls[0];
    expect(warnArgs[1]).toBe('[nobulex:ccl]');
    expect(warnArgs[2]).toBe('WARN');
    expect(warnArgs[3]).toBe('deprecated syntax');

    createDebugLogger('nobulex:store').error('write failed');
    const errArgs = errorSpy.mock.calls[0];
    expect(errArgs[1]).toBe('[nobulex:store]');
    expect(errArgs[2]).toBe('ERROR');
    expect(errArgs[3]).toBe('write failed');

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('time() returns a stop function that logs a `label: <ms>ms` line; supports nested timers', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createDebugLogger('nobulex:sdk');

    const stop1 = logger.time('op1');
    const stop2 = logger.time('op2');
    stop2();
    stop1();
    expect(spy).toHaveBeenCalledTimes(2);
    const out1 = spy.mock.calls[0][2] as string;
    const out2 = spy.mock.calls[1][2] as string;
    expect(out1).toMatch(/^op2: \d+\.\d+ms$/);
    expect(out2).toMatch(/^op1: \d+\.\d+ms$/);
    const match = out1.match(/op2: (\d+\.\d+)ms/);
    expect(match).not.toBeNull();
    expect(parseFloat(match![1])).toBeGreaterThanOrEqual(0);

    spy.mockRestore();
  });
});

describe('namespace filtering', () => {
  it('only matched namespaces are active for log and warn', () => {
    process.env.DEBUG = 'nobulex:crypto';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const crypto = createDebugLogger('nobulex:crypto');
    const ccl = createDebugLogger('nobulex:ccl');
    crypto.log('yes');
    ccl.log('no');
    crypto.warn('yes');
    ccl.warn('no');

    expect(logSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledOnce();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('comma-separated DEBUG enables exactly the listed namespaces', () => {
    process.env.DEBUG = 'nobulex:crypto,nobulex:store';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDebugLogger('nobulex:crypto').log('a');
    createDebugLogger('nobulex:store').log('b');
    createDebugLogger('nobulex:ccl').log('c');
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
