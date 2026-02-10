/**
 * Crypto hardening tests for @stele/crypto.
 *
 * Exercises edge cases, known-answer vectors, encoding roundtrips,
 * constant-time comparison, and signature manipulation scenarios
 * to ensure the cryptographic foundation is robust.
 */

import { describe, it, expect } from 'vitest';
import {
  generateKeyPair,
  sign,
  signString,
  verify,
  sha256,
  sha256String,
  sha256Object,
  canonicalizeJson,
  toHex,
  fromHex,
  base64urlEncode,
  base64urlDecode,
  generateNonce,
  generateId,
  constantTimeEqual,
  timestamp,
  keyPairFromPrivateKey,
  keyPairFromPrivateKeyHex,
} from '@stele/crypto';

// ---------------------------------------------------------------------------
// Key generation hardening
// ---------------------------------------------------------------------------

describe('Key generation hardening', () => {
  it('generated key pair has 32-byte private key', async () => {
    const kp = await generateKeyPair();
    expect(kp.privateKey).toBeInstanceOf(Uint8Array);
    expect(kp.privateKey.length).toBe(32);
  });

  it('generated key pair has 32-byte public key', async () => {
    const kp = await generateKeyPair();
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey.length).toBe(32);
  });

  it('publicKeyHex matches toHex(publicKey)', async () => {
    const kp = await generateKeyPair();
    expect(kp.publicKeyHex).toBe(toHex(kp.publicKey));
  });

  it('100 generated key pairs are all unique', async () => {
    const hexSet = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const kp = await generateKeyPair();
      hexSet.add(toHex(kp.privateKey));
    }
    expect(hexSet.size).toBe(100);
  });

  it('private key bytes are not all zeros', async () => {
    const kp = await generateKeyPair();
    const allZero = kp.privateKey.every((b) => b === 0);
    expect(allZero).toBe(false);
  });

  it('public key bytes are not all zeros', async () => {
    const kp = await generateKeyPair();
    const allZero = kp.publicKey.every((b) => b === 0);
    expect(allZero).toBe(false);
  });

  it('public key derivation is deterministic (same private key -> same public key)', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await keyPairFromPrivateKey(kp1.privateKey);
    expect(toHex(kp2.publicKey)).toBe(toHex(kp1.publicKey));
    expect(kp2.publicKeyHex).toBe(kp1.publicKeyHex);
  });

  it('keyPairFromPrivateKey roundtrips correctly', async () => {
    const original = await generateKeyPair();
    const restored = await keyPairFromPrivateKey(original.privateKey);
    expect(toHex(restored.publicKey)).toBe(toHex(original.publicKey));
    expect(restored.publicKeyHex).toBe(original.publicKeyHex);
  });

  it('keyPairFromPrivateKeyHex roundtrips correctly', async () => {
    const original = await generateKeyPair();
    const hex = toHex(original.privateKey);
    const restored = await keyPairFromPrivateKeyHex(hex);
    expect(toHex(restored.publicKey)).toBe(toHex(original.publicKey));
  });

  it('keyPairFromPrivateKey creates a copy of the private key', async () => {
    const original = await generateKeyPair();
    const restored = await keyPairFromPrivateKey(original.privateKey);
    // The returned private key should be a distinct buffer
    original.privateKey[0] = (original.privateKey[0]! + 1) % 256;
    expect(restored.privateKey[0]).not.toBe(original.privateKey[0]);
  });
});

// ---------------------------------------------------------------------------
// Signature edge cases
// ---------------------------------------------------------------------------

