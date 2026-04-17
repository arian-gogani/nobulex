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

const enc = (s: string) => new TextEncoder().encode(s);

describe('key generation and derivation', () => {
  it('generateKeyPair produces 32-byte private/public keys with matching hex encoding', async () => {
    const kp = await generateKeyPair();
    expect(kp.privateKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.privateKey.length).toBe(32);
    expect(kp.publicKey.length).toBe(32);
    expect(kp.publicKeyHex).toHaveLength(64);
    expect(kp.publicKeyHex).toBe(toHex(kp.publicKey));
  });

  it('successive generateKeyPair calls produce distinct keys', async () => {
    const [a, b] = [await generateKeyPair(), await generateKeyPair()];
    expect(toHex(a.privateKey)).not.toBe(toHex(b.privateKey));
    expect(a.publicKeyHex).not.toBe(b.publicKeyHex);
  });

  it('keyPairFromPrivateKey/Hex reconstructs the same public key and defensively copies bytes', async () => {
    const orig = await generateKeyPair();
    const restored = await keyPairFromPrivateKey(orig.privateKey);
    expect(toHex(restored.privateKey)).toBe(toHex(orig.privateKey));
    expect(restored.publicKeyHex).toBe(orig.publicKeyHex);
    // Defensive copy: mutating restored does not touch original
    restored.privateKey[0] = (restored.privateKey[0]! + 1) % 256;
    expect(orig.privateKey[0]).not.toBe(restored.privateKey[0]);

    const fromHexKp = await keyPairFromPrivateKeyHex(toHex(orig.privateKey).toLowerCase());
    expect(fromHexKp.publicKeyHex).toBe(orig.publicKeyHex);
  });

  it('derives keys for edge private keys (all-zero, all-0xFF) and keeps distinct pubs for distinct privs', async () => {
    const zero = await keyPairFromPrivateKey(new Uint8Array(32));
    const max = await keyPairFromPrivateKey(new Uint8Array(32).fill(0xff));
    expect(zero.publicKey.length).toBe(32);
    expect(max.publicKey.length).toBe(32);
    const k1 = await keyPairFromPrivateKey(new Uint8Array(32).fill(1));
    const k2 = await keyPairFromPrivateKey(new Uint8Array(32).fill(2));
    expect(k1.publicKeyHex).not.toBe(k2.publicKeyHex);
  });
});

describe('sign / verify', () => {
  it('sign and signString round-trip through verify; signatures are 64 bytes and deterministic', async () => {
    const kp = await generateKeyPair();
    const sigBytes = await sign(enc('hello world'), kp.privateKey);
    expect(sigBytes.length).toBe(64);
    expect(await verify(enc('hello world'), sigBytes, kp.publicKey)).toBe(true);

    const sig1 = await sign(enc('deterministic'), kp.privateKey);
    const sig2 = await sign(enc('deterministic'), kp.privateKey);
    expect(toHex(sig1)).toBe(toHex(sig2));

    const strSig = await signString('nobulex protocol message', kp.privateKey);
    expect(await verify(enc('nobulex protocol message'), strSig, kp.publicKey)).toBe(true);
  });

  it('verify rejects wrong key, tampered message, corrupted sig, empty/garbage inputs', async () => {
    const [a, b] = [await generateKeyPair(), await generateKeyPair()];
    const sig = await sign(enc('hello'), a.privateKey);
    expect(await verify(enc('hello'), sig, b.publicKey)).toBe(false);
    expect(await verify(enc('tampered'), sig, a.publicKey)).toBe(false);

    const corrupted = new Uint8Array(sig);
    corrupted[0] = (corrupted[0]! + 1) % 256;
    expect(await verify(enc('hello'), corrupted, a.publicKey)).toBe(false);

    // Invalid-sized inputs return false, never throw
    expect(await verify(enc('test'), new Uint8Array(0), a.publicKey)).toBe(false);
    expect(await verify(enc('test'), new Uint8Array(32), a.publicKey)).toBe(false);
    expect(await verify(enc('test'), sig, new Uint8Array(0))).toBe(false);
    expect(await verify(enc('test'), new Uint8Array(64).fill(0xff), new Uint8Array(32).fill(0xff))).toBe(false);
  });

  it('handles empty, unicode, and large (10KB) messages', async () => {
    const kp = await generateKeyPair();
    const cases = ['', 'Hello \u{1F600} World \u{1F30D}', 'x'.repeat(10240)];
    for (const msg of cases) {
      const sig = await signString(msg, kp.privateKey);
      expect(sig.length).toBe(64);
      expect(await verify(enc(msg), sig, kp.publicKey)).toBe(true);
    }
  });

  it('cross-verification isolates signatures between independent key pairs', async () => {
    const [a, b, c] = [await generateKeyPair(), await generateKeyPair(), await generateKeyPair()];
    const [sa, sb, sc] = [
      await sign(enc('m-a'), a.privateKey),
      await sign(enc('m-b'), b.privateKey),
      await sign(enc('m-c'), c.privateKey),
    ];
    expect(await verify(enc('m-a'), sa, a.publicKey)).toBe(true);
    expect(await verify(enc('m-a'), sa, b.publicKey)).toBe(false);
    expect(await verify(enc('m-a'), sb, a.publicKey)).toBe(false);
    expect(await verify(enc('m-b'), sa, b.publicKey)).toBe(false);
    expect(await verify(enc('m-c'), sc, c.publicKey)).toBe(true);
  });
});

