import { describe, it, expect } from 'vitest';
import {
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

// ---------------------------------------------------------------------------
// isNonEmptyString
// ---------------------------------------------------------------------------
describe('isNonEmptyString', () => {
  it('returns true for a regular string', () => {
    expect(isNonEmptyString('hello')).toBe(true);
  });

  it('returns true for a string with surrounding whitespace', () => {
    expect(isNonEmptyString('  hi  ')).toBe(true);
  });

  it('returns false for an empty string', () => {
    expect(isNonEmptyString('')).toBe(false);
  });

  it('returns false for a whitespace-only string', () => {
    expect(isNonEmptyString('   ')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isNonEmptyString(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isNonEmptyString(undefined)).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isNonEmptyString(42)).toBe(false);
  });

  it('returns false for a boolean', () => {
    expect(isNonEmptyString(true)).toBe(false);
  });

  it('returns false for an object', () => {
    expect(isNonEmptyString({})).toBe(false);
  });

  it('returns false for an array', () => {
    expect(isNonEmptyString([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidHex
// ---------------------------------------------------------------------------
describe('isValidHex', () => {
  it('returns true for valid lowercase hex', () => {
    expect(isValidHex('abcdef01')).toBe(true);
  });

  it('returns true for valid uppercase hex', () => {
    expect(isValidHex('ABCDEF01')).toBe(true);
  });

  it('returns true for valid mixed-case hex', () => {
    expect(isValidHex('aAbBcCdD')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidHex('')).toBe(false);
  });

  it('returns false for odd-length hex', () => {
    expect(isValidHex('abc')).toBe(false);
  });

  it('returns false for non-hex characters', () => {
    expect(isValidHex('xyz123')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidHex(null)).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isValidHex(123)).toBe(false);
  });

  it('returns false for hex with spaces', () => {
    expect(isValidHex('ab cd')).toBe(false);
  });

  it('returns false for hex with 0x prefix', () => {
    expect(isValidHex('0xabcd')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidId
// ---------------------------------------------------------------------------
describe('isValidId', () => {
  it('returns true for a 64-char hex string', () => {
    const id = 'a'.repeat(64);
    expect(isValidId(id)).toBe(true);
  });

  it('returns true for a realistic SHA-256 hash', () => {
    const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(isValidId(hash)).toBe(true);
  });

  it('returns false for a 63-char string', () => {
    expect(isValidId('a'.repeat(63))).toBe(false);
  });

  it('returns false for a 65-char string', () => {
    expect(isValidId('a'.repeat(65))).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidId('')).toBe(false);
  });

  it('returns false for non-hex 64-char string', () => {
    expect(isValidId('g'.repeat(64))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidId(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidPublicKey
// ---------------------------------------------------------------------------
describe('isValidPublicKey', () => {
  it('returns true for a 64-char hex string', () => {
    const key = 'b'.repeat(64);
    expect(isValidPublicKey(key)).toBe(true);
  });

  it('returns false for a 32-char hex string', () => {
    expect(isValidPublicKey('b'.repeat(32))).toBe(false);
  });

  it('returns false for a 128-char hex string', () => {
    expect(isValidPublicKey('b'.repeat(128))).toBe(false);
  });

  it('returns false for non-hex characters', () => {
    expect(isValidPublicKey('z'.repeat(64))).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidPublicKey(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidSignature
// ---------------------------------------------------------------------------
describe('isValidSignature', () => {
  it('returns true for a 128-char hex string', () => {
    const sig = 'c'.repeat(128);
    expect(isValidSignature(sig)).toBe(true);
  });

  it('returns false for a 64-char hex string', () => {
    expect(isValidSignature('c'.repeat(64))).toBe(false);
  });

  it('returns false for a 127-char hex string', () => {
    expect(isValidSignature('c'.repeat(127))).toBe(false);
  });

  it('returns false for a 129-char hex string', () => {
    expect(isValidSignature('c'.repeat(129))).toBe(false);
  });

  it('returns false for non-hex 128-char string', () => {
    expect(isValidSignature('z'.repeat(128))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidSignature(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidISODate
// ---------------------------------------------------------------------------
describe('isValidISODate', () => {
  it('returns true for a date-only string', () => {
    expect(isValidISODate('2025-01-15')).toBe(true);
  });

  it('returns true for a full ISO datetime with Z', () => {
    expect(isValidISODate('2025-01-15T12:00:00Z')).toBe(true);
  });

  it('returns true for an ISO datetime with timezone offset', () => {
    expect(isValidISODate('2025-01-15T12:00:00+05:30')).toBe(true);
  });

  it('returns true for an ISO datetime with milliseconds', () => {
    expect(isValidISODate('2025-01-15T12:00:00.000Z')).toBe(true);
  });

  it('returns false for an empty string', () => {
    expect(isValidISODate('')).toBe(false);
  });

  it('returns false for a random string', () => {
    expect(isValidISODate('not-a-date')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidISODate(null)).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isValidISODate(1234567890)).toBe(false);
  });

  it('returns false for a Date object', () => {
    expect(isValidISODate(new Date())).toBe(false);
  });

  it('returns false for an invalid date like 2025-13-45', () => {
    expect(isValidISODate('2025-13-45')).toBe(false);
  });

  it('returns false for a date-like string with extra characters', () => {
    expect(isValidISODate('2025-01-15 extra')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidVersion
// ---------------------------------------------------------------------------
describe('isValidVersion', () => {
  it('returns true for 0.1.0', () => {
    expect(isValidVersion('0.1.0')).toBe(true);
  });

  it('returns true for 1.0.0', () => {
    expect(isValidVersion('1.0.0')).toBe(true);
  });

  it('returns true for 10.20.30', () => {
    expect(isValidVersion('10.20.30')).toBe(true);
  });

  it('returns true for a version with prerelease tag', () => {
    expect(isValidVersion('1.0.0-beta')).toBe(true);
  });

  it('returns true for a version with dotted prerelease', () => {
    expect(isValidVersion('1.0.0-beta.1')).toBe(true);
  });

  it('returns false for an empty string', () => {
    expect(isValidVersion('')).toBe(false);
  });

  it('returns false for a partial version like 1.0', () => {
    expect(isValidVersion('1.0')).toBe(false);
  });

  it('returns false for non-numeric version', () => {
    expect(isValidVersion('a.b.c')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidVersion(null)).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isValidVersion(100)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isPlainObject
// ---------------------------------------------------------------------------
describe('isPlainObject', () => {
  it('returns true for a plain object literal', () => {
    expect(isPlainObject({})).toBe(true);
  });

  it('returns true for an object with properties', () => {
    expect(isPlainObject({ a: 1, b: 'two' })).toBe(true);
  });

  it('returns true for Object.create(null)', () => {
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it('returns false for null', () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it('returns false for an array', () => {
    expect(isPlainObject([1, 2, 3])).toBe(false);
  });

  it('returns false for a Date instance', () => {
    expect(isPlainObject(new Date())).toBe(false);
  });

  it('returns false for a RegExp instance', () => {
    expect(isPlainObject(/foo/)).toBe(false);
  });

  it('returns false for a Map instance', () => {
    expect(isPlainObject(new Map())).toBe(false);
  });

  it('returns false for a class instance', () => {
    class Foo { x = 1; }
    expect(isPlainObject(new Foo())).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isPlainObject('hello')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isPlainObject(42)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isPlainObject(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeString
// ---------------------------------------------------------------------------
describe('sanitizeString', () => {
  it('trims leading and trailing whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('truncates to maxLength', () => {
    const long = 'a'.repeat(200);
    expect(sanitizeString(long, 50)).toBe('a'.repeat(50));
  });

  it('uses default maxLength of 10000', () => {
    const long = 'b'.repeat(20000);
    expect(sanitizeString(long).length).toBe(10000);
  });

  it('strips null bytes', () => {
    expect(sanitizeString('he\x00llo')).toBe('hello');
  });

  it('strips ASCII control characters', () => {
    expect(sanitizeString('he\x01l\x02lo\x1F!')).toBe('hello!');
  });

  it('strips DEL character (0x7F)', () => {
    expect(sanitizeString('abc\x7Fdef')).toBe('abcdef');
  });

  it('preserves tabs', () => {
    expect(sanitizeString('col1\tcol2')).toBe('col1\tcol2');
  });

  it('preserves newlines', () => {
    expect(sanitizeString('line1\nline2')).toBe('line1\nline2');
  });

  it('preserves carriage returns', () => {
    expect(sanitizeString('line1\r\nline2')).toBe('line1\r\nline2');
  });

  it('handles an empty string', () => {
    expect(sanitizeString('')).toBe('');
  });

  it('trims then truncates (trim first)', () => {
    const input = '   ' + 'x'.repeat(10) + '   ';
    // Trim removes 6 chars of whitespace, leaving 10 'x' chars
    expect(sanitizeString(input, 5)).toBe('xxxxx');
  });
});

// ---------------------------------------------------------------------------
// sanitizeJsonInput
// ---------------------------------------------------------------------------
describe('sanitizeJsonInput', () => {
  it('parses valid JSON', () => {
    const result = sanitizeJsonInput('{"key":"value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('parses a JSON array', () => {
    const result = sanitizeJsonInput('[1,2,3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('parses a JSON string', () => {
    const result = sanitizeJsonInput('"hello"');
    expect(result).toBe('hello');
  });

  it('parses a JSON number', () => {
    const result = sanitizeJsonInput('42');
    expect(result).toBe(42);
  });

  it('parses null JSON', () => {
    const result = sanitizeJsonInput('null');
    expect(result).toBeNull();
  });

  it('throws on __proto__ key', () => {
    expect(() =>
      sanitizeJsonInput('{"__proto__":{"polluted":true}}'),
    ).toThrow(/dangerous key.*__proto__/i);
  });

  it('throws on constructor key', () => {
    expect(() =>
      sanitizeJsonInput('{"constructor":{"prototype":{"polluted":true}}}'),
    ).toThrow(/dangerous key.*constructor/i);
  });

  it('throws on prototype key', () => {
    expect(() =>
      sanitizeJsonInput('{"prototype":{"polluted":true}}'),
    ).toThrow(/dangerous key.*prototype/i);
  });

  it('throws on nested __proto__ key', () => {
    expect(() =>
      sanitizeJsonInput('{"safe":{"__proto__":{"polluted":true}}}'),
    ).toThrow(/dangerous key.*__proto__/i);
  });

  it('throws on __proto__ inside an array element', () => {
    expect(() =>
      sanitizeJsonInput('[{"__proto__":{"polluted":true}}]'),
    ).toThrow(/dangerous key.*__proto__/i);
  });

  it('throws on invalid JSON', () => {
    expect(() => sanitizeJsonInput('not valid json')).toThrow();
  });

  it('allows normal nested objects', () => {
    const result = sanitizeJsonInput('{"a":{"b":{"c":1}}}');
    expect(result).toEqual({ a: { b: { c: 1 } } });
  });

  it('allows arrays inside objects', () => {
    const result = sanitizeJsonInput('{"items":[1,2,3]}');
    expect(result).toEqual({ items: [1, 2, 3] });
  });
});

// ---------------------------------------------------------------------------
// freezeDeep
// ---------------------------------------------------------------------------
describe('freezeDeep', () => {
  it('freezes a simple object', () => {
    const obj = freezeDeep({ a: 1 });
    expect(Object.isFrozen(obj)).toBe(true);
  });

  it('freezes nested objects', () => {
    const obj = freezeDeep({ a: { b: { c: 1 } } });
    expect(Object.isFrozen(obj)).toBe(true);
    expect(Object.isFrozen((obj as any).a)).toBe(true);
    expect(Object.isFrozen((obj as any).a.b)).toBe(true);
  });

  it('freezes arrays', () => {
    const arr = freezeDeep([1, 2, 3]);
    expect(Object.isFrozen(arr)).toBe(true);
  });

  it('freezes nested arrays and objects', () => {
    const obj = freezeDeep({ items: [{ x: 1 }, { y: 2 }] });
    expect(Object.isFrozen(obj)).toBe(true);
    expect(Object.isFrozen((obj as any).items)).toBe(true);
    expect(Object.isFrozen((obj as any).items[0])).toBe(true);
    expect(Object.isFrozen((obj as any).items[1])).toBe(true);
  });

  it('returns primitives unchanged', () => {
    expect(freezeDeep(42)).toBe(42);
    expect(freezeDeep('hello')).toBe('hello');
    expect(freezeDeep(true)).toBe(true);
    expect(freezeDeep(null)).toBeNull();
    expect(freezeDeep(undefined)).toBeUndefined();
  });

  it('does not re-freeze already-frozen objects', () => {
    const inner = Object.freeze({ x: 1 });
    const obj = { nested: inner };
    const frozen = freezeDeep(obj);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen((frozen as any).nested)).toBe(true);
  });

  it('prevents property assignment on frozen objects', () => {
    const obj = freezeDeep({ a: 1 });
    expect(() => {
      (obj as any).a = 2;
    }).toThrow();
  });

  it('prevents adding new properties on frozen objects', () => {
    const obj = freezeDeep({ a: 1 });
    expect(() => {
      (obj as any).b = 2;
    }).toThrow();
  });

  it('prevents modifying nested properties', () => {
    const obj = freezeDeep({ nested: { value: 'original' } });
    expect(() => {
      (obj as any).nested.value = 'changed';
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// assertNever
// ---------------------------------------------------------------------------
describe('assertNever', () => {
  it('throws with a descriptive message', () => {
    expect(() => assertNever('unexpected' as never)).toThrow(
      /Unexpected value.*unexpected/,
    );
  });

  it('always throws (never returns)', () => {
    expect(() => assertNever(42 as never)).toThrow();
  });

  it('includes the value in the error message', () => {
    try {
      assertNever('some_value' as never);
    } catch (e) {
      expect((e as Error).message).toContain('some_value');
    }
  });
});
