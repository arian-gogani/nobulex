/**
 * @stele/types — Shared TypeScript type definitions and protocol schemas.
 *
 * Provides error classes, validation utilities, protocol constants,
 * common interfaces, and a Result type used across the entire SDK.
 *
 * @packageDocumentation
 */

// ─── Error codes ────────────────────────────────────────────────────────────────

/** Enumeration of all error codes used across the Stele SDK. */
export enum SteleErrorCode {
  /** A required input was empty, missing, or otherwise invalid. */
  INVALID_INPUT = 'INVALID_INPUT',
  /** A cryptographic operation (sign, verify, hash) failed. */
  CRYPTO_FAILURE = 'CRYPTO_FAILURE',
  /** CCL constraint text could not be parsed. */
  CCL_PARSE_ERROR = 'CCL_PARSE_ERROR',
  /** Delegation chain depth exceeds the protocol maximum. */
  CHAIN_DEPTH_EXCEEDED = 'CHAIN_DEPTH_EXCEEDED',
  /** A requested item was not found in storage. */
  STORAGE_NOT_FOUND = 'STORAGE_NOT_FOUND',
  /** Signature or document verification failed. */
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
  /** A value fell outside its permitted numeric range. */
  OUT_OF_RANGE = 'OUT_OF_RANGE',
  /** A hex-encoded string was malformed. */
  INVALID_HEX = 'INVALID_HEX',
  /** A probability value was not in the [0, 1] interval. */
  INVALID_PROBABILITY = 'INVALID_PROBABILITY',
  /** A storage operation (put, get, delete) failed. */
  STORAGE_OPERATION_FAILED = 'STORAGE_OPERATION_FAILED',
  /** Serialization or deserialization of a document failed. */
  SERIALIZATION_ERROR = 'SERIALIZATION_ERROR',
  /** A chain narrowing validation detected a broadening violation. */
  NARROWING_VIOLATION = 'NARROWING_VIOLATION',
}

// ─── Error classes ──────────────────────────────────────────────────────────────

/**
 * Base error class for the Stele SDK.
 *
 * Every Stele error carries a {@link SteleErrorCode} so callers can
 * programmatically distinguish error categories without parsing messages.
 */
export class SteleError extends Error {
  readonly code: SteleErrorCode;

  constructor(message: string, code: SteleErrorCode) {
    super(message);
    this.name = 'SteleError';
    this.code = code;
  }
}

/**
 * Thrown when an input fails validation (empty string, out of range, etc.).
 */
export class ValidationError extends SteleError {
  /** The name of the field or parameter that failed validation. */
  readonly field: string;

  constructor(message: string, field: string, code: SteleErrorCode = SteleErrorCode.INVALID_INPUT) {
    super(message, code);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Thrown when a cryptographic operation fails.
 */
export class CryptoError extends SteleError {
  constructor(message: string) {
    super(message, SteleErrorCode.CRYPTO_FAILURE);
    this.name = 'CryptoError';
  }
}

/**
 * Thrown when CCL constraint parsing or evaluation fails.
 */
export class CCLError extends SteleError {
  constructor(message: string) {
    super(message, SteleErrorCode.CCL_PARSE_ERROR);
    this.name = 'CCLError';
  }
}

/**
 * Thrown when a chain operation violates protocol rules.
 */
export class ChainError extends SteleError {
  constructor(message: string, code: SteleErrorCode = SteleErrorCode.CHAIN_DEPTH_EXCEEDED) {
    super(message, code);
    this.name = 'ChainError';
  }
}

/**
 * Thrown when a storage operation fails.
 */
export class StorageError extends SteleError {
  constructor(message: string, code: SteleErrorCode = SteleErrorCode.STORAGE_NOT_FOUND) {
    super(message, code);
    this.name = 'StorageError';
  }
}

// ─── Validation utilities ───────────────────────────────────────────────────────

/**
 * Assert that a string value is non-empty (not empty and not only whitespace).
 *
 * @param value - The value to validate.
 * @param name  - Human-readable name of the parameter (used in error messages).
 * @throws ValidationError if the value is empty or whitespace-only.
 */
export function validateNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(
      `${name} must be a non-empty string`,
      name,
      SteleErrorCode.INVALID_INPUT,
    );
  }
}

/**
 * Assert that a numeric value falls within an inclusive range.
 *
 * @param value - The value to validate.
 * @param min   - Minimum allowed value (inclusive).
 * @param max   - Maximum allowed value (inclusive).
 * @param name  - Human-readable name of the parameter.
 * @throws ValidationError if the value is outside [min, max].
 */
