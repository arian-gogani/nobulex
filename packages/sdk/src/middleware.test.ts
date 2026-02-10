/**
 * Tests for the Stele SDK middleware system.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger, LogLevel } from '@stele/types';

import {
  MiddlewarePipeline,
  loggingMiddleware,
  validationMiddleware,
  timingMiddleware,
  rateLimitMiddleware,
} from './middleware.js';
import type {
  MiddlewareContext,
  MiddlewareResult,
  SteleMiddleware,
} from './middleware.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a simple async operation that returns its input. */
function echoOp<T>(value: T): () => Promise<T> {
  return async () => value;
}

/** Create an async operation that throws. */
function failingOp(message: string): () => Promise<never> {
  return async () => {
    throw new Error(message);
  };
}

/** Create a simple pass-through middleware for testing. */
function passthroughMiddleware(name: string): SteleMiddleware {
  return { name };
}

/** Create a middleware that records calls for order verification. */
function orderTrackingMiddleware(name: string, calls: string[]): SteleMiddleware {
  return {
    name,
    async before(ctx) {
      calls.push(`${name}:before`);
      return { proceed: true };
    },
    async after(ctx, result) {
      calls.push(`${name}:after`);
      return result;
    },
    async onError(ctx, error) {
      calls.push(`${name}:onError`);
    },
  };
}

// ─── MiddlewarePipeline — use / remove / list / clear ────────────────────────

describe('MiddlewarePipeline — use / remove / list / clear', () => {
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
  });

  it('starts with an empty list', () => {
    expect(pipeline.list()).toEqual([]);
  });

  it('adds middleware via use()', () => {
    pipeline.use(passthroughMiddleware('a'));
    expect(pipeline.list()).toEqual(['a']);
  });

  it('returns this from use() for chaining', () => {
    const result = pipeline.use(passthroughMiddleware('a'));
    expect(result).toBe(pipeline);
  });

  it('adds multiple middleware in order', () => {
    pipeline.use(passthroughMiddleware('a'));
    pipeline.use(passthroughMiddleware('b'));
    pipeline.use(passthroughMiddleware('c'));
    expect(pipeline.list()).toEqual(['a', 'b', 'c']);
  });

  it('replaces middleware with the same name', () => {
    const first: SteleMiddleware = { name: 'dup', async before() { return { proceed: true, metadata: { v: 1 } }; } };
    const second: SteleMiddleware = { name: 'dup', async before() { return { proceed: true, metadata: { v: 2 } }; } };
    pipeline.use(first);
    pipeline.use(second);
    expect(pipeline.list()).toEqual(['dup']);
  });

  it('removes middleware by name', () => {
    pipeline.use(passthroughMiddleware('a'));
    pipeline.use(passthroughMiddleware('b'));
    pipeline.remove('a');
    expect(pipeline.list()).toEqual(['b']);
  });

  it('returns this from remove() for chaining', () => {
    pipeline.use(passthroughMiddleware('a'));
    const result = pipeline.remove('a');
    expect(result).toBe(pipeline);
  });

  it('does nothing when removing non-existent name', () => {
    pipeline.use(passthroughMiddleware('a'));
    pipeline.remove('nonexistent');
    expect(pipeline.list()).toEqual(['a']);
  });

  it('clears all middleware', () => {
    pipeline.use(passthroughMiddleware('a'));
    pipeline.use(passthroughMiddleware('b'));
    pipeline.clear();
    expect(pipeline.list()).toEqual([]);
  });

  it('supports chained use().use().remove()', () => {
    pipeline
      .use(passthroughMiddleware('a'))
      .use(passthroughMiddleware('b'))
      .use(passthroughMiddleware('c'))
      .remove('b');
    expect(pipeline.list()).toEqual(['a', 'c']);
  });
});

// ─── MiddlewarePipeline — execute ────────────────────────────────────────────

describe('MiddlewarePipeline — execute passthrough', () => {
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
  });

  it('passes through with no middleware', async () => {
    const result = await pipeline.execute('test', {}, echoOp(42));
    expect(result).toBe(42);
  });

  it('passes through with middleware that has no hooks', async () => {
    pipeline.use(passthroughMiddleware('noop'));
    const result = await pipeline.execute('test', {}, echoOp('hello'));
    expect(result).toBe('hello');
  });

  it('returns complex objects unchanged', async () => {
    const data = { key: 'value', nested: { arr: [1, 2, 3] } };
    const result = await pipeline.execute('test', {}, echoOp(data));
    expect(result).toEqual(data);
  });
});

