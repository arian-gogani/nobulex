import { describe, it, expect } from 'vitest';
import {
  createDID,
  rotateKey,
  signRotation,
  applyRotation,
  verifyRotationChain,
  verifyWithRotation,
  currentAuthoritativeKey,
  keyAtTime,
  signWithDID,
  verifyWithDID,
} from './index';
import { generateKeyPair } from '../crypto/index';
import type { DIDDocumentWithRotation } from './index';

describe('DID key rotation', () => {
  it('produces a signed rotation record bound to the old key', async () => {
    const id = await createDID();
    const nextKp = await generateKeyPair();
    const record = await signRotation({
      oldKeyPair: {
        privateKey: id.privateKey,
        publicKey: id.publicKey,
        publicKeyHex: id.publicKeyHex,
      },
      newPublicKeyHex: nextKp.publicKeyHex,
      reason: 'scheduled rotation',
    });
    expect(record.fromPublicKey).toBe(id.publicKeyHex);
    expect(record.toPublicKey).toBe(nextKp.publicKeyHex);
    expect(record.signature).toHaveLength(128); // 64-byte ed25519 sig in hex
    expect(record.index).toBe(0);
  });

  it('rotateKey returns a DID key pair bound to the new keys', async () => {
    const id = await createDID();
    const nextKp = await generateKeyPair();
    const { identity: rotated } = await rotateKey({ current: id, newKeyPair: nextKp });
    expect(rotated.did).toBe(id.did); // DID is stable through rotation
    expect(rotated.publicKeyHex).toBe(nextKp.publicKeyHex);
    expect(rotated.document.verificationMethod[0]!.publicKeyHex).toBe(nextKp.publicKeyHex);
    expect(rotated.document.keyRotations).toHaveLength(1);
  });

  it('rotation chain hash-links correctly across multiple rotations', async () => {
    const id = await createDID();
    const k2 = await generateKeyPair();
    const k3 = await generateKeyPair();

    const r1 = await rotateKey({ current: id, newKeyPair: k2 });
    const r2 = await rotateKey({ current: r1.identity, newKeyPair: k3 });

    const verification = await verifyRotationChain(
      id.publicKeyHex,
      r2.identity.document.keyRotations ?? [],
    );
    expect(verification.valid).toBe(true);
    expect(verification.errors).toEqual([]);
    expect(verification.currentPublicKey).toBe(k3.publicKeyHex);
  });

  it('detects a forged rotation (signature not from old key)', async () => {
    const id = await createDID();
    const k2 = await generateKeyPair();
    const { identity: rotated } = await rotateKey({ current: id, newKeyPair: k2 });

    // Tamper: swap the signature with a valid-looking but wrong one.
    const tampered: DIDDocumentWithRotation = {
      ...rotated.document,
      keyRotations: [
        {
          ...rotated.document.keyRotations![0]!,
          signature: '00'.repeat(64),
        },
      ],
    };
    const verification = await verifyRotationChain(
      id.publicKeyHex,
      tampered.keyRotations ?? [],
    );
    expect(verification.valid).toBe(false);
    expect(verification.errors.join('; ')).toMatch(/signature invalid/);
  });

  it('detects a broken chain link', async () => {
    const id = await createDID();
    const k2 = await generateKeyPair();
    const k3 = await generateKeyPair();
    const r1 = await rotateKey({ current: id, newKeyPair: k2 });
    const r2 = await rotateKey({ current: r1.identity, newKeyPair: k3 });

    // Corrupt the second rotation's previousHash.
    const corrupted = [
      r2.identity.document.keyRotations![0]!,
      {
        ...r2.identity.document.keyRotations![1]!,
        previousHash: '11'.repeat(32),
      },
    ];
    const verification = await verifyRotationChain(id.publicKeyHex, corrupted);
    expect(verification.valid).toBe(false);
  });

  it('verifyWithRotation accepts signatures from historical keys', async () => {
    const id = await createDID();
    const k2 = await generateKeyPair();

    // Sign a message with the ORIGINAL key...
    const message = 'contract-v1';
    const oldSig = await signWithDID(message, id);

    // ...then rotate to a new key.
    const { identity: rotated } = await rotateKey({ current: id, newKeyPair: k2 });

    // The old signature must still verify against the rotated document.
    expect(await verifyWithRotation(message, oldSig, rotated.document)).toBe(true);
    // But a plain verifyWithDID (checks only the first verificationMethod) would fail.
    expect(await verifyWithDID(message, oldSig, rotated.document)).toBe(false);
  });

  it('currentAuthoritativeKey reflects the latest rotation', async () => {
    const id = await createDID();
    const k2 = await generateKeyPair();
    const { identity } = await rotateKey({ current: id, newKeyPair: k2 });
    expect(currentAuthoritativeKey(identity.document)).toBe(k2.publicKeyHex);
  });

  it('keyAtTime walks the rotation history', async () => {
    const id = await createDID();
    const k2 = await generateKeyPair();

    const record = await signRotation({
      oldKeyPair: {
        privateKey: id.privateKey,
        publicKey: id.publicKey,
        publicKeyHex: id.publicKeyHex,
      },
      newPublicKeyHex: k2.publicKeyHex,
      ts: '2025-06-01T00:00:00.000Z',
    });
    const rotatedDoc = applyRotation(id.document as DIDDocumentWithRotation, record);

    expect(keyAtTime(rotatedDoc, '2025-01-01T00:00:00.000Z', id.publicKeyHex)).toBe(id.publicKeyHex);
    expect(keyAtTime(rotatedDoc, '2025-12-01T00:00:00.000Z', id.publicKeyHex)).toBe(k2.publicKeyHex);
  });

  it('applyRotation refuses mismatched fromPublicKey', async () => {
    const id = await createDID();
    const k2 = await generateKeyPair();
    const k3 = await generateKeyPair();

    // Build a record claiming to rotate FROM k2 (but the document is still on id's key).
    const bogus = await signRotation({
      oldKeyPair: k2,
      newPublicKeyHex: k3.publicKeyHex,
    });
    expect(() => applyRotation(id.document as DIDDocumentWithRotation, bogus)).toThrow();
  });

  it('signRotation refuses no-op rotations', async () => {
    const id = await createDID();
    await expect(signRotation({
      oldKeyPair: {
        privateKey: id.privateKey,
        publicKey: id.publicKey,
        publicKeyHex: id.publicKeyHex,
      },
      newPublicKeyHex: id.publicKeyHex,
    })).rejects.toThrow();
  });
});
