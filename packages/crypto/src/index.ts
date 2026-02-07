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
 */
export async function keyPairFromPrivateKeyHex(hex: string): Promise<KeyPair> {
  return keyPairFromPrivateKey(fromHex(hex));
}

/**
 * Sign arbitrary bytes with a private key. Returns a 64-byte Ed25519 signature.
 */
export async function sign(message: Uint8Array, privateKey: PrivateKey): Promise<Signature> {
  return ed.signAsync(message, privateKey);
}

/**
 * Sign a UTF-8 string. Convenience wrapper around sign().
 */
export async function signString(message: string, privateKey: PrivateKey): Promise<Signature> {
  return sign(new TextEncoder().encode(message), privateKey);
}

/**
 * Verify an Ed25519 signature against a message and public key.
 * Returns true if valid, false otherwise. Never throws.
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
 * SHA-256 hash of arbitrary bytes, returned as hex string.
 */
export function sha256(data: Uint8Array): HashHex {
  return toHex(nobleSha256(data));
}

/**
 * SHA-256 hash of a UTF-8 string, returned as hex string.
 */
export function sha256String(data: string): HashHex {
  return sha256(new TextEncoder().encode(data));
}

/**
 * SHA-256 hash of a JavaScript object in canonical form.
 * Object is first canonicalized via canonicalizeJson(), then SHA-256'd.
 */
export function sha256Object(obj: unknown): HashHex {
  return sha256String(canonicalizeJson(obj));
}

/**
 * Deterministic JSON serialization following JCS (RFC 8785).
 * Produces identical output regardless of key insertion order.
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
 */
export function base64urlEncode(data: Uint8Array): Base64Url {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64url decode.
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
 * Encode bytes to hex string.
 */
export function toHex(data: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < data.length; i++) {
    hex += data[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Decode hex string to bytes.
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
 */
export function generateNonce(): Nonce {
  return randomBytes(32);
}

/**
 * Generate a cryptographically secure random ID (hex-encoded).
 * @param bytes - Number of random bytes (default: 16, producing 32 hex chars)
 */
export function generateId(bytes: number = 16): string {
  return toHex(randomBytes(bytes));
}

/**
 * Constant-time comparison of two byte arrays.
 * Prevents timing attacks on signature/hash comparisons.
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
 * Create a timestamp string in ISO 8601 format.
 */
export function timestamp(): string {
  return new Date().toISOString();
}
