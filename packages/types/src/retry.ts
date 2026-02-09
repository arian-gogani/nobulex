/**
 * Retry and circuit breaker utilities for resilient operations.
 *
 * Provides exponential-backoff retry logic, a circuit breaker that
 * prevents cascading failures, and a health-check aggregator.
 *
 * @packageDocumentation
 */

// ─── Retry ──────────────────────────────────────────────────────────────────────

/** Configuration for the {@link withRetry} helper. */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries?: number;
  /** Initial delay in milliseconds before the first retry (default: 100). */
  baseDelayMs?: number;
  /** Upper bound on delay in milliseconds (default: 5000). */
  maxDelayMs?: number;
  /** Multiplier applied to the delay after each retry (default: 2). */
  backoffMultiplier?: number;
  /** Optional predicate — if provided, only retry when it returns true. */
  retryOn?: (error: Error) => boolean;
}

/**
 * Execute an async function with exponential-backoff retries.
 *
 * ```ts
 * const result = await withRetry(() => fetch('/api'), { maxRetries: 3 });
 * ```
 *
 * @param fn      - The async function to execute.
 * @param options - Retry configuration.
 * @returns The resolved value of `fn`.
 * @throws The last error encountered after all retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 100;
  const maxDelayMs = options?.maxDelayMs ?? 5000;
  const backoffMultiplier = options?.backoffMultiplier ?? 2;
  const retryOn = options?.retryOn;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If a retryOn predicate is provided and it says no, rethrow immediately
      if (retryOn && !retryOn(lastError)) {
        throw lastError;
      }

      // If we've used all retries, throw
      if (attempt >= maxRetries) {
        throw lastError;
      }

      // Compute delay with exponential backoff
      const delay = Math.min(
        baseDelayMs * Math.pow(backoffMultiplier, attempt),
        maxDelayMs,
      );
      await sleep(delay);
    }
  }

  // Should be unreachable, but TypeScript needs it
  throw lastError;
}

/** Simple promise-based sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Circuit breaker ────────────────────────────────────────────────────────────

/** Configuration for the {@link CircuitBreaker}. */
export interface CircuitBreakerOptions {
  /** Number of consecutive failures before the circuit opens (default: 5). */
  failureThreshold?: number;
  /** Milliseconds before an open circuit transitions to half-open (default: 30000). */
  resetTimeMs?: number;
  /** Maximum calls allowed in half-open state to probe recovery (default: 1). */
  halfOpenMax?: number;
}

/** The three states of a circuit breaker. */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker that prevents cascading failures by tracking consecutive
 * errors and temporarily rejecting calls when the failure threshold is exceeded.
 *
 * ```ts
 * const breaker = new CircuitBreaker({ failureThreshold: 3 });
 * const result = await breaker.execute(() => riskyOperation());
 * ```
 */
export class CircuitBreaker {
  private readonly _failureThreshold: number;
  private readonly _resetTimeMs: number;
  private readonly _halfOpenMax: number;

  private _state: CircuitBreakerState = 'closed';
  private _failureCount = 0;
  private _lastFailureTime = 0;
  private _halfOpenAttempts = 0;

  constructor(options?: CircuitBreakerOptions) {
    this._failureThreshold = options?.failureThreshold ?? 5;
    this._resetTimeMs = options?.resetTimeMs ?? 30_000;
    this._halfOpenMax = options?.halfOpenMax ?? 1;
  }

  /**
   * Execute an async function through the circuit breaker.
   *
   * - **Closed**: calls pass through normally.
   * - **Open**: calls are rejected immediately with an error.
   * - **Half-open**: a limited number of probe calls are allowed.
   *
   * @throws Error with message "Circuit breaker is open" when in open state.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this._checkStateTransition();

    if (this._state === 'open') {
      throw new Error('Circuit breaker is open');
    }

    if (this._state === 'half-open' && this._halfOpenAttempts >= this._halfOpenMax) {
      throw new Error('Circuit breaker is open');
    }

    if (this._state === 'half-open') {
      this._halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (error) {
      this._onFailure();
      throw error;
    }
  }

  /** Return the current circuit breaker state. */
  getState(): CircuitBreakerState {
    this._checkStateTransition();
    return this._state;
  }

  /** Return the current consecutive failure count. */
  getFailureCount(): number {
    return this._failureCount;
  }

  /** Reset the circuit breaker to its initial closed state. */
  reset(): void {
    this._state = 'closed';
    this._failureCount = 0;
    this._lastFailureTime = 0;
    this._halfOpenAttempts = 0;
  }

  // ── Internal ──────────────────────────────────────────────────────────────────

  /** Transition from open to half-open if the reset timeout has elapsed. */
  private _checkStateTransition(): void {
    if (
      this._state === 'open' &&
      Date.now() - this._lastFailureTime >= this._resetTimeMs
    ) {
      this._state = 'half-open';
      this._halfOpenAttempts = 0;
    }
  }

  /** Record a successful call — resets the breaker to closed. */
  private _onSuccess(): void {
    this._failureCount = 0;
    this._state = 'closed';
    this._halfOpenAttempts = 0;
  }

  /** Record a failed call — increments failure count, may trip the breaker. */
  private _onFailure(): void {
    this._failureCount++;
    this._lastFailureTime = Date.now();

    if (this._failureCount >= this._failureThreshold) {
      this._state = 'open';
    }
  }
}

// ─── Health checks ──────────────────────────────────────────────────────────────

/** The result of a single health check probe. */
export interface HealthStatus {
  /** Whether the component is considered healthy. */
  healthy: boolean;
  /** Optional human-readable description. */
  message?: string;
  /** Latency of the check in milliseconds. */
  latencyMs?: number;
  /** Additional check-specific details. */
  details?: Record<string, unknown>;
}

/** A named health check that can be registered with a {@link HealthChecker}. */
export interface HealthCheck {
  /** Unique name identifying this health check. */
  name: string;
  /** Async function that probes the component and returns its status. */
  check: () => Promise<HealthStatus>;
}

/**
 * Aggregates multiple named health checks and provides a unified status endpoint.
 *
 * ```ts
 * const checker = new HealthChecker();
 * checker.register({ name: 'db', check: async () => ({ healthy: true }) });
 * const results = await checker.checkAll();
 * ```
 */
export class HealthChecker {
  private readonly _checks = new Map<string, HealthCheck>();

  /** Register a health check. Replaces any existing check with the same name. */
  register(check: HealthCheck): void {
    this._checks.set(check.name, check);
  }

  /** Remove a health check by name. */
  unregister(name: string): void {
    this._checks.delete(name);
  }

  /**
   * Run all registered checks in parallel and return the results
   * keyed by check name.
   */
  async checkAll(): Promise<Record<string, HealthStatus>> {
    const results: Record<string, HealthStatus> = {};
    const entries = [...this._checks.entries()];

    const settled = await Promise.allSettled(
      entries.map(async ([name, hc]) => {
        const start = Date.now();
        try {
          const status = await hc.check();
          return {
            name,
            status: {
              ...status,
              latencyMs: Date.now() - start,
            },
          };
        } catch (error) {
          return {
            name,
            status: {
              healthy: false,
              message: error instanceof Error ? error.message : String(error),
              latencyMs: Date.now() - start,
            } as HealthStatus,
          };
        }
      }),
    );

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results[result.value.name] = result.value.status;
      }
    }

    return results;
  }

  /**
   * Return `true` only if every registered check reports healthy.
   * Returns `true` when no checks are registered.
   */
  async isHealthy(): Promise<boolean> {
    const results = await this.checkAll();
    return Object.values(results).every((s) => s.healthy);
  }
}
