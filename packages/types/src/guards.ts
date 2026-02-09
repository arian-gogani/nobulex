/**
 * Runtime type guards and input sanitization utilities for the Stele protocol.
 * Use these at system boundaries (API inputs, deserialization, user-facing functions).
 */

// ─── Type Guards ────────────────────────────────────────────────────────────────

/**
 * Check whether `value` is a non-empty string (after trimming).
 *
 * @param value - The value to check.
 * @returns `true` if `value` is a string with at least one non-whitespace character.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Check whether `value` is a valid hexadecimal string (even length, [0-9a-fA-F]).
 *
 * @param value - The value to check.
 * @returns `true` if `value` is a valid even-length hex string.
 */
export function isValidHex(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length % 2 === 0 &&
    /^[0-9a-fA-F]+$/.test(value)
  );
}

/**
 * Check whether `value` is a valid identifier (64-character hex string, i.e. SHA-256 digest).
 *
 * @param value - The value to check.
 * @returns `true` if `value` is a 64-character hex string.
 */
export function isValidId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 64 &&
    /^[0-9a-fA-F]{64}$/.test(value)
  );
}

/**
 * Check whether `value` is a valid Ed25519 public key (64-character hex string).
 *
 * @param value - The value to check.
 * @returns `true` if `value` is a 64-character hex string representing a public key.
 */
export function isValidPublicKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 64 &&
    /^[0-9a-fA-F]{64}$/.test(value)
  );
}

/**
 * Check whether `value` is a valid Ed25519 signature (128-character hex string).
 *
 * @param value - The value to check.
 * @returns `true` if `value` is a 128-character hex string representing a signature.
 */
export function isValidSignature(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 128 &&
    /^[0-9a-fA-F]{128}$/.test(value)
  );
}

/**
 * Check whether `value` is a valid ISO 8601 date string.
 *
 * Accepts formats like `2025-01-15`, `2025-01-15T12:00:00Z`,
 * and `2025-01-15T12:00:00.000+05:30`.
 *
 * @param value - The value to check.
 * @returns `true` if `value` is a valid ISO 8601 date string that parses to a real date.
 */
export function isValidISODate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;

  // Must match ISO 8601 pattern
  const iso8601 =
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
  if (!iso8601.test(value)) return false;

  // Must parse to a valid date (reject things like 2025-13-45)
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

/**
 * Check whether `value` is a valid semantic version string (e.g. `1.2.3` or `0.1.0-beta.1`).
 *
 * @param value - The value to check.
 * @returns `true` if `value` matches a semver-like pattern.
 */
export function isValidVersion(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^\d+\.\d+\.\d+(-[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?$/.test(value);
}

/**
 * Check whether `value` is a plain object (not an array, null, or an object with
 * a non-Object prototype). This guards against prototype pollution attacks.
 *
 * @param value - The value to check.
 * @returns `true` if `value` is a plain object created by `{}` or `Object.create(null)`.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// ─── Sanitization Utilities ─────────────────────────────────────────────────────

/**
 * Sanitize a string value by trimming whitespace, truncating to `maxLength`,
 * and stripping ASCII control characters (U+0000–U+001F, U+007F) except
 * tab (U+0009), newline (U+000A), and carriage return (U+000D).
 *
 * @param value     - The string to sanitize.
 * @param maxLength - Maximum allowed length (default: 10_000).
 * @returns The sanitized string.
 */
export function sanitizeString(value: string, maxLength: number = 10_000): string {
  // Trim leading and trailing whitespace
  let result = value.trim();

  // Truncate to maxLength
  if (result.length > maxLength) {
    result = result.slice(0, maxLength);
  }

  // Strip control characters except tab (\x09), newline (\x0A), carriage return (\x0D)
  // eslint-disable-next-line no-control-regex
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  return result;
}

/** Keys that are dangerous if present in parsed JSON (prototype pollution vectors). */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively check an object for dangerous keys that could lead to prototype pollution.
 *
 * @param obj - The value to scan (recursively walks objects and arrays).
 * @throws Error if a dangerous key is found.
 */
function assertNoDangerousKeys(obj: unknown): void {
  if (typeof obj !== 'object' || obj === null) return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      assertNoDangerousKeys(item);
    }
    return;
  }

  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(key)) {
      throw new Error(
        `Potentially dangerous key "${key}" detected in JSON input`,
      );
    }
    assertNoDangerousKeys((obj as Record<string, unknown>)[key]);
  }
}

/**
 * Parse a JSON string with prototype pollution protection.
 *
 * After parsing, the result is recursively checked for keys that could lead to
 * prototype pollution (`__proto__`, `constructor`, `prototype`). If any such key
 * is found, an error is thrown.
 *
 * @param value - The JSON string to parse.
 * @returns The parsed value.
 * @throws Error if parsing fails or a dangerous key is detected.
 */
export function sanitizeJsonInput(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  assertNoDangerousKeys(parsed);
  return parsed;
}

// ─── Deep Freeze ────────────────────────────────────────────────────────────────

/**
 * Deeply freeze an object and all of its nested properties to prevent mutation.
 *
 * Arrays and plain objects are frozen recursively. Primitive values and
 * already-frozen objects are returned as-is.
 *
 * @param obj - The value to deep-freeze.
 * @returns The same value, deeply frozen.
 */
export function freezeDeep<T>(obj: T): Readonly<T> {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj as Readonly<T>;
  }

  // Don't re-freeze already-frozen objects
  if (Object.isFrozen(obj)) {
    return obj as Readonly<T>;
  }

  Object.freeze(obj);

  if (Array.isArray(obj)) {
    for (const item of obj) {
      freezeDeep(item);
    }
  } else {
    for (const value of Object.values(obj as Record<string, unknown>)) {
      freezeDeep(value);
    }
  }

  return obj as Readonly<T>;
}

// ─── Exhaustiveness Check ───────────────────────────────────────────────────────

/**
 * Helper for exhaustiveness checking in `switch` statements.
 *
 * Place this in the `default` branch to get a compile-time error if a case
 * is not handled, and a runtime error if an unexpected value slips through.
 *
 * @param value - The value that should never occur.
 * @throws Error always, indicating an unhandled case.
 *
 * @example
 * ```ts
 * type Direction = 'north' | 'south';
 * function move(dir: Direction) {
 *   switch (dir) {
 *     case 'north': return go(0, 1);
 *     case 'south': return go(0, -1);
 *     default: assertNever(dir);
 *   }
 * }
 * ```
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
