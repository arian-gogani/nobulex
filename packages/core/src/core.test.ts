import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '@stele/crypto';
import type { KeyPair } from '@stele/crypto';

import {
  buildCovenant,
  verifyCovenant,
  canonicalForm,
  computeId,
  countersignCovenant,
  resignCovenant,
  serializeCovenant,
  deserializeCovenant,
  CovenantBuildError,
  MemoryChainResolver,
  resolveChain,
  PROTOCOL_VERSION,
  MAX_DOCUMENT_SIZE,
} from './index';

import type {
  CovenantDocument,
  CovenantBuilderOptions,
  Issuer,
  Beneficiary,
} from './index';

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

function validConstraints(): string {
  return "permit read on 'data'";
}

async function buildValidCovenant(overrides?: Partial<CovenantBuilderOptions>): Promise<{
  doc: CovenantDocument;
  issuerKeyPair: KeyPair;
  beneficiaryKeyPair: KeyPair;
}> {
  const { issuerKeyPair, beneficiaryKeyPair, issuer, beneficiary } = await makeParties();

  const options: CovenantBuilderOptions = {
    issuer,
    beneficiary,
    constraints: validConstraints(),
    privateKey: issuerKeyPair.privateKey,
    ...overrides,
  };

  const doc = await buildCovenant(options);
  return { doc, issuerKeyPair, beneficiaryKeyPair };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@stele/core', () => {
  // ── buildCovenant ──────────────────────────────────────────────────────

  describe('buildCovenant', () => {
    it('creates a valid CovenantDocument', async () => {
      const { doc } = await buildValidCovenant();

      expect(doc).toBeDefined();
      expect(doc.id).toBeTruthy();
      expect(typeof doc.id).toBe('string');
      expect(doc.version).toBe(PROTOCOL_VERSION);
      expect(doc.issuer.role).toBe('issuer');
      expect(doc.beneficiary.role).toBe('beneficiary');
      expect(doc.constraints).toBe(validConstraints());
      expect(doc.nonce).toBeTruthy();
      expect(doc.createdAt).toBeTruthy();
      expect(doc.signature).toBeTruthy();
      // id should be a hex string (64 chars for SHA-256)
      expect(doc.id).toMatch(/^[0-9a-f]{64}$/);
      // signature should be a hex string (128 chars for Ed25519)
      expect(doc.signature).toMatch(/^[0-9a-f]{128}$/);
    });

    it('includes optional fields when provided', async () => {
      const { doc } = await buildValidCovenant({
        expiresAt: '2099-12-31T23:59:59.000Z',
        activatesAt: '2020-01-01T00:00:00.000Z',
        metadata: { name: 'test-covenant', description: 'A test covenant' },
        obligations: [{ id: 'ob-1', description: 'Must log', action: 'log' }],
        enforcement: { type: 'monitor', config: {} },
        proof: { type: 'audit_log', config: {} },
        revocation: { method: 'crl' },
      });

      expect(doc.expiresAt).toBe('2099-12-31T23:59:59.000Z');
      expect(doc.activatesAt).toBe('2020-01-01T00:00:00.000Z');
      expect(doc.metadata?.name).toBe('test-covenant');
      expect(doc.obligations).toHaveLength(1);
      expect(doc.enforcement?.type).toBe('monitor');
      expect(doc.proof?.type).toBe('audit_log');
      expect(doc.revocation?.method).toBe('crl');
    });
  });

  // ── buildCovenant → verifyCovenant round-trip ──────────────────────────

  describe('buildCovenant → verifyCovenant round-trip', () => {
    it('all checks pass for a freshly-built covenant', async () => {
      const { doc } = await buildValidCovenant();

      const result = await verifyCovenant(doc);

      expect(result.valid).toBe(true);
      expect(result.checks.length).toBeGreaterThanOrEqual(11);
      for (const check of result.checks) {
        expect(check.passed).toBe(true);
      }
      expect(result.document).toEqual(doc);
    });
  });

  // ── verifyCovenant detects tampering ───────────────────────────────────

  describe('verifyCovenant detects tampering', () => {
    it('fails when signature is tampered', async () => {
      const { doc } = await buildValidCovenant();

      // Flip one hex character in the signature
      const tampered = { ...doc };
      const sigChars = tampered.signature.split('');
      sigChars[0] = sigChars[0] === 'a' ? 'b' : 'a';
      tampered.signature = sigChars.join('');

      const result = await verifyCovenant(tampered);

      expect(result.valid).toBe(false);
      const sigCheck = result.checks.find((c) => c.name === 'signature_valid');
      expect(sigCheck).toBeDefined();
      expect(sigCheck!.passed).toBe(false);
    });

    it('fails when document ID is tampered', async () => {
      const { doc } = await buildValidCovenant();

      const tampered = { ...doc };
      const idChars = tampered.id.split('');
      idChars[0] = idChars[0] === 'a' ? 'b' : 'a';
      tampered.id = idChars.join('');

      const result = await verifyCovenant(tampered);

      expect(result.valid).toBe(false);
      const idCheck = result.checks.find((c) => c.name === 'id_match');
      expect(idCheck).toBeDefined();
      expect(idCheck!.passed).toBe(false);
    });
  });

  // ── verifyCovenant detects expired covenants ───────────────────────────

  describe('verifyCovenant detects expired covenants', () => {
    it('fails for an expired covenant', async () => {
      const { doc } = await buildValidCovenant({
        expiresAt: '2000-01-01T00:00:00.000Z',
      });

      const result = await verifyCovenant(doc);

      expect(result.valid).toBe(false);
      const expiryCheck = result.checks.find((c) => c.name === 'not_expired');
      expect(expiryCheck).toBeDefined();
      expect(expiryCheck!.passed).toBe(false);
      expect(expiryCheck!.message).toContain('expired');
    });

    it('passes for a non-expired covenant', async () => {
      const { doc } = await buildValidCovenant({
        expiresAt: '2099-12-31T23:59:59.000Z',
      });

      const result = await verifyCovenant(doc);

      const expiryCheck = result.checks.find((c) => c.name === 'not_expired');
      expect(expiryCheck).toBeDefined();
      expect(expiryCheck!.passed).toBe(true);
    });
  });

  // ── canonicalForm ──────────────────────────────────────────────────────

  describe('canonicalForm', () => {
    it('is deterministic (same doc produces the same output)', async () => {
      const { doc } = await buildValidCovenant();

      const form1 = canonicalForm(doc);
      const form2 = canonicalForm(doc);

      expect(form1).toBe(form2);
    });

    it('strips id, signature, and countersignatures', async () => {
      const { doc } = await buildValidCovenant();

      const form = canonicalForm(doc);
      const parsed = JSON.parse(form);

      expect(parsed.id).toBeUndefined();
      expect(parsed.signature).toBeUndefined();
      expect(parsed.countersignatures).toBeUndefined();
    });

    it('produces identical output regardless of object key order', async () => {
      const { doc } = await buildValidCovenant();

      // Create a clone with keys in a different order
      const reordered: Record<string, unknown> = {};
      const keys = Object.keys(doc).reverse();
      for (const key of keys) {
        reordered[key] = (doc as Record<string, unknown>)[key];
      }

      const form1 = canonicalForm(doc);
      const form2 = canonicalForm(reordered as unknown as CovenantDocument);

      expect(form1).toBe(form2);
    });
  });

  // ── computeId ──────────────────────────────────────────────────────────

  describe('computeId', () => {
    it('matches the document id field', async () => {
      const { doc } = await buildValidCovenant();

      const computedId = computeId(doc);

      expect(computedId).toBe(doc.id);
    });

    it('changes when document content changes', async () => {
      const { doc } = await buildValidCovenant();

      const id1 = computeId(doc);

      // Modify a field that is part of the canonical form
      const modified = { ...doc, nonce: 'aaaa' };
      const id2 = computeId(modified);

      expect(id1).not.toBe(id2);
    });
  });

  // ── countersignCovenant ────────────────────────────────────────────────

  describe('countersignCovenant', () => {
    it('adds a valid countersignature', async () => {
      const { doc } = await buildValidCovenant();
      const auditorKeyPair = await generateKeyPair();

      const countersigned = await countersignCovenant(doc, auditorKeyPair, 'auditor');

      expect(countersigned.countersignatures).toBeDefined();
      expect(countersigned.countersignatures).toHaveLength(1);
      expect(countersigned.countersignatures![0]!.signerPublicKey).toBe(auditorKeyPair.publicKeyHex);
      expect(countersigned.countersignatures![0]!.signerRole).toBe('auditor');
      expect(countersigned.countersignatures![0]!.signature).toBeTruthy();
      expect(countersigned.countersignatures![0]!.timestamp).toBeTruthy();
    });

    it('countersigned document passes verification', async () => {
      const { doc } = await buildValidCovenant();
      const auditorKeyPair = await generateKeyPair();

      const countersigned = await countersignCovenant(doc, auditorKeyPair, 'auditor');

      const result = await verifyCovenant(countersigned);
      expect(result.valid).toBe(true);

      const csCheck = result.checks.find((c) => c.name === 'countersignatures');
      expect(csCheck).toBeDefined();
      expect(csCheck!.passed).toBe(true);
    });

    it('does not mutate the original document', async () => {
      const { doc } = await buildValidCovenant();
      const auditorKeyPair = await generateKeyPair();

      const originalCountersigs = doc.countersignatures;
      await countersignCovenant(doc, auditorKeyPair, 'auditor');

      expect(doc.countersignatures).toEqual(originalCountersigs);
    });

    it('can add multiple countersignatures', async () => {
      const { doc } = await buildValidCovenant();
      const auditorKeyPair = await generateKeyPair();
      const regulatorKeyPair = await generateKeyPair();

      let signed = await countersignCovenant(doc, auditorKeyPair, 'auditor');
      signed = await countersignCovenant(signed, regulatorKeyPair, 'regulator');

      expect(signed.countersignatures).toHaveLength(2);
      expect(signed.countersignatures![0]!.signerRole).toBe('auditor');
      expect(signed.countersignatures![1]!.signerRole).toBe('regulator');

      const result = await verifyCovenant(signed);
      expect(result.valid).toBe(true);
    });
  });

  // ── resignCovenant ─────────────────────────────────────────────────────

  describe('resignCovenant', () => {
    it('produces a new valid document', async () => {
      const { doc, issuerKeyPair } = await buildValidCovenant();

      const resigned = await resignCovenant(doc, issuerKeyPair.privateKey);

      expect(resigned.id).not.toBe(doc.id);
      expect(resigned.nonce).not.toBe(doc.nonce);
      expect(resigned.signature).not.toBe(doc.signature);

      const result = await verifyCovenant(resigned);
      expect(result.valid).toBe(true);
    });

    it('strips countersignatures on re-sign', async () => {
      const { doc, issuerKeyPair } = await buildValidCovenant();
      const auditorKeyPair = await generateKeyPair();

      const countersigned = await countersignCovenant(doc, auditorKeyPair, 'auditor');
      expect(countersigned.countersignatures).toHaveLength(1);

      const resigned = await resignCovenant(countersigned, issuerKeyPair.privateKey);
      expect(resigned.countersignatures).toBeUndefined();
    });

    it('does not mutate the original document', async () => {
      const { doc, issuerKeyPair } = await buildValidCovenant();
      const originalId = doc.id;
      const originalSig = doc.signature;

      await resignCovenant(doc, issuerKeyPair.privateKey);

      expect(doc.id).toBe(originalId);
      expect(doc.signature).toBe(originalSig);
    });
  });

  // ── CovenantBuildError for missing required fields ─────────────────────

  describe('CovenantBuildError for missing required fields', () => {
    it('throws for missing issuer', async () => {
      const { beneficiaryKeyPair, beneficiary } = await makeParties();
      await expect(
        buildCovenant({
          issuer: undefined as unknown as Issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: beneficiaryKeyPair.privateKey,
        }),
      ).rejects.toThrow(CovenantBuildError);
    });

    it('throws for missing issuer.id', async () => {
      const { issuerKeyPair, beneficiary } = await makeParties();
      await expect(
        buildCovenant({
          issuer: { id: '', publicKey: issuerKeyPair.publicKeyHex, role: 'issuer' },
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
        }),
      ).rejects.toThrow(CovenantBuildError);
    });

    it('throws for missing issuer.publicKey', async () => {
      const { issuerKeyPair, beneficiary } = await makeParties();
      await expect(
        buildCovenant({
          issuer: { id: 'issuer-1', publicKey: '', role: 'issuer' },
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
        }),
      ).rejects.toThrow(CovenantBuildError);
    });

    it('throws when issuer.role is not "issuer"', async () => {
      const { issuerKeyPair, beneficiary } = await makeParties();
      await expect(
        buildCovenant({
          issuer: {
            id: 'issuer-1',
            publicKey: issuerKeyPair.publicKeyHex,
            role: 'beneficiary' as 'issuer',
          },
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
        }),
      ).rejects.toThrow(CovenantBuildError);
    });

    it('throws for missing beneficiary', async () => {
      const { issuerKeyPair, issuer } = await makeParties();
      await expect(
        buildCovenant({
          issuer,
          beneficiary: undefined as unknown as Beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
        }),
      ).rejects.toThrow(CovenantBuildError);
    });

    it('throws for empty constraints', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      await expect(
        buildCovenant({
          issuer,
          beneficiary,
          constraints: '',
          privateKey: issuerKeyPair.privateKey,
        }),
      ).rejects.toThrow(CovenantBuildError);
    });

    it('throws for whitespace-only constraints', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      await expect(
        buildCovenant({
          issuer,
          beneficiary,
          constraints: '   ',
          privateKey: issuerKeyPair.privateKey,
        }),
      ).rejects.toThrow(CovenantBuildError);
    });

    it('throws for missing privateKey', async () => {
      const { issuer, beneficiary } = await makeParties();
      await expect(
        buildCovenant({
          issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: new Uint8Array(0),
        }),
      ).rejects.toThrow(CovenantBuildError);
    });

    it('sets the field property on the error', async () => {
      const { issuerKeyPair, beneficiary } = await makeParties();
      try {
        await buildCovenant({
          issuer: undefined as unknown as Issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
        });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CovenantBuildError);
        expect((err as CovenantBuildError).field).toBe('issuer');
      }
    });
  });

  // ── CovenantBuildError for invalid CCL constraints ─────────────────────

  describe('CovenantBuildError for invalid CCL constraints', () => {
    it('throws for syntactically invalid CCL', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      await expect(
        buildCovenant({
          issuer,
          beneficiary,
          constraints: '!!! not valid CCL !!!',
          privateKey: issuerKeyPair.privateKey,
        }),
      ).rejects.toThrow(CovenantBuildError);
    });

    it('error message includes "constraints" field', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      try {
        await buildCovenant({
          issuer,
          beneficiary,
          constraints: '!!! not valid !!!',
          privateKey: issuerKeyPair.privateKey,
        });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CovenantBuildError);
        expect((err as CovenantBuildError).field).toBe('constraints');
      }
    });
  });

  // ── MemoryChainResolver ────────────────────────────────────────────────

  describe('MemoryChainResolver', () => {
    it('stores and resolves covenants', async () => {
      const { doc } = await buildValidCovenant();
      const resolver = new MemoryChainResolver();

      resolver.add(doc);

      const resolved = await resolver.resolve(doc.id);
      expect(resolved).toEqual(doc);
    });

    it('returns undefined for unknown IDs', async () => {
      const resolver = new MemoryChainResolver();

      const resolved = await resolver.resolve('nonexistent-id');
      expect(resolved).toBeUndefined();
    });
  });

  // ── resolveChain ───────────────────────────────────────────────────────

  describe('resolveChain', () => {
    it('walks parent chain', async () => {
      // Build a root covenant
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();

      const root = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'root'",
        privateKey: issuerKeyPair.privateKey,
      });

      // Build a child that references the root
      const child = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'child'",
        privateKey: issuerKeyPair.privateKey,
        chain: {
          parentId: root.id,
          relation: 'delegates',
          depth: 1,
        },
      });

      // Build a grandchild that references the child
      const grandchild = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'grandchild'",
        privateKey: issuerKeyPair.privateKey,
        chain: {
          parentId: child.id,
          relation: 'restricts',
          depth: 2,
        },
      });

      const resolver = new MemoryChainResolver();
      resolver.add(root);
      resolver.add(child);
      resolver.add(grandchild);

      const ancestors = await resolveChain(grandchild, resolver);

      expect(ancestors).toHaveLength(2);
      expect(ancestors[0]!.id).toBe(child.id);
      expect(ancestors[1]!.id).toBe(root.id);
    });

    it('returns empty array for root covenant (no chain)', async () => {
      const { doc } = await buildValidCovenant();
      const resolver = new MemoryChainResolver();
      resolver.add(doc);

      const ancestors = await resolveChain(doc, resolver);

      expect(ancestors).toHaveLength(0);
    });

    it('stops at maxDepth', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();

      const root = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'root'",
        privateKey: issuerKeyPair.privateKey,
      });

      const child = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'child'",
        privateKey: issuerKeyPair.privateKey,
        chain: {
          parentId: root.id,
          relation: 'delegates',
          depth: 1,
        },
      });

      const grandchild = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'grandchild'",
        privateKey: issuerKeyPair.privateKey,
        chain: {
          parentId: child.id,
          relation: 'delegates',
          depth: 2,
        },
      });

      const resolver = new MemoryChainResolver();
      resolver.add(root);
      resolver.add(child);
      resolver.add(grandchild);

      // Only walk up 1 level
      const ancestors = await resolveChain(grandchild, resolver, 1);

      expect(ancestors).toHaveLength(1);
      expect(ancestors[0]!.id).toBe(child.id);
    });
  });

  // ── serializeCovenant → deserializeCovenant round-trip ─────────────────

  describe('serializeCovenant → deserializeCovenant round-trip', () => {
    it('produces an identical document', async () => {
      const { doc } = await buildValidCovenant();

      const json = serializeCovenant(doc);
      const restored = deserializeCovenant(json);

      expect(restored).toEqual(doc);
    });

    it('deserialized document still passes verification', async () => {
      const { doc } = await buildValidCovenant();

      const json = serializeCovenant(doc);
      const restored = deserializeCovenant(json);

      const result = await verifyCovenant(restored);
      expect(result.valid).toBe(true);
    });

    it('deserializeCovenant throws on invalid JSON', () => {
      expect(() => deserializeCovenant('not json')).toThrow('Invalid JSON');
    });

    it('deserializeCovenant throws on array input', () => {
      expect(() => deserializeCovenant('[]')).toThrow('must be a JSON object');
    });

    it('deserializeCovenant throws on missing required fields', () => {
      expect(() => deserializeCovenant('{}')).toThrow('Missing or invalid required field');
    });

    it('deserializeCovenant throws on wrong protocol version', async () => {
      const { doc } = await buildValidCovenant();
      const json = serializeCovenant(doc);
      const modified = JSON.parse(json);
      modified.version = '99.99';

      expect(() => deserializeCovenant(JSON.stringify(modified))).toThrow(
        'Unsupported protocol version',
      );
    });
  });

  // ── Document size limit ────────────────────────────────────────────────

  describe('Document size limit', () => {
    it('rejects documents exceeding MAX_DOCUMENT_SIZE on build', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();

      // Create a huge metadata field to push past the limit
      const hugeMetadata = {
        name: 'test',
        custom: { payload: 'x'.repeat(MAX_DOCUMENT_SIZE + 1000) },
      };

      await expect(
        buildCovenant({
          issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
          metadata: hugeMetadata,
        }),
      ).rejects.toThrow(CovenantBuildError);
    });

    it('rejects oversized documents on deserialization', async () => {
      // Create a JSON string that exceeds the size limit
      const fakeDoc = {
        id: 'a'.repeat(64),
        version: PROTOCOL_VERSION,
        issuer: { id: 'x', publicKey: 'y', role: 'issuer' },
        beneficiary: { id: 'x', publicKey: 'y', role: 'beneficiary' },
        constraints: "permit read on 'x'",
        nonce: 'n',
        createdAt: '2024-01-01T00:00:00.000Z',
        signature: 's',
        metadata: { custom: { payload: 'x'.repeat(MAX_DOCUMENT_SIZE + 1000) } },
      };

      expect(() => deserializeCovenant(JSON.stringify(fakeDoc))).toThrow(
        'exceeds maximum',
      );
    });

    it('verifyCovenant checks document size', async () => {
      const { doc } = await buildValidCovenant();

      // Verification of a normal-sized document passes the size check
      const result = await verifyCovenant(doc);
      const sizeCheck = result.checks.find((c) => c.name === 'document_size');
      expect(sizeCheck).toBeDefined();
      expect(sizeCheck!.passed).toBe(true);
    });
  });

  // ── Verification check: nonce_present ──────────────────────────────────

  describe('verifyCovenant nonce checks', () => {
    it('fails when nonce is empty', async () => {
      const { doc } = await buildValidCovenant();

      const tampered = { ...doc, nonce: '' };

      const result = await verifyCovenant(tampered);
      const nonceCheck = result.checks.find((c) => c.name === 'nonce_present');
      expect(nonceCheck).toBeDefined();
      expect(nonceCheck!.passed).toBe(false);
    });
  });

  // ── Verification check: active ─────────────────────────────────────────

  describe('verifyCovenant activation time', () => {
    it('fails for a covenant not yet active', async () => {
      const { doc } = await buildValidCovenant({
        activatesAt: '2099-12-31T00:00:00.000Z',
      });

      const result = await verifyCovenant(doc);

      const activeCheck = result.checks.find((c) => c.name === 'active');
      expect(activeCheck).toBeDefined();
      expect(activeCheck!.passed).toBe(false);
    });

    it('passes for a covenant that has activated', async () => {
      const { doc } = await buildValidCovenant({
        activatesAt: '2000-01-01T00:00:00.000Z',
      });

      const result = await verifyCovenant(doc);

      const activeCheck = result.checks.find((c) => c.name === 'active');
      expect(activeCheck).toBeDefined();
      expect(activeCheck!.passed).toBe(true);
    });
  });

  // ── Verification check: enforcement_valid ──────────────────────────────

  describe('verifyCovenant enforcement validation', () => {
    it('passes for valid enforcement types', async () => {
      const { doc } = await buildValidCovenant({
        enforcement: { type: 'capability', config: {} },
      });

      const result = await verifyCovenant(doc);
      const enfCheck = result.checks.find((c) => c.name === 'enforcement_valid');
      expect(enfCheck).toBeDefined();
      expect(enfCheck!.passed).toBe(true);
    });
  });

  // ── Verification check: proof_valid ────────────────────────────────────

  describe('verifyCovenant proof validation', () => {
    it('passes for valid proof types', async () => {
      const { doc } = await buildValidCovenant({
        proof: { type: 'zkp', config: {} },
      });

      const result = await verifyCovenant(doc);
      const proofCheck = result.checks.find((c) => c.name === 'proof_valid');
      expect(proofCheck).toBeDefined();
      expect(proofCheck!.passed).toBe(true);
    });
  });

  // ── Verification check: chain_depth ────────────────────────────────────

  describe('verifyCovenant chain depth', () => {
    it('passes for valid chain depth', async () => {
      const { doc: root } = await buildValidCovenant();

      const { doc } = await buildValidCovenant({
        chain: { parentId: root.id, relation: 'delegates', depth: 1 },
      });

      const result = await verifyCovenant(doc);
      const depthCheck = result.checks.find((c) => c.name === 'chain_depth');
      expect(depthCheck).toBeDefined();
      expect(depthCheck!.passed).toBe(true);
    });
  });

  // ── Error class properties ─────────────────────────────────────────────

  describe('CovenantBuildError', () => {
    it('has the correct name and field properties', () => {
      const err = new CovenantBuildError('test message', 'testField');
      expect(err.name).toBe('CovenantBuildError');
      expect(err.field).toBe('testField');
      expect(err.message).toBe('test message');
      expect(err instanceof Error).toBe(true);
    });
  });
});
