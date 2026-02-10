import { describe, it, expect, vi } from 'vitest';
import {
  withRetry,
  CircuitBreaker,
  HealthChecker,
} from './retry';
import type {
  RetryOptions,
  CircuitBreakerOptions,
  CircuitBreakerState,
  HealthCheck,
  HealthStatus,
} from './retry';

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Create a function that fails N times then succeeds. */
function failNTimes<T>(n: number, value: T): () => Promise<T> {
  let count = 0;
  return async () => {
    if (count < n) {
      count++;
      throw new Error(`fail-${count}`);
    }
    return value;
  };
}

/** Create a function that always fails. */
function alwaysFail(msg = 'always'): () => Promise<never> {
  return async () => {
    throw new Error(msg);
  };
}

// ─── withRetry ──────────────────────────────────────────────────────────────────

describe('withRetry', () => {
  it('succeeds on the first try', async () => {
    const result = await withRetry(async () => 42);
    expect(result).toBe(42);
  });

  it('returns the resolved value', async () => {
    const result = await withRetry(async () => 'hello');
    expect(result).toBe('hello');
  });

  it('succeeds after transient failures', async () => {
    const fn = failNTimes(2, 'ok');
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
  });

  it('throws after exhausting all retries', async () => {
    const fn = alwaysFail('boom');
    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow('boom');
  });

  it('uses default maxRetries of 3', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error('fail');
    };
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow('fail');
    // 1 initial + 3 retries = 4 total attempts
    expect(attempts).toBe(4);
  });

  it('zero maxRetries means no retries', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error('fail');
    };
    await expect(
      withRetry(fn, { maxRetries: 0, baseDelayMs: 1 }),
    ).rejects.toThrow('fail');
    expect(attempts).toBe(1);
  });

  it('exponential backoff increases delay between attempts', async () => {
    const attemptTimes: number[] = [];
    let attempts = 0;
    const start = Date.now();

    const fn = async () => {
      attemptTimes.push(Date.now() - start);
      attempts++;
      throw new Error('backoff-test');
    };

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 20,
        backoffMultiplier: 2,
        maxDelayMs: 10000,
      }),
    ).rejects.toThrow('backoff-test');

    expect(attempts).toBe(4);
    // Verify delays increase: gap between attempt 2-3 >= gap between attempt 1-2
    if (attemptTimes.length >= 3) {
      const gap1 = attemptTimes[1]! - attemptTimes[0]!;
      const gap2 = attemptTimes[2]! - attemptTimes[1]!;
      expect(gap2).toBeGreaterThanOrEqual(gap1);
    }
  });

  it('respects maxDelayMs cap', async () => {
    const attemptTimes: number[] = [];
    let attempts = 0;
    const start = Date.now();

    const fn = async () => {
      attemptTimes.push(Date.now() - start);
      attempts++;
      throw new Error('cap-test');
    };

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 10,
        backoffMultiplier: 100,
        maxDelayMs: 30,
      }),
    ).rejects.toThrow('cap-test');

    expect(attempts).toBe(4);
    // The last gap should not exceed maxDelayMs + tolerance
    if (attemptTimes.length >= 3) {
      const gap = attemptTimes[3]! - attemptTimes[2]!;
      // Allow some timing tolerance but should be capped near 30ms
      expect(gap).toBeLessThan(100);
    }
  });

  it('retryOn predicate allows selective retries', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error('non-retryable');
    };

    await expect(
      withRetry(fn, {
        maxRetries: 5,
        baseDelayMs: 1,
        retryOn: (err) => err.message !== 'non-retryable',
      }),
    ).rejects.toThrow('non-retryable');

    // Should not retry because predicate returned false
    expect(attempts).toBe(1);
  });

  it('retryOn predicate allows retry for matching errors', async () => {
    const fn = failNTimes(2, 'recovered');
    const result = await withRetry(fn, {
      maxRetries: 5,
      baseDelayMs: 1,
      retryOn: (err) => err.message.startsWith('fail'),
    });
    expect(result).toBe('recovered');
  });

  it('converts non-Error throws to Error', async () => {
    const fn = async () => {
      throw 'string-error';
    };
    await expect(
      withRetry(fn, { maxRetries: 0 }),
    ).rejects.toThrow('string-error');
  });

  it('immediate success does not delay', async () => {
    const start = Date.now();
    await withRetry(async () => 'fast');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});

