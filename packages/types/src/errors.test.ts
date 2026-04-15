import { describe, it, expect } from 'vitest';
import {
  NobulexErrorCode,
  NobulexError,
  errorDocsUrl,
  formatError,
} from './errors';

describe('NobulexErrorCode', () => {
  it('groups codes by category prefix', () => {
    const codes = Object.values(NobulexErrorCode);
    // all codes follow NOBULEX_EXXX format
    for (const code of codes) {
      expect(code).toMatch(/^NOBULEX_E\d{3}$/);
    }
  });

  it('has no duplicate values', () => {
    const codes = Object.values(NobulexErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('covers key mgmt, covenant, verification, ccl, and chain categories', () => {
    const codes = Object.values(NobulexErrorCode);
    const prefixes = new Set(codes.map(c => c.slice(0, 10))); // NOBULEX_EX
    expect(prefixes.size).toBeGreaterThanOrEqual(5);
  });
});

describe('NobulexError', () => {
  it('carries code, message, and optional hint', () => {
    const e = new NobulexError(
      NobulexErrorCode.NO_PRIVATE_KEY,
      'key missing',
      { hint: 'generate one with generateKeyPair()' }
    );
    expect(e.code).toBe(NobulexErrorCode.NO_PRIVATE_KEY);
    expect(e.message).toBe('key missing');
    expect(e.hint).toBe('generate one with generateKeyPair()');
  });

  it('extends Error', () => {
    const e = new NobulexError(NobulexErrorCode.EXPIRED, 'too old');
    expect(e).toBeInstanceOf(Error);
    expect(e.stack).toBeDefined();
  });

  it('works without hint', () => {
    const e = new NobulexError(NobulexErrorCode.EXPIRED, 'done');
    expect(e.hint).toBeUndefined();
  });
});

describe('errorDocsUrl', () => {
  it('returns a URL containing the error code', () => {
    const url = errorDocsUrl(NobulexErrorCode.SIGNATURE_INVALID);
    expect(url).toContain(NobulexErrorCode.SIGNATURE_INVALID);
    expect(url).toMatch(/^https?:\/\//);
  });
});

describe('formatError', () => {
  it('includes code and message', () => {
    const e = new NobulexError(NobulexErrorCode.CCL_SYNTAX_ERROR, 'unexpected token');
    const formatted = formatError(e);
    expect(formatted).toContain(NobulexErrorCode.CCL_SYNTAX_ERROR);
    expect(formatted).toContain('unexpected token');
  });

  it('includes hint when present', () => {
    const e = new NobulexError(
      NobulexErrorCode.NO_PRIVATE_KEY,
      'missing key',
      { hint: 'run generateKeyPair()' }
    );
    const formatted = formatError(e);
    expect(formatted).toContain('run generateKeyPair()');
  });

  it('includes docs link', () => {
    const e = new NobulexError(NobulexErrorCode.EXPIRED, 'expired');
    const formatted = formatError(e);
    expect(formatted).toContain('Docs:');
    expect(formatted).toContain(NobulexErrorCode.EXPIRED);
  });
});
