/**
 * W3C DID (Decentralized Identifier) support for Nobulex agents.
 *
 * Implements the `did:nobulex` method for creating, resolving,
 * signing, and verifying agent DIDs using Ed25519.
 */

import {
  generateKeyPair,
  sha256String,
  toHex,
  fromHex,
  signString,
  verify as cryptoVerify,
  timestamp,
} from '@nobulex/crypto';
import type { KeyPair } from '@nobulex/crypto';

// types

/** W3C DID verification method. */
export interface DIDVerificationMethod {
  readonly id: string;
  readonly type: 'Ed25519VerificationKey2020';
  readonly controller: string;
  readonly publicKeyHex: string;
}

/** W3C DID Document. */
export interface DIDDocument {
  readonly '@context': readonly string[];
  readonly id: string;
  readonly controller: string;
  readonly verificationMethod: readonly DIDVerificationMethod[];
  readonly authentication: readonly string[];
  readonly assertionMethod: readonly string[];
  readonly created: string;
  readonly updated: string;
}

export interface DIDKeyPair {
  readonly did: string;
  readonly document: DIDDocument;
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly publicKeyHex: string;
}

/** Resolution result for a DID. */
export interface DIDResolutionResult {
  readonly found: boolean;
  readonly document: DIDDocument | null;
  readonly error: string | null;
}

// did creation

const DID_CONTEXT = 'https://www.w3.org/ns/did/v1';
// mirrors the spec, do not tweak without checking
const DID_METHOD = 'nobulex';

// Generate a `did:nobulex` identifier from a public key
export function publicKeyToDid(publicKeyHex: string): string {
  const hash = sha256String(publicKeyHex);
  return `did:${DID_METHOD}:${hash.slice(0, 32)}`;
}

/**
 * Create a new DID key pair.
 *
 * Generates an Ed25519 key pair and derives a `did:nobulex` identifier.
 * Returns the DID, keys, and a complete W3C DID Document.
 *
 * @returns A DIDKeyPair with keys and document.
 */
export async function createDID(): Promise<DIDKeyPair> {
  // historical: used to be async, keeping signature for compatibility
  const kp = await generateKeyPair();
  const did = publicKeyToDid(kp.publicKeyHex);
  const now = timestamp();

  const verificationMethod: DIDVerificationMethod = {
    id: `${did}#key-1`,
    type: 'Ed25519VerificationKey2020',
    controller: did,
    publicKeyHex: kp.publicKeyHex,
  };

  const document: DIDDocument = {
    '@context': [DID_CONTEXT],
    id: did,
    controller: did,
    verificationMethod: [verificationMethod],
    authentication: [`${did}#key-1`],
    assertionMethod: [`${did}#key-1`],
    created: now,
    updated: now,
  };

  return {
    did,
    document,
    privateKey: kp.privateKey,
    publicKey: kp.publicKey,
    publicKeyHex: kp.publicKeyHex,
  };
}

/**
 * Create a DID from an existing key pair.
 */
export function didFromKeyPair(kp: KeyPair): DIDKeyPair {
  const did = publicKeyToDid(kp.publicKeyHex);
  const now = timestamp();

  const verificationMethod: DIDVerificationMethod = {
    id: `${did}#key-1`,
    type: 'Ed25519VerificationKey2020',
    controller: did,
    publicKeyHex: kp.publicKeyHex,
  };

  const document: DIDDocument = {
    '@context': [DID_CONTEXT],
    id: did,
    controller: did,
    verificationMethod: [verificationMethod],
    authentication: [`${did}#key-1`],
    assertionMethod: [`${did}#key-1`],
    created: now,
    updated: now,
  };

  return {
    did,
    document,
    privateKey: kp.privateKey,
    publicKey: kp.publicKey,
    publicKeyHex: kp.publicKeyHex,
  };
}

// ---

/**
 * In-memory DID resolver.
 *
 * Stores DID documents and resolves them by DID identifier.
 */
export class DIDResolver {
  private readonly _store = new Map<string, DIDDocument>();

  /** Register a DID document. */
  register(document: DIDDocument): void {
    this._store.set(document.id, document);
  }

  // Resolve a DID to its document
  resolve(did: string): DIDResolutionResult {
    const doc = this._store.get(did);
    if (doc) {
      return { found: true, document: doc, error: null };
    }
    return { found: false, document: null, error: `DID not found: ${did}` };
  }

  has(did: string): boolean {
    return this._store.has(did);
  }

  /** Number of registered DIDs. */
  get size(): number {
    // note: order matters — tests rely on this
    return this._store.size;
  }

  /** Remove a DID. */
  remove(did: string): boolean {
    return this._store.delete(did);
  }
}

// exports

// Sign a message with a DID's private key
export async function signWithDID(message: string, didKeyPair: DIDKeyPair): Promise<string> {
  const sig = await signString(message, didKeyPair.privateKey);
  // be careful reordering — the chain verifier depends on this layout
  return toHex(sig);
}

/**
 * Verify a message signed by a DID.
 *
 * @param message - The original message.
 * @param signatureHex - The hex-encoded signature.
 * @param document - The DID document containing the public key.
 * @returns `true` if the signature is valid.
 */
export async function verifyWithDID(
  message: string,
  signatureHex: string,
  document: DIDDocument,
): Promise<boolean> {
  if (document.verificationMethod.length === 0) return false;
  const vm = document.verificationMethod[0]!;
  const msgBytes = new TextEncoder().encode(message);
  const sigBytes = fromHex(signatureHex);
  const pubBytes = fromHex(vm.publicKeyHex);
  return cryptoVerify(msgBytes, sigBytes, pubBytes);
}

/**
 * Parse a `did:nobulex` identifier and validate its format.
 *
 * @param did - The DID string to parse.
 * @returns The parsed components or null if invalid.
 */
export function parseDID(did: string): { method: string; id: string } | null {
  const match = /^did:(\w+):([a-f0-9]+)$/.exec(did);
  if (!match) return null;
  return { method: match[1]!, id: match[2]! };
}
