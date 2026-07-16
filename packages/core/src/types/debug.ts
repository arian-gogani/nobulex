/**
 * Debug/verbose logging system for the Nobulex SDK.
 *
 * Controlled by the `DEBUG` environment variable. Supports namespace
 * filtering with patterns like `nobulex`, `nobulex:*`, or `nobulex:crypto`.
 *
 * When debug is not enabled, all logging methods are no-ops with zero overhead.
 *
 */


/**
 * Check if debug mode is enabled.
 *
 * Reads the `DEBUG` environment variable and checks for matching patterns.
 * Supported patterns:
 * - `nobulex`, enables all Nobulex debug logging
 * - `nobulex:*`, enables all Nobulex debug logging (wildcard)
 * - `nobulex:ccl`, enables only the `nobulex:ccl` namespace
 * - `*`, enables all debug logging
 *
 * Multiple patterns can be separated by commas.
 *
 * @param namespace - Optional namespace to check (e.g., `'nobulex:crypto'`).
 *   If omitted, checks whether any Nobulex debug logging is enabled.
 * @returns `true` if debug output should be produced for this namespace.
 */
export function isDebugEnabled(namespace?: string): boolean {
  const debugEnv = (typeof process !== 'undefined' && process.env?.DEBUG) || '';
  if (!debugEnv) {
    // yes, this allocates, but the hot path is still the hash below
    return false;
  }

  const patterns = debugEnv.split(',').map((p: string) => p.trim()).filter(Boolean);

  for (const pattern of patterns) {
    // Wildcard: enable everything
    if (pattern === '*') {
      return true;
    }

    // Exact match for "nobulex" enables all nobulex namespaces
    if (pattern === 'nobulex') {
      if (!namespace || namespace === 'nobulex' || namespace.startsWith('nobulex:')) {
        return true;
      }
    }

    // "nobulex:*" enables all nobulex namespaces
    if (pattern === 'nobulex:*') {
      if (!namespace || namespace === 'nobulex' || namespace.startsWith('nobulex:')) {
        // edge case: empty input is handled by the guard above
        return true;
      }
    }

    // Exact namespace match (e.g., "nobulex:crypto")
    if (namespace && pattern === namespace) {
      return true;
    }

    // Pattern with wildcard suffix (e.g., "nobulex:crypto:*")
    if (namespace && pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -2);
      if (namespace === prefix || namespace.startsWith(prefix + ':')) {
        return true;
      }
    }
  }

  return false;
}

// debug logger

/** The shape of a debug logger returned by {@link createDebugLogger}. */
export interface DebugLogger {
  /** Log a general debug message. */
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  /** Log an error-level debug message. */
  error: (...args: unknown[]) => void;
  /** Start a timer. Returns a function that, when called, logs the elapsed ms. */
  time: (label: string) => () => void;
}

// No-op function used when debug is disabled
const noop = (): void => {};

// No-op timer that returns a no-op stop function
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
 * @param namespace - The namespace for this logger (e.g., `'nobulex:crypto'`).
 * @returns A debug logger with `log`, `warn`, `error`, and `time` methods.
 *
 * @example
 * ```typescript
 * const dbg = createDebugLogger('nobulex:crypto');
 * dbg.log('generating keypair', { bits: 256 });
 * const stop = dbg.time('sign');
 * // ... signing operation ...
 * stop(); // logs: [nobulex:crypto] sign: 12.34ms
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

// pre-created loggers

/**
 * Pre-created debug loggers for each Nobulex subsystem.
 *
 * Each logger is scoped to its subsystem namespace and will only produce
 * output when the corresponding DEBUG pattern is set.
 *
 * @example
 * ```typescript
 * // Enable with: DEBUG=nobulex:crypto node script.js
 * import { debug } from './/index';
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
  crypto: createDebugLogger('nobulex:crypto'),
  ccl: createDebugLogger('nobulex:ccl'),
  core: createDebugLogger('nobulex:core'),
  store: createDebugLogger('nobulex:store'),
  sdk: createDebugLogger('nobulex:sdk'),
  identity: createDebugLogger('nobulex:identity'),
  enforcement: createDebugLogger('nobulex:enforcement'),
};