// ─── Before middleware ───────────────────────────────────────────────────────

describe('MiddlewarePipeline — before hooks', () => {
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
  });

  it('runs before hook and proceeds', async () => {
    const beforeFn = vi.fn(async (): Promise<MiddlewareResult> => ({ proceed: true }));
    pipeline.use({ name: 'test', before: beforeFn });

    await pipeline.execute('op', { a: 1 }, echoOp('ok'));
    expect(beforeFn).toHaveBeenCalledOnce();
  });

  it('receives correct context in before hook', async () => {
    let capturedCtx: MiddlewareContext | undefined;
    pipeline.use({
      name: 'capture',
      async before(ctx) {
        capturedCtx = ctx;
        return { proceed: true };
      },
    });

    await pipeline.execute('myOp', { x: 10 }, echoOp(null));

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.operation).toBe('myOp');
    expect(capturedCtx!.args).toEqual({ x: 10 });
    expect(capturedCtx!.timestamp).toBeTruthy();
    expect(capturedCtx!.metadata).toEqual({});
  });

  it('prevents execution when proceed is false', async () => {
    const fn = vi.fn(async () => 'should not run');
    pipeline.use({
      name: 'blocker',
      async before() {
        return { proceed: false };
      },
    });

    const result = await pipeline.execute('op', {}, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('modifies args via modifiedArgs', async () => {
    let receivedArgs: Record<string, unknown> | undefined;
    pipeline.use({
      name: 'modifier',
      async before(ctx) {
        return { proceed: true, modifiedArgs: { extra: 'added' } };
      },
    });
    pipeline.use({
      name: 'reader',
      async before(ctx) {
        receivedArgs = { ...ctx.args };
        return { proceed: true };
      },
    });

    await pipeline.execute('op', { original: true }, echoOp(null));
    expect(receivedArgs).toEqual({ original: true, extra: 'added' });
  });

  it('merges metadata from before hooks', async () => {
    let capturedMetadata: Record<string, unknown> | undefined;
    pipeline.use({
      name: 'meta1',
      async before() {
        return { proceed: true, metadata: { source: 'meta1' } };
      },
    });
    pipeline.use({
      name: 'meta2',
      async before(ctx) {
        capturedMetadata = { ...ctx.metadata };
        return { proceed: true, metadata: { source2: 'meta2' } };
      },
    });

    await pipeline.execute('op', {}, echoOp(null));
    expect(capturedMetadata).toEqual({ source: 'meta1' });
  });
});

// ─── After middleware ────────────────────────────────────────────────────────

describe('MiddlewarePipeline — after hooks', () => {
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
  });

  it('runs after hook with result', async () => {
    const afterFn = vi.fn(async (_ctx: MiddlewareContext, result: unknown) => result);
    pipeline.use({ name: 'test', after: afterFn });

    const result = await pipeline.execute('op', {}, echoOp(42));
    expect(afterFn).toHaveBeenCalledOnce();
    expect(result).toBe(42);
  });

  it('transforms result via after hook', async () => {
    pipeline.use({
      name: 'transformer',
      async after(_ctx, result) {
        return (result as number) * 2;
      },
    });

    const result = await pipeline.execute('op', {}, echoOp(21));
    expect(result).toBe(42);
  });

  it('chains after hook transformations in reverse order', async () => {
    pipeline.use({
      name: 'first',
      async after(_ctx, result) {
        return `${result}:first`;
      },
    });
    pipeline.use({
      name: 'second',
      async after(_ctx, result) {
        return `${result}:second`;
      },
    });

    // After hooks run in reverse: second first, then first
    const result = await pipeline.execute('op', {}, echoOp('start'));
    expect(result).toBe('start:second:first');
  });
});

// ─── Error middleware ────────────────────────────────────────────────────────