describe('Signature edge cases', () => {
  it('empty message signs and verifies', async () => {
    const kp = await generateKeyPair();
    const msg = new Uint8Array(0);
    const sig = await sign(msg, kp.privateKey);
    const ok = await verify(msg, sig, kp.publicKey);
    expect(ok).toBe(true);
  });

  it('very large message (100 KB) signs and verifies', async () => {
    const kp = await generateKeyPair();
    const msg = new Uint8Array(100_000).fill(0xab);
    const sig = await sign(msg, kp.privateKey);
    const ok = await verify(msg, sig, kp.publicKey);
    expect(ok).toBe(true);
  });

  it('single-byte message signs and verifies', async () => {
    const kp = await generateKeyPair();
    const msg = new Uint8Array([42]);
    const sig = await sign(msg, kp.privateKey);
    const ok = await verify(msg, sig, kp.publicKey);
    expect(ok).toBe(true);
  });

  it('signString signs and verifies via raw bytes', async () => {
    const kp = await generateKeyPair();
    const text = 'hello stele';
    const sig = await signString(text, kp.privateKey);
    const msgBytes = new TextEncoder().encode(text);
    const ok = await verify(msgBytes, sig, kp.publicKey);
    expect(ok).toBe(true);
  });

  it('signature is exactly 64 bytes', async () => {
    const kp = await generateKeyPair();
    const sig = await sign(new Uint8Array([1, 2, 3]), kp.privateKey);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);
  });

  it('Ed25519 is deterministic: same message + same key = same signature', async () => {
    const kp = await generateKeyPair();
    const msg = new TextEncoder().encode('deterministic test');
    const sig1 = await sign(msg, kp.privateKey);
    const sig2 = await sign(msg, kp.privateKey);
    expect(toHex(sig1)).toBe(toHex(sig2));
  });

  it('modified message fails verification', async () => {
    const kp = await generateKeyPair();
    const msg = new TextEncoder().encode('original message');
    const sig = await sign(msg, kp.privateKey);
    const tampered = new TextEncoder().encode('tampered message');
    const ok = await verify(tampered, sig, kp.publicKey);
    expect(ok).toBe(false);
  });

  it('modified signature fails verification (flip first 10 byte positions)', async () => {
    const kp = await generateKeyPair();
    const msg = new TextEncoder().encode('flip test');
    const sig = await sign(msg, kp.privateKey);
    for (let i = 0; i < 10; i++) {
      const bad = new Uint8Array(sig);
      bad[i] = bad[i]! ^ 0xff;
      const ok = await verify(msg, bad, kp.publicKey);
      expect(ok).toBe(false);
    }
  });

  it('truncated signature fails verification', async () => {
    const kp = await generateKeyPair();
    const msg = new TextEncoder().encode('truncation');
    const sig = await sign(msg, kp.privateKey);
    const truncated = sig.slice(0, 32);
    const ok = await verify(msg, truncated, kp.publicKey);
    expect(ok).toBe(false);
  });

  it('extended signature fails verification', async () => {
    const kp = await generateKeyPair();
    const msg = new TextEncoder().encode('extension');
    const sig = await sign(msg, kp.privateKey);
    const extended = new Uint8Array(128);
    extended.set(sig);
    const ok = await verify(msg, extended, kp.publicKey);
    expect(ok).toBe(false);
  });

  it('all-zero signature fails verification', async () => {
    const kp = await generateKeyPair();
    const msg = new TextEncoder().encode('zeroes');
    const zeroSig = new Uint8Array(64);
    const ok = await verify(msg, zeroSig, kp.publicKey);
    expect(ok).toBe(false);
  });

  it('wrong public key fails verification', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const msg = new TextEncoder().encode('wrong key test');
    const sig = await sign(msg, kp1.privateKey);
    const ok = await verify(msg, sig, kp2.publicKey);
    expect(ok).toBe(false);
  });

  it('swapped public keys between two key pairs fail', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const msg1 = new TextEncoder().encode('message for kp1');
    const msg2 = new TextEncoder().encode('message for kp2');
    const sig1 = await sign(msg1, kp1.privateKey);
    const sig2 = await sign(msg2, kp2.privateKey);
    // sig1 should not verify with kp2 public key
    expect(await verify(msg1, sig1, kp2.publicKey)).toBe(false);
    // sig2 should not verify with kp1 public key
    expect(await verify(msg2, sig2, kp1.publicKey)).toBe(false);
  });

  it('verify never throws, even with garbage inputs', async () => {
    const garbage = new Uint8Array([0xde, 0xad]);
    const ok = await verify(garbage, garbage, garbage);
    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hash consistency
// ---------------------------------------------------------------------------

describe('Hash consistency', () => {
  it('SHA-256 of empty string matches known value', () => {
    const hash = sha256String('');
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('SHA-256 of "hello" matches known value', () => {
    const hash = sha256String('hello');
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('SHA-256 of empty Uint8Array matches empty string hash', () => {
    const hash = sha256(new Uint8Array(0));
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('SHA-256 output is always 64 hex characters', () => {
    const inputs = ['', 'a', 'hello world', 'x'.repeat(10000)];
    for (const input of inputs) {
      const hash = sha256String(input);
      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    }
  });

  it('same input always produces same hash (1000 iterations)', () => {
    const input = 'consistency check';
    const expected = sha256String(input);
    for (let i = 0; i < 1000; i++) {
      expect(sha256String(input)).toBe(expected);
    }
  });

  it('different inputs produce different hashes', () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      hashes.add(sha256String(`input-${i}`));
    }
    expect(hashes.size).toBe(100);
  });

  it('sha256Object produces deterministic hash of an object', () => {
    const obj = { b: 2, a: 1 };
    const h1 = sha256Object(obj);
    const h2 = sha256Object(obj);
    expect(h1).toBe(h2);
    expect(h1.length).toBe(64);
  });

  it('sha256Object ignores key order', () => {
    const h1 = sha256Object({ a: 1, b: 2 });
    const h2 = sha256Object({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// Constant-time comparison
// ---------------------------------------------------------------------------

describe('Constant-time comparison', () => {
  it('equal buffers return true', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeEqual(a, b)).toBe(true);
  });

  it('different length buffers return false', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('single-bit difference returns false', () => {
    const a = new Uint8Array([0b10101010]);
    const b = new Uint8Array([0b10101011]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('all-zero vs all-one returns false', () => {
    const a = new Uint8Array(32).fill(0x00);
    const b = new Uint8Array(32).fill(0xff);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('empty buffers return true', () => {
    const a = new Uint8Array(0);
    const b = new Uint8Array(0);
    expect(constantTimeEqual(a, b)).toBe(true);
  });

  it('first-byte-only difference returns false', () => {
    const a = new Uint8Array(32).fill(0x00);
    const b = new Uint8Array(32).fill(0x00);
    b[0] = 0x01;
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('last-byte-only difference returns false', () => {
    const a = new Uint8Array(32).fill(0x00);
    const b = new Uint8Array(32).fill(0x00);
    b[31] = 0x01;
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('timing sanity check: equal vs unequal comparison times are similar', () => {
    const a = new Uint8Array(4096).fill(0xaa);
    const bEqual = new Uint8Array(4096).fill(0xaa);
    const bDiff = new Uint8Array(4096).fill(0xbb);

    const iterations = 10_000;

    const startEqual = performance.now();
    for (let i = 0; i < iterations; i++) {
      constantTimeEqual(a, bEqual);
    }
    const elapsedEqual = performance.now() - startEqual;

    const startDiff = performance.now();
    for (let i = 0; i < iterations; i++) {
      constantTimeEqual(a, bDiff);
    }
    const elapsedDiff = performance.now() - startDiff;

    // Allow a generous 5x tolerance - the point is they should be in the
    // same order of magnitude, not that one is 100x faster (which would
    // indicate an early-exit short-circuit).
    const ratio = Math.max(elapsedEqual, elapsedDiff) / Math.max(0.001, Math.min(elapsedEqual, elapsedDiff));
    expect(ratio).toBeLessThan(5);
  });
});

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

describe('Canonicalization', () => {
  it('key order does not matter: {a:1,b:2} === {b:2,a:1}', () => {
    expect(canonicalizeJson({ a: 1, b: 2 })).toBe(canonicalizeJson({ b: 2, a: 1 }));
  });

  it('nested objects are canonicalized', () => {
    const a = { outer: { z: 3, a: 1 } };
    const b = { outer: { a: 1, z: 3 } };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
  });

  it('arrays preserve order', () => {
    const a = { list: [1, 2, 3] };
    const b = { list: [3, 2, 1] };
    expect(canonicalizeJson(a)).not.toBe(canonicalizeJson(b));
  });

  it('unicode strings are preserved', () => {
    const obj = { greeting: '\u4f60\u597d' }; // "nihao" in Chinese
    const json = canonicalizeJson(obj);
    expect(json).toContain('\u4f60\u597d');
  });

  it('numbers are preserved exactly', () => {
    const obj = { pi: 3.14159, neg: -42, zero: 0 };
    const json = canonicalizeJson(obj);
    expect(json).toContain('3.14159');
    expect(json).toContain('-42');
    expect(json).toContain('"zero":0');
  });

  it('null values are preserved', () => {
    const obj = { key: null };
    const json = canonicalizeJson(obj);
    expect(json).toBe('{"key":null}');
  });

  it('undefined values are omitted (JSON.stringify behavior)', () => {
    const obj = { a: 1, b: undefined };
    const json = canonicalizeJson(obj);
    expect(json).toBe('{"a":1}');
  });

  it('deep nested objects (5 levels) canonicalize correctly', () => {
    const a = { l1: { l2: { l3: { l4: { l5: { z: 1, a: 2 } } } } } };
    const b = { l1: { l2: { l3: { l4: { l5: { a: 2, z: 1 } } } } } };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
  });

  it('arrays inside objects are recursively canonicalized', () => {
    const a = { list: [{ z: 1, a: 2 }] };
    const b = { list: [{ a: 2, z: 1 }] };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
  });

  it('boolean values are preserved', () => {
    expect(canonicalizeJson({ flag: true })).toBe('{"flag":true}');
    expect(canonicalizeJson({ flag: false })).toBe('{"flag":false}');
  });

  it('empty object canonicalizes to {}', () => {
    expect(canonicalizeJson({})).toBe('{}');
  });

  it('empty array canonicalizes to []', () => {
    expect(canonicalizeJson([])).toBe('[]');
  });
});

// ---------------------------------------------------------------------------
// Encoding roundtrips
// ---------------------------------------------------------------------------

describe('Encoding roundtrips', () => {
  it('toHex/fromHex for every byte value (0x00 to 0xFF)', () => {
    for (let i = 0; i <= 0xff; i++) {
      const data = new Uint8Array([i]);
      const hex = toHex(data);
      expect(hex.length).toBe(2);
      const roundtripped = fromHex(hex);
      expect(roundtripped[0]).toBe(i);
    }
  });

  it('toHex/fromHex for multi-byte data', () => {
    const data = new Uint8Array([0x00, 0x7f, 0x80, 0xff, 0xde, 0xad]);
    const hex = toHex(data);
    expect(hex).toBe('007f80ffdead');
    const back = fromHex(hex);
    expect(Array.from(back)).toEqual(Array.from(data));
  });

  it('fromHex rejects odd-length hex string', () => {
    expect(() => fromHex('abc')).toThrow('odd length');
  });

  it('toHex of empty data returns empty string', () => {
    expect(toHex(new Uint8Array(0))).toBe('');
  });

  it('fromHex of empty string returns empty Uint8Array', () => {
    const result = fromHex('');
    expect(result.length).toBe(0);
  });

  it('base64url encode/decode roundtrip for binary data', () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i;
    const encoded = base64urlEncode(data);
    const decoded = base64urlDecode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(data));
  });

  it('base64url encoding contains no +, /, or = characters', () => {
    const data = new Uint8Array(128);
    for (let i = 0; i < 128; i++) data[i] = i;
    const encoded = base64urlEncode(data);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('base64url encode/decode padding edge cases', () => {
    // Length % 3 == 0 (no padding)
    const d0 = new Uint8Array([1, 2, 3]);
    expect(Array.from(base64urlDecode(base64urlEncode(d0)))).toEqual(Array.from(d0));

    // Length % 3 == 1 (2 bytes padding)
    const d1 = new Uint8Array([1, 2, 3, 4]);
    expect(Array.from(base64urlDecode(base64urlEncode(d1)))).toEqual(Array.from(d1));

    // Length % 3 == 2 (1 byte padding)
    const d2 = new Uint8Array([1, 2, 3, 4, 5]);
    expect(Array.from(base64urlDecode(base64urlEncode(d2)))).toEqual(Array.from(d2));
  });

  it('base64url empty data roundtrips', () => {
    const data = new Uint8Array(0);
    const encoded = base64urlEncode(data);
    expect(encoded).toBe('');
    const decoded = base64urlDecode(encoded);
    expect(decoded.length).toBe(0);
  });

  it('base64url decode handles standard base64 with padding', () => {
    // base64url should handle the re-addition of padding
    const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const encoded = base64urlEncode(data);
    const decoded = base64urlDecode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(data));
  });
});

// ---------------------------------------------------------------------------
// Nonce and ID generation
// ---------------------------------------------------------------------------

describe('Nonce and ID generation', () => {
  it('generateNonce returns 32 bytes', () => {
    const nonce = generateNonce();
    expect(nonce).toBeInstanceOf(Uint8Array);
    expect(nonce.length).toBe(32);
  });

  it('100 nonces are all unique', () => {
    const hexSet = new Set<string>();
    for (let i = 0; i < 100; i++) {
      hexSet.add(toHex(generateNonce()));
    }
    expect(hexSet.size).toBe(100);
  });

  it('generateId returns 32 hex characters by default', () => {
    const id = generateId();
    expect(id.length).toBe(32);
    expect(/^[0-9a-f]{32}$/.test(id)).toBe(true);
  });

  it('generateId with custom byte count', () => {
    const id = generateId(8);
    expect(id.length).toBe(16);
    expect(/^[0-9a-f]{16}$/.test(id)).toBe(true);
  });

  it('100 IDs are all unique', () => {
    const idSet = new Set<string>();
    for (let i = 0; i < 100; i++) {
      idSet.add(generateId());
    }
    expect(idSet.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------

describe('Timestamp', () => {
  it('returns a valid ISO 8601 string', () => {
    const ts = timestamp();
    const parsed = new Date(ts);
    expect(parsed.toISOString()).toBe(ts);
  });

  it('successive timestamps are non-decreasing', () => {
    const t1 = timestamp();
    const t2 = timestamp();
    expect(new Date(t2).getTime()).toBeGreaterThanOrEqual(new Date(t1).getTime());
  });
});

// ---------------------------------------------------------------------------
// Cross-function integration
// ---------------------------------------------------------------------------

describe('Cross-function integration', () => {
  it('sign -> toHex -> fromHex -> verify roundtrip', async () => {
    const kp = await generateKeyPair();
    const msg = new TextEncoder().encode('roundtrip test');
    const sig = await sign(msg, kp.privateKey);
    const sigHex = toHex(sig);
    const sigRestored = fromHex(sigHex);
    const ok = await verify(msg, sigRestored, kp.publicKey);
    expect(ok).toBe(true);
  });

  it('sign -> base64urlEncode -> base64urlDecode -> verify roundtrip', async () => {
    const kp = await generateKeyPair();
    const msg = new TextEncoder().encode('base64 roundtrip');
    const sig = await sign(msg, kp.privateKey);
    const b64 = base64urlEncode(sig);
    const sigRestored = base64urlDecode(b64);
    const ok = await verify(msg, sigRestored, kp.publicKey);
    expect(ok).toBe(true);
  });

  it('sha256Object of canonicalized JSON is consistent', () => {
    const obj = { z: 3, a: 1, m: 2 };
    const directHash = sha256String(canonicalizeJson(obj));
    const objectHash = sha256Object(obj);
    expect(objectHash).toBe(directHash);
  });

  it('generateKeyPair -> signString -> verify', async () => {
    const kp = await generateKeyPair();
    const message = 'end-to-end string signing';
    const sig = await signString(message, kp.privateKey);
    const msgBytes = new TextEncoder().encode(message);
    const ok = await verify(msgBytes, sig, kp.publicKey);
    expect(ok).toBe(true);
  });

  it('keyPairFromPrivateKeyHex -> sign -> verify', async () => {
    const original = await generateKeyPair();
    const hex = toHex(original.privateKey);
    const restored = await keyPairFromPrivateKeyHex(hex);
    const msg = new TextEncoder().encode('hex roundtrip');
    const sig = await sign(msg, restored.privateKey);
    const ok = await verify(msg, sig, restored.publicKey);
    expect(ok).toBe(true);
  });
});
