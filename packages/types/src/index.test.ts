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

import type { Result, Identifiable, Timestamped, Hashable, Serializable } from './index';

// ---------------------------------------------------------------------------
// NobulexErrorCode enum
// ---------------------------------------------------------------------------
describe('NobulexErrorCode', () => {
  it('contains INVALID_INPUT', () => {
    expect(NobulexErrorCode.INVALID_INPUT).toBe('INVALID_INPUT');
  });

  it('contains CRYPTO_FAILURE', () => {
    expect(NobulexErrorCode.CRYPTO_FAILURE).toBe('CRYPTO_FAILURE');
  });

  it('contains CCL_PARSE_ERROR', () => {
    expect(NobulexErrorCode.CCL_PARSE_ERROR).toBe('CCL_PARSE_ERROR');
  });

  it('contains CHAIN_DEPTH_EXCEEDED', () => {
    expect(NobulexErrorCode.CHAIN_DEPTH_EXCEEDED).toBe('CHAIN_DEPTH_EXCEEDED');
  });

  it('contains STORAGE_NOT_FOUND', () => {
    expect(NobulexErrorCode.STORAGE_NOT_FOUND).toBe('STORAGE_NOT_FOUND');
  });

  it('contains VERIFICATION_FAILED', () => {
    expect(NobulexErrorCode.VERIFICATION_FAILED).toBe('VERIFICATION_FAILED');
  });

  it('contains OUT_OF_RANGE', () => {
    expect(NobulexErrorCode.OUT_OF_RANGE).toBe('OUT_OF_RANGE');
  });

  it('contains INVALID_HEX', () => {
    expect(NobulexErrorCode.INVALID_HEX).toBe('INVALID_HEX');
  });

  it('contains INVALID_PROBABILITY', () => {
    expect(NobulexErrorCode.INVALID_PROBABILITY).toBe('INVALID_PROBABILITY');
  });

  it('contains STORAGE_OPERATION_FAILED', () => {
    expect(NobulexErrorCode.STORAGE_OPERATION_FAILED).toBe('STORAGE_OPERATION_FAILED');
  });

  it('contains SERIALIZATION_ERROR', () => {
    expect(NobulexErrorCode.SERIALIZATION_ERROR).toBe('SERIALIZATION_ERROR');
  });

  it('contains NARROWING_VIOLATION', () => {
    expect(NobulexErrorCode.NARROWING_VIOLATION).toBe('NARROWING_VIOLATION');
  });
});

// ---------------------------------------------------------------------------
// NobulexError base class
// ---------------------------------------------------------------------------
describe('NobulexError', () => {
  it('extends Error', () => {
    const err = new NobulexError('test', NobulexErrorCode.INVALID_INPUT);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NobulexError);
  });

  it('carries the provided message and code', () => {
    const err = new NobulexError('something broke', NobulexErrorCode.CRYPTO_FAILURE);
    expect(err.message).toBe('something broke');
    expect(err.code).toBe(NobulexErrorCode.CRYPTO_FAILURE);
  });

  it('has name "NobulexError"', () => {
    const err = new NobulexError('msg', NobulexErrorCode.INVALID_INPUT);
    expect(err.name).toBe('NobulexError');
  });

  it('code is readonly', () => {
    const err = new NobulexError('msg', NobulexErrorCode.INVALID_INPUT);
    // TypeScript prevents assignment; verify the value is stable
    expect(err.code).toBe(NobulexErrorCode.INVALID_INPUT);
  });
});

// ---------------------------------------------------------------------------
// ValidationError
// ---------------------------------------------------------------------------
describe('ValidationError', () => {
  it('extends NobulexError', () => {
    const e = new ValidationError('bad input', 'field1');
    expect(e).toBeInstanceOf(NobulexError);
    expect(e).toBeInstanceOf(Error);
  });

  it('has name "ValidationError"', () => {
    const e = new ValidationError('bad', 'x');
    expect(e.name).toBe('ValidationError');
  });

  it('defaults to INVALID_INPUT code', () => {
    const e = new ValidationError('bad', 'x');
    expect(e.code).toBe(NobulexErrorCode.INVALID_INPUT);
  });

  it('accepts a custom error code', () => {
    const e = new ValidationError('bad hex', 'key', NobulexErrorCode.INVALID_HEX);
    expect(e.code).toBe(NobulexErrorCode.INVALID_HEX);
  });

  it('carries the field name', () => {
    const e = new ValidationError('bad', 'myField');
    expect(e.field).toBe('myField');
  });
});