describe('MiddlewarePipeline — error handling', () => {
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
  });

  it('calls onError hook when operation throws', async () => {
    const onErrorFn = vi.fn();
    pipeline.use({ name: 'errHandler', onError: onErrorFn });

    await expect(
      pipeline.execute('op', {}, failingOp('boom')),
    ).rejects.toThrow('boom');

    expect(onErrorFn).toHaveBeenCalledOnce();
    expect(onErrorFn.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(onErrorFn.mock.calls[0][1].message).toBe('boom');
  });

  it('calls onError with correct context', async () => {
    let capturedCtx: MiddlewareContext | undefined;
    pipeline.use({
      name: 'errCapture',
      async onError(ctx) {
        capturedCtx = ctx;
      },
    });

    await expect(
      pipeline.execute('failOp', { key: 'val' }, failingOp('oops')),
    ).rejects.toThrow();

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.operation).toBe('failOp');
  });

  it('propagates the original error after onError hooks', async () => {
    pipeline.use({
      name: 'silent',
      async onError() {
        // does nothing, error still propagates
      },
    });

    await expect(
      pipeline.execute('op', {}, failingOp('original error')),
    ).rejects.toThrow('original error');
  });

  it('calls all onError hooks in order', async () => {
    const calls: string[] = [];
    pipeline.use({
      name: 'err1',
      async onError() { calls.push('err1'); },
    });
    pipeline.use({
      name: 'err2',
      async onError() { calls.push('err2'); },
    });

    await expect(
      pipeline.execute('op', {}, failingOp('fail')),
    ).rejects.toThrow();

    expect(calls).toEqual(['err1', 'err2']);
  });

  it('calls onError when before hook throws', async () => {
    const onErrorFn = vi.fn();
    pipeline.use({
      name: 'thrower',
      async before() {
        throw new Error('before failed');
      },
      onError: onErrorFn,
    });

    await expect(
      pipeline.execute('op', {}, echoOp('ok')),
    ).rejects.toThrow('before failed');

    expect(onErrorFn).toHaveBeenCalledOnce();
  });
});

// ─── Execution order ─────────────────────────────────────────────────────────

describe('MiddlewarePipeline — execution order', () => {
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
  });

  it('executes before hooks in registration order', async () => {
    const calls: string[] = [];
    pipeline.use(orderTrackingMiddleware('a', calls));
    pipeline.use(orderTrackingMiddleware('b', calls));
    pipeline.use(orderTrackingMiddleware('c', calls));

    await pipeline.execute('op', {}, echoOp('ok'));

    const beforeCalls = calls.filter((c) => c.endsWith(':before'));
    expect(beforeCalls).toEqual(['a:before', 'b:before', 'c:before']);
  });

  it('executes after hooks in reverse registration order', async () => {
    const calls: string[] = [];
    pipeline.use(orderTrackingMiddleware('a', calls));
    pipeline.use(orderTrackingMiddleware('b', calls));
    pipeline.use(orderTrackingMiddleware('c', calls));

    await pipeline.execute('op', {}, echoOp('ok'));

    const afterCalls = calls.filter((c) => c.endsWith(':after'));
    expect(afterCalls).toEqual(['c:after', 'b:after', 'a:after']);
  });

  it('executes full lifecycle: before -> operation -> after', async () => {
    const calls: string[] = [];
    pipeline.use({
      name: 'tracker',
      async before() {
        calls.push('before');
        return { proceed: true };
      },
      async after(_ctx, result) {
        calls.push('after');
        return result;
      },
    });

    const fn = async () => {
      calls.push('operation');
      return 'done';
    };

    await pipeline.execute('op', {}, fn);
    expect(calls).toEqual(['before', 'operation', 'after']);
  });

  it('executes onError hooks in registration order', async () => {
    const calls: string[] = [];
    pipeline.use(orderTrackingMiddleware('a', calls));
    pipeline.use(orderTrackingMiddleware('b', calls));

    await expect(
      pipeline.execute('op', {}, failingOp('fail')),
    ).rejects.toThrow();

    const errorCalls = calls.filter((c) => c.endsWith(':onError'));
    expect(errorCalls).toEqual(['a:onError', 'b:onError']);
  });
});

// ─── loggingMiddleware ───────────────────────────────────────────────────────