describe('sha256 / sha256String / sha256Object', () => {
  it('sha256 is deterministic and yields 64-hex chars for any input', () => {
    expect(sha256(enc('hello'))).toBe(sha256(enc('hello')));
    expect(sha256(enc('foo'))).not.toBe(sha256(enc('bar')));

    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) allBytes[i] = i;
    const h = sha256(allBytes);
    expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);

    // Known vectors
    expect(sha256(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256String('hello world')).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    expect(sha256String('test123')).not.toBe(sha256String('test124'));
  });

  it('sha256String equals sha256(enc(s))', () => {
    expect(sha256String('hello world')).toBe(sha256(enc('hello world')));
  });

  it('sha256Object is stable across key orders and sensitive to content / array order / booleans', () => {
    expect(sha256Object({ b: 2, a: 1 })).toBe(sha256Object({ a: 1, b: 2 }));
    expect(sha256Object({ outer: { z: 3, a: 1 }, name: 'test' })).toBe(
      sha256Object({ name: 'test', outer: { a: 1, z: 3 } }),
    );
    expect(sha256Object({ a: 1 })).not.toBe(sha256Object({ a: 2 }));
    expect(sha256Object([1, 2, 3])).toBe(sha256Object([1, 2, 3]));
    expect(sha256Object([1, 2, 3])).not.toBe(sha256Object([3, 2, 1]));
    expect(sha256Object({ flag: true })).not.toBe(sha256Object({ flag: false }));
    expect(sha256Object({})).toBe(sha256Object({}));
    expect(sha256Object(null)).toHaveLength(64);
  });
});

