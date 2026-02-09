import { describe, it, expect, vi } from 'vitest';
import {
  Logger,
  createLogger,
  defaultLogger,
  LogLevel,
} from './logger';
import type { LogEntry, LogOutput } from './logger';

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Create a logger whose output is captured into an array for inspection. */
function captureLogger(
  level: LogLevel = LogLevel.DEBUG,
  component?: string,
): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const output: LogOutput = (entry) => entries.push(entry);
  const logger = new Logger({ level, component, output });
  return { logger, entries };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('LogLevel', () => {
  it('has the expected numeric values', () => {
    expect(LogLevel.DEBUG).toBe(0);
    expect(LogLevel.INFO).toBe(1);
    expect(LogLevel.WARN).toBe(2);
    expect(LogLevel.ERROR).toBe(3);
    expect(LogLevel.SILENT).toBe(4);
  });

  it('levels are ordered from least to most severe', () => {
    expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO);
    expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN);
    expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR);
    expect(LogLevel.ERROR).toBeLessThan(LogLevel.SILENT);
  });
});

describe('Logger — default creation', () => {
  it('can be constructed with no arguments', () => {
    const logger = new Logger();
    expect(logger).toBeInstanceOf(Logger);
  });

  it('defaults to INFO level', () => {
    const logger = new Logger();
    expect(logger.getLevel()).toBe(LogLevel.INFO);
  });

  it('defaults to console.log JSON output', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new Logger();
    logger.info('hello');
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.message).toBe('hello');
    spy.mockRestore();
  });
});

describe('Logger — log at each level', () => {
  it('emits DEBUG entries', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.debug('dbg');
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('DEBUG');
    expect(entries[0].message).toBe('dbg');
  });

  it('emits INFO entries', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.info('inf');
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('INFO');
  });

  it('emits WARN entries', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.warn('wrn');
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('WARN');
  });

  it('emits ERROR entries', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.error('err');
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('ERROR');
  });
});

describe('Logger — level filtering', () => {
  it('suppresses DEBUG when level is INFO', () => {
    const { logger, entries } = captureLogger(LogLevel.INFO);
    logger.debug('should not appear');
    expect(entries).toHaveLength(0);
  });

  it('suppresses DEBUG and INFO when level is WARN', () => {
    const { logger, entries } = captureLogger(LogLevel.WARN);
    logger.debug('no');
    logger.info('no');
    logger.warn('yes');
    logger.error('yes');
    expect(entries).toHaveLength(2);
    expect(entries[0].level).toBe('WARN');
    expect(entries[1].level).toBe('ERROR');
  });

  it('suppresses DEBUG, INFO, and WARN when level is ERROR', () => {
    const { logger, entries } = captureLogger(LogLevel.ERROR);
    logger.debug('no');
    logger.info('no');
    logger.warn('no');
    logger.error('yes');
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('ERROR');
  });

  it('SILENT suppresses all output', () => {
    const { logger, entries } = captureLogger(LogLevel.SILENT);
    logger.debug('no');
    logger.info('no');
    logger.warn('no');
    logger.error('no');
    expect(entries).toHaveLength(0);
  });
});

describe('Logger — custom output', () => {
  it('uses the provided output function', () => {
    const captured: LogEntry[] = [];
    const output = vi.fn((entry: LogEntry) => captured.push(entry));
    const logger = new Logger({ level: LogLevel.DEBUG, output });
    logger.info('test');
    expect(output).toHaveBeenCalledOnce();
    expect(captured).toHaveLength(1);
    expect(captured[0].message).toBe('test');
  });

  it('does not call output when message is below threshold', () => {
    const output = vi.fn();
    const logger = new Logger({ level: LogLevel.ERROR, output });
    logger.debug('skip');
    logger.info('skip');
    logger.warn('skip');
    expect(output).not.toHaveBeenCalled();
  });
});

describe('Logger — child loggers', () => {
  it('creates a child with the given component', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    const child = logger.child('storage');
    child.info('connected');
    expect(entries).toHaveLength(1);
    expect(entries[0].component).toBe('storage');
  });

  it('child inherits the parent level', () => {
    const { logger, entries } = captureLogger(LogLevel.WARN);
    const child = logger.child('net');
    child.debug('no');
    child.info('no');
    child.warn('yes');
    expect(entries).toHaveLength(1);
  });

  it('child inherits the parent output', () => {
    const output = vi.fn();
    const parent = new Logger({ level: LogLevel.DEBUG, output });
    const child = parent.child('auth');
    child.info('login');
    expect(output).toHaveBeenCalledOnce();
  });

  it('prefixes component with parent component using dot notation', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG, 'core');
    const child = logger.child('storage');
    child.info('ready');
    expect(entries[0].component).toBe('core.storage');
  });

  it('supports multi-level nesting', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG, 'app');
    const child = logger.child('db').child('pool');
    child.info('acquired');
    expect(entries[0].component).toBe('app.db.pool');
  });

  it('parent component is not set when parent has no component', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    const child = logger.child('metrics');
    child.info('tick');
    expect(entries[0].component).toBe('metrics');
  });
});