// ---------------------------------------------------------------------------
// CryptoError
// ---------------------------------------------------------------------------
describe('CryptoError', () => {
  it('extends NobulexError with CRYPTO_FAILURE code', () => {
    const e = new CryptoError('sign failed');
    expect(e).toBeInstanceOf(NobulexError);
    expect(e.code).toBe(NobulexErrorCode.CRYPTO_FAILURE);
    expect(e.name).toBe('CryptoError');
    expect(e.message).toBe('sign failed');
  });
});

// ---------------------------------------------------------------------------
// CCLError
// ---------------------------------------------------------------------------
describe('CCLError', () => {
  it('extends NobulexError with CCL_PARSE_ERROR code', () => {
    const e = new CCLError('unexpected token');
    expect(e).toBeInstanceOf(NobulexError);
    expect(e.code).toBe(NobulexErrorCode.CCL_PARSE_ERROR);
    expect(e.name).toBe('CCLError');
    expect(e.message).toBe('unexpected token');
  });
});

// ---------------------------------------------------------------------------
// ChainError
// ---------------------------------------------------------------------------
describe('ChainError', () => {
  it('extends NobulexError with default CHAIN_DEPTH_EXCEEDED code', () => {
    const e = new ChainError('too deep');
    expect(e).toBeInstanceOf(NobulexError);
    expect(e.code).toBe(NobulexErrorCode.CHAIN_DEPTH_EXCEEDED);
    expect(e.name).toBe('ChainError');
  });

  it('accepts a custom error code', () => {
    const e = new ChainError('narrowing failed', NobulexErrorCode.NARROWING_VIOLATION);
    expect(e.code).toBe(NobulexErrorCode.NARROWING_VIOLATION);
  });
});

// ---------------------------------------------------------------------------
// StorageError
// ---------------------------------------------------------------------------
describe('StorageError', () => {
  it('extends NobulexError with default STORAGE_NOT_FOUND code', () => {
    const e = new StorageError('not found');
    expect(e).toBeInstanceOf(NobulexError);
    expect(e.code).toBe(NobulexErrorCode.STORAGE_NOT_FOUND);
    expect(e.name).toBe('StorageError');
  });

  it('accepts a custom error code', () => {
    const e = new StorageError('write failed', NobulexErrorCode.STORAGE_OPERATION_FAILED);
    expect(e.code).toBe(NobulexErrorCode.STORAGE_OPERATION_FAILED);
  });
});

