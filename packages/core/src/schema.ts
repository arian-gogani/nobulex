/**
 * @stele/core/schema — JSON Schema-like validation for CovenantDocument structures.
 *
 * Hand-written validator (no external dependencies) that checks structural
 * correctness of a CovenantDocument before any cryptographic verification.
 * Returns ALL errors at once rather than stopping at the first one.
 *
 * @packageDocumentation
 */

// ─── Public types ────────────────────────────────────────────────────────────────

/** A single validation error with path, message, and optional offending value. */
export interface ValidationError {
  /** Dot-delimited path to the invalid field, e.g. "issuer.publicKey". */
  path: string;
  /** Human-readable explanation of why validation failed. */
  message: string;
  /** The actual value that was found (if any). */
  value?: unknown;
}

/** The aggregate result of validating a document. */
export interface ValidationResult {
  /** Whether the document passed all validation checks. */
  valid: boolean;
  /** All validation errors found (empty when valid is true). */
  errors: ValidationError[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

const HEX_64_RE = /^[0-9a-fA-F]{64}$/;
const HEX_NONEMPTY_RE = /^[0-9a-fA-F]+$/;
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.length > 0;
}

function isHex64(val: unknown): val is string {
  return typeof val === 'string' && HEX_64_RE.test(val);
}

function isNonEmptyHex(val: unknown): val is string {
  return typeof val === 'string' && val.length > 0 && HEX_NONEMPTY_RE.test(val);
}

function isValidISO8601(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  if (!ISO_8601_RE.test(val)) return false;
  const d = new Date(val);
  return !Number.isNaN(d.getTime());
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

// ─── Party validation ─────────────────────────────────────────────────────────────

/**
 * Validate a party (issuer or beneficiary) structure.
 *
 * Checks that the party is an object with:
 * - `id`: non-empty string
 * - `publicKey`: 64-character hex string
 * - `role`: non-empty string
 *
 * @param party - The value to validate.
 * @param path  - The base path for error reporting (e.g. "issuer" or "beneficiary").
 * @returns An array of validation errors (empty if valid).
 */
export function validatePartySchema(party: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isPlainObject(party)) {
    errors.push({ path, message: 'must be an object', value: party });
    return errors;
  }

  if (!isNonEmptyString(party.id)) {
    errors.push({ path: `${path}.id`, message: 'must be a non-empty string', value: party.id });
  }

  if (!isHex64(party.publicKey)) {
    errors.push({
      path: `${path}.publicKey`,
      message: 'must be a 64-character hex string',
      value: party.publicKey,
    });
  }

  if (!isNonEmptyString(party.role)) {
    errors.push({ path: `${path}.role`, message: 'must be a non-empty string', value: party.role });
  }

  return errors;
}

// ─── Constraints validation ───────────────────────────────────────────────────────

/**
 * Validate CCL constraints.
 *
 * Checks that constraints is a non-empty string.
 *
 * @param constraints - The value to validate.
 * @returns An array of validation errors (empty if valid).
 */
export function validateConstraintsSchema(constraints: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof constraints !== 'string') {
    errors.push({ path: 'constraints', message: 'must be a string', value: constraints });
  } else if (constraints.trim().length === 0) {
    errors.push({ path: 'constraints', message: 'must be a non-empty string', value: constraints });
  }

  return errors;
}

// ─── Chain validation ─────────────────────────────────────────────────────────────

/**
 * Validate a chain reference structure.
 *
 * Checks that chain is an object with:
 * - `parentId`: non-empty string
 * - `relation`: non-empty string
 * - `depth`: positive integer
 *
 * @param chain - The value to validate.
 * @returns An array of validation errors (empty if valid).
 */
export function validateChainSchema(chain: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isPlainObject(chain)) {
    errors.push({ path: 'chain', message: 'must be an object', value: chain });
    return errors;
  }

  if (!isNonEmptyString(chain.parentId)) {
    errors.push({
      path: 'chain.parentId',
      message: 'must be a non-empty string',
      value: chain.parentId,
    });
  }

  if (!isNonEmptyString(chain.relation)) {
    errors.push({
      path: 'chain.relation',
      message: 'must be a non-empty string',
      value: chain.relation,
    });
  }

  if (
    typeof chain.depth !== 'number' ||
    !Number.isInteger(chain.depth) ||
    chain.depth < 1
  ) {
    errors.push({
      path: 'chain.depth',
      message: 'must be a positive integer',
      value: chain.depth,
    });
  }

  return errors;
}

