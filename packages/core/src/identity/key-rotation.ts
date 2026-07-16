/*
 * DID key rotation.
 *
 * Each rotation is a signed record: the OLD key signs a statement that says
 * "I am rotating control of this DID to public key X as of time T." A DID
 * accumulates a hash-chained `keyRotations` log. Verifiers follow the chain
 * to decide which key is currently authoritative and to validate historical
 * signatures against the key that was active at the time.
 *
 * Without rotation, a leaked or retired key forces an agent to rebuild
 * identity from scratch, losing its reputation and chain. With rotation,
 * an operator can rotate a key mid-life and every downstream verifier can
 * still prove the continuity.
 */

import {
  sha256String,
  signString,
  verify as cryptoVerify,
  toHex,
  fromHex,
  canonicalizeJson,
  timestamp,
} from '../crypto/index';
import type { HashHex, KeyPair } from '../crypto/index';
import type { DIDDocument, DIDKeyPair, DIDVerificationMethod } from '../types/core-types';

const GENESIS_ROTATION_HASH: HashHex =
  '0000000000000000000000000000000000000000000000000000000000000000';

/** A single signed entry in a DID's key-rotation chain. */
export interface KeyRotationRecord {
  /** Monotonic index (0-based). Version 0 == initial key, no rotation performed yet. */
  readonly index: number;
  /** Hex public key being rotated AWAY from (the signer of this record). */
  readonly fromPublicKey: string;
  /** Hex public key becoming authoritative after this record. */
  readonly toPublicKey: string;
  /** ISO-8601 timestamp of the rotation. */
  readonly timestamp: string;
  /** Free-form reason (e.g. "scheduled rotation", "key compromise"). */
  readonly reason: string;
  /** Hash of the previous record, or the genesis hash for the first rotation. */
  readonly previousHash: HashHex;
  /** Content hash of this record (without signature). */
  readonly hash: HashHex;
  /** Signature by `fromPublicKey` over the canonical content. */
  readonly signature: string;
}

/** A DID document that carries a rotation log. */
export interface DIDDocumentWithRotation extends DIDDocument {
  /** Hash-chained history of key rotations, oldest first. May be empty. */
  readonly keyRotations?: readonly KeyRotationRecord[];
}

// ── Content hashing ─────────────────────────────────────────────────────────

function rotationContent(record: Omit<KeyRotationRecord, 'hash' | 'signature'>): string {
  return canonicalizeJson({
    index: record.index,
    fromPublicKey: record.fromPublicKey,
    toPublicKey: record.toPublicKey,
    timestamp: record.timestamp,
    reason: record.reason,
    previousHash: record.previousHash,
  });
}

function computeRotationHash(record: Omit<KeyRotationRecord, 'hash' | 'signature'>): HashHex {
  return sha256String(rotationContent(record));
}

// ── Signing & rotation ──────────────────────────────────────────────────────

/**
 * Produce a signed rotation record. The caller holds the current (old) key
 * and is committing to the new public key.
 *
 * This function does NOT update the DID document, callers stitch the record
 * into a new document via {@link applyRotation}.
 */
export async function signRotation(params: {
  oldKeyPair: KeyPair;
  newPublicKeyHex: string;
  previousRotations?: readonly KeyRotationRecord[];
  reason?: string;
  ts?: string;
}): Promise<KeyRotationRecord> {
  const { oldKeyPair, newPublicKeyHex, previousRotations = [], reason = '', ts } = params;

  if (oldKeyPair.publicKeyHex === newPublicKeyHex) {
    throw new Error('signRotation: new public key must differ from old public key');
  }

  const index = previousRotations.length;
  const previousHash = index === 0
    ? GENESIS_ROTATION_HASH
    : previousRotations[index - 1]!.hash;

  const unsigned: Omit<KeyRotationRecord, 'hash' | 'signature'> = {
    index,
    fromPublicKey: oldKeyPair.publicKeyHex,
    toPublicKey: newPublicKeyHex,
    timestamp: ts ?? timestamp(),
    reason,
    previousHash,
  };

  const hash = computeRotationHash(unsigned);
  const sigBytes = await signString(hash, oldKeyPair.privateKey);

  return {
    ...unsigned,
    hash,
    signature: toHex(sigBytes),
  };
}

/**
 * Apply a rotation record to a DID document: swap the authoritative key and
 * append the record. The returned document has an updated verification method
 * list (new key first) and an updated `keyRotations` chain.
 */
export function applyRotation(
  document: DIDDocumentWithRotation,
  record: KeyRotationRecord,
): DIDDocumentWithRotation {
  // Sanity-check linkage before we mutate anything.
  const existing = document.keyRotations ?? [];
  if (record.index !== existing.length) {
    throw new Error(
      `applyRotation: record index ${record.index} does not match current rotation count ${existing.length}`,
    );
  }
  const expectedPrevHash = existing.length === 0
    ? GENESIS_ROTATION_HASH
    : existing[existing.length - 1]!.hash;
  if (record.previousHash !== expectedPrevHash) {
    throw new Error('applyRotation: rotation chain linkage broken');
  }

  // Current authoritative key must match the record's `fromPublicKey`.
  const currentKey = document.verificationMethod[0]?.publicKeyHex;
  if (currentKey !== record.fromPublicKey) {
    throw new Error(
      `applyRotation: record.fromPublicKey does not match current authoritative key`,
    );
  }

  const newVerificationMethod: DIDVerificationMethod = {
    id: `${document.id}#key-${record.index + 2}`,
    type: 'Ed25519VerificationKey2020',
    controller: document.controller,
    publicKeyHex: record.toPublicKey,
  };

  return {
    ...document,
    // Put the new key first, it's now authoritative, but retain older keys
    // so historical signatures can still be verified.
    verificationMethod: [newVerificationMethod, ...document.verificationMethod],
    authentication: [newVerificationMethod.id, ...document.authentication],
    assertionMethod: [newVerificationMethod.id, ...document.assertionMethod],
    updated: record.timestamp,
    keyRotations: [...existing, record],
  };
}

