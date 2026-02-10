import { describe, it, expect } from 'vitest';
import {
  SteleErrorCode,
  SteleError,
  errorDocsUrl,
  formatError,
} from './errors';

// ---------------------------------------------------------------------------
// SteleErrorCode enum
// ---------------------------------------------------------------------------
describe('SteleErrorCode', () => {
  it('has key management codes (1xx)', () => {
    expect(SteleErrorCode.NO_PRIVATE_KEY).toBe('STELE_E100');
    expect(SteleErrorCode.NO_KEY_PAIR).toBe('STELE_E101');
    expect(SteleErrorCode.INVALID_KEY_SIZE).toBe('STELE_E102');
    expect(SteleErrorCode.KEY_ROTATION_REQUIRED).toBe('STELE_E103');
  });

  it('has covenant building codes (2xx)', () => {
    expect(SteleErrorCode.MISSING_ISSUER).toBe('STELE_E200');
    expect(SteleErrorCode.MISSING_BENEFICIARY).toBe('STELE_E201');
    expect(SteleErrorCode.EMPTY_CONSTRAINTS).toBe('STELE_E202');
    expect(SteleErrorCode.INVALID_EXPIRY).toBe('STELE_E203');
    expect(SteleErrorCode.CONSTRAINTS_TOO_LARGE).toBe('STELE_E204');
    expect(SteleErrorCode.DOCUMENT_TOO_LARGE).toBe('STELE_E205');
  });

  it('has verification codes (3xx)', () => {
    expect(SteleErrorCode.SIGNATURE_INVALID).toBe('STELE_E300');
    expect(SteleErrorCode.ID_MISMATCH).toBe('STELE_E301');
    expect(SteleErrorCode.EXPIRED).toBe('STELE_E302');
    expect(SteleErrorCode.NOT_YET_ACTIVE).toBe('STELE_E303');
    expect(SteleErrorCode.CHAIN_DEPTH_EXCEEDED).toBe('STELE_E304');
    expect(SteleErrorCode.VERSION_UNSUPPORTED).toBe('STELE_E305');
  });

  it('has CCL codes (4xx)', () => {
    expect(SteleErrorCode.CCL_SYNTAX_ERROR).toBe('STELE_E400');
    expect(SteleErrorCode.CCL_EMPTY_INPUT).toBe('STELE_E401');
    expect(SteleErrorCode.CCL_INVALID_ACTION).toBe('STELE_E402');
    expect(SteleErrorCode.CCL_INVALID_RESOURCE).toBe('STELE_E403');
    expect(SteleErrorCode.CCL_NARROWING_VIOLATION).toBe('STELE_E404');
  });

  it('has store codes (5xx)', () => {
    expect(SteleErrorCode.STORE_MISSING_DOC).toBe('STELE_E500');
    expect(SteleErrorCode.STORE_MISSING_ID).toBe('STELE_E501');
    expect(SteleErrorCode.STORE_NOT_FOUND).toBe('STELE_E502');
    expect(SteleErrorCode.STORE_WRITE_FAILED).toBe('STELE_E503');
  });

  it('has identity codes (6xx)', () => {
    expect(SteleErrorCode.IDENTITY_INVALID).toBe('STELE_E600');
    expect(SteleErrorCode.IDENTITY_EVOLUTION_FAILED).toBe('STELE_E601');
  });

  it('has enforcement codes (7xx)', () => {
    expect(SteleErrorCode.RATE_LIMIT_EXCEEDED).toBe('STELE_E700');
    expect(SteleErrorCode.ACTION_DENIED).toBe('STELE_E701');
    expect(SteleErrorCode.AUDIT_CHAIN_CORRUPTED).toBe('STELE_E702');
  });

  it('has auth codes (8xx)', () => {
    expect(SteleErrorCode.AUTH_REQUIRED).toBe('STELE_E800');
    expect(SteleErrorCode.AUTH_INVALID_KEY).toBe('STELE_E801');
    expect(SteleErrorCode.AUTH_RATE_LIMITED).toBe('STELE_E802');
  });

  it('every code value starts with STELE_E', () => {
    const values = Object.values(SteleErrorCode);
    for (const value of values) {
      expect(value).toMatch(/^STELE_E\d{3}$/);
    }
  });

  it('all code values are unique', () => {
    const values = Object.values(SteleErrorCode);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

// ---------------------------------------------------------------------------
// SteleError class
// ---------------------------------------------------------------------------
describe('SteleError', () => {
  it('extends Error', () => {
    const err = new SteleError(SteleErrorCode.MISSING_ISSUER, 'no issuer');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SteleError);
  });

  it('has code, message, and name', () => {
    const err = new SteleError(SteleErrorCode.SIGNATURE_INVALID, 'bad sig');
    expect(err.code).toBe(SteleErrorCode.SIGNATURE_INVALID);
    expect(err.message).toBe('bad sig');
    expect(err.name).toBe('SteleError');
  });

  it('supports hint option', () => {
    const err = new SteleError(
      SteleErrorCode.MISSING_ISSUER,
      'Covenant requires an issuer',
      { hint: 'Set the issuer field before calling build()' },
    );
    expect(err.hint).toBe('Set the issuer field before calling build()');
  });

  it('supports context option', () => {
    const err = new SteleError(
      SteleErrorCode.CONSTRAINTS_TOO_LARGE,
      'constraints exceed limit',
      { context: { maxBytes: 65536, actualBytes: 128000 } },
    );
    expect(err.context).toEqual({ maxBytes: 65536, actualBytes: 128000 });
  });

  it('supports cause option for error chaining', () => {
    const cause = new Error('underlying failure');
    const err = new SteleError(
      SteleErrorCode.STORE_WRITE_FAILED,
      'store write failed',
      { cause },
    );
    expect(err.cause).toBe(cause);
  });

  it('hint and context are undefined when not provided', () => {
    const err = new SteleError(SteleErrorCode.EXPIRED, 'token expired');
    expect(err.hint).toBeUndefined();
    expect(err.context).toBeUndefined();
  });

  it('code is readonly', () => {
    const err = new SteleError(SteleErrorCode.NO_PRIVATE_KEY, 'missing key');
    expect(err.code).toBe(SteleErrorCode.NO_PRIVATE_KEY);
    // Verify value is stable after construction
    expect(err.code).toBe('STELE_E100');
  });
});

// ---------------------------------------------------------------------------
// SteleError.toJSON
// ---------------------------------------------------------------------------
describe('SteleError.toJSON', () => {
  it('returns code and message for a basic error', () => {
    const err = new SteleError(SteleErrorCode.CCL_SYNTAX_ERROR, 'parse failed');
    const json = err.toJSON();
    expect(json).toEqual({
      code: 'STELE_E400',
      message: 'parse failed',
    });
  });

  it('includes hint when provided', () => {
    const err = new SteleError(
      SteleErrorCode.MISSING_BENEFICIARY,
      'no beneficiary',
      { hint: 'Add a beneficiary before signing' },
    );
    const json = err.toJSON();
    expect(json.hint).toBe('Add a beneficiary before signing');
  });

  it('includes context when provided', () => {
    const err = new SteleError(
      SteleErrorCode.DOCUMENT_TOO_LARGE,
      'too big',
      { context: { size: 1024000 } },
    );
    const json = err.toJSON();
    expect(json.context).toEqual({ size: 1024000 });
  });

  it('omits hint and context when not provided', () => {
    const err = new SteleError(SteleErrorCode.EXPIRED, 'expired');
    const json = err.toJSON();
    expect('hint' in json).toBe(false);
    expect('context' in json).toBe(false);
  });

  it('returns a plain object suitable for JSON.stringify', () => {
    const err = new SteleError(
      SteleErrorCode.AUTH_REQUIRED,
      'auth needed',
      { hint: 'Provide an API key', context: { endpoint: '/api/v1' } },
    );
    const serialized = JSON.stringify(err.toJSON());
    const parsed = JSON.parse(serialized);
    expect(parsed.code).toBe('STELE_E800');
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
    const url = errorDocsUrl(SteleErrorCode.MISSING_ISSUER);
    expect(url).toBe('https://stele.dev/errors/STELE_E200');
  });

  it('returns different URLs for different codes', () => {
    const url1 = errorDocsUrl(SteleErrorCode.NO_PRIVATE_KEY);
    const url2 = errorDocsUrl(SteleErrorCode.SIGNATURE_INVALID);
    expect(url1).not.toBe(url2);
  });

  it('URL starts with https://', () => {
    const url = errorDocsUrl(SteleErrorCode.CCL_SYNTAX_ERROR);
    expect(url).toMatch(/^https:\/\//);
  });

  it('URL contains the error code', () => {
    const url = errorDocsUrl(SteleErrorCode.STORE_NOT_FOUND);
    expect(url).toContain('STELE_E502');
  });

  it('returns valid URLs for all error codes', () => {
    const codes = Object.values(SteleErrorCode);
    for (const code of codes) {
      const url = errorDocsUrl(code);
      expect(url).toMatch(/^https:\/\/stele\.dev\/errors\/STELE_E\d{3}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// formatError
// ---------------------------------------------------------------------------
describe('formatError', () => {
  it('includes the error code in brackets', () => {
    const err = new SteleError(SteleErrorCode.SIGNATURE_INVALID, 'bad signature');
    const formatted = formatError(err);
    expect(formatted).toContain('[STELE_E300]');
  });

  it('includes the error message', () => {
    const err = new SteleError(SteleErrorCode.EXPIRED, 'document has expired');
    const formatted = formatError(err);
    expect(formatted).toContain('document has expired');
  });

  it('includes the hint when provided', () => {
    const err = new SteleError(
      SteleErrorCode.MISSING_ISSUER,
      'no issuer set',
      { hint: 'Call setIssuer() first' },
    );
    const formatted = formatError(err);
    expect(formatted).toContain('Hint: Call setIssuer() first');
  });

  it('does not include a hint line when hint is absent', () => {
    const err = new SteleError(SteleErrorCode.EXPIRED, 'expired');
    const formatted = formatError(err);
    expect(formatted).not.toContain('Hint:');
  });

  it('includes a docs URL', () => {
    const err = new SteleError(SteleErrorCode.CCL_SYNTAX_ERROR, 'parse error');
    const formatted = formatError(err);
    expect(formatted).toContain('Docs: https://stele.dev/errors/STELE_E400');
  });

  it('formats a complete error with all fields', () => {
    const err = new SteleError(
      SteleErrorCode.MISSING_ISSUER,
      'Covenant requires an issuer',
      { hint: 'Set the issuer field before calling build()' },
    );
    const formatted = formatError(err);
    const lines = formatted.split('\n');
    expect(lines[0]).toBe('[STELE_E200] Covenant requires an issuer');
    expect(lines[1]).toBe('Hint: Set the issuer field before calling build()');
    expect(lines[2]).toBe('Docs: https://stele.dev/errors/STELE_E200');
  });

  it('formats an error without hint as two lines', () => {
    const err = new SteleError(SteleErrorCode.NO_KEY_PAIR, 'no key pair available');
    const formatted = formatError(err);
    const lines = formatted.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('[STELE_E101] no key pair available');
    expect(lines[1]).toBe('Docs: https://stele.dev/errors/STELE_E101');
  });
});