describe('Logger — contextual fields', () => {
  it('includes extra fields in the log entry', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.info('request', { method: 'GET', path: '/api' });
    expect(entries[0].method).toBe('GET');
    expect(entries[0].path).toBe('/api');
  });

  it('supports numeric field values', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.info('latency', { ms: 42 });
    expect(entries[0].ms).toBe(42);
  });

  it('supports boolean field values', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.info('cache', { hit: true });
    expect(entries[0].hit).toBe(true);
  });

  it('supports nested object field values', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.info('user', { data: { id: 1, name: 'alice' } });
    expect(entries[0].data).toEqual({ id: 1, name: 'alice' });
  });

  it('works without fields argument', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.info('bare message');
    expect(entries[0].message).toBe('bare message');
    // Only standard keys should be present
    expect(Object.keys(entries[0]).sort()).toEqual(
      ['level', 'message', 'timestamp'].sort(),
    );
  });
});

describe('Logger — setLevel / getLevel', () => {
  it('setLevel changes the minimum level', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.info('before');
    logger.setLevel(LogLevel.ERROR);
    logger.info('suppressed');
    logger.error('after');
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe('before');
    expect(entries[1].message).toBe('after');
  });

  it('getLevel reflects the current level', () => {
    const logger = new Logger({ level: LogLevel.WARN });
    expect(logger.getLevel()).toBe(LogLevel.WARN);
    logger.setLevel(LogLevel.DEBUG);
    expect(logger.getLevel()).toBe(LogLevel.DEBUG);
  });

  it('setLevel does not affect existing child loggers', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    const child = logger.child('c');
    logger.setLevel(LogLevel.SILENT);
    // Parent is now silent, but child retains its original level
    logger.info('parent silent');
    child.info('child still active');
    expect(entries).toHaveLength(1);
    expect(entries[0].component).toBe('c');
  });
});

describe('LogEntry structure', () => {
  it('always contains level, message, and timestamp', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.debug('structural check');
    const entry = entries[0];
    expect(entry).toHaveProperty('level');
    expect(entry).toHaveProperty('message');
    expect(entry).toHaveProperty('timestamp');
  });

  it('does not include component when none is set', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.info('no component');
    expect(entries[0].component).toBeUndefined();
    expect('component' in entries[0]).toBe(false);
  });

  it('includes component when set', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG, 'mycomp');
    logger.info('with component');
    expect(entries[0].component).toBe('mycomp');
  });

  it('timestamp is a valid ISO 8601 string', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.info('ts check');
    const ts = entries[0].timestamp;
    expect(typeof ts).toBe('string');
    const parsed = new Date(ts);
    expect(parsed.toISOString()).toBe(ts);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });

  it('timestamp is close to now', () => {
    const before = new Date().getTime();
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.info('timing');
    const after = new Date().getTime();
    const entryTime = new Date(entries[0].timestamp).getTime();
    expect(entryTime).toBeGreaterThanOrEqual(before);
    expect(entryTime).toBeLessThanOrEqual(after);
  });

  it('level name matches the method used', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(entries.map((e) => e.level)).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR']);
  });
});

describe('createLogger factory', () => {
  it('returns a Logger instance', () => {
    const logger = createLogger();
    expect(logger).toBeInstanceOf(Logger);
  });

  it('accepts options', () => {
    const logger = createLogger({ level: LogLevel.ERROR });
    expect(logger.getLevel()).toBe(LogLevel.ERROR);
  });

  it('accepts a custom output', () => {
    const output = vi.fn();
    const logger = createLogger({ level: LogLevel.DEBUG, output });
    logger.info('via factory');
    expect(output).toHaveBeenCalledOnce();
  });

  it('accepts a component option', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      level: LogLevel.DEBUG,
      component: 'factory',
      output: (e) => entries.push(e),
    });
    logger.info('test');
    expect(entries[0].component).toBe('factory');
  });
});

describe('defaultLogger', () => {
  it('is a Logger instance', () => {
    expect(defaultLogger).toBeInstanceOf(Logger);
  });

  it('is set to INFO level', () => {
    expect(defaultLogger.getLevel()).toBe(LogLevel.INFO);
  });

  it('can produce child loggers', () => {
    const child = defaultLogger.child('test');
    expect(child).toBeInstanceOf(Logger);
  });
});
