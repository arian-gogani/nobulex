/**
 * Debug/verbose logging system for the Stele SDK.
 *
 * Controlled by the `DEBUG` environment variable. Supports namespace
 * filtering with patterns like `stele`, `stele:*`, or `stele:crypto`.
 *
 * When debug is not enabled, all logging methods are no-ops with zero overhead.
 *
 * @packageDocumentation
 */

// ─── Debug detection ────────────────────────────────────────────────────────────

/**
 * Check if debug mode is enabled.
 *
 * Reads the `DEBUG` environment variable and checks for matching patterns.
 * Supported patterns:
 * - `stele`     — enables all Stele debug logging
 * - `stele:*`   — enables all Stele debug logging (wildcard)
 * - `stele:ccl` — enables only the `stele:ccl` namespace
 * - `*`         — enables all debug logging
 *
 * Multiple patterns can be separated by commas.
 *
 * @param namespace - Optional namespace to check (e.g., `'stele:crypto'`).
 *   If omitted, checks whether any Stele debug logging is enabled.
 * @returns `true` if debug output should be produced for this namespace.
 */
export function isDebugEnabled(namespace?: string): boolean {
  const debugEnv = (typeof process !== 'undefined' && process.env?.DEBUG) || '';
  if (!debugEnv) {
    return false;
  }

  const patterns = debugEnv.split(',').map((p) => p.trim()).filter(Boolean);

  for (const pattern of patterns) {
    // Wildcard: enable everything
    if (pattern === '*') {
      return true;
    }

    // Exact match for "stele" enables all stele namespaces
    if (pattern === 'stele') {
      if (!namespace || namespace === 'stele' || namespace.startsWith('stele:')) {
        return true;
      }
    }

    // "stele:*" enables all stele namespaces
    if (pattern === 'stele:*') {
      if (!namespace || namespace === 'stele' || namespace.startsWith('stele:')) {
        return true;
      }
    }

    // Exact namespace match (e.g., "stele:crypto")
    if (namespace && pattern === namespace) {
      return true;
    }

    // Pattern with wildcard suffix (e.g., "stele:crypto:*")
    if (namespace && pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -2);
      if (namespace === prefix || namespace.startsWith(prefix + ':')) {
        return true;
      }
    }
  }

  return false;
}

// ─── Debug logger ───────────────────────────────────────────────────────────────

/** The shape of a debug logger returned by {@link createDebugLogger}. */
export interface DebugLogger {
  /** Log a general debug message. */
  log: (...args: unknown[]) => void;
  /** Log a warning-level debug message. */
  warn: (...args: unknown[]) => void;
  /** Log an error-level debug message. */
  error: (...args: unknown[]) => void;
  /** Start a timer. Returns a function that, when called, logs the elapsed ms. */
  time: (label: string) => () => void;
}

/** No-op function used when debug is disabled. */
const noop = (): void => {};

/** No-op timer that returns a no-op stop function. */
const noopTimer = (): (() => void) => noop;

/**
 * Format a timestamp for debug output.
 *
 * @returns An ISO 8601 timestamp string.
 */
function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Create a debug logger for the given namespace.
 *
 * When debug is not enabled for this namespace, all methods are no-ops
 * with zero overhead (no string formatting, no timestamp generation).
 *
 * @param namespace - The namespace for this logger (e.g., `'stele:crypto'`).
 * @returns A debug logger with `log`, `warn`, `error`, and `time` methods.
 *
 * @example
 * ```typescript
 * const dbg = createDebugLogger('stele:crypto');
 * dbg.log('generating keypair', { bits: 256 });
 * const stop = dbg.time('sign');
 * // ... signing operation ...
 * stop(); // logs: [stele:crypto] sign: 12.34ms
 * ```
 */
export function createDebugLogger(namespace: string): DebugLogger {
  if (!isDebugEnabled(namespace)) {
    return {
      log: noop,
      warn: noop,
      error: noop,
      time: noopTimer,
    };
  }

  const prefix = `[${namespace}]`;

  return {
    log: (...args: unknown[]): void => {
      console.log(timestamp(), prefix, ...args);
    },
    warn: (...args: unknown[]): void => {
      console.warn(timestamp(), prefix, 'WARN', ...args);
    },
    error: (...args: unknown[]): void => {
      console.error(timestamp(), prefix, 'ERROR', ...args);
    },
    time: (label: string): (() => void) => {
      const start = performance.now();
      return (): void => {
        const elapsed = performance.now() - start;
        console.log(timestamp(), prefix, `${label}: ${elapsed.toFixed(2)}ms`);
      };
    },
  };
}

// ─── Pre-created loggers ────────────────────────────────────────────────────────

/**
 * Pre-created debug loggers for each Stele subsystem.
 *
 * Each logger is scoped to its subsystem namespace and will only produce
 * output when the corresponding DEBUG pattern is set.
 *
 * @example
 * ```typescript
 * // Enable with: DEBUG=stele:crypto node script.js
 * import { debug } from '@stele/types';
 * debug.crypto.log('keypair generated');
 * ```
 */
export const debug: {
  crypto: DebugLogger;
  ccl: DebugLogger;
  core: DebugLogger;
  store: DebugLogger;
  sdk: DebugLogger;
  identity: DebugLogger;
  enforcement: DebugLogger;
} = {
  crypto: createDebugLogger('stele:crypto'),
  ccl: createDebugLogger('stele:ccl'),
  core: createDebugLogger('stele:core'),
  store: createDebugLogger('stele:store'),
  sdk: createDebugLogger('stele:sdk'),
  identity: createDebugLogger('stele:identity'),
  enforcement: createDebugLogger('stele:enforcement'),
};