// ─── CircuitBreaker ─────────────────────────────────────────────────────────────

describe('CircuitBreaker', () => {
  it('starts in closed state', () => {
    const breaker = new CircuitBreaker();
    expect(breaker.getState()).toBe('closed');
    expect(breaker.getFailureCount()).toBe(0);
  });

  it('allows calls in closed state', async () => {
    const breaker = new CircuitBreaker();
    const result = await breaker.execute(async () => 42);
    expect(result).toBe(42);
    expect(breaker.getState()).toBe('closed');
  });

  it('tracks failure count', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });

    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    expect(breaker.getFailureCount()).toBe(1);

    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    expect(breaker.getFailureCount()).toBe(2);
  });

  it('opens after reaching failure threshold', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    }

    expect(breaker.getState()).toBe('open');
    expect(breaker.getFailureCount()).toBe(3);
  });

  it('rejects calls in open state', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });

    // Trip the breaker
    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    expect(breaker.getState()).toBe('open');

    // Subsequent call should be rejected without executing fn
    let fnCalled = false;
    await expect(
      breaker.execute(async () => {
        fnCalled = true;
        return 'should-not-run';
      }),
    ).rejects.toThrow('Circuit breaker is open');
    expect(fnCalled).toBe(false);
  });

  it('transitions to half-open after resetTimeMs', async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeMs: 1000,
    });

    // Trip the breaker
    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    expect(breaker.getState()).toBe('open');

    // Advance past reset time
    vi.advanceTimersByTime(1001);
    expect(breaker.getState()).toBe('half-open');

    vi.useRealTimers();
  });

  it('half-open allows limited probe calls', async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeMs: 1000,
      halfOpenMax: 1,
    });

    // Trip the breaker
    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    await expect(breaker.execute(alwaysFail())).rejects.toThrow();

    // Wait for half-open
    vi.advanceTimersByTime(1001);
    expect(breaker.getState()).toBe('half-open');

    // First call in half-open succeeds -> closes the breaker
    const result = await breaker.execute(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(breaker.getState()).toBe('closed');

    vi.useRealTimers();
  });

  it('half-open failure re-opens the breaker', async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeMs: 1000,
      halfOpenMax: 1,
    });

    // Trip the breaker
    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    await expect(breaker.execute(alwaysFail())).rejects.toThrow();

    // Wait for half-open
    vi.advanceTimersByTime(1001);
    expect(breaker.getState()).toBe('half-open');

    // Probe fails -> should trip again
    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    expect(breaker.getState()).toBe('open');

    vi.useRealTimers();
  });

  it('half-open rejects excess probe calls', async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeMs: 1000,
      halfOpenMax: 1,
    });

    // Trip the breaker
    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    await expect(breaker.execute(alwaysFail())).rejects.toThrow();

    // Wait for half-open
    vi.advanceTimersByTime(1001);

    // First probe call — this consumes the halfOpenMax slot but fails
    await expect(breaker.execute(alwaysFail())).rejects.toThrow('always');

    // The breaker re-opens after the failure, so second call is rejected
    await expect(
      breaker.execute(async () => 'nope'),
    ).rejects.toThrow('Circuit breaker is open');

    vi.useRealTimers();
  });

  it('success resets failure count', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });

    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    expect(breaker.getFailureCount()).toBe(2);

    await breaker.execute(async () => 'ok');
    expect(breaker.getFailureCount()).toBe(0);
    expect(breaker.getState()).toBe('closed');
  });

  it('reset() returns to initial state', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });

    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    expect(breaker.getState()).toBe('open');

    breaker.reset();
    expect(breaker.getState()).toBe('closed');
    expect(breaker.getFailureCount()).toBe(0);

    // Should work again
    const result = await breaker.execute(async () => 'fresh');
    expect(result).toBe('fresh');
  });

  it('default failure threshold is 5', async () => {
    const breaker = new CircuitBreaker();

    for (let i = 0; i < 4; i++) {
      await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    }
    expect(breaker.getState()).toBe('closed');

    await expect(breaker.execute(alwaysFail())).rejects.toThrow();
    expect(breaker.getState()).toBe('open');
  });
});

// ─── HealthChecker ──────────────────────────────────────────────────────────────