describe('loggingMiddleware', () => {
  it('has the name "logging"', () => {
    const mw = loggingMiddleware();
    expect(mw.name).toBe('logging');
  });

  it('logs operation start on before', async () => {
    const entries: Array<{ message: string }> = [];
    const logger = new Logger({
      level: LogLevel.DEBUG,
      output: (entry) => entries.push(entry),
    });

    const pipeline = new MiddlewarePipeline();
    pipeline.use(loggingMiddleware(logger));

    await pipeline.execute('createCovenant', { key: 'value' }, echoOp('ok'));

    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries[0]!.message).toContain('createCovenant');
    expect(entries[0]!.message).toContain('started');
  });

  it('logs operation completion on after', async () => {
    const entries: Array<{ message: string }> = [];
    const logger = new Logger({
      level: LogLevel.DEBUG,
      output: (entry) => entries.push(entry),
    });

    const pipeline = new MiddlewarePipeline();
    pipeline.use(loggingMiddleware(logger));

    await pipeline.execute('verifyCovenant', {}, echoOp(true));

    const completionLogs = entries.filter((e) => e.message.includes('completed'));
    expect(completionLogs.length).toBe(1);
    expect(completionLogs[0]!.message).toContain('verifyCovenant');
  });

  it('logs errors via onError', async () => {
    const entries: Array<{ message: string; level: string }> = [];
    const logger = new Logger({
      level: LogLevel.DEBUG,
      output: (entry) => entries.push(entry),
    });

    const pipeline = new MiddlewarePipeline();
    pipeline.use(loggingMiddleware(logger));

    await expect(
      pipeline.execute('op', {}, failingOp('something broke')),
    ).rejects.toThrow();

    const errorLogs = entries.filter((e) => e.level === 'ERROR');
    expect(errorLogs.length).toBe(1);
    expect(errorLogs[0]!.message).toContain('something broke');
  });

  it('uses default logger when none provided', () => {
    const mw = loggingMiddleware();
    expect(mw.before).toBeDefined();
    expect(mw.after).toBeDefined();
    expect(mw.onError).toBeDefined();
  });
});

// ─── validationMiddleware ────────────────────────────────────────────────────

describe('validationMiddleware', () => {
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
    pipeline.use(validationMiddleware());
  });

  it('has the name "validation"', () => {
    const mw = validationMiddleware();
    expect(mw.name).toBe('validation');
  });

  it('allows execution when no validatable args present', async () => {
    const result = await pipeline.execute('op', { other: 'value' }, echoOp('ok'));
    expect(result).toBe('ok');
  });

  it('allows valid constraints', async () => {
    const result = await pipeline.execute(
      'op',
      { constraints: "permit read on '/data'" },
      echoOp('ok'),
    );
    expect(result).toBe('ok');
  });

  it('rejects empty string constraints', async () => {
    await expect(
      pipeline.execute('op', { constraints: '' }, echoOp('ok')),
    ).rejects.toThrow('constraints must be a non-empty string');
  });

  it('rejects whitespace-only constraints', async () => {
    await expect(
      pipeline.execute('op', { constraints: '   ' }, echoOp('ok')),
    ).rejects.toThrow('constraints must be a non-empty string');
  });

  it('rejects non-string constraints', async () => {
    await expect(
      pipeline.execute('op', { constraints: 42 }, echoOp('ok')),
    ).rejects.toThrow('constraints must be a non-empty string');
  });

  it('allows valid 32-byte privateKey', async () => {
    const key = new Uint8Array(32).fill(1);
    const result = await pipeline.execute('op', { privateKey: key }, echoOp('ok'));
    expect(result).toBe('ok');
  });

  it('allows valid 64-byte privateKey', async () => {
    const key = new Uint8Array(64).fill(1);
    const result = await pipeline.execute('op', { privateKey: key }, echoOp('ok'));
    expect(result).toBe('ok');
  });

  it('rejects invalid key size', async () => {
    const key = new Uint8Array(16).fill(1);
    await expect(
      pipeline.execute('op', { privateKey: key }, echoOp('ok')),
    ).rejects.toThrow('privateKey must be 32 or 64 bytes');
  });

  it('ignores non-Uint8Array privateKey values', async () => {
    // String keys are not validated by this middleware
    const result = await pipeline.execute('op', { privateKey: 'stringkey' }, echoOp('ok'));
    expect(result).toBe('ok');
  });
});

// ─── timingMiddleware ────────────────────────────────────────────────────────

