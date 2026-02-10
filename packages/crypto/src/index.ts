import * as ed from '@noble/ed25519';
import { sha256 as nobleSha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';

export type {
  KeyPair,
  DetachedSignature,
  Nonce,
  HashHex,
  Base64Url,
  PrivateKey,
  PublicKey,
  Signature,
} from './types';

import type { KeyPair, PrivateKey, Signature, HashHex, Base64Url, Nonce } from './types';

/**
 * Generate a new Ed25519 key pair from cryptographically secure randomness.
 *
 * The private key is 32 bytes of entropy from the platform CSPRNG.
 * The public key is derived deterministically from the private key.
 *
 * @returns A KeyPair containing privateKey, publicKey, and publicKeyHex.
 *
 * @example
 * ```typescript
 * const kp = await generateKeyPair();
 * console.log(kp.publicKeyHex); // 64-char hex string
 * ```
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const privateKey = randomBytes(32);
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyHex: toHex(publicKey),
  };
}

/**
 * Reconstruct a KeyPair from an existing private key.
 *
 * Useful for loading a previously generated key from storage. The input
 * is defensively copied so the original array is not retained.
 *
 * @param privateKey - A 32-byte Ed25519 private key.
 * @returns The reconstructed KeyPair with derived public key.
 *
 * @example
 * ```typescript
 * const kp = await keyPairFromPrivateKey(savedPrivateKey);
 * console.log(kp.publicKeyHex);
 * ```
 */
export async function keyPairFromPrivateKey(privateKey: Uint8Array): Promise<KeyPair> {
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    privateKey: new Uint8Array(privateKey),
    publicKey,
    publicKeyHex: toHex(publicKey),
  };
}

/**
 * Reconstruct a KeyPair from a hex-encoded private key string.
 *
 * Convenience wrapper that decodes the hex string and delegates to
 * {@link keyPairFromPrivateKey}.
 *
 * @param hex - A 64-character hex string encoding a 32-byte private key.
 * @returns The reconstructed KeyPair with derived public key.
 * @throws {Error} When the hex string has odd length.
 *
 * @example
 * ```typescript
 * const kp = await keyPairFromPrivateKeyHex('a1b2c3...');
 * ```
 */
export async function keyPairFromPrivateKeyHex(hex: string): Promise<KeyPair> {
  return keyPairFromPrivateKey(fromHex(hex));
}

/**
 * Sign arbitrary bytes with an Ed25519 private key.
 *
 * @param message - The message bytes to sign.
 * @param privateKey - The 32-byte Ed25519 private key.
 * @returns A 64-byte Ed25519 signature.
 *
 * @example
 * ```typescript
 * const sig = await sign(new TextEncoder().encode('hello'), kp.privateKey);
 * console.log(toHex(sig)); // 128-char hex string
 * ```
 */
export async function sign(message: Uint8Array, privateKey: PrivateKey): Promise<Signature> {
  return ed.signAsync(message, privateKey);
}

/**
 * Sign a UTF-8 string. Convenience wrapper around {@link sign}.
 *
 * @param message - The UTF-8 string to sign.
 * @param privateKey - The 32-byte Ed25519 private key.
 * @returns A 64-byte Ed25519 signature.
 *
 * @example
 * ```typescript
 * const sig = await signString('covenant payload', kp.privateKey);
 * ```
 */
export async function signString(message: string, privateKey: PrivateKey): Promise<Signature> {
  return sign(new TextEncoder().encode(message), privateKey);
}

/**
 * Verify an Ed25519 signature against a message and public key.
 *
 * This function is safe to call with untrusted inputs -- it never throws.
 * Any internal error (malformed key, truncated signature) returns `false`.
 *
 * @param message - The original message bytes.
 * @param signature - The 64-byte signature to verify.
 * @param publicKey - The signer's 32-byte public key.
 * @returns `true` if the signature is valid, `false` otherwise.
 *
 * @example
 * ```typescript
 * const valid = await verify(messageBytes, sigBytes, kp.publicKey);
 * ```
 */
export async function verify(
  message: Uint8Array,
  signature: Signature,
  publicKey: Uint8Array
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}

/**
 * SHA-256 hash of arbitrary bytes, returned as a lowercase hex string.
 *
 * @param data - The bytes to hash.
 * @returns A 64-character hex-encoded SHA-256 digest.
 *
 * @example
 * ```typescript
 * const hash = sha256(new TextEncoder().encode('hello'));
 * console.log(hash); // '2cf24dba5fb0a30e...'
 * ```
 */
export function sha256(data: Uint8Array): HashHex {
  return toHex(nobleSha256(data));
}

/**
 * SHA-256 hash of a UTF-8 string, returned as a lowercase hex string.
 *
 * @param data - The UTF-8 string to hash.
 * @returns A 64-character hex-encoded SHA-256 digest.
 *
 * @example
 * ```typescript
 * const hash = sha256String('hello world');
 * ```
 */
export function sha256String(data: string): HashHex {
  return sha256(new TextEncoder().encode(data));
}