describe('HealthChecker', () => {
  it('starts with no checks', async () => {
    const checker = new HealthChecker();
    const results = await checker.checkAll();
    expect(Object.keys(results)).toHaveLength(0);
  });

  it('isHealthy returns true when no checks are registered', async () => {
    const checker = new HealthChecker();
    expect(await checker.isHealthy()).toBe(true);
  });

  it('registers and runs a health check', async () => {
    const checker = new HealthChecker();
    checker.register({
      name: 'db',
      check: async () => ({ healthy: true, message: 'connected' }),
    });

    const results = await checker.checkAll();
    expect(results.db).toBeDefined();
    expect(results.db!.healthy).toBe(true);
    expect(results.db!.message).toBe('connected');
  });

  it('checkAll includes latencyMs', async () => {
    const checker = new HealthChecker();
    checker.register({
      name: 'fast',
      check: async () => ({ healthy: true }),
    });

    const results = await checker.checkAll();
    expect(typeof results.fast!.latencyMs).toBe('number');
    expect(results.fast!.latencyMs!).toBeGreaterThanOrEqual(0);
  });

  it('reports multiple checks', async () => {
    const checker = new HealthChecker();
    checker.register({
      name: 'db',
      check: async () => ({ healthy: true }),
    });
    checker.register({
      name: 'cache',
      check: async () => ({ healthy: true }),
    });
    checker.register({
      name: 'queue',
      check: async () => ({ healthy: false, message: 'disconnected' }),
    });

    const results = await checker.checkAll();
    expect(Object.keys(results)).toHaveLength(3);
    expect(results.db!.healthy).toBe(true);
    expect(results.cache!.healthy).toBe(true);
    expect(results.queue!.healthy).toBe(false);
  });

  it('isHealthy returns true when all checks pass', async () => {
    const checker = new HealthChecker();
    checker.register({
      name: 'a',
      check: async () => ({ healthy: true }),
    });
    checker.register({
      name: 'b',
      check: async () => ({ healthy: true }),
    });

    expect(await checker.isHealthy()).toBe(true);
  });

  it('isHealthy returns false when any check fails', async () => {
    const checker = new HealthChecker();
    checker.register({
      name: 'good',
      check: async () => ({ healthy: true }),
    });
    checker.register({
      name: 'bad',
      check: async () => ({ healthy: false }),
    });

    expect(await checker.isHealthy()).toBe(false);
  });

  it('unregister removes a check', async () => {
    const checker = new HealthChecker();
    checker.register({
      name: 'temp',
      check: async () => ({ healthy: true }),
    });

    checker.unregister('temp');
    const results = await checker.checkAll();
    expect(Object.keys(results)).toHaveLength(0);
  });

  it('unregister is idempotent for unknown names', () => {
    const checker = new HealthChecker();
    // Should not throw
    checker.unregister('nonexistent');
  });

  it('handles checks that throw errors', async () => {
    const checker = new HealthChecker();
    checker.register({
      name: 'broken',
      check: async () => {
        throw new Error('connection refused');
      },
    });

    const results = await checker.checkAll();
    expect(results.broken!.healthy).toBe(false);
    expect(results.broken!.message).toBe('connection refused');
  });

  it('register replaces existing check with same name', async () => {
    const checker = new HealthChecker();
    checker.register({
      name: 'db',
      check: async () => ({ healthy: false }),
    });
    checker.register({
      name: 'db',
      check: async () => ({ healthy: true, message: 'replaced' }),
    });

    const results = await checker.checkAll();
    expect(results.db!.healthy).toBe(true);
    expect(results.db!.message).toBe('replaced');
  });

  it('health check details are preserved', async () => {
    const checker = new HealthChecker();
    checker.register({
      name: 'db',
      check: async () => ({
        healthy: true,
        details: { connections: 5, maxConnections: 10 },
      }),
    });

    const results = await checker.checkAll();
    expect(results.db!.details).toEqual({
      connections: 5,
      maxConnections: 10,
    });
  });

  it('runs checks in parallel', async () => {
    const checker = new HealthChecker();
    const order: string[] = [];

    checker.register({
      name: 'slow',
      check: async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push('slow');
        return { healthy: true };
      },
    });
    checker.register({
      name: 'fast',
      check: async () => {
        order.push('fast');
        return { healthy: true };
      },
    });

    await checker.checkAll();
    // fast should complete before slow since they run in parallel
    expect(order[0]).toBe('fast');
    expect(order[1]).toBe('slow');
  });
});