/**
 * One-shot helper: rotate a DID key pair, producing a new DIDKeyPair bound
 * to the new keys with the rotation record persisted on the document.
 *
 * Call this when the caller holds both the old and the new key pairs
 * (the common case for operator-driven rotation).
 */
export async function rotateKey(params: {
  current: DIDKeyPair;
  newKeyPair: KeyPair;
  reason?: string;
  ts?: string;
}): Promise<{ identity: DIDKeyPair & { document: DIDDocumentWithRotation }; record: KeyRotationRecord }> {
  const { current, newKeyPair, reason, ts } = params;

  const doc = current.document as DIDDocumentWithRotation;
  const record = await signRotation({
    oldKeyPair: {
      privateKey: current.privateKey,
      publicKey: current.publicKey,
      publicKeyHex: current.publicKeyHex,
    },
    newPublicKeyHex: newKeyPair.publicKeyHex,
    previousRotations: doc.keyRotations ?? [],
    reason,
    ts,
  });

  const newDocument = applyRotation(doc, record);

  const identity: DIDKeyPair & { document: DIDDocumentWithRotation } = {
    did: current.did,
    document: newDocument,
    privateKey: newKeyPair.privateKey,
    publicKey: newKeyPair.publicKey,
    publicKeyHex: newKeyPair.publicKeyHex,
  };

  return { identity, record };
}

// ── Verification ────────────────────────────────────────────────────────────

export interface KeyRotationVerification {
  readonly valid: boolean;
  readonly errors: readonly string[];
  /** Final authoritative public key after applying every record in order. */
  readonly currentPublicKey: string;
}

/**
 * Verify every signature and link in a rotation chain, given the DID's original
 * initial public key (the one embedded in the document at creation time, or
 * `null` if no rotations have been applied).
 */
export async function verifyRotationChain(
  initialPublicKey: string,
  rotations: readonly KeyRotationRecord[],
): Promise<KeyRotationVerification> {
  const errors: string[] = [];
  let currentKey = initialPublicKey;

  for (let i = 0; i < rotations.length; i++) {
    const record = rotations[i]!;

    if (record.index !== i) {
      errors.push(`rotation ${i}: expected index ${i}, got ${record.index}`);
    }

    const expectedPrev = i === 0
      ? GENESIS_ROTATION_HASH
      : rotations[i - 1]!.hash;
    if (record.previousHash !== expectedPrev) {
      errors.push(`rotation ${i}: previousHash does not link to prior record`);
    }

    if (record.fromPublicKey !== currentKey) {
      errors.push(
        `rotation ${i}: fromPublicKey does not match current authoritative key`,
      );
    }

    const expectedHash = computeRotationHash({
      index: record.index,
      fromPublicKey: record.fromPublicKey,
      toPublicKey: record.toPublicKey,
      timestamp: record.timestamp,
      reason: record.reason,
      previousHash: record.previousHash,
    });
    if (expectedHash !== record.hash) {
      errors.push(`rotation ${i}: content hash mismatch`);
    }

    let sigValid = false;
    try {
      const msg = new TextEncoder().encode(record.hash);
      const sig = fromHex(record.signature);
      const pub = fromHex(record.fromPublicKey);
      sigValid = await cryptoVerify(msg, sig, pub);
    } catch {
      sigValid = false;
    }
    if (!sigValid) {
      errors.push(`rotation ${i}: signature invalid (not signed by fromPublicKey)`);
    }

    currentKey = record.toPublicKey;
  }

  return { valid: errors.length === 0, errors, currentPublicKey: currentKey };
}

/**
 * Given a DID document, return the public key that is authoritative for
 * signatures made *now* (after all rotations have been applied).
 */
export function currentAuthoritativeKey(document: DIDDocumentWithRotation): string {
  const vm = document.verificationMethod[0];
  if (!vm) throw new Error('Document has no verification method');
  return vm.publicKeyHex;
}

/**
 * Given a DID document and a timestamp, return the public key that was
 * authoritative at that moment (by walking the rotation chain). Use this
 * to verify old signatures that predate the current key.
 */
export function keyAtTime(
  document: DIDDocumentWithRotation,
  at: string,
  initialPublicKey: string,
): string {
  const rotations = document.keyRotations ?? [];
  let key = initialPublicKey;
  for (const record of rotations) {
    if (record.timestamp > at) break;
    key = record.toPublicKey;
  }
  return key;
}

/**
 * Verify a signature against the DID's full rotation history. Tries each
 * historical key in turn, succeeds if any of them signed the message.
 *
 * The current authoritative key is preferred (checked first), so the fast
 * path for fresh messages stays fast.
 */
export async function verifyWithRotation(
  message: string,
  signatureHex: string,
  document: DIDDocumentWithRotation,
): Promise<boolean> {
  const messageBytes = new TextEncoder().encode(message);
  let sigBytes: Uint8Array;
  try {
    sigBytes = fromHex(signatureHex);
  } catch {
    return false;
  }

  for (const vm of document.verificationMethod) {
    try {
      const pub = fromHex(vm.publicKeyHex);
      if (await cryptoVerify(messageBytes, sigBytes, pub)) return true;
    } catch {
      // keep trying
    }
  }
  return false;
}

// ── Re-exports ──────────────────────────────────────────────────────────────

export { GENESIS_ROTATION_HASH };