// ─── Full document validation ─────────────────────────────────────────────────────

/**
 * Validate a CovenantDocument's structure before any cryptographic checks.
 *
 * Checks all required fields (id, version, issuer, beneficiary, constraints,
 * nonce, createdAt, signature) as well as optional fields when present
 * (chain, expiresAt, activatesAt, metadata, countersignatures).
 *
 * Returns ALL errors, not just the first one.
 *
 * @param doc - The value to validate (typically parsed JSON).
 * @returns A {@link ValidationResult} with `valid` boolean and `errors` array.
 */
export function validateDocumentSchema(doc: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  // Top-level must be an object
  if (!isPlainObject(doc)) {
    errors.push({ path: '', message: 'document must be an object', value: doc });
    return { valid: false, errors };
  }

  // ── Required field: id ──────────────────────────────────────────────────
  if (!isNonEmptyString(doc.id)) {
    errors.push({ path: 'id', message: 'must be a non-empty string', value: doc.id });
  }

  // ── Required field: version ─────────────────────────────────────────────
  if (typeof doc.version !== 'string') {
    errors.push({ path: 'version', message: 'must be a string', value: doc.version });
  } else if (!/^\d+\.\d+$/.test(doc.version)) {
    errors.push({
      path: 'version',
      message: 'must match pattern "X.Y" (e.g. "1.0")',
      value: doc.version,
    });
  }

  // ── Required field: issuer ──────────────────────────────────────────────
  errors.push(...validatePartySchema(doc.issuer, 'issuer'));

  // ── Required field: beneficiary ─────────────────────────────────────────
  errors.push(...validatePartySchema(doc.beneficiary, 'beneficiary'));

  // ── Required field: constraints ─────────────────────────────────────────
  errors.push(...validateConstraintsSchema(doc.constraints));

  // ── Required field: nonce ───────────────────────────────────────────────
  if (!isHex64(doc.nonce)) {
    errors.push({
      path: 'nonce',
      message: 'must be a 64-character hex string',
      value: doc.nonce,
    });
  }

  // ── Required field: createdAt ───────────────────────────────────────────
  if (!isValidISO8601(doc.createdAt)) {
    errors.push({
      path: 'createdAt',
      message: 'must be a valid ISO 8601 datetime string',
      value: doc.createdAt,
    });
  }

  // ── Required field: signature ───────────────────────────────────────────
  if (!isNonEmptyHex(doc.signature)) {
    errors.push({
      path: 'signature',
      message: 'must be a non-empty hex string',
      value: doc.signature,
    });
  }

  // ── Optional field: chain ───────────────────────────────────────────────
  if (doc.chain !== undefined) {
    errors.push(...validateChainSchema(doc.chain));
  }

  // ── Optional field: expiresAt ───────────────────────────────────────────
  if (doc.expiresAt !== undefined) {
    if (!isValidISO8601(doc.expiresAt)) {
      errors.push({
        path: 'expiresAt',
        message: 'must be a valid ISO 8601 datetime string',
        value: doc.expiresAt,
      });
    }
  }

  // ── Optional field: activatesAt ─────────────────────────────────────────
  if (doc.activatesAt !== undefined) {
    if (!isValidISO8601(doc.activatesAt)) {
      errors.push({
        path: 'activatesAt',
        message: 'must be a valid ISO 8601 datetime string',
        value: doc.activatesAt,
      });
    }
  }

  // ── Optional field: metadata ────────────────────────────────────────────
  if (doc.metadata !== undefined) {
    if (!isPlainObject(doc.metadata)) {
      errors.push({
        path: 'metadata',
        message: 'must be an object',
        value: doc.metadata,
      });
    }
  }

  // ── Optional field: countersignatures ───────────────────────────────────
  if (doc.countersignatures !== undefined) {
    if (!Array.isArray(doc.countersignatures)) {
      errors.push({
        path: 'countersignatures',
        message: 'must be an array',
        value: doc.countersignatures,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
