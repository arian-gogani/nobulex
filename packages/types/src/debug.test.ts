import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isDebugEnabled, createDebugLogger } from './debug';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Save and restore the original DEBUG env var around each test. */
let originalDebug: string | undefined;

beforeEach(() => {
  originalDebug = process.env.DEBUG;
});

afterEach(() => {
  if (originalDebug === undefined) {
    delete process.env.DEBUG;
  } else {
    process.env.DEBUG = originalDebug;
  }
});

// ---------------------------------------------------------------------------
// isDebugEnabled
// ---------------------------------------------------------------------------
describe('isDebugEnabled', () => {
  it('returns false when DEBUG is not set', () => {
    delete process.env.DEBUG;
    expect(isDebugEnabled()).toBe(false);
    expect(isDebugEnabled('stele:crypto')).toBe(false);
  });

  it('returns false when DEBUG is an empty string', () => {
    process.env.DEBUG = '';
    expect(isDebugEnabled()).toBe(false);
    expect(isDebugEnabled('stele:crypto')).toBe(false);
  });

  it('returns true for all stele namespaces when DEBUG=stele', () => {
    process.env.DEBUG = 'stele';
    expect(isDebugEnabled()).toBe(true);
    expect(isDebugEnabled('stele')).toBe(true);
    expect(isDebugEnabled('stele:crypto')).toBe(true);
    expect(isDebugEnabled('stele:ccl')).toBe(true);
  });

  it('returns true for all stele namespaces when DEBUG=stele:*', () => {
    process.env.DEBUG = 'stele:*';
    expect(isDebugEnabled()).toBe(true);
    expect(isDebugEnabled('stele')).toBe(true);
    expect(isDebugEnabled('stele:crypto')).toBe(true);
    expect(isDebugEnabled('stele:store')).toBe(true);
  });

  it('returns true for everything when DEBUG=*', () => {
    process.env.DEBUG = '*';
    expect(isDebugEnabled()).toBe(true);
    expect(isDebugEnabled('stele:crypto')).toBe(true);
    expect(isDebugEnabled('anything')).toBe(true);
  });

  it('returns true only for the exact namespace when DEBUG=stele:crypto', () => {
    process.env.DEBUG = 'stele:crypto';
    expect(isDebugEnabled('stele:crypto')).toBe(true);
    expect(isDebugEnabled('stele:ccl')).toBe(false);
    expect(isDebugEnabled('stele:store')).toBe(false);
  });

  it('supports comma-separated patterns', () => {
    process.env.DEBUG = 'stele:crypto, stele:ccl';
    expect(isDebugEnabled('stele:crypto')).toBe(true);
    expect(isDebugEnabled('stele:ccl')).toBe(true);
    expect(isDebugEnabled('stele:store')).toBe(false);
  });

  it('returns false for non-stele namespace when DEBUG=stele', () => {
    process.env.DEBUG = 'stele';
    expect(isDebugEnabled('express:router')).toBe(false);
  });

  it('handles patterns with wildcard suffixes', () => {
    process.env.DEBUG = 'stele:crypto:*';
    expect(isDebugEnabled('stele:crypto')).toBe(true);
    expect(isDebugEnabled('stele:crypto:sign')).toBe(true);
    expect(isDebugEnabled('stele:ccl')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createDebugLogger — disabled (no-op)
// ---------------------------------------------------------------------------
describe('createDebugLogger — disabled', () => {
  beforeEach(() => {
    delete process.env.DEBUG;
  });

  it('returns a logger with no-op methods when debug is disabled', () => {
    const logger = createDebugLogger('stele:crypto');
    expect(typeof logger.log).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.time).toBe('function');
  });

  it('log does not call console.log when disabled', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createDebugLogger('stele:crypto');
    logger.log('should not appear');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('warn does not call console.warn when disabled', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = createDebugLogger('stele:crypto');
    logger.warn('should not appear');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('error does not call console.error when disabled', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createDebugLogger('stele:crypto');
    logger.error('should not appear');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('time returns a no-op stop function when disabled', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createDebugLogger('stele:crypto');
    const stop = logger.time('operation');
    expect(typeof stop).toBe('function');
    stop();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// createDebugLogger — enabled
// ---------------------------------------------------------------------------
describe('createDebugLogger — enabled', () => {
  beforeEach(() => {
    process.env.DEBUG = 'stele';
  });

  it('log outputs to console.log with namespace prefix', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createDebugLogger('stele:crypto');
    logger.log('generating key');
    expect(spy).toHaveBeenCalledOnce();
    const args = spy.mock.calls[0];
    // First arg is timestamp (ISO string), second is namespace prefix
    expect(typeof args[0]).toBe('string');
    expect(args[1]).toBe('[stele:crypto]');
    expect(args[2]).toBe('generating key');
    spy.mockRestore();
  });

  it('warn outputs to console.warn with WARN marker', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = createDebugLogger('stele:ccl');
    logger.warn('deprecated syntax');
    expect(spy).toHaveBeenCalledOnce();
    const args = spy.mock.calls[0];
    expect(args[1]).toBe('[stele:ccl]');
    expect(args[2]).toBe('WARN');
    expect(args[3]).toBe('deprecated syntax');
    spy.mockRestore();
  });

  it('error outputs to console.error with ERROR marker', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createDebugLogger('stele:store');
    logger.error('write failed');
    expect(spy).toHaveBeenCalledOnce();
    const args = spy.mock.calls[0];
    expect(args[1]).toBe('[stele:store]');
    expect(args[2]).toBe('ERROR');
    expect(args[3]).toBe('write failed');
    spy.mockRestore();
  });

  it('log includes a valid ISO 8601 timestamp', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createDebugLogger('stele:sdk');
    logger.log('test');
    const ts = spy.mock.calls[0][0] as string;
    const parsed = new Date(ts);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    spy.mockRestore();
  });

  it('log passes multiple arguments through', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createDebugLogger('stele:crypto');
    logger.log('key', 'value', 42);
    const args = spy.mock.calls[0];
    expect(args[2]).toBe('key');
    expect(args[3]).toBe('value');
    expect(args[4]).toBe(42);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// createDebugLogger — time()
// ---------------------------------------------------------------------------
describe('createDebugLogger — time()', () => {
  beforeEach(() => {
    process.env.DEBUG = 'stele';
  });

  it('returns a stop function that logs elapsed time', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createDebugLogger('stele:crypto');
    const stop = logger.time('sign');
    // Simulate some passage of time (even minimal)
    stop();
    expect(spy).toHaveBeenCalledOnce();
    const args = spy.mock.calls[0];
    expect(args[1]).toBe('[stele:crypto]');
    // The third arg should be the label with elapsed ms
    const timerOutput = args[2] as string;
    expect(timerOutput).toMatch(/^sign: \d+\.\d+ms$/);
    spy.mockRestore();
  });

  it('measures elapsed time (at least 0ms)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createDebugLogger('stele:core');
    const stop = logger.time('compute');
    stop();
    const timerOutput = spy.mock.calls[0][2] as string;
    const match = timerOutput.match(/compute: (\d+\.\d+)ms/);
    expect(match).not.toBeNull();
    const elapsed = parseFloat(match![1]);
    expect(elapsed).toBeGreaterThanOrEqual(0);
    spy.mockRestore();
  });

  it('can time multiple operations independently', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createDebugLogger('stele:sdk');
    const stop1 = logger.time('op1');
    const stop2 = logger.time('op2');
    stop2();
    stop1();
    expect(spy).toHaveBeenCalledTimes(2);
    expect((spy.mock.calls[0][2] as string)).toContain('op2:');
    expect((spy.mock.calls[1][2] as string)).toContain('op1:');
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Namespace filtering
// ---------------------------------------------------------------------------
describe('namespace filtering', () => {
  it('only creates active loggers for matched namespaces', () => {
    process.env.DEBUG = 'stele:crypto';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const cryptoLogger = createDebugLogger('stele:crypto');
    const cclLogger = createDebugLogger('stele:ccl');

    cryptoLogger.log('should appear');
    cclLogger.log('should not appear');

    expect(logSpy).toHaveBeenCalledOnce();

    cryptoLogger.warn('crypto warn');
    cclLogger.warn('ccl warn');

    expect(warnSpy).toHaveBeenCalledOnce();

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('comma-separated DEBUG enables multiple specific namespaces', () => {
    process.env.DEBUG = 'stele:crypto,stele:store';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const crypto = createDebugLogger('stele:crypto');
    const store = createDebugLogger('stele:store');
    const ccl = createDebugLogger('stele:ccl');

    crypto.log('a');
    store.log('b');
    ccl.log('c');

    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