describe('timingMiddleware', () => {
  it('has the name "timing"', () => {
    const mw = timingMiddleware();
    expect(mw.name).toBe('timing');
  });

  it('adds durationMs to metadata', async () => {
    let capturedMetadata: Record<string, unknown> | undefined;
    const pipeline = new MiddlewarePipeline();
    // Register metaCapture BEFORE timing so its after hook runs AFTER timing's
    // (after hooks execute in reverse registration order)
    pipeline.use({
      name: 'metaCapture',
      async after(ctx, result) {
        capturedMetadata = { ...ctx.metadata };
        return result;
      },
    });
    pipeline.use(timingMiddleware());

    await pipeline.execute('op', {}, async () => {
      // Small delay to ensure measurable duration
      await new Promise((r) => setTimeout(r, 5));
      return 'done';
    });

    expect(capturedMetadata).toBeDefined();
    expect(typeof capturedMetadata!.durationMs).toBe('number');
    expect(capturedMetadata!.durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it('removes internal _timingStart from metadata', async () => {
    let capturedMetadata: Record<string, unknown> | undefined;
    const pipeline = new MiddlewarePipeline();
    pipeline.use({
      name: 'metaCapture',
      async after(ctx, result) {
        capturedMetadata = { ...ctx.metadata };
        return result;
      },
    });
    pipeline.use(timingMiddleware());

    await pipeline.execute('op', {}, echoOp('done'));

    expect(capturedMetadata).toBeDefined();
    expect(capturedMetadata!._timingStart).toBeUndefined();
  });

  it('returns the original result unchanged', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(timingMiddleware());

    const result = await pipeline.execute('op', {}, echoOp({ x: 1 }));
    expect(result).toEqual({ x: 1 });
  });
});

// ─── rateLimitMiddleware ─────────────────────────────────────────────────────

describe('rateLimitMiddleware', () => {
  it('has the name "rateLimit"', () => {
    const mw = rateLimitMiddleware({ maxPerSecond: 10 });
    expect(mw.name).toBe('rateLimit');
  });

  it('allows operations within the limit', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(rateLimitMiddleware({ maxPerSecond: 100 }));

    // Should all succeed within the bucket
    for (let i = 0; i < 5; i++) {
      const result = await pipeline.execute('op', {}, echoOp(i));
      expect(result).toBe(i);
    }
  });

  it('rejects when rate limit is exceeded', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(rateLimitMiddleware({ maxPerSecond: 2 }));

    // Use up the tokens
    await pipeline.execute('op', {}, echoOp(1));
    await pipeline.execute('op', {}, echoOp(2));

    // The third should fail
    await expect(
      pipeline.execute('op', {}, echoOp(3)),
    ).rejects.toThrow('Rate limit exceeded');
  });

  it('refills tokens over time', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(rateLimitMiddleware({ maxPerSecond: 5 }));

    // Use all tokens
    for (let i = 0; i < 5; i++) {
      await pipeline.execute('op', {}, echoOp(i));
    }

    // Wait for refill
    await new Promise((r) => setTimeout(r, 250));

    // Should have at least 1 token now
    const result = await pipeline.execute('op', {}, echoOp('refilled'));
    expect(result).toBe('refilled');
  });
});

// ─── Pipeline composition ────────────────────────────────────────────────────

describe('MiddlewarePipeline — composition', () => {
  it('composes logging + timing + validation together', async () => {
    const entries: Array<{ message: string }> = [];
    const logger = new Logger({
      level: LogLevel.DEBUG,
      output: (entry) => entries.push(entry),
    });

    const pipeline = new MiddlewarePipeline();
    pipeline.use(loggingMiddleware(logger));
    pipeline.use(timingMiddleware());
    pipeline.use(validationMiddleware());

    const result = await pipeline.execute(
      'createCovenant',
      { constraints: "permit read on '/data'" },
      echoOp({ id: 'cov-123' }),
    );

    expect(result).toEqual({ id: 'cov-123' });
    expect(entries.length).toBeGreaterThanOrEqual(2); // start + complete
  });

  it('validation rejects within composed pipeline', async () => {
    const entries: Array<{ message: string; level: string }> = [];
    const logger = new Logger({
      level: LogLevel.DEBUG,
      output: (entry) => entries.push(entry),
    });

    const pipeline = new MiddlewarePipeline();
    pipeline.use(loggingMiddleware(logger));
    pipeline.use(validationMiddleware());

    await expect(
      pipeline.execute('createCovenant', { constraints: '' }, echoOp('ok')),
    ).rejects.toThrow('constraints must be a non-empty string');

    // Should have error log
    const errorLogs = entries.filter((e) => e.level === 'ERROR');
    expect(errorLogs.length).toBe(1);
  });

  it('timing works with rate limiting', async () => {
    let capturedMetadata: Record<string, unknown> | undefined;
    const pipeline = new MiddlewarePipeline();
    // Register metaCapture first so its after hook runs last (reverse order)
    pipeline.use({
      name: 'metaCapture',
      async after(ctx, result) {
        capturedMetadata = { ...ctx.metadata };
        return result;
      },
    });
    pipeline.use(timingMiddleware());
    pipeline.use(rateLimitMiddleware({ maxPerSecond: 100 }));

    await pipeline.execute('op', {}, echoOp('done'));
    expect(capturedMetadata).toBeDefined();
    expect(typeof capturedMetadata!.durationMs).toBe('number');
  });
});

// ─── Middleware error propagation ────────────────────────────────────────────

