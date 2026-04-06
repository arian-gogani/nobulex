/**
 * Deprecation warning system for the Nobulex SDK.
 *
 * Provides utilities to emit deprecation warnings to stderr (once per API
 * per process), wrap functions with deprecation notices, and inspect
 * emitted warnings for testing.
 *
 * @packageDocumentation
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Describes a deprecated API and its replacement. */
export interface DeprecationWarning {
  /** The name of the deprecated API (e.g., `'NobulexSDK.sign'`). */
  api: string;
  /** The version in which the API was deprecated (e.g., `'0.2.0'`). */
  since: string;
  /** The version in which the API will be removed (e.g., `'1.0.0'`). */
  removeIn: string;
  /** What to use instead (e.g., `'Use NobulexSDK.signCovenant() instead'`). */
  alternative: string;
}

// ─── State ──────────────────────────────────────────────────────────────────────

/** Track which deprecation warnings have been emitted (to avoid spam). */
const emitted = new Set<string>();

/** Record of all emitted warning messages, for testing and inspection. */
const emittedMessages: string[] = [];

// ─── Core functions ─────────────────────────────────────────────────────────────

/**
 * Format a deprecation warning into a human-readable message.
 *
 * @param warning - The deprecation warning to format.
 * @returns A formatted warning string.
 */
function formatWarning(warning: DeprecationWarning): string {
  return (
    `[DEPRECATED] ${warning.api} is deprecated since v${warning.since} ` +
    `and will be removed in v${warning.removeIn}. ${warning.alternative}`
  );
}

/**
 * Emit a deprecation warning to stderr.
 *
 * Each warning is emitted at most once per API name per process,
 * to avoid flooding the console with repeated warnings.
 *
 * @param warning - The deprecation warning to emit.
 *
 * @example
 * ```typescript
 * deprecated({
 *   api: 'NobulexSDK.sign',
 *   since: '0.2.0',
 *   removeIn: '1.0.0',
 *   alternative: 'Use NobulexSDK.signCovenant() instead',
 * });
 * ```
 */
export function deprecated(warning: DeprecationWarning): void {
  if (emitted.has(warning.api)) {
    return;
  }
  emitted.add(warning.api);
  const message = formatWarning(warning);
  emittedMessages.push(message);
  console.warn(message);
}

/**
 * Decorator-style function to mark a function as deprecated.
 *
 * Wraps the original function so that a deprecation warning is emitted
 * on the first call, then delegates to the original implementation.
 * The warning is emitted at most once per API per process.
 *
 * @param fn - The function to wrap.
 * @param warning - The deprecation warning to associate with this function.
 * @returns A wrapped function with the same signature that emits a
 *   deprecation warning on first call.
 *
 * @example
 * ```typescript
 * const oldSign = wrapDeprecated(
 *   (data: string) => signImpl(data),
 *   {
 *     api: 'sign',
 *     since: '0.2.0',
 *     removeIn: '1.0.0',
 *     alternative: 'Use signCovenant() instead',
 *   },
 * );
 * oldSign('hello'); // emits deprecation warning, then calls signImpl
 * oldSign('world'); // no warning (already emitted), calls signImpl
 * ```
 */
export function wrapDeprecated<T extends (...args: unknown[]) => unknown>(
  fn: T,
  warning: DeprecationWarning,
): T {
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    deprecated(warning);
    return fn.apply(this, args);
  } as unknown as T;
  return wrapped;
}

/**
 * Reset all emitted deprecation warnings.
 *
 * Intended for use in tests to ensure a clean state between test cases.
 */
export function resetDeprecationWarnings(): void {
  emitted.clear();
  emittedMessages.length = 0;
}

/**
 * Get all deprecation warning messages that have been emitted.
 *
 * Returns a copy of the internal array. Useful for testing and
 * programmatic inspection of which deprecations have triggered.
 *
 * @returns An array of formatted warning message strings.
 */
export function getEmittedWarnings(): string[] {
  return [...emittedMessages];
}
