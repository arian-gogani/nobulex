import { describe, it, expect } from 'vitest';
import {
  createDID,
  didFromKeyPair,
  publicKeyToDid,
  signWithDID,
  verifyWithDID,
  parseDID,
  DIDResolver,
} from './did';
import { generateKeyPair } from '@nobulex/crypto';

describe('W3C DID support', () => {
  // ── createDID ─────────────────────────────────────────────────────────────

  describe('createDID()', () => {
    it('creates a valid DID with did:nobulex method', async () => {
      const kp = await createDID();
      expect(kp.did).toMatch(/^did:nobulex:[a-f0-9]{32}$/);
    });

    it('generates unique DIDs', async () => {
      const a = await createDID();
      const b = await createDID();
      expect(a.did).not.toBe(b.did);
    });

    it('includes a valid DID document', async () => {
      const kp = await createDID();
      expect(kp.document['@context']).toContain('https://www.w3.org/ns/did/v1');
      expect(kp.document.id).toBe(kp.did);
      expect(kp.document.controller).toBe(kp.did);
      expect(kp.document.verificationMethod).toHaveLength(1);
      expect(kp.document.authentication).toHaveLength(1);
      expect(kp.document.assertionMethod).toHaveLength(1);
    });

    it('verification method has correct type', async () => {
      const kp = await createDID();
      const vm = kp.document.verificationMethod[0]!;
      expect(vm.type).toBe('Ed25519VerificationKey2020');
      expect(vm.controller).toBe(kp.did);
      expect(vm.publicKeyHex).toBe(kp.publicKeyHex);
    });

    it('includes timestamps', async () => {
      const kp = await createDID();
      expect(new Date(kp.document.created).getTime()).not.toBeNaN();
      expect(new Date(kp.document.updated).getTime()).not.toBeNaN();
    });

    it('has 32-byte keys', async () => {
      const kp = await createDID();
      expect(kp.privateKey).toHaveLength(32);
      expect(kp.publicKey).toHaveLength(32);
      expect(kp.publicKeyHex).toHaveLength(64);
    });
  });

  // ── didFromKeyPair ────────────────────────────────────────────────────────

  describe('didFromKeyPair()', () => {
    it('creates DID from existing key pair', async () => {
      const kp = await generateKeyPair();
      const didKp = didFromKeyPair(kp);
      expect(didKp.did).toMatch(/^did:nobulex:/);
      expect(didKp.publicKeyHex).toBe(kp.publicKeyHex);
    });

    it('same key pair produces same DID', async () => {
      const kp = await generateKeyPair();
      const a = didFromKeyPair(kp);
      const b = didFromKeyPair(kp);
      expect(a.did).toBe(b.did);
    });
  });

  // ── publicKeyToDid ────────────────────────────────────────────────────────

  describe('publicKeyToDid()', () => {
    it('produces deterministic DIDs', () => {
      const hex = 'aabbccdd' + '00'.repeat(28);
      const d1 = publicKeyToDid(hex);
      const d2 = publicKeyToDid(hex);
      expect(d1).toBe(d2);
    });

    it('different keys produce different DIDs', () => {
      const d1 = publicKeyToDid('aa'.repeat(32));
      const d2 = publicKeyToDid('bb'.repeat(32));
      expect(d1).not.toBe(d2);
    });
  });

  // ── Signing & Verification ────────────────────────────────────────────────

  describe('signWithDID() & verifyWithDID()', () => {
    it('signs and verifies a message', async () => {
      const kp = await createDID();
      const message = 'Hello, Nobulex!';
      const sig = await signWithDID(message, kp);
      const valid = await verifyWithDID(message, sig, kp.document);
      expect(valid).toBe(true);
    });

    it('verification fails with wrong message', async () => {
      const kp = await createDID();
      const sig = await signWithDID('original', kp);
      const valid = await verifyWithDID('tampered', sig, kp.document);
      expect(valid).toBe(false);
    });

    it('verification fails with wrong key', async () => {
      const kp1 = await createDID();
      const kp2 = await createDID();
      const sig = await signWithDID('message', kp1);
      const valid = await verifyWithDID('message', sig, kp2.document);
      expect(valid).toBe(false);
    });

    it('verification fails with empty verification methods', async () => {
      const kp = await createDID();
      const sig = await signWithDID('message', kp);
      const emptyDoc = { ...kp.document, verificationMethod: [] as const };
      const valid = await verifyWithDID('message', sig, emptyDoc);
      expect(valid).toBe(false);
    });

    it('produces hex-encoded signatures', async () => {
      const kp = await createDID();
      const sig = await signWithDID('test', kp);
      expect(sig).toMatch(/^[a-f0-9]+$/);
      expect(sig).toHaveLength(128); // 64-byte Ed25519 sig = 128 hex chars
    });
  });

  // ── DIDResolver ───────────────────────────────────────────────────────────

  describe('DIDResolver', () => {
    it('registers and resolves a DID', async () => {
      const resolver = new DIDResolver();
      const kp = await createDID();
      resolver.register(kp.document);
      const result = resolver.resolve(kp.did);
      expect(result.found).toBe(true);
      expect(result.document!.id).toBe(kp.did);
      expect(result.error).toBeNull();
    });

    it('returns not found for unknown DID', () => {
      const resolver = new DIDResolver();
      const result = resolver.resolve('did:nobulex:nonexistent');
      expect(result.found).toBe(false);
      expect(result.document).toBeNull();
      expect(result.error).toContain('not found');
    });

    it('has() checks existence', async () => {
      const resolver = new DIDResolver();
      const kp = await createDID();
      expect(resolver.has(kp.did)).toBe(false);
      resolver.register(kp.document);
      expect(resolver.has(kp.did)).toBe(true);
    });

    it('tracks size', async () => {
      const resolver = new DIDResolver();
      expect(resolver.size).toBe(0);
      const kp1 = await createDID();
      const kp2 = await createDID();
      resolver.register(kp1.document);
      expect(resolver.size).toBe(1);
      resolver.register(kp2.document);
      expect(resolver.size).toBe(2);
    });

    it('remove() deletes a DID', async () => {
      const resolver = new DIDResolver();
      const kp = await createDID();
      resolver.register(kp.document);
      expect(resolver.has(kp.did)).toBe(true);
      resolver.remove(kp.did);
      expect(resolver.has(kp.did)).toBe(false);
    });

    it('resolves multiple DIDs', async () => {
      const resolver = new DIDResolver();
      const kps = await Promise.all([createDID(), createDID(), createDID()]);
      for (const kp of kps) resolver.register(kp.document);

      for (const kp of kps) {
        const result = resolver.resolve(kp.did);
        expect(result.found).toBe(true);
      }
    });
  });

  // ── parseDID ──────────────────────────────────────────────────────────────

  describe('parseDID()', () => {
    it('parses a valid did:nobulex identifier', () => {
      const result = parseDID('did:nobulex:aabbccdd1122334455667788');
      expect(result).not.toBeNull();
      expect(result!.method).toBe('nobulex');
      expect(result!.id).toBe('aabbccdd1122334455667788');
    });

    it('returns null for invalid format', () => {
      expect(parseDID('not-a-did')).toBeNull();
      expect(parseDID('did:')).toBeNull();
      expect(parseDID('')).toBeNull();
    });

    it('parses other DID methods', () => {
      const result = parseDID('did:key:abc123');
      expect(result).not.toBeNull();
      expect(result!.method).toBe('key');
    });
  });
});
