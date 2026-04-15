/**
 * Comprehensive error code system for the Nobulex SDK.
 *
 * Every error has a unique, documentable code (NOBULEX_Exxx) that maps
 * to a specific, documented failure mode. This enables structured error
 * handling, logging, and user-facing diagnostics.
 *
 * @packageDocumentation
 */

// ---

/** All Nobulex error codes. Each maps to a specific, documented failure mode. */
export enum NobulexErrorCode {
  // Key management (1xx)
  /** A required private key was not provided or not available. */
  NO_PRIVATE_KEY = 'NOBULEX_E100',
  /** A required key pair was not provided or not available. */
  NO_KEY_PAIR = 'NOBULEX_E101',
  /** The key size does not meet the required specification. */
  INVALID_KEY_SIZE = 'NOBULEX_E102',
  /** The key has exceeded its validity period and must be rotated. */
  KEY_ROTATION_REQUIRED = 'NOBULEX_E103',

  // Covenant building (2xx)
  /** The issuer field is required but was not provided. */
  MISSING_ISSUER = 'NOBULEX_E200',
  /** The beneficiary field is required but was not provided. */
  MISSING_BENEFICIARY = 'NOBULEX_E201',
  /** At least one constraint must be specified. */
  EMPTY_CONSTRAINTS = 'NOBULEX_E202',
  /** The expiry date is invalid (e.g., in the past or malformed). */
  INVALID_EXPIRY = 'NOBULEX_E203',
  /** The constraints payload exceeds the maximum allowed size. */
  CONSTRAINTS_TOO_LARGE = 'NOBULEX_E204',
  /** The document exceeds the maximum allowed size. */
  DOCUMENT_TOO_LARGE = 'NOBULEX_E205',

  // Verification (3xx)
  /** The cryptographic signature did not verify. */
  SIGNATURE_INVALID = 'NOBULEX_E300',
  /** The document ID does not match the expected value. */
  ID_MISMATCH = 'NOBULEX_E301',
  /** The document or token has expired. */
  EXPIRED = 'NOBULEX_E302',
  /** The document or token is not yet active (notBefore date in the future). */
  NOT_YET_ACTIVE = 'NOBULEX_E303',
  /** The delegation chain exceeds the maximum allowed depth. */
  CHAIN_DEPTH_EXCEEDED = 'NOBULEX_E304',
  /** The protocol version is not supported. */
  VERSION_UNSUPPORTED = 'NOBULEX_E305',

  // CCL (4xx)
  /** The CCL constraint text contains a syntax error. */
  CCL_SYNTAX_ERROR = 'NOBULEX_E400',
  /** The CCL input was empty or missing. */
  CCL_EMPTY_INPUT = 'NOBULEX_E401',
  /** The action specified in the CCL rule is not valid. */
  CCL_INVALID_ACTION = 'NOBULEX_E402',
  /** The resource specified in the CCL rule is not valid. */
  CCL_INVALID_RESOURCE = 'NOBULEX_E403',
  /** A chain narrowing validation detected a broadening violation. */
  CCL_NARROWING_VIOLATION = 'NOBULEX_E404',

  // Store (5xx)
  /** The document was expected but not provided to the store operation. */
  STORE_MISSING_DOC = 'NOBULEX_E500',
  /** The document ID was expected but not provided. */
  STORE_MISSING_ID = 'NOBULEX_E501',
  /** The requested document was not found in the store. */
  STORE_NOT_FOUND = 'NOBULEX_E502',
  /** The store write operation failed. */
  STORE_WRITE_FAILED = 'NOBULEX_E503',

  // Identity (6xx)
  /** The identity document or format is invalid. */
  IDENTITY_INVALID = 'NOBULEX_E600',
  /** An identity evolution operation failed. */
  IDENTITY_EVOLUTION_FAILED = 'NOBULEX_E601',

