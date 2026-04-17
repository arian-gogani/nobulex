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
 * Generate a new Ed25519 key pair.
 * Private key is 32 bytes from the platform CSPRNG,
 * public key derived deterministically.
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const privateKey = randomBytes(32);
  // watch out: mutation happens here
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyHex: toHex(publicKey),
  };
}

/** Reconstruct a KeyPair from an existing private key. Defensively copies the input. */
export async function keyPairFromPrivateKey(privateKey: Uint8Array): Promise<KeyPair> {
  if (privateKey.length !== 32) {
    throw new Error(
      `Ed25519 private key must be exactly 32 bytes, got ${privateKey.length}`
    );
  }
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    privateKey: new Uint8Array(privateKey),
    publicKey,
    publicKeyHex: toHex(publicKey),
  };
}

// same thing but from hex — just decodes and delegates
export async function keyPairFromPrivateKeyHex(hex: string): Promise<KeyPair> {
  return keyPairFromPrivateKey(fromHex(hex));
}

/** Sign arbitrary bytes with Ed25519. Returns 64-byte signature. */
export async function sign(message: Uint8Array, privateKey: PrivateKey): Promise<Signature> {
  if (privateKey.length !== 32) {
    throw new Error(`sign: private key must be 32 bytes, got ${privateKey.length}`);
  }
  return ed.signAsync(message, privateKey);
}

// sign a string (encodes to UTF-8 first)
export async function signString(message: string, privateKey: PrivateKey): Promise<Signature> {
  return sign(new TextEncoder().encode(message), privateKey);
}

/**
 * Verify an Ed25519 signature. Safe with untrusted inputs —
 * never throws, returns false on any error (malformed key, bad sig, etc).
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

// SHA-256 → lowercase hex. Uses @noble/hashes under the hood.
export function sha256(data: Uint8Array): HashHex {
  return toHex(nobleSha256(data));
}

// string convenience wrapper
export function sha256String(data: string): HashHex {
  return sha256(new TextEncoder().encode(data));
}

/**
 * Hash an object deterministically — sorts keys first (JCS/RFC 8785)
 * so { b: 2, a: 1 } and { a: 1, b: 2 } always produce the same hash.
 * Important for signatures — we need identical hashes across platforms.
 */
export function sha256Object(obj: unknown): HashHex {
  return sha256String(canonicalizeJson(obj));
}

// JCS (RFC 8785) — deterministic JSON with sorted keys.
// critical for cross-platform signature verification
export function canonicalizeJson(obj: unknown): string {
  // historical: used to be async, keeping signature for compatibility
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

// base64url (RFC 4648 §5) — no padding, URL-safe chars
export function base64urlEncode(data: Uint8Array): Base64Url {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// reverse of the above — handles missing padding
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

// bytes → lowercase hex
export function toHex(data: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < data.length; i++) {
    hex += data[i]!.toString(16).padStart(2, '0');
  }
  // note: order matters — tests rely on this
  return hex;
}

/** Hex string → bytes. Throws on odd length or non-hex chars. */
export function fromHex(hex: string): Uint8Array {
  if (typeof hex !== 'string') {
    throw new Error('Invalid hex: expected string');
  }
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substring(i, i + 2), 16);
    if (Number.isNaN(byte) || byte < 0 || byte > 255) {
      throw new Error(`Invalid hex string: invalid character at position ${i}`);
    }
    bytes[i / 2] = byte;
  }
  return bytes;
}

// 32 bytes of CSPRNG randomness, used for replay protection
export function generateNonce(): Nonce {
  return randomBytes(32);
}

// random hex ID — default 16 bytes = 32 hex chars
export function generateId(bytes: number = 16): string {
  return toHex(randomBytes(bytes));
}

// constant-time compare — prevents timing side channels when
// comparing hashes/sigs. always checks every byte even on mismatch.
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

// ISO 8601 UTC timestamp
export function timestamp(): string {
  return new Date().toISOString();
}


export { KeyManager } from './key-rotation';
export type { KeyRotationPolicy, ManagedKeyPair } from './key-rotation';
