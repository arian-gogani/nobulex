/**
 * Tests for key rotation integration in NobulexClient.
 */

import { describe, it, expect, vi } from 'vitest';
import { generateKeyPair } from '@nobulex/crypto';
import { verifyCovenant as coreVerifyCovenant } from '@nobulex/core';
import type { KeyPair } from '@nobulex/crypto';
import type { Issuer, Beneficiary } from '@nobulex/core';

import { NobulexClient, KeyManager } from '../src/index.js';
import type { KeyRotatedEvent } from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeParties(): Promise<{
  issuerKeyPair: KeyPair;
  beneficiaryKeyPair: KeyPair;
  issuer: Issuer;
  beneficiary: Beneficiary;
}> {
  const issuerKeyPair = await generateKeyPair();
  const beneficiaryKeyPair = await generateKeyPair();

  const issuer: Issuer = {
    id: 'issuer-1',
    publicKey: issuerKeyPair.publicKeyHex,
    role: 'issuer',
  };

  const beneficiary: Beneficiary = {
    id: 'beneficiary-1',
    publicKey: beneficiaryKeyPair.publicKeyHex,
    role: 'beneficiary',
  };

  return { issuerKeyPair, beneficiaryKeyPair, issuer, beneficiary };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NobulexClient key rotation', () => {
  // 1. Client with keyRotation option initializes KeyManager
  it('creates a KeyManager when keyRotation option is provided', () => {
    const client = new NobulexClient({
      keyRotation: {
        maxAgeMs: 60000,
        overlapPeriodMs: 5000,
      },
    });

    expect(client.keyManager).toBeInstanceOf(KeyManager);
  });

  it('does not create a KeyManager when keyRotation is not provided', () => {
    const client = new NobulexClient();
    expect(client.keyManager).toBeUndefined();
  });

  // 2. initializeKeyRotation() generates first key
  it('initializeKeyRotation() generates the first key and sets it on the client', async () => {
    const client = new NobulexClient({
      keyRotation: {
        maxAgeMs: 60000,
        overlapPeriodMs: 5000,
      },
    });

    expect(client.keyPair).toBeUndefined();

    await client.initializeKeyRotation();

    expect(client.keyPair).toBeDefined();
    expect(client.keyPair!.publicKeyHex).toBeTruthy();
    expect(client.keyPair!.privateKey).toBeInstanceOf(Uint8Array);
  });

  it('initializeKeyRotation() throws when key rotation is not configured', async () => {
    const client = new NobulexClient();
    await expect(client.initializeKeyRotation()).rejects.toThrow(
      'Key rotation is not configured',
    );
  });

  // 3. rotateKeyIfNeeded() rotates when key is expired
  it('rotateKeyIfNeeded() rotates when key has exceeded maxAgeMs', async () => {
    const client = new NobulexClient({
      keyRotation: {
        maxAgeMs: 50, // Very short for testing
        overlapPeriodMs: 10,
      },
    });

    await client.initializeKeyRotation();
    const originalPubKey = client.keyPair!.publicKeyHex;

    // Wait for the key to age past maxAgeMs
    await new Promise((resolve) => setTimeout(resolve, 60));

    const rotated = await client.rotateKeyIfNeeded();
    expect(rotated).toBe(true);
    expect(client.keyPair!.publicKeyHex).not.toBe(originalPubKey);
  });

  it('rotateKeyIfNeeded() does not rotate when key is still fresh', async () => {
    const client = new NobulexClient({
      keyRotation: {
        maxAgeMs: 100000,
        overlapPeriodMs: 5000,
      },
    });

    await client.initializeKeyRotation();
    const originalPubKey = client.keyPair!.publicKeyHex;

    const rotated = await client.rotateKeyIfNeeded();
    expect(rotated).toBe(false);
    expect(client.keyPair!.publicKeyHex).toBe(originalPubKey);
  });

  it('rotateKeyIfNeeded() throws when key rotation is not configured', async () => {
    const client = new NobulexClient();
    await expect(client.rotateKeyIfNeeded()).rejects.toThrow(
      'Key rotation is not configured',
    );
  });

  // 4. createCovenant uses rotated key
  it('createCovenant uses the rotated key after rotation', async () => {
    const client = new NobulexClient({
      keyRotation: {
        maxAgeMs: 50,
        overlapPeriodMs: 10,
      },
    });

    await client.initializeKeyRotation();
    const firstKey = client.keyPair!;

    // Build issuer using the first key
    const { beneficiary } = await makeParties();
    const issuer: Issuer = {
      id: 'issuer-1',
      publicKey: firstKey.publicKeyHex,
      role: 'issuer',
    };

    // Create a covenant before rotation
    const doc1 = await client.createCovenant({
      issuer,
      beneficiary,
      constraints: "permit read on '/data'",
    });

    const result1 = await coreVerifyCovenant(doc1);
    expect(result1.valid).toBe(true);

    // Wait for key to expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Create another covenant -- should trigger auto-rotation
    // Update the issuer with the new key after rotation triggers
    await client.rotateKeyIfNeeded();
    const newKey = client.keyPair!;
    const issuer2: Issuer = {
      id: 'issuer-1',
      publicKey: newKey.publicKeyHex,
      role: 'issuer',
    };

    const doc2 = await client.createCovenant({
      issuer: issuer2,
      beneficiary,
      constraints: "permit read on '/data'",
    });

    const result2 = await coreVerifyCovenant(doc2);
    expect(result2.valid).toBe(true);

    // The two covenants should have been signed with different keys
    expect(doc1.issuer.publicKey).not.toBe(doc2.issuer.publicKey);
  });

  // 5. key:rotated event is emitted on rotation
  it('emits key:rotated event when rotation occurs', async () => {
    const client = new NobulexClient({
      keyRotation: {
        maxAgeMs: 50,
        overlapPeriodMs: 10,
      },
    });

    await client.initializeKeyRotation();
    const originalPubKey = client.keyPair!.publicKeyHex;

    const events: KeyRotatedEvent[] = [];
    client.on('key:rotated', (e) => events.push(e));

    // Wait for key to expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    await client.rotateKeyIfNeeded();

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('key:rotated');
    expect(events[0]!.previousPublicKey).toBe(originalPubKey);
    expect(events[0]!.currentPublicKey).toBe(client.keyPair!.publicKeyHex);
    expect(events[0]!.timestamp).toBeTruthy();
  });

  it('does not emit key:rotated event when no rotation is needed', async () => {
    const client = new NobulexClient({
      keyRotation: {
        maxAgeMs: 100000,
        overlapPeriodMs: 5000,
      },
    });

    await client.initializeKeyRotation();

    const events: KeyRotatedEvent[] = [];
    client.on('key:rotated', (e) => events.push(e));

    await client.rotateKeyIfNeeded();

    expect(events).toHaveLength(0);
  });

  // 6. Covenants signed with previous key still verify (during overlap)
  it('covenants signed with previous key still verify during overlap period', async () => {
    const client = new NobulexClient({
      keyRotation: {
        maxAgeMs: 100,
        overlapPeriodMs: 90, // long overlap so old key stays valid after rotation
      },
    });

    await client.initializeKeyRotation();
    const firstKey = client.keyPair!;

    const { beneficiary } = await makeParties();
    const issuer: Issuer = {
      id: 'issuer-1',
      publicKey: firstKey.publicKeyHex,
      role: 'issuer',
    };

    // Create a covenant with the first key
    const doc = await client.createCovenant({
      issuer,
      beneficiary,
      constraints: "permit read on '/data'",
    });

    // Wait for key to expire, then rotate
    await new Promise((resolve) => setTimeout(resolve, 110));
    await client.rotateKeyIfNeeded();

    // The old covenant should still verify (the signature is valid against
    // the issuer's publicKey recorded in the document)
    const result = await coreVerifyCovenant(doc);
    expect(result.valid).toBe(true);

    // The key manager should still be able to verify with the old key
    const km = client.keyManager!;
    const message = new TextEncoder().encode('test-message');
    const { sign } = await import('@nobulex/crypto');
    const sig = await sign(message, firstKey.privateKey);

    const verifyResult = await km.verifyWithAnyKey(message, sig);
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.keyId).toBe(firstKey.publicKeyHex);
  });

  // 7. Client without keyRotation works normally (no regression)
  it('client without keyRotation works normally for generateKeyPair', async () => {
    const client = new NobulexClient();
    const kp = await client.generateKeyPair();

    expect(kp.privateKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKeyHex).toBeTruthy();
    expect(client.keyPair).toBe(kp);
  });

  it('client without keyRotation works normally for createCovenant', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();
    const client = new NobulexClient({ keyPair: issuerKeyPair });

    const doc = await client.createCovenant({
      issuer,
      beneficiary,
      constraints: "permit read on '/data'",
    });

    const result = await coreVerifyCovenant(doc);
    expect(result.valid).toBe(true);
  });

  it('client without keyRotation works normally for countersign', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();
    const auditorKp = await generateKeyPair();
    const createClient = new NobulexClient({ keyPair: issuerKeyPair });
    const auditClient = new NobulexClient({ keyPair: auditorKp });

    const doc = await createClient.createCovenant({
      issuer,
      beneficiary,
      constraints: "permit read on '/data'",
    });

    const signed = await auditClient.countersign(doc, 'auditor');
    expect(signed.countersignatures).toHaveLength(1);

    const result = await coreVerifyCovenant(signed);
    expect(result.valid).toBe(true);
  });

  // Additional: generateKeyPair returns managed key when key manager is initialized
  it('generateKeyPair returns managed key when key manager is initialized', async () => {
    const client = new NobulexClient({
      keyRotation: {
        maxAgeMs: 60000,
        overlapPeriodMs: 5000,
      },
    });

    await client.initializeKeyRotation();
    const managedKey = client.keyManager!.current().keyPair;

    const kp = await client.generateKeyPair();
    expect(kp.publicKeyHex).toBe(managedKey.publicKeyHex);
  });

  // Additional: onRotation callback is invoked
  it('invokes the onRotation callback from client options', async () => {
    const onRotation = vi.fn();
    const client = new NobulexClient({
      keyRotation: {
        maxAgeMs: 50,
        overlapPeriodMs: 10,
        onRotation,
      },
    });

    await client.initializeKeyRotation();
    const originalPubKey = client.keyPair!.publicKeyHex;

    // Wait for key to expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    await client.rotateKeyIfNeeded();

    expect(onRotation).toHaveBeenCalledOnce();
    expect(onRotation).toHaveBeenCalledWith(
      originalPubKey,
      client.keyPair!.publicKeyHex,
    );
  });
});