describe('canonicalizeJson', () => {
  it('sorts object keys (top-level and nested) and produces canonical output', () => {
    expect(canonicalizeJson({ c: 3, a: 1, b: 2 })).toBe('{"a":1,"b":2,"c":3}');
    expect(canonicalizeJson({ z: { b: 2, a: 1 }, a: 0 })).toBe('{"a":0,"z":{"a":1,"b":2}}');
    expect(canonicalizeJson({ d: { c: { b: { a: 1 } } } })).toBe('{"d":{"c":{"b":{"a":1}}}}');
    // Array order is preserved
    expect(canonicalizeJson({ arr: [3, 1, 2] })).toBe('{"arr":[3,1,2]}');
    expect(canonicalizeJson([{ b: 2, a: 1 }, { d: 4, c: 3 }])).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
  });

  it('handles primitives, undefined omission, empty containers, special chars, numeric edges, and booleans', () => {
    expect(canonicalizeJson(null)).toBe('null');
    expect(canonicalizeJson(42)).toBe('42');
    expect(canonicalizeJson('hello')).toBe('"hello"');
    expect(canonicalizeJson(true)).toBe('true');
    expect(canonicalizeJson({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
    expect(canonicalizeJson({ arr: [], obj: {} })).toBe('{"arr":[],"obj":{}}');
    expect(canonicalizeJson({ t: true, f: false })).toBe('{"f":false,"t":true}');

    const numeric = JSON.parse(canonicalizeJson({ max: Number.MAX_SAFE_INTEGER, min: Number.MIN_SAFE_INTEGER }));
    expect(numeric.max).toBe(Number.MAX_SAFE_INTEGER);
    expect(numeric.min).toBe(Number.MIN_SAFE_INTEGER);

    const specials = canonicalizeJson({ text: 'hello "world" \\n\ttab' });
    expect(JSON.parse(specials).text).toBe('hello "world" \\n\ttab');
  });

  it('equal data structures produce equal output regardless of insertion order', () => {
    const o1: Record<string, number> = {};
    o1['z'] = 26; o1['a'] = 1; o1['m'] = 13;
    const o2: Record<string, number> = {};
    o2['m'] = 13; o2['z'] = 26; o2['a'] = 1;
    expect(canonicalizeJson(o1)).toBe(canonicalizeJson(o2));
  });
});

describe('base64url encode/decode', () => {
  it('round-trips arbitrary, empty, single-byte, 1KB, and lengths 1-33', () => {
    const arbitrary = new Uint8Array([0, 1, 2, 255, 128, 64, 32, 16]);
    expect(base64urlDecode(base64urlEncode(arbitrary))).toEqual(arbitrary);
    expect(base64urlDecode(base64urlEncode(new Uint8Array(0)))).toEqual(new Uint8Array(0));

    for (let i = 0; i < 256; i++) {
      const data = new Uint8Array([i]);
      expect(base64urlDecode(base64urlEncode(data))).toEqual(data);
    }

    const large = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) large[i] = i % 256;
    expect(base64urlDecode(base64urlEncode(large))).toEqual(large);

    for (let len = 1; len <= 33; len++) {
      const d = new Uint8Array(len);
      for (let i = 0; i < len; i++) d[i] = (i * 17) % 256;
      expect(base64urlDecode(base64urlEncode(d))).toEqual(d);
    }
  });

  it('produces only URL-safe characters (no +, /, =)', () => {
    const trouble = new Uint8Array([251, 255, 254, 253, 63, 62]);
    const encoded = base64urlEncode(trouble);
    expect(encoded).not.toMatch(/[+/=]/);
    const data = new Uint8Array(100);
    for (let i = 0; i < 100; i++) data[i] = i * 3;
    expect(/^[A-Za-z0-9_-]*$/.test(base64urlEncode(data))).toBe(true);
  });
});

describe('toHex / fromHex', () => {
  it('produces lowercase padded hex and round-trips arbitrary + 32-byte inputs', () => {
    expect(toHex(new Uint8Array([0xab, 0xcd, 0xef]))).toBe('abcdef');
    expect(toHex(new Uint8Array([0, 1, 2, 15]))).toBe('0001020f');
    const roundtrip = new Uint8Array([0x00, 0xff, 0x0a, 0xab, 0xcd, 0xef]);
    expect(fromHex(toHex(roundtrip))).toEqual(roundtrip);

    const k32 = new Uint8Array(32);
    for (let i = 0; i < 32; i++) k32[i] = i * 8;
    expect(toHex(k32)).toHaveLength(64);
    expect(fromHex(toHex(k32))).toEqual(k32);

    expect(toHex(new Uint8Array(0))).toBe('');
    expect(fromHex('')).toEqual(new Uint8Array(0));

    // Uppercase and mixed case accepted
    expect(fromHex('ABCDEF')).toEqual(new Uint8Array([0xab, 0xcd, 0xef]));
    expect(fromHex('AbCdEf')).toEqual(new Uint8Array([0xab, 0xcd, 0xef]));
  });

  it('round-trips all single-byte values and 512-byte blocks', () => {
    for (let i = 0; i <= 0xff; i++) {
      const d = new Uint8Array([i]);
      const hex = toHex(d);
      expect(hex).toHaveLength(2);
      expect(fromHex(hex)).toEqual(d);
    }
    const big = new Uint8Array(512);
    for (let i = 0; i < 512; i++) big[i] = i % 256;
    expect(toHex(big)).toHaveLength(1024);
    expect(fromHex(toHex(big))).toEqual(big);
  });

  it('fromHex throws on odd length, invalid chars, and non-string inputs', () => {
    expect(() => fromHex('abc')).toThrow('Invalid hex string: odd length');
    expect(() => fromHex('ffzz')).toThrow('Invalid hex string: invalid character');
    expect(() => fromHex('gg00')).toThrow('Invalid hex string: invalid character');
    expect(() => fromHex(null as unknown as string)).toThrow('Invalid hex: expected string');
    expect(() => fromHex(123 as unknown as string)).toThrow('Invalid hex: expected string');
  });
});

describe('generateNonce / generateId', () => {
  it('nonce is a unique, non-zero 32-byte Uint8Array', () => {
    const nonce = generateNonce();
    expect(nonce).toBeInstanceOf(Uint8Array);
    expect(nonce.length).toBe(32);
    expect(nonce.every(b => b === 0)).toBe(false);

    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(toHex(generateNonce()));
    expect(set.size).toBe(100);
  });

  it('generateId produces hex of configurable byte length and unique values', () => {
    const id = generateId();
    expect(id).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(id)).toBe(true);
    for (const b of [1, 4, 8, 16, 32, 64]) expect(generateId(b)).toHaveLength(b * 2);

    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(generateId());
    expect(ids.size).toBe(50);
  });
});

describe('constantTimeEqual', () => {
  it('returns true for equal arrays (incl. empty, 32, 64 bytes), false otherwise', () => {
    expect(constantTimeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    expect(constantTimeEqual(a, new Uint8Array([1, 2, 3, 4, 5]))).toBe(true);
    expect(constantTimeEqual(a, new Uint8Array([1, 2, 3, 4, 6]))).toBe(false);

    const k32 = new Uint8Array(32);
    for (let i = 0; i < 32; i++) k32[i] = i;
    expect(constantTimeEqual(k32, new Uint8Array(k32))).toBe(true);

    const sigA = new Uint8Array(64).fill(0x42);
    const sigB = new Uint8Array(64).fill(0x42);
    expect(constantTimeEqual(sigA, sigB)).toBe(true);
    sigB[63] = 0x43;
    expect(constantTimeEqual(sigA, sigB)).toBe(false);
  });

  it('returns false for any length mismatch and single-bit differences anywhere', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array(31), new Uint8Array(32))).toBe(false);

    // Differ in first byte
    expect(constantTimeEqual(new Uint8Array([0, 1, 2, 3]), new Uint8Array([1, 1, 2, 3]))).toBe(false);
    // Differ in last byte
    expect(constantTimeEqual(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2, 3, 5]))).toBe(false);

    // One bit flipped in the middle
    const z1 = new Uint8Array(32);
    const z2 = new Uint8Array(32);
    z2[15] = 1;
    expect(constantTimeEqual(z1, z2)).toBe(false);
  });
});

