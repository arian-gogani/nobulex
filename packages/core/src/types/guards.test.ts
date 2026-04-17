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

describe('isNonEmptyString', () => {
  it('accepts non-whitespace strings, rejects everything else', () => {
    for (const v of ['hello', '  hi  ']) expect(isNonEmptyString(v)).toBe(true);
    for (const v of ['', '   ', null, undefined, 42, true, {}, []]) {
      expect(isNonEmptyString(v)).toBe(false);
    }
  });
});

describe('isValidHex', () => {
  it('accepts even-length hex (any case), rejects non-hex, odd length, empty, prefixes, non-strings', () => {
    for (const v of ['abcdef01', 'ABCDEF01', 'aAbBcCdD']) expect(isValidHex(v)).toBe(true);
    for (const v of ['', 'abc', 'xyz123', 'ab cd', '0xabcd', null, 123]) {
      expect(isValidHex(v)).toBe(false);
    }
  });
});

describe('isValidId / isValidPublicKey / isValidSignature', () => {
  it('id: 64 hex chars required', () => {
    expect(isValidId('a'.repeat(64))).toBe(true);
    expect(isValidId('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(true);
    for (const v of ['a'.repeat(63), 'a'.repeat(65), '', 'g'.repeat(64), null]) {
      expect(isValidId(v)).toBe(false);
    }
  });

  it('publicKey: 64 hex chars (32 bytes), signature: 128 hex chars (64 bytes)', () => {
    expect(isValidPublicKey('b'.repeat(64))).toBe(true);
    for (const v of ['b'.repeat(32), 'b'.repeat(128), 'z'.repeat(64), undefined]) {
      expect(isValidPublicKey(v)).toBe(false);
    }
    expect(isValidSignature('c'.repeat(128))).toBe(true);
    for (const v of ['c'.repeat(64), 'c'.repeat(127), 'c'.repeat(129), 'z'.repeat(128), null]) {
      expect(isValidSignature(v)).toBe(false);
    }
  });
});

describe('isValidISODate', () => {
  it('accepts date, datetime (Z / offset / millis), rejects garbage', () => {
    for (const v of [
      '2025-01-15',
      '2025-01-15T12:00:00Z',
      '2025-01-15T12:00:00+05:30',
      '2025-01-15T12:00:00.000Z',
    ]) {
      expect(isValidISODate(v)).toBe(true);
    }
    for (const v of ['', 'not-a-date', null, 1234567890, new Date(), '2025-13-45', '2025-01-15 extra']) {
      expect(isValidISODate(v)).toBe(false);
    }
  });
});

describe('isValidVersion', () => {
  it('accepts semver (incl. prerelease), rejects partial/non-numeric/non-string', () => {
    for (const v of ['0.1.0', '1.0.0', '10.20.30', '1.0.0-beta', '1.0.0-beta.1']) {
      expect(isValidVersion(v)).toBe(true);
    }
    for (const v of ['', '1.0', 'a.b.c', null, 100]) {
      expect(isValidVersion(v)).toBe(false);
    }
  });
});

describe('isPlainObject', () => {
  it('accepts plain object literals and Object.create(null); rejects instances, primitives, nil', () => {
    for (const v of [{}, { a: 1, b: 'two' }, Object.create(null)]) {
      expect(isPlainObject(v)).toBe(true);
    }
    class Foo { x = 1; }
    for (const v of [null, undefined, [1, 2, 3], new Date(), /foo/, new Map(), new Foo(), 'hello', 42]) {
      expect(isPlainObject(v)).toBe(false);
    }
  });
});

describe('sanitizeString', () => {
  it('trims, strips null bytes / ASCII control / DEL, preserves tab/newline/CR', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
    expect(sanitizeString('he\x00llo')).toBe('hello');
    expect(sanitizeString('he\x01l\x02lo\x1F!')).toBe('hello!');
    expect(sanitizeString('abc\x7Fdef')).toBe('abcdef');
    expect(sanitizeString('col1\tcol2')).toBe('col1\tcol2');
    expect(sanitizeString('line1\nline2')).toBe('line1\nline2');
    expect(sanitizeString('line1\r\nline2')).toBe('line1\r\nline2');
    expect(sanitizeString('')).toBe('');
  });

  it('applies trim before truncation and uses default maxLength 10000', () => {
    expect(sanitizeString('a'.repeat(200), 50)).toBe('a'.repeat(50));
    expect(sanitizeString('b'.repeat(20000))).toHaveLength(10000);
    const padded = '   ' + 'x'.repeat(10) + '   ';
    expect(sanitizeString(padded, 5)).toBe('xxxxx');
  });
});

describe('sanitizeJsonInput', () => {
  it('parses objects/arrays/primitives and allows nested structures', () => {
    expect(sanitizeJsonInput('{"key":"value"}')).toEqual({ key: 'value' });
    expect(sanitizeJsonInput('[1,2,3]')).toEqual([1, 2, 3]);
    expect(sanitizeJsonInput('"hello"')).toBe('hello');
    expect(sanitizeJsonInput('42')).toBe(42);
    expect(sanitizeJsonInput('null')).toBeNull();
    expect(sanitizeJsonInput('{"a":{"b":{"c":1}}}')).toEqual({ a: { b: { c: 1 } } });
    expect(sanitizeJsonInput('{"items":[1,2,3]}')).toEqual({ items: [1, 2, 3] });
  });

  it('rejects prototype-pollution keys (__proto__, constructor, prototype) including nested and in arrays', () => {
    expect(() => sanitizeJsonInput('{"__proto__":{"x":1}}')).toThrow(/dangerous key.*__proto__/i);
    expect(() => sanitizeJsonInput('{"constructor":{"prototype":{}}}')).toThrow(/dangerous key.*constructor/i);
    expect(() => sanitizeJsonInput('{"prototype":{}}')).toThrow(/dangerous key.*prototype/i);
    expect(() => sanitizeJsonInput('{"safe":{"__proto__":{"x":1}}}')).toThrow(/dangerous key.*__proto__/i);
    expect(() => sanitizeJsonInput('[{"__proto__":{"x":1}}]')).toThrow(/dangerous key.*__proto__/i);
    expect(() => sanitizeJsonInput('not valid json')).toThrow();
  });
});

describe('freezeDeep', () => {
  it('deeply freezes objects, arrays, and nested structures', () => {
    const obj = freezeDeep({ items: [{ x: 1 }, { y: 2 }], nested: { deep: { value: 'v' } } }) as Record<string, unknown>;
    expect(Object.isFrozen(obj)).toBe(true);
    expect(Object.isFrozen(obj.items)).toBe(true);
    expect(Object.isFrozen(obj.items[0])).toBe(true);
    expect(Object.isFrozen(obj.nested.deep)).toBe(true);
    expect(Object.isFrozen(freezeDeep([1, 2, 3]))).toBe(true);
  });

  it('returns primitives unchanged and handles already-frozen children', () => {
    expect(freezeDeep(42)).toBe(42);
    expect(freezeDeep('hello')).toBe('hello');
    expect(freezeDeep(true)).toBe(true);
    expect(freezeDeep(null)).toBeNull();
    expect(freezeDeep(undefined)).toBeUndefined();

    const inner = Object.freeze({ x: 1 });
    const wrapped = freezeDeep({ nested: inner }) as Record<string, unknown>;
    expect(Object.isFrozen(wrapped)).toBe(true);
    expect(Object.isFrozen(wrapped.nested)).toBe(true);
  });

  it('prevents mutation, addition, and nested mutation (throws in strict mode)', () => {
    const obj = freezeDeep({ a: 1, nested: { value: 'original' } }) as Record<string, unknown>;
    expect(() => { obj.a = 2; }).toThrow();
    expect(() => { obj.b = 2; }).toThrow();
    expect(() => { obj.nested.value = 'changed'; }).toThrow();
  });
});

describe('assertNever', () => {
  it('always throws and includes the offending value in the message', () => {
    expect(() => assertNever('unexpected' as never)).toThrow(/Unexpected value.*unexpected/);
    expect(() => assertNever(42 as never)).toThrow();
    try {
      assertNever('some_value' as never);
    } catch (e) {
      expect((e as Error).message).toContain('some_value');
    }
  });
});
