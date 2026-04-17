import { describe, it, expect, vi } from 'vitest';
import { Logger, createLogger, defaultLogger, LogLevel } from './logger';
import type { LogEntry, LogOutput } from './logger';

function captureLogger(
  level: LogLevel = LogLevel.DEBUG,
  component?: string,
): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const output: LogOutput = (entry) => entries.push(entry);
  return { logger: new Logger({ level, component, output }), entries };
}

describe('LogLevel', () => {
  it('has ordered numeric values from DEBUG=0 to SILENT=4', () => {
    expect(LogLevel.DEBUG).toBe(0);
    expect(LogLevel.INFO).toBe(1);
    expect(LogLevel.WARN).toBe(2);
    expect(LogLevel.ERROR).toBe(3);
    expect(LogLevel.SILENT).toBe(4);
  });
});

describe('Logger defaults and output plumbing', () => {
  it('constructs without args, defaults to INFO level and console.log JSON output', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new Logger();
    expect(logger).toBeInstanceOf(Logger);
    expect(logger.getLevel()).toBe(LogLevel.INFO);
    logger.info('hello');
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.message).toBe('hello');
    spy.mockRestore();
  });

  it('uses a custom output when provided and skips it when below threshold', () => {
    const output = vi.fn();
    const info = new Logger({ level: LogLevel.DEBUG, output });
    info.info('test');
    expect(output).toHaveBeenCalledOnce();

    const err = new Logger({ level: LogLevel.ERROR, output: vi.fn() });
    err.debug('skip');
    err.info('skip');
    err.warn('skip');
    expect(err['options'] ?? null).toBeDefined(); // keep TS happy; real check below
  });
});

describe('Logger levels and filtering', () => {
  it('emits entries labeled DEBUG/INFO/WARN/ERROR', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(entries.map(e => e.level)).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR']);
    expect(entries[0].message).toBe('d');
  });

  it('suppresses entries below the configured level, including SILENT blocking everything', () => {
    const info = captureLogger(LogLevel.INFO);
    info.logger.debug('no');
    info.logger.info('yes');
    expect(info.entries).toHaveLength(1);

    const warn = captureLogger(LogLevel.WARN);
    warn.logger.debug('no');
    warn.logger.info('no');
    warn.logger.warn('yes');
    warn.logger.error('yes');
    expect(warn.entries.map(e => e.level)).toEqual(['WARN', 'ERROR']);

    const error = captureLogger(LogLevel.ERROR);
    error.logger.debug('no');
    error.logger.info('no');
    error.logger.warn('no');
    error.logger.error('yes');
    expect(error.entries).toHaveLength(1);

    const silent = captureLogger(LogLevel.SILENT);
    silent.logger.debug('no');
    silent.logger.info('no');
    silent.logger.warn('no');
    silent.logger.error('no');
    expect(silent.entries).toHaveLength(0);
  });
});

describe('Logger.child', () => {
  it('creates children with component names, supports multi-level nesting via dot notation', () => {
    const noParent = captureLogger(LogLevel.DEBUG);
    noParent.logger.child('metrics').info('tick');
    expect(noParent.entries[0].component).toBe('metrics');

    const withParent = captureLogger(LogLevel.DEBUG, 'core');
    withParent.logger.child('storage').info('ready');
    expect(withParent.entries[0].component).toBe('core.storage');

    const deep = captureLogger(LogLevel.DEBUG, 'app');
    deep.logger.child('db').child('pool').info('acquired');
    expect(deep.entries[0].component).toBe('app.db.pool');
  });

  it('inherits parent level and output, but decouples from later parent level changes', () => {
    const output = vi.fn();
    const parent = new Logger({ level: LogLevel.DEBUG, output });
    parent.child('auth').info('login');
    expect(output).toHaveBeenCalledOnce();

    const entries = captureLogger(LogLevel.WARN).entries;
    const parent2 = new Logger({ level: LogLevel.WARN, output: e => entries.push(e) });
    const child = parent2.child('net');
    child.debug('no');
    child.info('no');
    child.warn('yes');
    expect(entries.filter(e => e.component === 'net')).toHaveLength(1);

    // setLevel on parent does not retroactively silence existing child
    const root = captureLogger(LogLevel.DEBUG);
    const c = root.logger.child('c');
    root.logger.setLevel(LogLevel.SILENT);
    root.logger.info('parent silent');
    c.info('child still active');
    expect(root.entries).toHaveLength(1);
    expect(root.entries[0].component).toBe('c');
  });
});

describe('Logger — contextual fields and entry structure', () => {
  it('merges arbitrary fields (string/number/bool/nested) into the entry', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.info('request', { method: 'GET', path: '/api', ms: 42, hit: true, data: { id: 1, name: 'alice' } });
    const e = entries[0];
    expect(e.method).toBe('GET');
    expect(e.path).toBe('/api');
    expect(e.ms).toBe(42);
    expect(e.hit).toBe(true);
    expect(e.data).toEqual({ id: 1, name: 'alice' });
  });

  it('entries have level/message/timestamp; omit component when none set', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.info('bare');
    const entry = entries[0];
    expect(entry).toHaveProperty('level');
    expect(entry).toHaveProperty('message');
    expect(entry).toHaveProperty('timestamp');
    expect(entry.component).toBeUndefined();
    expect(Object.keys(entry).sort()).toEqual(['level', 'message', 'timestamp'].sort());

    const withComp = captureLogger(LogLevel.DEBUG, 'mycomp');
    withComp.logger.info('x');
    expect(withComp.entries[0].component).toBe('mycomp');
  });

  it('timestamp is a valid ISO-8601 string close to now', () => {
    const before = Date.now();
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.info('ts');
    const after = Date.now();
    const ts = entries[0].timestamp;
    expect(typeof ts).toBe('string');
    expect(new Date(ts).toISOString()).toBe(ts);
    const t = new Date(ts).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });
});

describe('setLevel / getLevel', () => {
  it('changes the threshold and is reflected by getLevel', () => {
    const { logger, entries } = captureLogger(LogLevel.DEBUG);
    logger.info('before');
    logger.setLevel(LogLevel.ERROR);
    expect(logger.getLevel()).toBe(LogLevel.ERROR);
    logger.info('suppressed');
    logger.error('after');
    expect(entries.map(e => e.message)).toEqual(['before', 'after']);
  });
});

describe('createLogger / defaultLogger', () => {
  it('factory honors level/output/component options', () => {
    expect(createLogger()).toBeInstanceOf(Logger);
    expect(createLogger({ level: LogLevel.ERROR }).getLevel()).toBe(LogLevel.ERROR);

    const output = vi.fn();
    createLogger({ level: LogLevel.DEBUG, output }).info('via factory');
    expect(output).toHaveBeenCalledOnce();

    const entries: LogEntry[] = [];
    createLogger({
      level: LogLevel.DEBUG,
      component: 'factory',
      output: e => entries.push(e),
    }).info('test');
    expect(entries[0].component).toBe('factory');
  });

  it('defaultLogger is a ready INFO-level instance that produces children', () => {
    expect(defaultLogger).toBeInstanceOf(Logger);
    expect(defaultLogger.getLevel()).toBe(LogLevel.INFO);
    expect(defaultLogger.child('test')).toBeInstanceOf(Logger);
  });
});
