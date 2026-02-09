import { describe, it, expect } from 'vitest';
import {
  SteleErrorCode,
  SteleError,
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
// SteleErrorCode enum
// ---------------------------------------------------------------------------
describe('SteleErrorCode', () => {
  it('contains INVALID_INPUT', () => {
    expect(SteleErrorCode.INVALID_INPUT).toBe('INVALID_INPUT');
  });

  it('contains CRYPTO_FAILURE', () => {
    expect(SteleErrorCode.CRYPTO_FAILURE).toBe('CRYPTO_FAILURE');
  });

  it('contains CCL_PARSE_ERROR', () => {
    expect(SteleErrorCode.CCL_PARSE_ERROR).toBe('CCL_PARSE_ERROR');
  });

  it('contains CHAIN_DEPTH_EXCEEDED', () => {
    expect(SteleErrorCode.CHAIN_DEPTH_EXCEEDED).toBe('CHAIN_DEPTH_EXCEEDED');
  });

  it('contains STORAGE_NOT_FOUND', () => {
    expect(SteleErrorCode.STORAGE_NOT_FOUND).toBe('STORAGE_NOT_FOUND');
  });

  it('contains VERIFICATION_FAILED', () => {
    expect(SteleErrorCode.VERIFICATION_FAILED).toBe('VERIFICATION_FAILED');
  });

  it('contains OUT_OF_RANGE', () => {
    expect(SteleErrorCode.OUT_OF_RANGE).toBe('OUT_OF_RANGE');
  });

  it('contains INVALID_HEX', () => {
    expect(SteleErrorCode.INVALID_HEX).toBe('INVALID_HEX');
  });

  it('contains INVALID_PROBABILITY', () => {
    expect(SteleErrorCode.INVALID_PROBABILITY).toBe('INVALID_PROBABILITY');
  });

  it('contains STORAGE_OPERATION_FAILED', () => {
    expect(SteleErrorCode.STORAGE_OPERATION_FAILED).toBe('STORAGE_OPERATION_FAILED');
  });

  it('contains SERIALIZATION_ERROR', () => {
    expect(SteleErrorCode.SERIALIZATION_ERROR).toBe('SERIALIZATION_ERROR');
  });

  it('contains NARROWING_VIOLATION', () => {
    expect(SteleErrorCode.NARROWING_VIOLATION).toBe('NARROWING_VIOLATION');
  });
});

// ---------------------------------------------------------------------------
// SteleError base class
// ---------------------------------------------------------------------------
describe('SteleError', () => {
  it('extends Error', () => {
    const err = new SteleError('test', SteleErrorCode.INVALID_INPUT);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SteleError);
  });

  it('carries the provided message and code', () => {
    const err = new SteleError('something broke', SteleErrorCode.CRYPTO_FAILURE);
    expect(err.message).toBe('something broke');
    expect(err.code).toBe(SteleErrorCode.CRYPTO_FAILURE);
  });

  it('has name "SteleError"', () => {
    const err = new SteleError('msg', SteleErrorCode.INVALID_INPUT);
    expect(err.name).toBe('SteleError');
  });

  it('code is readonly', () => {
    const err = new SteleError('msg', SteleErrorCode.INVALID_INPUT);
    // TypeScript prevents assignment; verify the value is stable
    expect(err.code).toBe(SteleErrorCode.INVALID_INPUT);
  });
});