describe('MiddlewarePipeline — error propagation', () => {
  it('propagates error from before hook', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use({
      name: 'thrower',
      async before() {
        throw new Error('before hook error');
      },
    });

    await expect(
      pipeline.execute('op', {}, echoOp('ok')),
    ).rejects.toThrow('before hook error');
  });

  it('propagates error from after hook', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use({
      name: 'afterThrower',
      async after() {
        throw new Error('after hook error');
      },
    });

    await expect(
      pipeline.execute('op', {}, echoOp('ok')),
    ).rejects.toThrow('after hook error');
  });

  it('wraps non-Error throws into Error instances', async () => {
    const pipeline = new MiddlewarePipeline();
    const onErrorFn = vi.fn();
    pipeline.use({
      name: 'stringThrower',
      async before() {
        throw 'string error';
      },
      onError: onErrorFn,
    });

    await expect(
      pipeline.execute('op', {}, echoOp('ok')),
    ).rejects.toThrow('string error');

    expect(onErrorFn).toHaveBeenCalledOnce();
    expect(onErrorFn.mock.calls[0][1]).toBeInstanceOf(Error);
  });
});

// ─── Async middleware ────────────────────────────────────────────────────────

describe('MiddlewarePipeline — async middleware', () => {
  it('handles async before hooks', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use({
      name: 'asyncBefore',
      async before(ctx) {
        await new Promise((r) => setTimeout(r, 10));
        return { proceed: true, metadata: { async: true } };
      },
    });

    let capturedMetadata: Record<string, unknown> | undefined;
    pipeline.use({
      name: 'reader',
      async before(ctx) {
        capturedMetadata = { ...ctx.metadata };
        return { proceed: true };
      },
    });

    await pipeline.execute('op', {}, echoOp('done'));
    expect(capturedMetadata).toEqual({ async: true });
  });

  it('handles async after hooks', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use({
      name: 'asyncAfter',
      async after(_ctx, result) {
        await new Promise((r) => setTimeout(r, 10));
        return `${result}:async`;
      },
    });

    const result = await pipeline.execute('op', {}, echoOp('start'));
    expect(result).toBe('start:async');
  });

  it('handles async error hooks', async () => {
    const pipeline = new MiddlewarePipeline();
    const errors: string[] = [];
    pipeline.use({
      name: 'asyncError',
      async onError(_ctx, error) {
        await new Promise((r) => setTimeout(r, 10));
        errors.push(error.message);
      },
    });

    await expect(
      pipeline.execute('op', {}, failingOp('async fail')),
    ).rejects.toThrow('async fail');

    expect(errors).toEqual(['async fail']);
  });

  it('handles slow async operations with timing', async () => {
    let capturedDuration: number | undefined;
    const pipeline = new MiddlewarePipeline();
    // Register durationCapture first so its after hook runs after timing's
    pipeline.use({
      name: 'durationCapture',
      async after(ctx, result) {
        capturedDuration = ctx.metadata.durationMs as number;
        return result;
      },
    });
    pipeline.use(timingMiddleware());

    await pipeline.execute('op', {}, async () => {
      await new Promise((r) => setTimeout(r, 20));
      return 'done';
    });

    expect(capturedDuration).toBeDefined();
    expect(capturedDuration!).toBeGreaterThanOrEqual(15);
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe('MiddlewarePipeline — edge cases', () => {
  it('handles undefined return from after hook', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use({
      name: 'nullifier',
      async after() {
        return undefined;
      },
    });

    const result = await pipeline.execute('op', {}, echoOp(42));
    expect(result).toBeUndefined();
  });

  it('handles empty args object', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(validationMiddleware());

    const result = await pipeline.execute('op', {}, echoOp('ok'));
    expect(result).toBe('ok');
  });

  it('supports re-adding middleware after clear', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(passthroughMiddleware('a'));
    pipeline.clear();
    pipeline.use(passthroughMiddleware('b'));

    expect(pipeline.list()).toEqual(['b']);

    const result = await pipeline.execute('op', {}, echoOp('ok'));
    expect(result).toBe('ok');
  });

  it('does not mutate the original args object', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use({
      name: 'modifier',
      async before(ctx) {
        return { proceed: true, modifiedArgs: { injected: true } };
      },
    });

    const originalArgs = { key: 'value' };
    await pipeline.execute('op', originalArgs, echoOp('ok'));

    expect(originalArgs).toEqual({ key: 'value' });
    expect((originalArgs as Record<string, unknown>).injected).toBeUndefined();
  });
});