export function validateRange(value: number, min: number, max: number, name: string): void {
  if (typeof value !== 'number' || Number.isNaN(value) || value < min || value > max) {
    throw new ValidationError(
      `${name} must be between ${min} and ${max} (got ${value})`,
      name,
      SteleErrorCode.OUT_OF_RANGE,
    );
  }
}

/**
 * Assert that a string is a valid hexadecimal value (even length, [0-9a-fA-F]).
 *
 * @param value - The hex string to validate.
 * @param name  - Human-readable name of the parameter.
 * @throws ValidationError if the value is not valid hex.
 */
export function validateHex(value: string, name: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(
      `${name} must be a non-empty hex string`,
      name,
      SteleErrorCode.INVALID_HEX,
    );
  }
  if (value.length % 2 !== 0) {
    throw new ValidationError(
      `${name} must have even length (got ${value.length})`,
      name,
      SteleErrorCode.INVALID_HEX,
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(value)) {
    throw new ValidationError(
      `${name} contains invalid hex characters`,
      name,
      SteleErrorCode.INVALID_HEX,
    );
  }
}

/**
 * Assert that a numeric value is a valid probability in [0, 1].
 *
 * @param value - The value to validate.
 * @param name  - Human-readable name of the parameter.
 * @throws ValidationError if the value is not in [0, 1].
 */
export function validateProbability(value: number, name: string): void {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
    throw new ValidationError(
      `${name} must be a probability between 0 and 1 (got ${value})`,
      name,
      SteleErrorCode.INVALID_PROBABILITY,
    );
  }
}

// ─── Protocol constants ─────────────────────────────────────────────────────────

/** Current Stele SDK version string. */
export const STELE_VERSION = '0.1.0';

/** Default severity level for CCL statements. */
export const DEFAULT_SEVERITY = 'must';

/** Hash algorithms supported by the Stele protocol. */
export const SUPPORTED_HASH_ALGORITHMS: readonly string[] = [
  'sha256',
] as const;

/** Signature schemes supported by the Stele protocol. */
export const SUPPORTED_SIGNATURE_SCHEMES: readonly string[] = [
  'ed25519',
] as const;

// ─── Common interfaces ──────────────────────────────────────────────────────────

/** An entity that carries a unique identifier. */
export interface Identifiable {
  /** Unique identifier. */
  readonly id: string;
}

/** An entity that carries creation (and optional update) timestamps. */
export interface Timestamped {
  /** ISO 8601 creation timestamp. */
  readonly createdAt: string;
  /** ISO 8601 last-update timestamp (optional). */
  readonly updatedAt?: string;
}

/** An entity that can produce a cryptographic hash of itself. */
export interface Hashable {
  /** Compute and return the hash of this entity. */
  hash(): string;
}

/** An entity that can be serialized to and deserialized from type T. */
export interface Serializable<T> {
  /** Serialize this entity to a value of type T. */
  serialize(): T;
}

/** Static companion for deserializing a Serializable. */
export interface Deserializer<T, U> {
  /** Deserialize a value of type T into an instance of type U. */
  deserialize(data: T): U;
}

// ─── Result type ────────────────────────────────────────────────────────────────

/**
 * A discriminated union representing either a successful value or an error.
 *
 * Inspired by Rust's `Result<T, E>`:
 *   - `{ ok: true, value: T }`
 *   - `{ ok: false, error: E }`
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Construct a successful Result.
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Construct a failed Result.
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ─── Runtime type guards & sanitization ─────────────────────────────────────────

export {
  isNonEmptyString,
  isValidHex,
  isValidId,
  isValidPublicKey,
  isValidSignature,
  isValidISODate,
  isValidVersion,
  isPlainObject,
  sanitizeString,
  sanitizeJsonInput,
  freezeDeep,
  assertNever,
} from './guards';

// ─── Structured logging ─────────────────────────────────────────────────────────

export { Logger, createLogger, defaultLogger, LogLevel } from './logger';
export type { LogEntry, LogOutput } from './logger';

// ─── Tracing ─────────────────────────────────────────────────────────────────────
export { Tracer, ActiveSpan, InMemoryCollector, createTracer } from './tracing';
export type { Span, SpanEvent, SpanStatus, SpanCollector } from './tracing';

// ─── Retry & resilience ──────────────────────────────────────────────────────────
export { withRetry, CircuitBreaker, HealthChecker } from './retry';
export type { RetryOptions, CircuitBreakerOptions, CircuitBreakerState, HealthCheck, HealthStatus } from './retry';
