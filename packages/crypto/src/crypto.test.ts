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

// ---------------------------------------------------------------------------
// Extended signing edge cases
// ---------------------------------------------------------------------------
describe('sign and verify - extended', () => {
  it('sign produces deterministic output for same key + message', async () => {
    // Ed25519 uses deterministic nonce, so same key + message = same signature
    const kp = await generateKeyPair();
    const msg = new TextEncoder().encode('deterministic test');
    const sig1 = await sign(msg, kp.privateKey);
    const sig2 = await sign(msg, kp.privateKey);
    expect(toHex(sig1)).toBe(toHex(sig2));
  });

  it('signString with empty string produces a valid signature', async () => {
    const kp = await generateKeyPair();
    const sig = await signString('', kp.privateKey);
    expect(sig.length).toBe(64);
    const valid = await verify(new TextEncoder().encode(''), sig, kp.publicKey);
    expect(valid).toBe(true);
  });

  it('signString with unicode characters', async () => {
    const kp = await generateKeyPair();
    const unicodeMsg = 'Hello \u{1F600} World \u{1F30D}';
    const sig = await signString(unicodeMsg, kp.privateKey);
    const valid = await verify(new TextEncoder().encode(unicodeMsg), sig, kp.publicKey);
    expect(valid).toBe(true);
  });

  it('signString with very long message (10KB)', async () => {
    const kp = await generateKeyPair();
    const longMsg = 'x'.repeat(10240);
    const sig = await signString(longMsg, kp.privateKey);
    const valid = await verify(new TextEncoder().encode(longMsg), sig, kp.publicKey);
    expect(valid).toBe(true);
  });

  it('verify rejects signature from different message with same key', async () => {
    const kp = await generateKeyPair();
    const sig = await signString('message A', kp.privateKey);
    const valid = await verify(new TextEncoder().encode('message B'), sig, kp.publicKey);
    expect(valid).toBe(false);
  });

  it('verify rejects empty signature', async () => {
    const kp = await generateKeyPair();
    const msg = new TextEncoder().encode('test');
    const valid = await verify(msg, new Uint8Array(0), kp.publicKey);
    expect(valid).toBe(false);
  });

  it('verify rejects signature of wrong length (32 bytes)', async () => {
    const kp = await generateKeyPair();
    const msg = new TextEncoder().encode('test');
    const valid = await verify(msg, new Uint8Array(32), kp.publicKey);
    expect(valid).toBe(false);
  });

  it('verify rejects empty public key', async () => {
    const kp = await generateKeyPair();
    const msg = new TextEncoder().encode('test');
    const sig = await sign(msg, kp.privateKey);
    const valid = await verify(msg, sig, new Uint8Array(0));
    expect(valid).toBe(false);
  });

  it('sign and verify with multiple key pairs independently', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const kp3 = await generateKeyPair();

    const msg1 = new TextEncoder().encode('message for kp1');
    const msg2 = new TextEncoder().encode('message for kp2');
    const msg3 = new TextEncoder().encode('message for kp3');

    const sig1 = await sign(msg1, kp1.privateKey);
    const sig2 = await sign(msg2, kp2.privateKey);
    const sig3 = await sign(msg3, kp3.privateKey);

    // Each signature should only verify with its own key+message
    expect(await verify(msg1, sig1, kp1.publicKey)).toBe(true);
    expect(await verify(msg2, sig2, kp2.publicKey)).toBe(true);
    expect(await verify(msg3, sig3, kp3.publicKey)).toBe(true);

    // Cross-verify should fail
    expect(await verify(msg1, sig1, kp2.publicKey)).toBe(false);
    expect(await verify(msg2, sig2, kp3.publicKey)).toBe(false);
    expect(await verify(msg3, sig3, kp1.publicKey)).toBe(false);
    expect(await verify(msg1, sig2, kp1.publicKey)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Extended key pair derivation
// ---------------------------------------------------------------------------
describe('keyPairFromPrivateKey - extended', () => {
  it('preserves private key bytes exactly', async () => {
    const original = await generateKeyPair();
    const restored = await keyPairFromPrivateKey(original.privateKey);
    expect(toHex(restored.privateKey)).toBe(toHex(original.privateKey));
  });

  it('works with all-zero private key', async () => {
    const zeroKey = new Uint8Array(32);
    const kp = await keyPairFromPrivateKey(zeroKey);
    expect(kp.publicKey.length).toBe(32);
    expect(kp.publicKeyHex.length).toBe(64);
  });

  it('works with all-0xFF private key', async () => {
    const maxKey = new Uint8Array(32).fill(0xff);
    const kp = await keyPairFromPrivateKey(maxKey);
    expect(kp.publicKey.length).toBe(32);
    expect(kp.publicKeyHex.length).toBe(64);
  });

  it('different private keys produce different public keys', async () => {
    const key1 = new Uint8Array(32).fill(1);
    const key2 = new Uint8Array(32).fill(2);
    const kp1 = await keyPairFromPrivateKey(key1);
    const kp2 = await keyPairFromPrivateKey(key2);
    expect(kp1.publicKeyHex).not.toBe(kp2.publicKeyHex);
  });
});

describe('keyPairFromPrivateKeyHex - extended', () => {
  it('handles lowercase hex input', async () => {
    const original = await generateKeyPair();
    const hex = toHex(original.privateKey).toLowerCase();
    const restored = await keyPairFromPrivateKeyHex(hex);
    expect(restored.publicKeyHex).toBe(original.publicKeyHex);
  });

  it('round-trips: generate -> hex -> restore -> sign -> verify', async () => {
    const original = await generateKeyPair();
    const hex = toHex(original.privateKey);
    const restored = await keyPairFromPrivateKeyHex(hex);
    const msg = new TextEncoder().encode('round trip test');
    const sig = await sign(msg, restored.privateKey);
    const valid = await verify(msg, sig, original.publicKey);
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Extended SHA-256 hashing tests
// ---------------------------------------------------------------------------
describe('sha256 - extended', () => {
  it('matches known hash for "hello world"', () => {
    const hash = sha256String('hello world');
    // Known SHA-256 of "hello world"
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('handles binary data (all byte values 0x00-0xFF)', () => {
    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) allBytes[i] = i;
    const hash = sha256(allBytes);
    expect(hash.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it('produces different hash for different strings that share prefix', () => {
    const h1 = sha256String('test123');
    const h2 = sha256String('test124');
    expect(h1).not.toBe(h2);
  });

  it('sha256Object handles arrays of primitives', () => {
    const h1 = sha256Object([1, 2, 3]);
    const h2 = sha256Object([1, 2, 3]);
    expect(h1).toBe(h2);
  });

  it('sha256Object produces different hashes for different array orders', () => {
    const h1 = sha256Object([1, 2, 3]);
    const h2 = sha256Object([3, 2, 1]);
    expect(h1).not.toBe(h2);
  });

  it('sha256Object handles nested arrays within objects', () => {
    const obj = { data: [{ x: 1, y: 2 }, { y: 4, x: 3 }] };
    const hash = sha256Object(obj);
    expect(hash.length).toBe(64);
  });

  it('sha256Object handles empty object', () => {
    const h1 = sha256Object({});
    const h2 = sha256Object({});
    expect(h1).toBe(h2);
  });

  it('sha256Object handles null', () => {
    const hash = sha256Object(null);
    expect(hash.length).toBe(64);
  });

  it('sha256Object handles boolean values', () => {
    const h1 = sha256Object({ flag: true });
    const h2 = sha256Object({ flag: false });
    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// Extended canonicalization
// ---------------------------------------------------------------------------
describe('canonicalizeJson - extended', () => {
  it('handles numeric edge values', () => {
    const obj = { max: Number.MAX_SAFE_INTEGER, min: Number.MIN_SAFE_INTEGER, zero: 0, neg: -1 };
    const canonical = canonicalizeJson(obj);
    const parsed = JSON.parse(canonical);
    expect(parsed.max).toBe(Number.MAX_SAFE_INTEGER);
    expect(parsed.min).toBe(Number.MIN_SAFE_INTEGER);
  });

  it('handles boolean values', () => {
    const obj = { t: true, f: false };
    expect(canonicalizeJson(obj)).toBe('{"f":false,"t":true}');
  });

  it('handles empty arrays and objects', () => {
    const obj = { arr: [], obj: {} };
    expect(canonicalizeJson(obj)).toBe('{"arr":[],"obj":{}}');
  });

  it('handles deeply nested (5 levels) structures', () => {
    const obj = { a: { b: { c: { d: { e: 'deep' } } } } };
    expect(canonicalizeJson(obj)).toBe('{"a":{"b":{"c":{"d":{"e":"deep"}}}}}');
  });

  it('handles mixed arrays with objects', () => {
    const obj = { items: [1, 'two', { three: 3 }, [4, 5]] };
    const canonical = canonicalizeJson(obj);
    expect(canonical).toBe('{"items":[1,"two",{"three":3},[4,5]]}');
  });

  it('handles strings with special characters', () => {
    const obj = { text: 'hello "world" \\n\ttab' };
    const canonical = canonicalizeJson(obj);
    const parsed = JSON.parse(canonical);
    expect(parsed.text).toBe('hello "world" \\n\ttab');
  });

  it('handles object with many keys (verifies sort order)', () => {
    const obj: Record<string, number> = {};
    const letters = 'zyxwvutsrqponmlkjihgfedcba'.split('');
    letters.forEach((l, i) => { obj[l] = i; });
    const canonical = canonicalizeJson(obj);
    const keys = Object.keys(JSON.parse(canonical));
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });

  it('produces identical output for identical data structures', () => {
    const a = { users: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }] };
    const b = { users: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }] };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
  });
});

// ---------------------------------------------------------------------------
// Extended base64url
// ---------------------------------------------------------------------------
describe('base64urlEncode / base64urlDecode - extended', () => {
  it('round-trips a single byte', () => {
    for (let i = 0; i < 256; i++) {
      const data = new Uint8Array([i]);
      const encoded = base64urlEncode(data);
      const decoded = base64urlDecode(encoded);
      expect(decoded).toEqual(data);
    }
  });

  it('round-trips large data (1KB)', () => {
    const data = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) data[i] = i % 256;
    const encoded = base64urlEncode(data);
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(data);
  });

  it('round-trips data of lengths 1 through 33 (all padding variations)', () => {
    for (let len = 1; len <= 33; len++) {
      const data = new Uint8Array(len);
      for (let i = 0; i < len; i++) data[i] = (i * 17) % 256;
      const encoded = base64urlEncode(data);
      const decoded = base64urlDecode(encoded);
      expect(decoded).toEqual(data);
    }
  });

  it('encoded output only contains URL-safe characters', () => {
    const data = new Uint8Array(100);
    for (let i = 0; i < 100; i++) data[i] = i * 3;
    const encoded = base64urlEncode(data);
    expect(/^[A-Za-z0-9_-]*$/.test(encoded)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Extended hex encoding
// ---------------------------------------------------------------------------
describe('toHex / fromHex - extended', () => {
  it('round-trips all single-byte values (0x00-0xFF)', () => {
    for (let i = 0; i <= 0xff; i++) {
      const data = new Uint8Array([i]);
      const hex = toHex(data);
      expect(hex.length).toBe(2);
      expect(fromHex(hex)).toEqual(data);
    }
  });

  it('fromHex handles uppercase hex strings', () => {
    const hex = 'ABCDEF';
    const bytes = fromHex(hex);
    expect(bytes).toEqual(new Uint8Array([0xab, 0xcd, 0xef]));
  });

  it('fromHex handles mixed case hex strings', () => {
    const hex = 'AbCdEf';
    const bytes = fromHex(hex);
    expect(bytes).toEqual(new Uint8Array([0xab, 0xcd, 0xef]));
  });

  it('round-trips large data (512 bytes)', () => {
    const data = new Uint8Array(512);
    for (let i = 0; i < 512; i++) data[i] = i % 256;
    const hex = toHex(data);
    expect(hex.length).toBe(1024);
    expect(fromHex(hex)).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// Extended nonce and ID generation
// ---------------------------------------------------------------------------
describe('generateNonce - extended', () => {
  it('nonce hex representations are all unique', () => {
    const hexes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      hexes.add(toHex(generateNonce()));
    }
    expect(hexes.size).toBe(50);
  });

  it('nonce is not all zeros', () => {
    // Extremely unlikely but good to check
    const nonce = generateNonce();
    const allZero = nonce.every(b => b === 0);
    expect(allZero).toBe(false);
  });
});

describe('generateId - extended', () => {
  it('produces only valid hex characters', () => {
    for (let i = 0; i < 20; i++) {
      const id = generateId();
      expect(/^[0-9a-f]+$/.test(id)).toBe(true);
    }
  });

  it('generates IDs of various sizes', () => {
    for (const bytes of [1, 4, 8, 16, 32, 64]) {
      const id = generateId(bytes);
      expect(id.length).toBe(bytes * 2);
    }
  });
});

// ---------------------------------------------------------------------------
// Extended constant-time comparison
// ---------------------------------------------------------------------------
describe('constantTimeEqual - extended', () => {
  it('returns true for identical 32-byte arrays', () => {
    const data = new Uint8Array(32);
    for (let i = 0; i < 32; i++) data[i] = i;
    const clone = new Uint8Array(data);
    expect(constantTimeEqual(data, clone)).toBe(true);
  });

  it('returns false when single bit differs', () => {
    const a = new Uint8Array(32).fill(0);
    const b = new Uint8Array(32).fill(0);
    b[15] = 1; // Flip one bit in the middle
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('returns false for arrays differing in length by 1', () => {
    const a = new Uint8Array(31).fill(0xab);
    const b = new Uint8Array(32).fill(0xab);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('works with 64-byte arrays (signature length)', () => {
    const a = new Uint8Array(64).fill(0x42);
    const b = new Uint8Array(64).fill(0x42);
    expect(constantTimeEqual(a, b)).toBe(true);
    b[63] = 0x43;
    expect(constantTimeEqual(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Extended timestamp
// ---------------------------------------------------------------------------
describe('timestamp - extended', () => {
  it('successive timestamps are non-decreasing', () => {
    const t1 = timestamp();
    const t2 = timestamp();
    expect(new Date(t2).getTime()).toBeGreaterThanOrEqual(new Date(t1).getTime());
  });

  it('timestamp ends with Z (UTC)', () => {
    expect(timestamp().endsWith('Z')).toBe(true);
  });

  it('timestamp can be used with Date constructor', () => {
    const ts = timestamp();
    const d = new Date(ts);
    expect(d.toISOString()).toBe(ts);
  });
});

// ---------------------------------------------------------------------------
// Cross-function integration
// ---------------------------------------------------------------------------
describe('cross-function integration', () => {
  it('sign/verify with canonicalized JSON', async () => {
    const kp = await generateKeyPair();
    const obj = { z: 3, a: 1, m: 2 };
    const canonical = canonicalizeJson(obj);
    const sig = await signString(canonical, kp.privateKey);
    const valid = await verify(new TextEncoder().encode(canonical), sig, kp.publicKey);
    expect(valid).toBe(true);
  });

  it('sha256Object matches sha256String(canonicalizeJson(obj))', () => {
    const obj = { hello: 'world', num: 42 };
    const hash1 = sha256Object(obj);
    const hash2 = sha256String(canonicalizeJson(obj));
    expect(hash1).toBe(hash2);
  });

  it('nonce -> hex -> sign -> verify round trip', async () => {
    const kp = await generateKeyPair();
    const nonce = generateNonce();
    const nonceHex = toHex(nonce);
    const sig = await signString(nonceHex, kp.privateKey);
    const valid = await verify(new TextEncoder().encode(nonceHex), sig, kp.publicKey);
    expect(valid).toBe(true);
  });

  it('base64url -> sign -> verify round trip', async () => {
    const kp = await generateKeyPair();
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const encoded = base64urlEncode(data);
    const sig = await signString(encoded, kp.privateKey);
    const valid = await verify(new TextEncoder().encode(encoded), sig, kp.publicKey);
    expect(valid).toBe(true);
  });

  it('constantTimeEqual on key pair bytes', async () => {
    const kp = await generateKeyPair();
    const restored = await keyPairFromPrivateKey(kp.privateKey);
    expect(constantTimeEqual(kp.publicKey, restored.publicKey)).toBe(true);
    expect(constantTimeEqual(kp.privateKey, restored.privateKey)).toBe(true);
  });

  it('sha256 of signed message is deterministic', async () => {
    const kp = await generateKeyPair();
    const msg = 'deterministic hash test';
    const sig = await signString(msg, kp.privateKey);
    const hash1 = sha256(sig);
    const hash2 = sha256(sig);
    expect(hash1).toBe(hash2);
  });
});
