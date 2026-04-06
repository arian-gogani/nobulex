import { describe, it, expect } from 'vitest';
import {
  NobulexErrorCode,
  NobulexError,
  errorDocsUrl,
  formatError,
} from './errors';

// ---------------------------------------------------------------------------
// NobulexErrorCode enum
// ---------------------------------------------------------------------------
describe('NobulexErrorCode', () => {
  it('has key management codes (1xx)', () => {
    expect(NobulexErrorCode.NO_PRIVATE_KEY).toBe('NOBULEX_E100');
    expect(NobulexErrorCode.NO_KEY_PAIR).toBe('NOBULEX_E101');
    expect(NobulexErrorCode.INVALID_KEY_SIZE).toBe('NOBULEX_E102');
    expect(NobulexErrorCode.KEY_ROTATION_REQUIRED).toBe('NOBULEX_E103');
  });

  it('has covenant building codes (2xx)', () => {
    expect(NobulexErrorCode.MISSING_ISSUER).toBe('NOBULEX_E200');
    expect(NobulexErrorCode.MISSING_BENEFICIARY).toBe('NOBULEX_E201');
    expect(NobulexErrorCode.EMPTY_CONSTRAINTS).toBe('NOBULEX_E202');
    expect(NobulexErrorCode.INVALID_EXPIRY).toBe('NOBULEX_E203');
    expect(NobulexErrorCode.CONSTRAINTS_TOO_LARGE).toBe('NOBULEX_E204');
    expect(NobulexErrorCode.DOCUMENT_TOO_LARGE).toBe('NOBULEX_E205');
  });

  it('has verification codes (3xx)', () => {
    expect(NobulexErrorCode.SIGNATURE_INVALID).toBe('NOBULEX_E300');
    expect(NobulexErrorCode.ID_MISMATCH).toBe('NOBULEX_E301');
    expect(NobulexErrorCode.EXPIRED).toBe('NOBULEX_E302');
    expect(NobulexErrorCode.NOT_YET_ACTIVE).toBe('NOBULEX_E303');
    expect(NobulexErrorCode.CHAIN_DEPTH_EXCEEDED).toBe('NOBULEX_E304');
    expect(NobulexErrorCode.VERSION_UNSUPPORTED).toBe('NOBULEX_E305');
  });

  it('has CCL codes (4xx)', () => {
    expect(NobulexErrorCode.CCL_SYNTAX_ERROR).toBe('NOBULEX_E400');
    expect(NobulexErrorCode.CCL_EMPTY_INPUT).toBe('NOBULEX_E401');
    expect(NobulexErrorCode.CCL_INVALID_ACTION).toBe('NOBULEX_E402');
    expect(NobulexErrorCode.CCL_INVALID_RESOURCE).toBe('NOBULEX_E403');
    expect(NobulexErrorCode.CCL_NARROWING_VIOLATION).toBe('NOBULEX_E404');
  });

  it('has store codes (5xx)', () => {
    expect(NobulexErrorCode.STORE_MISSING_DOC).toBe('NOBULEX_E500');
    expect(NobulexErrorCode.STORE_MISSING_ID).toBe('NOBULEX_E501');
    expect(NobulexErrorCode.STORE_NOT_FOUND).toBe('NOBULEX_E502');
    expect(NobulexErrorCode.STORE_WRITE_FAILED).toBe('NOBULEX_E503');
  });

  it('has identity codes (6xx)', () => {
    expect(NobulexErrorCode.IDENTITY_INVALID).toBe('NOBULEX_E600');
    expect(NobulexErrorCode.IDENTITY_EVOLUTION_FAILED).toBe('NOBULEX_E601');
  });

  it('has enforcement codes (7xx)', () => {
    expect(NobulexErrorCode.RATE_LIMIT_EXCEEDED).toBe('NOBULEX_E700');
    expect(NobulexErrorCode.ACTION_DENIED).toBe('NOBULEX_E701');
    expect(NobulexErrorCode.AUDIT_CHAIN_CORRUPTED).toBe('NOBULEX_E702');
  });

  it('has auth codes (8xx)', () => {
    expect(NobulexErrorCode.AUTH_REQUIRED).toBe('NOBULEX_E800');
    expect(NobulexErrorCode.AUTH_INVALID_KEY).toBe('NOBULEX_E801');
    expect(NobulexErrorCode.AUTH_RATE_LIMITED).toBe('NOBULEX_E802');
  });

  it('every code value starts with NOBULEX_E', () => {
    const values = Object.values(NobulexErrorCode);
    for (const value of values) {
      expect(value).toMatch(/^NOBULEX_E\d{3}$/);
    }
  });

  it('all code values are unique', () => {
    const values = Object.values(NobulexErrorCode);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

// ---------------------------------------------------------------------------
// NobulexError class
// ---------------------------------------------------------------------------
describe('NobulexError', () => {
  it('extends Error', () => {
    const err = new NobulexError(NobulexErrorCode.MISSING_ISSUER, 'no issuer');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NobulexError);
  });

  it('has code, message, and name', () => {
    const err = new NobulexError(NobulexErrorCode.SIGNATURE_INVALID, 'bad sig');
    expect(err.code).toBe(NobulexErrorCode.SIGNATURE_INVALID);
    expect(err.message).toBe('bad sig');
    expect(err.name).toBe('NobulexError');
  });

  it('supports hint option', () => {
    const err = new NobulexError(
      NobulexErrorCode.MISSING_ISSUER,
      'Covenant requires an issuer',
      { hint: 'Set the issuer field before calling build()' },
    );
    expect(err.hint).toBe('Set the issuer field before calling build()');
  });

  it('supports context option', () => {
    const err = new NobulexError(
      NobulexErrorCode.CONSTRAINTS_TOO_LARGE,
      'constraints exceed limit',
      { context: { maxBytes: 65536, actualBytes: 128000 } },
    );
    expect(err.context).toEqual({ maxBytes: 65536, actualBytes: 128000 });
  });

  it('supports cause option for error chaining', () => {
    const cause = new Error('underlying failure');
    const err = new NobulexError(
      NobulexErrorCode.STORE_WRITE_FAILED,
      'store write failed',
      { cause },
    );
    expect(err.cause).toBe(cause);
  });

  it('hint and context are undefined when not provided', () => {
    const err = new NobulexError(NobulexErrorCode.EXPIRED, 'token expired');
    expect(err.hint).toBeUndefined();
    expect(err.context).toBeUndefined();
  });

  it('code is readonly', () => {
    const err = new NobulexError(NobulexErrorCode.NO_PRIVATE_KEY, 'missing key');
    expect(err.code).toBe(NobulexErrorCode.NO_PRIVATE_KEY);
    // Verify value is stable after construction
    expect(err.code).toBe('NOBULEX_E100');
  });
});

// ---------------------------------------------------------------------------
// NobulexError.toJSON
// ---------------------------------------------------------------------------
describe('NobulexError.toJSON', () => {
  it('returns code and message for a basic error', () => {
    const err = new NobulexError(NobulexErrorCode.CCL_SYNTAX_ERROR, 'parse failed');
    const json = err.toJSON();
    expect(json).toEqual({
      code: 'NOBULEX_E400',
      message: 'parse failed',
    });
  });

  it('includes hint when provided', () => {
    const err = new NobulexError(
      NobulexErrorCode.MISSING_BENEFICIARY,
      'no beneficiary',
      { hint: 'Add a beneficiary before signing' },
    );
    const json = err.toJSON();
    expect(json.hint).toBe('Add a beneficiary before signing');
  });

  it('includes context when provided', () => {
    const err = new NobulexError(
      NobulexErrorCode.DOCUMENT_TOO_LARGE,
      'too big',
      { context: { size: 1024000 } },
    );
    const json = err.toJSON();
    expect(json.context).toEqual({ size: 1024000 });
  });

  it('omits hint and context when not provided', () => {
    const err = new NobulexError(NobulexErrorCode.EXPIRED, 'expired');
    const json = err.toJSON();
    expect('hint' in json).toBe(false);
    expect('context' in json).toBe(false);
  });

  it('returns a plain object suitable for JSON.stringify', () => {
    const err = new NobulexError(
      NobulexErrorCode.AUTH_REQUIRED,
      'auth needed',
      { hint: 'Provide an API key', context: { endpoint: '/api/v1' } },
    );
    const serialized = JSON.stringify(err.toJSON());
    const parsed = JSON.parse(serialized);
    expect(parsed.code).toBe('NOBULEX_E800');
    expect(parsed.message).toBe('auth needed');
    expect(parsed.hint).toBe('Provide an API key');
    expect(parsed.context).toEqual({ endpoint: '/api/v1' });
  });
});

// ---------------------------------------------------------------------------
// errorDocsUrl
// ---------------------------------------------------------------------------
describe('errorDocsUrl', () => {
  it('returns a valid URL for a given error code', () => {
    const url = errorDocsUrl(NobulexErrorCode.MISSING_ISSUER);
    expect(url).toBe('https://nobulex.com/errors/NOBULEX_E200');
  });

  it('returns different URLs for different codes', () => {
    const url1 = errorDocsUrl(NobulexErrorCode.NO_PRIVATE_KEY);
    const url2 = errorDocsUrl(NobulexErrorCode.SIGNATURE_INVALID);
    expect(url1).not.toBe(url2);
  });

  it('URL starts with https://', () => {
    const url = errorDocsUrl(NobulexErrorCode.CCL_SYNTAX_ERROR);
    expect(url).toMatch(/^https:\/\//);
  });

  it('URL contains the error code', () => {
    const url = errorDocsUrl(NobulexErrorCode.STORE_NOT_FOUND);
    expect(url).toContain('NOBULEX_E502');
  });

  it('returns valid URLs for all error codes', () => {
    const codes = Object.values(NobulexErrorCode);
    for (const code of codes) {
      const url = errorDocsUrl(code);
      expect(url).toMatch(/^https:\/\/nobulex\.com\/errors\/NOBULEX_E\d{3}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// formatError
// ---------------------------------------------------------------------------
describe('formatError', () => {
  it('includes the error code in brackets', () => {
    const err = new NobulexError(NobulexErrorCode.SIGNATURE_INVALID, 'bad signature');
    const formatted = formatError(err);
    expect(formatted).toContain('[NOBULEX_E300]');
  });

  it('includes the error message', () => {
    const err = new NobulexError(NobulexErrorCode.EXPIRED, 'document has expired');
    const formatted = formatError(err);
    expect(formatted).toContain('document has expired');
  });

  it('includes the hint when provided', () => {
    const err = new NobulexError(
      NobulexErrorCode.MISSING_ISSUER,
      'no issuer set',
      { hint: 'Call setIssuer() first' },
    );
    const formatted = formatError(err);
    expect(formatted).toContain('Hint: Call setIssuer() first');
  });

  it('does not include a hint line when hint is absent', () => {
    const err = new NobulexError(NobulexErrorCode.EXPIRED, 'expired');
    const formatted = formatError(err);
    expect(formatted).not.toContain('Hint:');
  });

  it('includes a docs URL', () => {
    const err = new NobulexError(NobulexErrorCode.CCL_SYNTAX_ERROR, 'parse error');
    const formatted = formatError(err);
    expect(formatted).toContain('Docs: https://nobulex.com/errors/NOBULEX_E400');
  });

  it('formats a complete error with all fields', () => {
    const err = new NobulexError(
      NobulexErrorCode.MISSING_ISSUER,
      'Covenant requires an issuer',
      { hint: 'Set the issuer field before calling build()' },
    );
    const formatted = formatError(err);
    const lines = formatted.split('\n');
    expect(lines[0]).toBe('[NOBULEX_E200] Covenant requires an issuer');
    expect(lines[1]).toBe('Hint: Set the issuer field before calling build()');
    expect(lines[2]).toBe('Docs: https://nobulex.com/errors/NOBULEX_E200');
  });

  it('formats an error without hint as two lines', () => {
    const err = new NobulexError(NobulexErrorCode.NO_KEY_PAIR, 'no key pair available');
    const formatted = formatError(err);
    const lines = formatted.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('[NOBULEX_E101] no key pair available');
    expect(lines[1]).toBe('Docs: https://nobulex.com/errors/NOBULEX_E101');
  });
});