describe('timestamp', () => {
  it('returns a UTC ISO 8601 string close to Date.now() that round-trips through Date', () => {
    const before = Date.now();
    const ts = timestamp();
    const after = Date.now();
    expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(ts)).toBe(true);
    expect(ts.endsWith('Z')).toBe(true);
    const parsed = new Date(ts).getTime();
    expect(Number.isNaN(parsed)).toBe(false);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
    expect(new Date(ts).toISOString()).toBe(ts);

    const t2 = timestamp();
    expect(new Date(t2).getTime()).toBeGreaterThanOrEqual(parsed);
  });
});

describe('cross-function integration', () => {
  it('canonicalizeJson -> signString -> verify round-trips; sha256Object matches sha256String(canonical)', async () => {
    const kp = await generateKeyPair();
    const canonical = canonicalizeJson({ z: 3, a: 1, m: 2 });
    const sig = await signString(canonical, kp.privateKey);
    expect(await verify(enc(canonical), sig, kp.publicKey)).toBe(true);

    const obj = { hello: 'world', num: 42 };
    expect(sha256Object(obj)).toBe(sha256String(canonicalizeJson(obj)));
  });

  it('nonce/base64url can be signed and verified; derived key pair bytes are constant-time equal', async () => {
    const kp = await generateKeyPair();
    const nonceHex = toHex(generateNonce());
    const nonceSig = await signString(nonceHex, kp.privateKey);
    expect(await verify(enc(nonceHex), nonceSig, kp.publicKey)).toBe(true);

    const encoded = base64urlEncode(new Uint8Array([1, 2, 3, 4, 5]));
    const b64Sig = await signString(encoded, kp.privateKey);
    expect(await verify(enc(encoded), b64Sig, kp.publicKey)).toBe(true);

    const restored = await keyPairFromPrivateKey(kp.privateKey);
    expect(constantTimeEqual(kp.publicKey, restored.publicKey)).toBe(true);
    expect(constantTimeEqual(kp.privateKey, restored.privateKey)).toBe(true);
  });
});
