import { describe, it, expect } from 'vitest';
import {
  generateKeyPair,
  keyPairFromPrivateKey,
  keyPairFromPrivateKeyHex,
  sign,
  signString,
  verify,
  sha256,
  sha256String,
  sha256Object,
  canonicalizeJson,
  base64urlEncode,
  base64urlDecode,
  toHex,
  fromHex,
  generateNonce,
  generateId,
  constantTimeEqual,
  timestamp,
} from './index';

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------
describe('generateKeyPair', () => {
  it('produces a valid KeyPair with 32-byte private key and 32-byte public key', async () => {
    const kp = await generateKeyPair();
    expect(kp.privateKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.privateKey.length).toBe(32);
    expect(kp.publicKey.length).toBe(32);
  });

  it('includes a hex-encoded public key that matches the raw public key', async () => {
    const kp = await generateKeyPair();
    expect(typeof kp.publicKeyHex).toBe('string');
    expect(kp.publicKeyHex.length).toBe(64); // 32 bytes -> 64 hex chars
    expect(kp.publicKeyHex).toBe(toHex(kp.publicKey));
  });

  it('produces different key pairs on each call', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    expect(toHex(kp1.privateKey)).not.toBe(toHex(kp2.privateKey));
    expect(kp1.publicKeyHex).not.toBe(kp2.publicKeyHex);
  });
});

describe('keyPairFromPrivateKey', () => {
  it('reconstructs the same public key from an existing private key', async () => {
    const original = await generateKeyPair();
    const restored = await keyPairFromPrivateKey(original.privateKey);
    expect(toHex(restored.publicKey)).toBe(toHex(original.publicKey));
    expect(restored.publicKeyHex).toBe(original.publicKeyHex);
  });

  it('creates a copy of the private key bytes', async () => {
    const original = await generateKeyPair();
    const restored = await keyPairFromPrivateKey(original.privateKey);
    // Mutating one should not affect the other
    restored.privateKey[0] = (restored.privateKey[0]! + 1) % 256;
    expect(original.privateKey[0]).not.toBe(restored.privateKey[0]);
  });
});

describe('keyPairFromPrivateKeyHex', () => {
  it('reconstructs a key pair from a hex-encoded private key', async () => {
    const original = await generateKeyPair();
    const hex = toHex(original.privateKey);
    const restored = await keyPairFromPrivateKeyHex(hex);
    expect(restored.publicKeyHex).toBe(original.publicKeyHex);
  });
});

