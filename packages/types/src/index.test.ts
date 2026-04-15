import { describe, it, expect } from 'vitest';
import {
  NobulexErrorCode,
  NobulexError,
  ValidationError,
  CryptoError,
  CCLError,
  ChainError,
  StorageError,
  validateNonEmpty,
  validateRange,
  validateHex,
  validateProbability,
  STELE_VERSION,
  DEFAULT_SEVERITY,
  SUPPORTED_HASH_ALGORITHMS,
  SUPPORTED_SIGNATURE_SCHEMES,
  ok,
  err,
} from './index';

import type { Result } from './index';

// --- error codes ---
describe('NobulexErrorCode', () => {
  it('has at least 10 distinct error codes', () => {
    const codes = Object.values(NobulexErrorCode);
    expect(codes.length).toBeGreaterThanOrEqual(10);
    // no duplicates
    expect(new Set(codes).size).toBe(codes.length);
  });
});

// --- error hierarchy ---
describe('NobulexError', () => {
  it('carries code and message through the chain', () => {
    const e = new NobulexError('something broke', NobulexErrorCode.INVALID_INPUT);
    expect(e.message).toBe('something broke');
    expect(e.code).toBe(NobulexErrorCode.INVALID_INPUT);
    expect(e).toBeInstanceOf(Error);
  });

  it('preserves cause when wrapping another error', () => {
    const cause = new TypeError('bad type');
    const e = new NobulexError('wrapped', NobulexErrorCode.CRYPTO_FAILURE, { cause });
    expect(e.cause).toBe(cause);
  });
});

describe('ValidationError', () => {
  it('defaults to INVALID_INPUT code', () => {
    const e = new ValidationError('bad input');
    expect(e.code).toBe(NobulexErrorCode.INVALID_INPUT);
    expect(e).toBeInstanceOf(NobulexError);
  });
});

describe('CryptoError', () => {
  it('defaults to CRYPTO_FAILURE code', () => {
    const e = new CryptoError('sig failed');
    expect(e.code).toBe(NobulexErrorCode.CRYPTO_FAILURE);
  });
});

// --- validation: the parts that actually matter ---
describe('validateNonEmpty', () => {
  it('passes for normal strings', () => {
    expect(() => validateNonEmpty('hello', 'field')).not.toThrow();
  });

  it('throws on empty string', () => {
    expect(() => validateNonEmpty('', 'name')).toThrow(ValidationError);
  });

  it('throws on whitespace-only', () => {
    expect(() => validateNonEmpty('   ', 'name')).toThrow();
  });

  it('throws on null at runtime', () => {
    expect(() => validateNonEmpty(null as unknown as string, 'x')).toThrow();
  });

  it('includes field name in error', () => {
    expect(() => validateNonEmpty('', 'agentDid')).toThrow(/agentDid/);
  });
});

describe('validateRange', () => {
  it('accepts values within bounds', () => {
    expect(() => validateRange(5, 0, 10, 'v')).not.toThrow();
  });

  it('accepts exact boundaries', () => {
    expect(() => validateRange(0, 0, 10, 'v')).not.toThrow();
    expect(() => validateRange(10, 0, 10, 'v')).not.toThrow();
  });

  it('rejects below min', () => {
    expect(() => validateRange(-1, 0, 10, 'v')).toThrow();
  });

  it('rejects above max', () => {
    expect(() => validateRange(11, 0, 10, 'v')).toThrow();
  });

  it('rejects NaN', () => {
    expect(() => validateRange(NaN, 0, 10, 'v')).toThrow();
  });
});

describe('validateHex', () => {
  it('accepts valid hex', () => {
    expect(() => validateHex('deadbeef', 'h')).not.toThrow();
    expect(() => validateHex('DEADBEEF', 'h')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateHex('', 'h')).toThrow();
  });

  it('rejects odd-length hex', () => {
    expect(() => validateHex('abc', 'h')).toThrow();
  });

  it('rejects non-hex chars', () => {
    expect(() => validateHex('xyz123', 'h')).toThrow();
  });
});

describe('validateProbability', () => {
  it('accepts 0 and 1', () => {
    expect(() => validateProbability(0, 'p')).not.toThrow();
    expect(() => validateProbability(1, 'p')).not.toThrow();
  });

  it('accepts values in between', () => {
    expect(() => validateProbability(0.5, 'p')).not.toThrow();
  });

  it('rejects negative', () => {
    expect(() => validateProbability(-0.1, 'p')).toThrow();
  });

  it('rejects > 1', () => {
    expect(() => validateProbability(1.01, 'p')).toThrow();
  });

  it('rejects NaN', () => {
    expect(() => validateProbability(NaN, 'p')).toThrow();
  });
});

// --- Result type ---
describe('ok / err', () => {
  it('ok wraps a value', () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('err wraps an error', () => {
    const r = err('nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('nope');
  });

  it('works with discriminated union narrowing', () => {
    const result: Result<number, string> = ok(10);
    if (result.ok) {
      // ts should narrow to { ok: true, value: number }
      expect(result.value + 1).toBe(11);
    }
  });
});

// --- constants sanity check (just verify they exist, don't test values) ---
describe('protocol constants', () => {
  it('exports expected constants', () => {
    expect(STELE_VERSION).toBeDefined();
    expect(DEFAULT_SEVERITY).toBeDefined();
    expect(SUPPORTED_HASH_ALGORITHMS).toBeInstanceOf(Array);
    expect(SUPPORTED_SIGNATURE_SCHEMES).toBeInstanceOf(Array);
  });
});
