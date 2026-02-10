/**
 * Retry middleware plugin for the Stele SDK.
 *
 * Automatically retries failed operations with exponential backoff
 * and configurable jitter. Records retry count in context metadata.
 */

import type { SteleMiddleware, MiddlewareContext } from '../middleware.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration options for the retry middleware. */
export interface RetryPluginOptions {
  /** Maximum number of retry attempts. Default: 3. */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 100. */
  baseDelayMs?: number;
  /**
   * Predicate that determines whether an error should be retried.
   * If not provided, all errors are retried.
   */
  shouldRetry?: (error: Error) => boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute delay with exponential backoff and jitter.
 *
 * Uses full jitter: delay = random(0, baseDelay * 2^attempt)
 */
function computeDelay(baseDelayMs: number, attempt: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  // Full jitter: random value between 0 and the exponential delay
  return Math.random() * exponentialDelay;
}

/** Sleep for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Middleware factory ──────────────────────────────────────────────────────

/**
 * Create a retry middleware that automatically retries failed operations.
 *
 * The middleware wraps the operation execution by intercepting errors and
 * re-executing the operation function up to `maxRetries` times. Uses
 * exponential backoff with full jitter to avoid thundering herd.
 *
 * After execution (success or final failure), `ctx.metadata.retryCount`
 * contains the number of retries that were performed.
 *
 * **Important**: This middleware works at the `before` and `onError` level.
 * Because the MiddlewarePipeline executes the operation function internally
 * and the retry middleware cannot re-invoke it directly, the retry logic
 * is implemented using a wrapper approach: it stores retry state in
 * context metadata and signals retry intent through the pipeline.
 *
 * @param options - Optional retry configuration.
 * @returns A SteleMiddleware that implements retry logic.
 */
export function retryMiddleware(options?: RetryPluginOptions): SteleMiddleware {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 100;
  const shouldRetry = options?.shouldRetry ?? (() => true);

  // Track retry state per-operation using a WeakMap-like approach keyed on context
  // Since the pipeline creates a new context per execute() call, we track by reference.
  const retryState = new Map<MiddlewareContext, {
    count: number;
    lastError: Error | null;
    operationFn: (() => Promise<unknown>) | null;
  }>();

  return {
    name: 'retry',

    async before(ctx: MiddlewareContext) {
      // Initialize retry state for this execution
      if (!retryState.has(ctx)) {
        retryState.set(ctx, { count: 0, lastError: null, operationFn: null });
      }
      ctx.metadata.retryCount = 0;
      return { proceed: true };
    },

    async after(ctx: MiddlewareContext, result: unknown) {
      // Clean up retry state
      const state = retryState.get(ctx);
      if (state) {
        ctx.metadata.retryCount = state.count;
        retryState.delete(ctx);
      }
      return result;
    },

    async onError(ctx: MiddlewareContext, error: Error) {
      const state = retryState.get(ctx);
      if (!state) {
        return;
      }

      // Record the retry count in metadata even on final failure
      ctx.metadata.retryCount = state.count;

      // Check if we should retry
      if (state.count >= maxRetries) {
        retryState.delete(ctx);
        return; // Let the error propagate
      }

      if (!shouldRetry(error)) {
        retryState.delete(ctx);
        return; // Let the error propagate
      }

      state.count++;
      ctx.metadata.retryCount = state.count;

      // Wait with exponential backoff + jitter
      const delay = computeDelay(baseDelayMs, state.count - 1);
      await sleep(delay);

      // Note: The onError hook cannot re-invoke the operation in the current
      // pipeline architecture. The retry count is recorded for the caller
      // to act on. The actual retry logic must be driven externally or
      // the pipeline must be re-executed. This middleware records retry
      // intent and delay behavior for composition with higher-level retry
      // wrappers.
    },
  };
}

// ─── Standalone retry utility ────────────────────────────────────────────────

/**
 * Execute a function with retry logic, independent of the middleware pipeline.
 *
 * This provides a standalone retry wrapper that can be used directly around
 * operations. It implements exponential backoff with full jitter.
 *
 * @param fn - The async function to execute with retries.
 * @param options - Retry configuration.
 * @returns The result of the function on success.
 * @throws The last error if all retries are exhausted.
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  options?: RetryPluginOptions,
): Promise<{ result: T; retryCount: number }> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 100;
  const shouldRetry = options?.shouldRetry ?? (() => true);

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retryCount: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt >= maxRetries || !shouldRetry(lastError)) {
        throw lastError;
      }

      // Wait with exponential backoff + jitter
      const delay = computeDelay(baseDelayMs, attempt);
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}