/**
 * SHA-256 hash of a JavaScript object in canonical (deterministic) JSON form.
 *
 * The object is first serialized via {@link canonicalizeJson} (sorted keys,
 * RFC 8785), then hashed. Two structurally equal objects always produce
 * the same hash regardless of key insertion order.
 *
 * @param obj - The value to canonicalize and hash.
 * @returns A 64-character hex-encoded SHA-256 digest.
 *
 * @example
 * ```typescript
 * const h1 = sha256Object({ b: 2, a: 1 });
 * const h2 = sha256Object({ a: 1, b: 2 });
 * console.log(h1 === h2); // true
 * ```
 */
export function sha256Object(obj: unknown): HashHex {
  return sha256String(canonicalizeJson(obj));
}

/**
 * Deterministic JSON serialization following JCS (RFC 8785).
 *
 * Recursively sorts all object keys alphabetically before serializing.
 * Produces identical output regardless of key insertion order, making
 * it safe for hashing and signature computation.
 *
 * @param obj - The value to serialize.
 * @returns A canonical JSON string.
 *
 * @example
 * ```typescript
 * canonicalizeJson({ z: 1, a: 2 }); // '{"a":2,"z":1}'
 * ```
 */
export function canonicalizeJson(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}

function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) {
        sorted[key] = sortKeys(v);
      }
    }
    return sorted;
  }
  return value;
}

/**
 * Base64url encode (RFC 4648 section 5, no padding).
 *
 * Uses URL-safe characters (`-` and `_` instead of `+` and `/`)
 * and strips trailing `=` padding.
 *
 * @param data - The bytes to encode.
 * @returns A base64url-encoded string.
 *
 * @example
 * ```typescript
 * const encoded = base64urlEncode(new Uint8Array([72, 101, 108]));
 * ```
 */
export function base64urlEncode(data: Uint8Array): Base64Url {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a base64url-encoded string back to bytes.
 *
 * Handles missing padding and translates URL-safe characters back
 * to standard base64 before decoding.
 *
 * @param encoded - The base64url string to decode.
 * @returns The decoded bytes.
 *
 * @example
 * ```typescript
 * const bytes = base64urlDecode(encoded);
 * ```
 */
export function base64urlDecode(encoded: Base64Url): Uint8Array {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode a byte array to a lowercase hex string.
 *
 * @param data - The bytes to encode.
 * @returns A hex string with length `data.length * 2`.
 *
 * @example
 * ```typescript
 * toHex(new Uint8Array([255, 0])); // 'ff00'
 * ```
 */
export function toHex(data: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < data.length; i++) {
    hex += data[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Decode a hex string to a byte array.
 *
 * @param hex - An even-length hexadecimal string.
 * @returns The decoded bytes.
 * @throws {Error} When the hex string has odd length.
 *
 * @example
 * ```typescript
 * fromHex('ff00'); // Uint8Array [255, 0]
 * ```
 */
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Generate a cryptographically secure 32-byte nonce.
 *
 * Used internally by `buildCovenant` for replay protection.
 * Each nonce is 256 bits of randomness from the platform CSPRNG.
 *
 * @returns A 32-byte Uint8Array nonce.
 *
 * @example
 * ```typescript
 * const nonce = generateNonce();
 * console.log(toHex(nonce)); // 64-char hex string
 * ```
 */
export function generateNonce(): Nonce {
  return randomBytes(32);
}

/**
 * Generate a cryptographically secure random ID as a hex string.
 *
 * @param bytes - Number of random bytes (default: 16, producing 32 hex chars).
 * @returns A hex-encoded random identifier.
 *
 * @example
 * ```typescript
 * const id = generateId();     // 32-char hex
 * const long = generateId(32); // 64-char hex
 * ```
 */
export function generateId(bytes: number = 16): string {
  return toHex(randomBytes(bytes));
}

/**
 * Constant-time comparison of two byte arrays.
 *
 * Prevents timing side-channel attacks when comparing signatures,
 * hashes, or other secret-derived values. Always examines every byte
 * even if a mismatch is found early.
 *
 * @param a - First byte array.
 * @param b - Second byte array.
 * @returns `true` if the arrays are identical in length and content.
 *
 * @example
 * ```typescript
 * const equal = constantTimeEqual(hash1, hash2);
 * ```
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

/**
 * Create a timestamp string in ISO 8601 format (e.g. `"2025-01-15T12:00:00.000Z"`).
 *
 * Uses the current system time. All Stele protocol timestamps are UTC.
 *
 * @returns An ISO 8601 timestamp string.
 *
 * @example
 * ```typescript
 * const ts = timestamp(); // '2025-06-15T08:30:00.123Z'
 * ```
 */
export function timestamp(): string {
  return new Date().toISOString();
}

// ─── Key Rotation ─────────────────────────────────────────────────────────────

export { KeyManager } from './key-rotation';
export type { KeyRotationPolicy, ManagedKeyPair } from './key-rotation';