// ---------------------------------------------------------------------------
// ValidationError
// ---------------------------------------------------------------------------
describe('ValidationError', () => {
  it('extends SteleError', () => {
    const e = new ValidationError('bad input', 'field1');
    expect(e).toBeInstanceOf(SteleError);
    expect(e).toBeInstanceOf(Error);
  });

  it('has name "ValidationError"', () => {
    const e = new ValidationError('bad', 'x');
    expect(e.name).toBe('ValidationError');
  });

  it('defaults to INVALID_INPUT code', () => {
    const e = new ValidationError('bad', 'x');
    expect(e.code).toBe(SteleErrorCode.INVALID_INPUT);
  });

  it('accepts a custom error code', () => {
    const e = new ValidationError('bad hex', 'key', SteleErrorCode.INVALID_HEX);
    expect(e.code).toBe(SteleErrorCode.INVALID_HEX);
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
  it('extends SteleError with CRYPTO_FAILURE code', () => {
    const e = new CryptoError('sign failed');
    expect(e).toBeInstanceOf(SteleError);
    expect(e.code).toBe(SteleErrorCode.CRYPTO_FAILURE);
    expect(e.name).toBe('CryptoError');
    expect(e.message).toBe('sign failed');
  });
});

// ---------------------------------------------------------------------------
// CCLError
// ---------------------------------------------------------------------------
describe('CCLError', () => {
  it('extends SteleError with CCL_PARSE_ERROR code', () => {
    const e = new CCLError('unexpected token');
    expect(e).toBeInstanceOf(SteleError);
    expect(e.code).toBe(SteleErrorCode.CCL_PARSE_ERROR);
    expect(e.name).toBe('CCLError');
    expect(e.message).toBe('unexpected token');
  });
});

// ---------------------------------------------------------------------------
// ChainError
// ---------------------------------------------------------------------------
describe('ChainError', () => {
  it('extends SteleError with default CHAIN_DEPTH_EXCEEDED code', () => {
    const e = new ChainError('too deep');
    expect(e).toBeInstanceOf(SteleError);
    expect(e.code).toBe(SteleErrorCode.CHAIN_DEPTH_EXCEEDED);
    expect(e.name).toBe('ChainError');
  });

  it('accepts a custom error code', () => {
    const e = new ChainError('narrowing failed', SteleErrorCode.NARROWING_VIOLATION);
    expect(e.code).toBe(SteleErrorCode.NARROWING_VIOLATION);
  });
});

// ---------------------------------------------------------------------------
// StorageError
// ---------------------------------------------------------------------------
describe('StorageError', () => {
  it('extends SteleError with default STORAGE_NOT_FOUND code', () => {
    const e = new StorageError('not found');
    expect(e).toBeInstanceOf(SteleError);
    expect(e.code).toBe(SteleErrorCode.STORAGE_NOT_FOUND);
    expect(e.name).toBe('StorageError');
  });

  it('accepts a custom error code', () => {
    const e = new StorageError('write failed', SteleErrorCode.STORAGE_OPERATION_FAILED);
    expect(e.code).toBe(SteleErrorCode.STORAGE_OPERATION_FAILED);
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
      expect((e as ValidationError).code).toBe(SteleErrorCode.INVALID_INPUT);
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
      expect((e as ValidationError).code).toBe(SteleErrorCode.OUT_OF_RANGE);
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
      expect((e as ValidationError).code).toBe(SteleErrorCode.INVALID_HEX);
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
      expect((e as ValidationError).code).toBe(SteleErrorCode.INVALID_PROBABILITY);
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

  it('err() works with SteleError', () => {
    const error = new SteleError('bad', SteleErrorCode.CRYPTO_FAILURE);
    const result = err(error);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SteleError);
      expect(result.error.code).toBe(SteleErrorCode.CRYPTO_FAILURE);
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
    expect(new SteleError('a', SteleErrorCode.INVALID_INPUT)).toBeInstanceOf(Error);
    expect(new ValidationError('a', 'f')).toBeInstanceOf(Error);
    expect(new CryptoError('a')).toBeInstanceOf(Error);
    expect(new CCLError('a')).toBeInstanceOf(Error);
    expect(new ChainError('a')).toBeInstanceOf(Error);
    expect(new StorageError('a')).toBeInstanceOf(Error);
  });

  it('all specialized errors extend SteleError', () => {
    expect(new ValidationError('a', 'f')).toBeInstanceOf(SteleError);
    expect(new CryptoError('a')).toBeInstanceOf(SteleError);
    expect(new CCLError('a')).toBeInstanceOf(SteleError);
    expect(new ChainError('a')).toBeInstanceOf(SteleError);
    expect(new StorageError('a')).toBeInstanceOf(SteleError);
  });

  it('each error has a distinct name', () => {
    const names = [
      new SteleError('a', SteleErrorCode.INVALID_INPUT).name,
      new ValidationError('a', 'f').name,
      new CryptoError('a').name,
      new CCLError('a').name,
      new ChainError('a').name,
      new StorageError('a').name,
    ];
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('errors can be caught by SteleError type', () => {
    const errors: SteleError[] = [
      new ValidationError('a', 'f'),
      new CryptoError('a'),
      new CCLError('a'),
      new ChainError('a'),
      new StorageError('a'),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(SteleError);
      expect(typeof e.code).toBe('string');
    }
  });
});