  // Rate limiting / enforcement (7xx)
  /** The rate limit for the operation has been exceeded. */
  RATE_LIMIT_EXCEEDED = 'NOBULEX_E700',
  /** The action was denied by enforcement policy. */
  ACTION_DENIED = 'NOBULEX_E701',
  /** The audit chain integrity check failed (corrupted or tampered). */
  AUDIT_CHAIN_CORRUPTED = 'NOBULEX_E702',

  // Auth (8xx)
  /** Authentication is required but was not provided. */
  AUTH_REQUIRED = 'NOBULEX_E800',
  /** The provided authentication key is invalid. */
  AUTH_INVALID_KEY = 'NOBULEX_E801',
  /** Authentication attempts have been rate limited. */
  AUTH_RATE_LIMITED = 'NOBULEX_E802',
}

// ---

/** Options for constructing a NobulexError. */
export interface NobulexErrorOptions {
  /** Additional structured context for diagnostics and logging. */
  context?: Record<string, unknown>;
  /** A human-readable hint suggesting how to resolve the error. */
  hint?: string;
  /** The underlying cause of this error, for error chaining. */
  cause?: Error;
}

/**
 * Base error class for all Nobulex errors.
 *
 * Includes a unique error code, optional context for structured logging,
 * and an optional hint for user-facing diagnostics.
 *
 * @example
 * ```typescript
 * throw new NobulexError(
 *   NobulexErrorCode.MISSING_ISSUER,
 *   'Covenant requires an issuer',
 *   { hint: 'Set the issuer field before calling build()' }
 * );
 * ```
 */
export class NobulexError extends Error {
  readonly code: NobulexErrorCode;
  readonly context?: Record<string, unknown>;
  readonly hint?: string;

  constructor(code: NobulexErrorCode, message: string, options?: NobulexErrorOptions) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'NobulexError';
    this.code = code;
    this.context = options?.context;
    this.hint = options?.hint;
  }

  /**
   * Return a structured JSON representation suitable for logging.
   *
   * Includes the error code, message, and optionally the hint and context.
   */
  toJSON(): { code: string; message: string; hint?: string; context?: Record<string, unknown> } {
    const result: { code: string; message: string; hint?: string; context?: Record<string, unknown> } = {
      code: this.code,
      message: this.message,
    };
    if (this.hint !== undefined) {
      result.hint = this.hint;
    }
    if (this.context !== undefined) {
      result.context = this.context;
    }
    return result;
  }
}

// ---

/** Base URL for error documentation pages. */
const DOCS_BASE_URL = 'https://nobulex.com/errors';

/**
 * Look up the documentation URL for an error code.
 *
 * @param code - The Nobulex error code.
 * @returns A URL pointing to the documentation page for this error code.
 *
 * @example
 * ```typescript
 * errorDocsUrl(NobulexErrorCode.MISSING_ISSUER)
 * // => 'https://nobulex.com/errors/NOBULEX_E200'
 * ```
 */
export function errorDocsUrl(code: NobulexErrorCode): string {
  return `${DOCS_BASE_URL}/${code}`;
}

/**
 * Format an error for display.
 *
 * Includes the error code, message, hint (if present), and a link
 * to the documentation page.
 *
 * @param error - The NobulexError to format.
 * @returns A multi-line formatted string for terminal or log output.
 *
 * @example
 * ```typescript
 * const err = new NobulexError(
 *   NobulexErrorCode.MISSING_ISSUER,
 *   'Covenant requires an issuer',
 *   { hint: 'Set the issuer field before calling build()' }
 * );
 * console.log(formatError(err));
 * // [NOBULEX_E200] Covenant requires an issuer
 * // Hint: Set the issuer field before calling build()
 * // Docs: https://nobulex.com/errors/NOBULEX_E200
 * ```
 */
export function formatError(error: NobulexError): string {
  const lines: string[] = [];
  lines.push(`[${error.code}] ${error.message}`);
  if (error.hint) {
    lines.push(`Hint: ${error.hint}`);
  }
  lines.push(`Docs: ${errorDocsUrl(error.code)}`);
  return lines.join('\n');
}