// ---------------------------------------------------------------------------
// Signing and verification
// ---------------------------------------------------------------------------
describe('sign and verify', () => {
  it('sign -> verify round-trip succeeds', async () => {
    const kp = await generateKeyPair();
    const message = new TextEncoder().encode('hello world');
    const signature = await sign(message, kp.privateKey);
    const valid = await verify(message, signature, kp.publicKey);
    expect(valid).toBe(true);
  });

  it('signString -> verify round-trip succeeds', async () => {
    const kp = await generateKeyPair();
    const msg = 'stele protocol message';
    const signature = await signString(msg, kp.privateKey);
    const valid = await verify(new TextEncoder().encode(msg), signature, kp.publicKey);
    expect(valid).toBe(true);
  });

  it('signature is 64 bytes', async () => {
    const kp = await generateKeyPair();
    const message = new TextEncoder().encode('test');
    const signature = await sign(message, kp.privateKey);
    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(64);
  });

  it('verify fails with wrong public key', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const message = new TextEncoder().encode('hello');
    const signature = await sign(message, kp1.privateKey);
    const valid = await verify(message, signature, kp2.publicKey);
    expect(valid).toBe(false);
  });

  it('verify fails with modified message', async () => {
    const kp = await generateKeyPair();
    const message = new TextEncoder().encode('original message');
    const signature = await sign(message, kp.privateKey);
    const tampered = new TextEncoder().encode('tampered message');
    const valid = await verify(tampered, signature, kp.publicKey);
    expect(valid).toBe(false);
  });

  it('verify fails with corrupted signature', async () => {
    const kp = await generateKeyPair();
    const message = new TextEncoder().encode('test');
    const signature = await sign(message, kp.privateKey);
    const corrupted = new Uint8Array(signature);
    corrupted[0] = (corrupted[0]! + 1) % 256;
    const valid = await verify(message, corrupted, kp.publicKey);
    expect(valid).toBe(false);
  });

  it('verify never throws, returns false on invalid input', async () => {
    const kp = await generateKeyPair();
    const message = new TextEncoder().encode('test');
    // Completely garbage signature and key
    const garbageSig = new Uint8Array(64).fill(0xff);
    const garbageKey = new Uint8Array(32).fill(0xff);
    const result = await verify(message, garbageSig, garbageKey);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------
describe('sha256', () => {
  it('produces consistent hash for same input', () => {
    const data = new TextEncoder().encode('hello');
    const hash1 = sha256(data);
    const hash2 = sha256(data);
    expect(hash1).toBe(hash2);
  });

  it('produces a 64-character hex string (256 bits)', () => {
    const data = new TextEncoder().encode('test');
    const hash = sha256(data);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it('produces different hashes for different inputs', () => {
    const h1 = sha256(new TextEncoder().encode('foo'));
    const h2 = sha256(new TextEncoder().encode('bar'));
    expect(h1).not.toBe(h2);
  });

  it('produces the known SHA-256 of empty input', () => {
    const hash = sha256(new Uint8Array(0));
    // SHA-256 of empty string
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('sha256String', () => {
  it('produces same hash as manual encoding + sha256', () => {
    const input = 'hello world';
    const expected = sha256(new TextEncoder().encode(input));
    expect(sha256String(input)).toBe(expected);
  });

  it('returns consistent hash for same string', () => {
    expect(sha256String('test')).toBe(sha256String('test'));
  });
});

describe('sha256Object', () => {
  it('produces same hash for objects with different key order', () => {
    const obj1 = { b: 2, a: 1 };
    const obj2 = { a: 1, b: 2 };
    expect(sha256Object(obj1)).toBe(sha256Object(obj2));
  });

  it('produces different hashes for different objects', () => {
    expect(sha256Object({ a: 1 })).not.toBe(sha256Object({ a: 2 }));
  });

  it('handles nested objects with different key ordering', () => {
    const obj1 = { outer: { z: 3, a: 1 }, name: 'test' };
    const obj2 = { name: 'test', outer: { a: 1, z: 3 } };
    expect(sha256Object(obj1)).toBe(sha256Object(obj2));
  });
});

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------
describe('canonicalizeJson', () => {
  it('sorts keys deterministically', () => {
    const obj = { c: 3, a: 1, b: 2 };
    const canonical = canonicalizeJson(obj);
    expect(canonical).toBe('{"a":1,"b":2,"c":3}');
  });

  it('sorts nested object keys', () => {
    const obj = { z: { b: 2, a: 1 }, a: 0 };
    const canonical = canonicalizeJson(obj);
    expect(canonical).toBe('{"a":0,"z":{"a":1,"b":2}}');
  });

  it('handles arrays without reordering elements', () => {
    const obj = { arr: [3, 1, 2] };
    const canonical = canonicalizeJson(obj);
    expect(canonical).toBe('{"arr":[3,1,2]}');
  });

  it('handles null and primitive values', () => {
    expect(canonicalizeJson(null)).toBe('null');
    expect(canonicalizeJson(42)).toBe('42');
    expect(canonicalizeJson('hello')).toBe('"hello"');
    expect(canonicalizeJson(true)).toBe('true');
  });

  it('omits undefined values', () => {
    const obj = { a: 1, b: undefined, c: 3 };
    const canonical = canonicalizeJson(obj);
    expect(canonical).toBe('{"a":1,"c":3}');
  });

  it('handles deeply nested structures', () => {
    const obj = { d: { c: { b: { a: 1 } } } };
    expect(canonicalizeJson(obj)).toBe('{"d":{"c":{"b":{"a":1}}}}');
  });

  it('same object with different key insertion order produces identical output', () => {
    const obj1: Record<string, number> = {};
    obj1['z'] = 26;
    obj1['a'] = 1;
    obj1['m'] = 13;

    const obj2: Record<string, number> = {};
    obj2['m'] = 13;
    obj2['z'] = 26;
    obj2['a'] = 1;

    expect(canonicalizeJson(obj1)).toBe(canonicalizeJson(obj2));
  });

  it('handles arrays of objects with sorted keys', () => {
    const arr = [{ b: 2, a: 1 }, { d: 4, c: 3 }];
    const canonical = canonicalizeJson(arr);
    expect(canonical).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
  });
});

// ---------------------------------------------------------------------------
// Base64url encoding
// ---------------------------------------------------------------------------
describe('base64urlEncode / base64urlDecode', () => {
  it('round-trips arbitrary bytes', () => {
    const data = new Uint8Array([0, 1, 2, 255, 128, 64, 32, 16, 8, 4, 2, 1]);
    const encoded = base64urlEncode(data);
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(data);
  });

  it('encodes to base64url without padding', () => {
    const data = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    const encoded = base64urlEncode(data);
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });

  it('round-trips empty input', () => {
    const data = new Uint8Array(0);
    const encoded = base64urlEncode(data);
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(data);
  });

  it('round-trips a 32-byte key', () => {
    const data = new Uint8Array(32);
    for (let i = 0; i < 32; i++) data[i] = i;
    const encoded = base64urlEncode(data);
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(data);
  });

  it('produces URL-safe characters (no +, /, or =)', () => {
    // Use bytes that would produce +, /, = in standard base64
    const data = new Uint8Array([251, 255, 254, 253, 63, 62]);
    const encoded = base64urlEncode(data);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });
});

// ---------------------------------------------------------------------------
// Hex encoding
// ---------------------------------------------------------------------------
describe('toHex / fromHex', () => {
  it('round-trips arbitrary bytes', () => {
    const data = new Uint8Array([0x00, 0xff, 0x0a, 0xab, 0xcd, 0xef]);
    const hex = toHex(data);
    const decoded = fromHex(hex);
    expect(decoded).toEqual(data);
  });

  it('produces lowercase hex', () => {
    const data = new Uint8Array([0xAB, 0xCD, 0xEF]);
    const hex = toHex(data);
    expect(hex).toBe('abcdef');
    expect(hex).toBe(hex.toLowerCase());
  });

  it('pads single-digit hex values with leading zero', () => {
    const data = new Uint8Array([0, 1, 2, 15]);
    const hex = toHex(data);
    expect(hex).toBe('0001020f');
  });

  it('round-trips empty input', () => {
    const data = new Uint8Array(0);
    expect(toHex(data)).toBe('');
    expect(fromHex('')).toEqual(data);
  });

  it('fromHex throws on odd-length input', () => {
    expect(() => fromHex('abc')).toThrow('Invalid hex string: odd length');
  });

  it('round-trips 32-byte keys', () => {
    const data = new Uint8Array(32);
    for (let i = 0; i < 32; i++) data[i] = i * 8;
    const hex = toHex(data);
    expect(hex.length).toBe(64);
    expect(fromHex(hex)).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// Nonce generation
// ---------------------------------------------------------------------------
describe('generateNonce', () => {
  it('produces a 32-byte Uint8Array', () => {
    const nonce = generateNonce();
    expect(nonce).toBeInstanceOf(Uint8Array);
    expect(nonce.length).toBe(32);
  });

  it('produces unique nonces (100 nonces, all different)', () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      nonces.add(toHex(generateNonce()));
    }
    expect(nonces.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------
describe('generateId', () => {
  it('produces 32-character hex string by default (16 bytes)', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBe(32);
    expect(/^[0-9a-f]{32}$/.test(id)).toBe(true);
  });

  it('produces hex string of expected length for custom byte count', () => {
    const id8 = generateId(8);
    expect(id8.length).toBe(16); // 8 bytes -> 16 hex chars

    const id32 = generateId(32);
    expect(id32.length).toBe(64); // 32 bytes -> 64 hex chars
  });

  it('produces unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Constant-time comparison
// ---------------------------------------------------------------------------
describe('constantTimeEqual', () => {
  it('returns true for equal arrays', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    expect(constantTimeEqual(a, b)).toBe(true);
  });

  it('returns false for different arrays of same length', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 6]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('returns false for different lengths', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('returns true for two empty arrays', () => {
    const a = new Uint8Array(0);
    const b = new Uint8Array(0);
    expect(constantTimeEqual(a, b)).toBe(true);
  });

  it('returns false when arrays differ only in first byte', () => {
    const a = new Uint8Array([0, 1, 2, 3]);
    const b = new Uint8Array([1, 1, 2, 3]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('returns false when arrays differ only in last byte', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------
describe('timestamp', () => {
  it('returns a string in ISO 8601 format', () => {
    const ts = timestamp();
    expect(typeof ts).toBe('string');
    // ISO 8601 pattern: YYYY-MM-DDTHH:mm:ss.sssZ
    const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(iso8601Regex.test(ts)).toBe(true);
  });

  it('returns a parseable date', () => {
    const ts = timestamp();
    const date = new Date(ts);
    expect(date.getTime()).not.toBeNaN();
  });

  it('returns a timestamp close to the current time', () => {
    const before = Date.now();
    const ts = timestamp();
    const after = Date.now();
    const parsed = new Date(ts).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});