// ---------------------------------------------------------------------------
// validateNonEmpty
// ---------------------------------------------------------------------------
describe('validateNonEmpty', () => {
  it('does not throw for a non-empty string', () => {
    expect(() => validateNonEmpty('hello', 'greeting')).not.toThrow();
  });

  it('throws ValidationError for an empty string', () => {
    expect(() => validateNonEmpty('', 'field')).toThrow(ValidationError);
  });

  it('throws ValidationError for a whitespace-only string', () => {
    expect(() => validateNonEmpty('   ', 'field')).toThrow(ValidationError);
  });

  it('thrown error contains the field name', () => {
    try {
      validateNonEmpty('', 'myParam');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).field).toBe('myParam');
    }
  });

  it('thrown error has INVALID_INPUT code', () => {
    try {
      validateNonEmpty('', 'x');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as ValidationError).code).toBe(NobulexErrorCode.INVALID_INPUT);
    }
  });

  it('accepts a string with mixed content', () => {
    expect(() => validateNonEmpty('  abc  ', 'val')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateRange
// ---------------------------------------------------------------------------
describe('validateRange', () => {
  it('does not throw for a value within range', () => {
    expect(() => validateRange(5, 0, 10, 'score')).not.toThrow();
  });

  it('does not throw for value at min boundary', () => {
    expect(() => validateRange(0, 0, 10, 'score')).not.toThrow();
  });

  it('does not throw for value at max boundary', () => {
    expect(() => validateRange(10, 0, 10, 'score')).not.toThrow();
  });

  it('throws for a value below min', () => {
    expect(() => validateRange(-1, 0, 10, 'score')).toThrow(ValidationError);
  });

  it('throws for a value above max', () => {
    expect(() => validateRange(11, 0, 10, 'score')).toThrow(ValidationError);
  });

  it('throws for NaN', () => {
    expect(() => validateRange(NaN, 0, 10, 'score')).toThrow(ValidationError);
  });

  it('thrown error has OUT_OF_RANGE code', () => {
    try {
      validateRange(100, 0, 10, 'depth');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as ValidationError).code).toBe(NobulexErrorCode.OUT_OF_RANGE);
    }
  });

  it('works with negative ranges', () => {
    expect(() => validateRange(-5, -10, -1, 'temp')).not.toThrow();
    expect(() => validateRange(0, -10, -1, 'temp')).toThrow(ValidationError);
  });

  it('works with floating-point boundaries', () => {
    expect(() => validateRange(0.5, 0.0, 1.0, 'prob')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateHex
// ---------------------------------------------------------------------------
describe('validateHex', () => {
  it('does not throw for valid lowercase hex', () => {
    expect(() => validateHex('abcdef01', 'key')).not.toThrow();
  });

  it('does not throw for valid uppercase hex', () => {
    expect(() => validateHex('ABCDEF01', 'key')).not.toThrow();
  });

  it('does not throw for valid mixed-case hex', () => {
    expect(() => validateHex('aAbBcCdD', 'key')).not.toThrow();
  });

  it('throws for an empty string', () => {
    expect(() => validateHex('', 'key')).toThrow(ValidationError);
  });

  it('throws for odd-length string', () => {
    expect(() => validateHex('abc', 'key')).toThrow(ValidationError);
  });

  it('throws for non-hex characters', () => {
    expect(() => validateHex('xyz123', 'key')).toThrow(ValidationError);
  });

  it('thrown error has INVALID_HEX code', () => {
    try {
      validateHex('zz', 'key');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as ValidationError).code).toBe(NobulexErrorCode.INVALID_HEX);
    }
  });

  it('accepts a 64-character hex string (32 bytes)', () => {
    const hex = 'a'.repeat(64);
    expect(() => validateHex(hex, 'hash')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateProbability
// ---------------------------------------------------------------------------
describe('validateProbability', () => {
  it('does not throw for 0', () => {
    expect(() => validateProbability(0, 'p')).not.toThrow();
  });

  it('does not throw for 1', () => {
    expect(() => validateProbability(1, 'p')).not.toThrow();
  });

  it('does not throw for 0.5', () => {
    expect(() => validateProbability(0.5, 'p')).not.toThrow();
  });

  it('throws for a negative number', () => {
    expect(() => validateProbability(-0.1, 'p')).toThrow(ValidationError);
  });

  it('throws for a value greater than 1', () => {
    expect(() => validateProbability(1.01, 'p')).toThrow(ValidationError);
  });

  it('throws for NaN', () => {
    expect(() => validateProbability(NaN, 'p')).toThrow(ValidationError);
  });

  it('thrown error has INVALID_PROBABILITY code', () => {
    try {
      validateProbability(2, 'p');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as ValidationError).code).toBe(NobulexErrorCode.INVALID_PROBABILITY);
    }
  });

  it('accepts very small positive probabilities', () => {
    expect(() => validateProbability(1e-10, 'p')).not.toThrow();
  });

  it('accepts probabilities very close to 1', () => {
    expect(() => validateProbability(1 - 1e-10, 'p')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------
describe('protocol constants', () => {
  it('STELE_VERSION is a semver string', () => {
    expect(typeof STELE_VERSION).toBe('string');
    expect(/^\d+\.\d+\.\d+/.test(STELE_VERSION)).toBe(true);
  });

  it('DEFAULT_SEVERITY is "must"', () => {
    expect(DEFAULT_SEVERITY).toBe('must');
  });

  it('SUPPORTED_HASH_ALGORITHMS includes sha256', () => {
    expect(SUPPORTED_HASH_ALGORITHMS).toContain('sha256');
  });

  it('SUPPORTED_HASH_ALGORITHMS is readonly', () => {
    expect(Array.isArray(SUPPORTED_HASH_ALGORITHMS)).toBe(true);
    expect(SUPPORTED_HASH_ALGORITHMS.length).toBeGreaterThan(0);
  });

  it('SUPPORTED_SIGNATURE_SCHEMES includes ed25519', () => {
    expect(SUPPORTED_SIGNATURE_SCHEMES).toContain('ed25519');
  });

  it('SUPPORTED_SIGNATURE_SCHEMES is readonly', () => {
    expect(Array.isArray(SUPPORTED_SIGNATURE_SCHEMES)).toBe(true);
    expect(SUPPORTED_SIGNATURE_SCHEMES.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Common interfaces (compile-time structural checks)
// ---------------------------------------------------------------------------
describe('common interfaces', () => {
  it('Identifiable requires an id', () => {
    const obj: Identifiable = { id: 'abc-123' };
    expect(obj.id).toBe('abc-123');
  });

  it('Timestamped requires createdAt and optional updatedAt', () => {
    const obj1: Timestamped = { createdAt: '2025-01-01T00:00:00Z' };
    expect(obj1.createdAt).toBe('2025-01-01T00:00:00Z');
    expect(obj1.updatedAt).toBeUndefined();

    const obj2: Timestamped = { createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-06-01T00:00:00Z' };
    expect(obj2.updatedAt).toBe('2025-06-01T00:00:00Z');
  });

  it('Hashable requires a hash() method', () => {
    const obj: Hashable = { hash: () => 'abc123' };
    expect(obj.hash()).toBe('abc123');
  });

  it('Serializable<T> requires a serialize() method', () => {
    const obj: Serializable<string> = { serialize: () => '{"data":1}' };
    expect(obj.serialize()).toBe('{"data":1}');
  });
});

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------
describe('Result type', () => {
  it('ok() produces a result with ok: true and a value', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  it('err() produces a result with ok: false and an error', () => {
    const result = err(new Error('fail'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('fail');
    }
  });

  it('ok() works with string values', () => {
    const result = ok('hello');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('hello');
    }
  });

  it('ok() works with object values', () => {
    const data = { x: 1, y: 2 };
    const result = ok(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(data);
    }
  });

  it('ok() works with null', () => {
    const result = ok(null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it('ok() works with undefined', () => {
    const result = ok(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeUndefined();
    }
  });

  it('err() works with string errors', () => {
    const result = err('something went wrong');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('something went wrong');
    }
  });

  it('err() works with NobulexError', () => {
    const error = new NobulexError('bad', NobulexErrorCode.CRYPTO_FAILURE);
    const result = err(error);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(NobulexError);
      expect(result.error.code).toBe(NobulexErrorCode.CRYPTO_FAILURE);
    }
  });

  it('can be used in a discriminated union pattern', () => {
    function divide(a: number, b: number): Result<number, string> {
      if (b === 0) return err('division by zero');
      return ok(a / b);
    }

    const good = divide(10, 2);
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.value).toBe(5);
    }

    const bad = divide(10, 0);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toBe('division by zero');
    }
  });

  it('ok result does not have error property', () => {
    const result = ok(1);
    expect(result.ok).toBe(true);
    expect('error' in result).toBe(false);
  });

  it('err result does not have value property', () => {
    const result = err('fail');
    expect(result.ok).toBe(false);
    expect('value' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error hierarchy checks
// ---------------------------------------------------------------------------
describe('error hierarchy', () => {
  it('all error classes extend Error', () => {
    expect(new NobulexError('a', NobulexErrorCode.INVALID_INPUT)).toBeInstanceOf(Error);
    expect(new ValidationError('a', 'f')).toBeInstanceOf(Error);
    expect(new CryptoError('a')).toBeInstanceOf(Error);
    expect(new CCLError('a')).toBeInstanceOf(Error);
    expect(new ChainError('a')).toBeInstanceOf(Error);
    expect(new StorageError('a')).toBeInstanceOf(Error);
  });

  it('all specialized errors extend NobulexError', () => {
    expect(new ValidationError('a', 'f')).toBeInstanceOf(NobulexError);
    expect(new CryptoError('a')).toBeInstanceOf(NobulexError);
    expect(new CCLError('a')).toBeInstanceOf(NobulexError);
    expect(new ChainError('a')).toBeInstanceOf(NobulexError);
    expect(new StorageError('a')).toBeInstanceOf(NobulexError);
  });

  it('each error has a distinct name', () => {
    const names = [
      new NobulexError('a', NobulexErrorCode.INVALID_INPUT).name,
      new ValidationError('a', 'f').name,
      new CryptoError('a').name,
      new CCLError('a').name,
      new ChainError('a').name,
      new StorageError('a').name,
    ];
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('errors can be caught by NobulexError type', () => {
    const errors: NobulexError[] = [
      new ValidationError('a', 'f'),
      new CryptoError('a'),
      new CCLError('a'),
      new ChainError('a'),
      new StorageError('a'),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(NobulexError);
      expect(typeof e.code).toBe('string');
    }
  });
});
