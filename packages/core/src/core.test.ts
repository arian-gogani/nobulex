import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '@nobulex/crypto';
import type { KeyPair } from '@nobulex/crypto';

import {
  buildCovenant,
  verifyCovenant,
  canonicalForm,
  computeId,
  countersignCovenant,
  resignCovenant,
  serializeCovenant,
  deserializeCovenant,
  computeEffectiveConstraints,
  validateChainNarrowing,
  CovenantBuildError,
  CovenantVerificationError,
  MemoryChainResolver,
  resolveChain,
  PROTOCOL_VERSION,
  MAX_DOCUMENT_SIZE,
  MAX_CHAIN_DEPTH,
  MAX_CONSTRAINTS,
} from './index';

import type {
  CovenantDocument,
  CovenantBuilderOptions,
  Issuer,
  Beneficiary,
  ChainReference,
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

describe('@nobulex/core', () => {
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
        reordered[key] = (doc as unknown as Record<string, unknown>)[key];
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

  // ── buildCovenant edge cases (expanded) ─────────────────────────────────

  describe('buildCovenant edge cases', () => {
    it('throws for missing beneficiary.id', async () => {
      const { issuerKeyPair, issuer, beneficiaryKeyPair } = await makeParties();
      await expect(
        buildCovenant({
          issuer,
          beneficiary: { id: '', publicKey: beneficiaryKeyPair.publicKeyHex, role: 'beneficiary' },
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
        }),
      ).rejects.toThrow(CovenantBuildError);

      try {
        await buildCovenant({
          issuer,
          beneficiary: { id: '', publicKey: beneficiaryKeyPair.publicKeyHex, role: 'beneficiary' },
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
        });
      } catch (err) {
        expect((err as CovenantBuildError).field).toBe('beneficiary.id');
      }
    });

    it('throws for missing beneficiary.publicKey', async () => {
      const { issuerKeyPair, issuer } = await makeParties();
      await expect(
        buildCovenant({
          issuer,
          beneficiary: { id: 'ben-1', publicKey: '', role: 'beneficiary' },
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
        }),
      ).rejects.toThrow(CovenantBuildError);

      try {
        await buildCovenant({
          issuer,
          beneficiary: { id: 'ben-1', publicKey: '', role: 'beneficiary' },
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
        });
      } catch (err) {
        expect((err as CovenantBuildError).field).toBe('beneficiary.publicKey');
      }
    });

    it('throws when beneficiary.role is not "beneficiary"', async () => {
      const { issuerKeyPair, issuer, beneficiaryKeyPair } = await makeParties();
      await expect(
        buildCovenant({
          issuer,
          beneficiary: {
            id: 'ben-1',
            publicKey: beneficiaryKeyPair.publicKeyHex,
            role: 'issuer' as 'beneficiary',
          },
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
        }),
      ).rejects.toThrow(CovenantBuildError);

      try {
        await buildCovenant({
          issuer,
          beneficiary: {
            id: 'ben-1',
            publicKey: beneficiaryKeyPair.publicKeyHex,
            role: 'issuer' as 'beneficiary',
          },
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
        });
      } catch (err) {
        expect((err as CovenantBuildError).field).toBe('beneficiary.role');
      }
    });

    it('throws for chain with missing parentId', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      await expect(
        buildCovenant({
          issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
          chain: { parentId: '', relation: 'delegates', depth: 1 } as ChainReference,
        }),
      ).rejects.toThrow(CovenantBuildError);

      try {
        await buildCovenant({
          issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
          chain: { parentId: '', relation: 'delegates', depth: 1 } as ChainReference,
        });
      } catch (err) {
        expect((err as CovenantBuildError).field).toBe('chain.parentId');
      }
    });

    it('throws for chain with missing relation', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      await expect(
        buildCovenant({
          issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
          chain: { parentId: 'a'.repeat(64), relation: '' as 'delegates', depth: 1 },
        }),
      ).rejects.toThrow(CovenantBuildError);

      try {
        await buildCovenant({
          issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
          chain: { parentId: 'a'.repeat(64), relation: '' as 'delegates', depth: 1 },
        });
      } catch (err) {
        expect((err as CovenantBuildError).field).toBe('chain.relation');
      }
    });

    it('throws for chain.depth < 1', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      await expect(
        buildCovenant({
          issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
          chain: { parentId: 'a'.repeat(64), relation: 'delegates', depth: 0 },
        }),
      ).rejects.toThrow(CovenantBuildError);

      try {
        await buildCovenant({
          issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
          chain: { parentId: 'a'.repeat(64), relation: 'delegates', depth: 0 },
        });
      } catch (err) {
        expect((err as CovenantBuildError).field).toBe('chain.depth');
      }
    });

    it('throws for chain.depth exceeding MAX_CHAIN_DEPTH', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      await expect(
        buildCovenant({
          issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
          chain: { parentId: 'a'.repeat(64), relation: 'delegates', depth: MAX_CHAIN_DEPTH + 1 },
        }),
      ).rejects.toThrow(CovenantBuildError);

      try {
        await buildCovenant({
          issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
          chain: { parentId: 'a'.repeat(64), relation: 'delegates', depth: MAX_CHAIN_DEPTH + 1 },
        });
      } catch (err) {
        expect((err as CovenantBuildError).field).toBe('chain.depth');
        expect((err as CovenantBuildError).message).toContain('exceeds maximum');
      }
    });

    it('throws for invalid enforcement type', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      await expect(
        buildCovenant({
          issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
          enforcement: { type: 'invalid_type' as any, config: {} },
        }),
      ).rejects.toThrow(CovenantBuildError);

      try {
        await buildCovenant({
          issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
          enforcement: { type: 'magic' as any, config: {} },
        });
      } catch (err) {
        expect((err as CovenantBuildError).field).toBe('enforcement.type');
      }
    });

    it('throws for invalid proof type', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      await expect(
        buildCovenant({
          issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
          proof: { type: 'invalid_proof' as any, config: {} },
        }),
      ).rejects.toThrow(CovenantBuildError);

      try {
        await buildCovenant({
          issuer,
          beneficiary,
          constraints: validConstraints(),
          privateKey: issuerKeyPair.privateKey,
          proof: { type: 'handshake' as any, config: {} },
        });
      } catch (err) {
        expect((err as CovenantBuildError).field).toBe('proof.type');
      }
    });

    it('accepts all valid enforcement types', async () => {
      const validTypes = ['capability', 'monitor', 'audit', 'bond', 'composite'] as const;
      for (const enfType of validTypes) {
        const { doc } = await buildValidCovenant({
          enforcement: { type: enfType, config: {} },
        });
        expect(doc.enforcement?.type).toBe(enfType);
      }
    });

    it('accepts all valid proof types', async () => {
      const validTypes = ['tee', 'capability_manifest', 'audit_log', 'bond_reference', 'zkp', 'composite'] as const;
      for (const proofType of validTypes) {
        const { doc } = await buildValidCovenant({
          proof: { type: proofType, config: {} },
        });
        expect(doc.proof?.type).toBe(proofType);
      }
    });
  });

  // ── verifyCovenant: all 11 checks failing independently ─────────────────

  describe('verifyCovenant: each check failing independently', () => {
    it('check 1 - id_match fails when ID is wrong', async () => {
      const { doc } = await buildValidCovenant();
      const tampered = { ...doc, id: 'b'.repeat(64) };

      const result = await verifyCovenant(tampered);
      const check = result.checks.find((c) => c.name === 'id_match');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.message).toContain('mismatch');
    });

    it('check 2 - signature_valid fails with corrupted signature', async () => {
      const { doc } = await buildValidCovenant();
      const tampered = { ...doc, signature: '00'.repeat(64) };

      const result = await verifyCovenant(tampered);
      const check = result.checks.find((c) => c.name === 'signature_valid');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.message).toContain('failed');
    });

    it('check 3 - not_expired fails when document has expired', async () => {
      const { doc } = await buildValidCovenant({
        expiresAt: '2000-01-01T00:00:00.000Z',
      });

      const result = await verifyCovenant(doc);
      const check = result.checks.find((c) => c.name === 'not_expired');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.message).toContain('expired');
    });

    it('check 3 - not_expired passes when no expiresAt is set', async () => {
      const { doc } = await buildValidCovenant();

      const result = await verifyCovenant(doc);
      const check = result.checks.find((c) => c.name === 'not_expired');
      expect(check!.passed).toBe(true);
      expect(check!.message).toContain('No expiry set');
    });

    it('check 4 - active fails when activatesAt is in the future', async () => {
      const { doc } = await buildValidCovenant({
        activatesAt: '2099-01-01T00:00:00.000Z',
      });

      const result = await verifyCovenant(doc);
      const check = result.checks.find((c) => c.name === 'active');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.message).toContain('activates at');
    });

    it('check 4 - active passes when no activatesAt is set', async () => {
      const { doc } = await buildValidCovenant();

      const result = await verifyCovenant(doc);
      const check = result.checks.find((c) => c.name === 'active');
      expect(check!.passed).toBe(true);
      expect(check!.message).toContain('No activation time set');
    });

    it('check 5 - ccl_parses fails with invalid CCL in constraints', async () => {
      const { doc } = await buildValidCovenant();
      // Directly tamper the constraints field (bypasses builder validation)
      const tampered = { ...doc, constraints: '!!!garbage!!!' };

      const result = await verifyCovenant(tampered);
      const check = result.checks.find((c) => c.name === 'ccl_parses');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.message).toContain('CCL parse error');
    });

    it('check 6 - enforcement_valid fails with unknown enforcement type', async () => {
      const { doc } = await buildValidCovenant();
      const tampered = {
        ...doc,
        enforcement: { type: 'nonexistent' as any, config: {} },
      };

      const result = await verifyCovenant(tampered);
      const check = result.checks.find((c) => c.name === 'enforcement_valid');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.message).toContain('Unknown enforcement type');
    });

    it('check 6 - enforcement_valid passes when no enforcement is set', async () => {
      const { doc } = await buildValidCovenant();

      const result = await verifyCovenant(doc);
      const check = result.checks.find((c) => c.name === 'enforcement_valid');
      expect(check!.passed).toBe(true);
      expect(check!.message).toContain('No enforcement config present');
    });

    it('check 7 - proof_valid fails with unknown proof type', async () => {
      const { doc } = await buildValidCovenant();
      const tampered = {
        ...doc,
        proof: { type: 'handshake' as any, config: {} },
      };

      const result = await verifyCovenant(tampered);
      const check = result.checks.find((c) => c.name === 'proof_valid');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.message).toContain('Unknown proof type');
    });

    it('check 7 - proof_valid passes when no proof is set', async () => {
      const { doc } = await buildValidCovenant();

      const result = await verifyCovenant(doc);
      const check = result.checks.find((c) => c.name === 'proof_valid');
      expect(check!.passed).toBe(true);
      expect(check!.message).toContain('No proof config present');
    });

    it('check 8 - chain_depth fails when depth exceeds MAX_CHAIN_DEPTH', async () => {
      const { doc } = await buildValidCovenant();
      const tampered = {
        ...doc,
        chain: { parentId: 'a'.repeat(64), relation: 'delegates' as const, depth: MAX_CHAIN_DEPTH + 5 },
      };

      const result = await verifyCovenant(tampered);
      const check = result.checks.find((c) => c.name === 'chain_depth');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.message).toContain('exceeds maximum');
    });

    it('check 8 - chain_depth passes when no chain is set', async () => {
      const { doc } = await buildValidCovenant();

      const result = await verifyCovenant(doc);
      const check = result.checks.find((c) => c.name === 'chain_depth');
      expect(check!.passed).toBe(true);
      expect(check!.message).toContain('No chain reference present');
    });

    it('check 9 - document_size passes for normal-sized documents', async () => {
      const { doc } = await buildValidCovenant();

      const result = await verifyCovenant(doc);
      const check = result.checks.find((c) => c.name === 'document_size');
      expect(check!.passed).toBe(true);
      expect(check!.message).toContain('within limit');
    });

    it('check 10 - countersignatures fails with invalid countersignature', async () => {
      const { doc } = await buildValidCovenant();
      const tampered = {
        ...doc,
        countersignatures: [
          {
            signerPublicKey: 'aa'.repeat(32),
            signerRole: 'auditor' as const,
            signature: 'ff'.repeat(64),
            timestamp: new Date().toISOString(),
          },
        ],
      };

      const result = await verifyCovenant(tampered);
      const check = result.checks.find((c) => c.name === 'countersignatures');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.message).toContain('Invalid countersignature');
    });

    it('check 10 - countersignatures passes when none present', async () => {
      const { doc } = await buildValidCovenant();

      const result = await verifyCovenant(doc);
      const check = result.checks.find((c) => c.name === 'countersignatures');
      expect(check!.passed).toBe(true);
      expect(check!.message).toContain('No countersignatures present');
    });

    it('check 11 - nonce_present fails with malformed nonce (too short)', async () => {
      const { doc } = await buildValidCovenant();
      const tampered = { ...doc, nonce: 'abcdef' };

      const result = await verifyCovenant(tampered);
      const check = result.checks.find((c) => c.name === 'nonce_present');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.message).toContain('malformed');
    });

    it('check 11 - nonce_present fails with non-hex characters', async () => {
      const { doc } = await buildValidCovenant();
      // 64 chars but includes non-hex characters
      const tampered = { ...doc, nonce: 'zzzz' + 'a'.repeat(60) };

      const result = await verifyCovenant(tampered);
      const check = result.checks.find((c) => c.name === 'nonce_present');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });

    it('check 11 - nonce_present fails when nonce is empty string', async () => {
      const { doc } = await buildValidCovenant();
      const tampered = { ...doc, nonce: '' };

      const result = await verifyCovenant(tampered);
      const check = result.checks.find((c) => c.name === 'nonce_present');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.message).toContain('missing or empty');
    });

    it('all 11 checks are always present in the result', async () => {
      const { doc } = await buildValidCovenant();
      const result = await verifyCovenant(doc);

      const expectedCheckNames = [
        'id_match',
        'signature_valid',
        'not_expired',
        'active',
        'ccl_parses',
        'enforcement_valid',
        'proof_valid',
        'chain_depth',
        'document_size',
        'countersignatures',
        'nonce_present',
      ];

      expect(result.checks.length).toBe(11);
      for (const name of expectedCheckNames) {
        const check = result.checks.find((c) => c.name === name);
        expect(check).toBeDefined();
      }
    });
  });

  // ── resignCovenant (expanded) ───────────────────────────────────────────

  describe('resignCovenant (expanded)', () => {
    it('produces a 64-char hex nonce different from the original', async () => {
      const { doc, issuerKeyPair } = await buildValidCovenant();
      const resigned = await resignCovenant(doc, issuerKeyPair.privateKey);

      expect(resigned.nonce).toMatch(/^[0-9a-f]{64}$/);
      expect(resigned.nonce).not.toBe(doc.nonce);
    });

    it('produces a new valid 64-char hex ID', async () => {
      const { doc, issuerKeyPair } = await buildValidCovenant();
      const resigned = await resignCovenant(doc, issuerKeyPair.privateKey);

      expect(resigned.id).toMatch(/^[0-9a-f]{64}$/);
      expect(resigned.id).not.toBe(doc.id);
    });

    it('produces a valid 128-char hex signature', async () => {
      const { doc, issuerKeyPair } = await buildValidCovenant();
      const resigned = await resignCovenant(doc, issuerKeyPair.privateKey);

      expect(resigned.signature).toMatch(/^[0-9a-f]{128}$/);
      expect(resigned.signature).not.toBe(doc.signature);
    });

    it('the resigned document ID matches computeId', async () => {
      const { doc, issuerKeyPair } = await buildValidCovenant();
      const resigned = await resignCovenant(doc, issuerKeyPair.privateKey);

      expect(resigned.id).toBe(computeId(resigned));
    });

    it('re-signing twice produces different nonces each time', async () => {
      const { doc, issuerKeyPair } = await buildValidCovenant();
      const resigned1 = await resignCovenant(doc, issuerKeyPair.privateKey);
      const resigned2 = await resignCovenant(doc, issuerKeyPair.privateKey);

      expect(resigned1.nonce).not.toBe(resigned2.nonce);
      expect(resigned1.id).not.toBe(resigned2.id);
    });

    it('preserves all content fields from the original document', async () => {
      const { doc, issuerKeyPair } = await buildValidCovenant({
        metadata: { name: 'test', description: 'A test' },
        enforcement: { type: 'monitor', config: { key: 'val' } },
      });
      const resigned = await resignCovenant(doc, issuerKeyPair.privateKey);

      expect(resigned.version).toBe(doc.version);
      expect(resigned.issuer).toEqual(doc.issuer);
      expect(resigned.beneficiary).toEqual(doc.beneficiary);
      expect(resigned.constraints).toBe(doc.constraints);
      expect(resigned.metadata).toEqual(doc.metadata);
      expect(resigned.enforcement).toEqual(doc.enforcement);
    });
  });

  // ── countersignCovenant (expanded) ──────────────────────────────────────

  describe('countersignCovenant (expanded)', () => {
    it('multiple countersigners all produce valid, individually verifiable signatures', async () => {
      const { doc } = await buildValidCovenant();
      const kp1 = await generateKeyPair();
      const kp2 = await generateKeyPair();
      const kp3 = await generateKeyPair();

      let signed = await countersignCovenant(doc, kp1, 'auditor');
      signed = await countersignCovenant(signed, kp2, 'regulator');
      signed = await countersignCovenant(signed, kp3, 'operator');

      expect(signed.countersignatures).toHaveLength(3);
      expect(signed.countersignatures![0]!.signerPublicKey).toBe(kp1.publicKeyHex);
      expect(signed.countersignatures![1]!.signerPublicKey).toBe(kp2.publicKeyHex);
      expect(signed.countersignatures![2]!.signerPublicKey).toBe(kp3.publicKeyHex);

      const result = await verifyCovenant(signed);
      expect(result.valid).toBe(true);

      const csCheck = result.checks.find((c) => c.name === 'countersignatures');
      expect(csCheck!.passed).toBe(true);
      expect(csCheck!.message).toContain('3 countersignature(s)');
    });

    it('each countersignature has a timestamp', async () => {
      const { doc } = await buildValidCovenant();
      const kp = await generateKeyPair();

      const signed = await countersignCovenant(doc, kp, 'auditor');

      const cs = signed.countersignatures![0]!;
      expect(cs.timestamp).toBeTruthy();
      // Verify it's a valid ISO 8601 date
      expect(new Date(cs.timestamp).toISOString()).toBe(cs.timestamp);
    });

    it('countersignatures survive serialization round-trip', async () => {
      const { doc } = await buildValidCovenant();
      const kp = await generateKeyPair();

      const signed = await countersignCovenant(doc, kp, 'auditor');
      const json = serializeCovenant(signed);
      const restored = deserializeCovenant(json);

      expect(restored.countersignatures).toHaveLength(1);
      expect(restored.countersignatures![0]!.signerPublicKey).toBe(kp.publicKeyHex);

      const result = await verifyCovenant(restored);
      expect(result.valid).toBe(true);
    });
  });

  // ── Chain operations (expanded) ─────────────────────────────────────────

  describe('resolveChain (expanded)', () => {
    it('resolves a 4-level deep chain', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const resolver = new MemoryChainResolver();

      const root = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'root'",
        privateKey: issuerKeyPair.privateKey,
      });
      resolver.add(root);

      const level1 = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'level1'",
        privateKey: issuerKeyPair.privateKey,
        chain: { parentId: root.id, relation: 'delegates', depth: 1 },
      });
      resolver.add(level1);

      const level2 = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'level2'",
        privateKey: issuerKeyPair.privateKey,
        chain: { parentId: level1.id, relation: 'restricts', depth: 2 },
      });
      resolver.add(level2);

      const level3 = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'level3'",
        privateKey: issuerKeyPair.privateKey,
        chain: { parentId: level2.id, relation: 'delegates', depth: 3 },
      });
      resolver.add(level3);

      const ancestors = await resolveChain(level3, resolver);

      expect(ancestors).toHaveLength(3);
      expect(ancestors[0]!.id).toBe(level2.id);
      expect(ancestors[1]!.id).toBe(level1.id);
      expect(ancestors[2]!.id).toBe(root.id);
    });

    it('stops when a parent is not found in the resolver', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const resolver = new MemoryChainResolver();

      // Build a child referencing a non-existent parent
      const child = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'child'",
        privateKey: issuerKeyPair.privateKey,
        chain: { parentId: 'f'.repeat(64), relation: 'delegates', depth: 1 },
      });
      resolver.add(child);

      const ancestors = await resolveChain(child, resolver);
      expect(ancestors).toHaveLength(0);
    });
  });

  // ── computeEffectiveConstraints ─────────────────────────────────────────

  describe('computeEffectiveConstraints', () => {
    it('merges parent and child constraints via deny-wins semantics', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();

      const parent = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/**'\ndeny write on '/system/**' severity critical",
        privateKey: issuerKeyPair.privateKey,
      });

      const child = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/public'",
        privateKey: issuerKeyPair.privateKey,
        chain: { parentId: parent.id, relation: 'restricts', depth: 1 },
      });

      const effective = await computeEffectiveConstraints(child, [parent]);

      // The effective constraints should include denies from parent and permits from both
      expect(effective.denies.length).toBeGreaterThanOrEqual(1);
      expect(effective.permits.length).toBeGreaterThanOrEqual(1);
    });

    it('works with no ancestors (root document only)', async () => {
      const { doc } = await buildValidCovenant();
      const effective = await computeEffectiveConstraints(doc, []);

      expect(effective.permits.length).toBeGreaterThanOrEqual(1);
    });

    it('merges a chain of 3 documents', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();

      const grandparent = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/**'\ndeny delete on '/data/**' severity high",
        privateKey: issuerKeyPair.privateKey,
      });

      const parent = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/reports/**'",
        privateKey: issuerKeyPair.privateKey,
        chain: { parentId: grandparent.id, relation: 'restricts', depth: 1 },
      });

      const child = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/reports/2024'",
        privateKey: issuerKeyPair.privateKey,
        chain: { parentId: parent.id, relation: 'restricts', depth: 2 },
      });

      // ancestors ordered parent-first as resolveChain returns
      const effective = await computeEffectiveConstraints(child, [parent, grandparent]);

      // Should carry the deny from grandparent through the chain
      expect(effective.denies.length).toBeGreaterThanOrEqual(1);
      // Should have permits from all levels
      expect(effective.permits.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── validateChainNarrowing ──────────────────────────────────────────────

  describe('validateChainNarrowing', () => {
    it('valid: child narrows parent by permitting a subset', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();

      const parent = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/**'",
        privateKey: issuerKeyPair.privateKey,
      });

      const child = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/public'",
        privateKey: issuerKeyPair.privateKey,
        chain: { parentId: parent.id, relation: 'restricts', depth: 1 },
      });

      const result = await validateChainNarrowing(child, parent);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('invalid: child permits something the parent denies', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();

      const parent = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "deny write on '/system/**' severity critical",
        privateKey: issuerKeyPair.privateKey,
      });

      const child = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit write on '/system/config'",
        privateKey: issuerKeyPair.privateKey,
        chain: { parentId: parent.id, relation: 'restricts', depth: 1 },
      });

      const result = await validateChainNarrowing(child, parent);
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]!.reason).toContain('denies');
    });

    it('invalid: child permits a broader scope than parent', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();

      const parent = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/reports'",
        privateKey: issuerKeyPair.privateKey,
      });

      const child = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/**'",
        privateKey: issuerKeyPair.privateKey,
        chain: { parentId: parent.id, relation: 'restricts', depth: 1 },
      });

      const result = await validateChainNarrowing(child, parent);
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]!.reason).toContain('not a subset');
    });
  });

  // ── Serialization / deserialization (expanded) ──────────────────────────

  describe('deserializeCovenant (expanded error cases)', () => {
    it('throws on null JSON', () => {
      expect(() => deserializeCovenant('null')).toThrow('must be a JSON object');
    });

    it('throws on a JSON number', () => {
      expect(() => deserializeCovenant('42')).toThrow('must be a JSON object');
    });

    it('throws on a JSON string', () => {
      expect(() => deserializeCovenant('"hello"')).toThrow('must be a JSON object');
    });

    it('throws when issuer is missing', () => {
      const obj = {
        id: 'a'.repeat(64),
        version: PROTOCOL_VERSION,
        beneficiary: { id: 'b', publicKey: 'pk', role: 'beneficiary' },
        constraints: "permit read on 'x'",
        nonce: 'a'.repeat(64),
        createdAt: '2024-01-01T00:00:00.000Z',
        signature: 'a'.repeat(128),
      };
      expect(() => deserializeCovenant(JSON.stringify(obj))).toThrow('issuer');
    });

    it('throws when issuer has wrong role', () => {
      const obj = {
        id: 'a'.repeat(64),
        version: PROTOCOL_VERSION,
        issuer: { id: 'i', publicKey: 'pk', role: 'beneficiary' },
        beneficiary: { id: 'b', publicKey: 'pk', role: 'beneficiary' },
        constraints: "permit read on 'x'",
        nonce: 'a'.repeat(64),
        createdAt: '2024-01-01T00:00:00.000Z',
        signature: 'a'.repeat(128),
      };
      expect(() => deserializeCovenant(JSON.stringify(obj))).toThrow('Invalid issuer');
    });

    it('throws when beneficiary is missing', () => {
      const obj = {
        id: 'a'.repeat(64),
        version: PROTOCOL_VERSION,
        issuer: { id: 'i', publicKey: 'pk', role: 'issuer' },
        constraints: "permit read on 'x'",
        nonce: 'a'.repeat(64),
        createdAt: '2024-01-01T00:00:00.000Z',
        signature: 'a'.repeat(128),
      };
      expect(() => deserializeCovenant(JSON.stringify(obj))).toThrow('beneficiary');
    });

    it('throws when beneficiary has wrong role', () => {
      const obj = {
        id: 'a'.repeat(64),
        version: PROTOCOL_VERSION,
        issuer: { id: 'i', publicKey: 'pk', role: 'issuer' },
        beneficiary: { id: 'b', publicKey: 'pk', role: 'issuer' },
        constraints: "permit read on 'x'",
        nonce: 'a'.repeat(64),
        createdAt: '2024-01-01T00:00:00.000Z',
        signature: 'a'.repeat(128),
      };
      expect(() => deserializeCovenant(JSON.stringify(obj))).toThrow('Invalid beneficiary');
    });

    it('throws when chain is not an object', () => {
      const obj = {
        id: 'a'.repeat(64),
        version: PROTOCOL_VERSION,
        issuer: { id: 'i', publicKey: 'pk', role: 'issuer' },
        beneficiary: { id: 'b', publicKey: 'pk', role: 'beneficiary' },
        constraints: "permit read on 'x'",
        nonce: 'a'.repeat(64),
        createdAt: '2024-01-01T00:00:00.000Z',
        signature: 'a'.repeat(128),
        chain: 'not-an-object',
      };
      expect(() => deserializeCovenant(JSON.stringify(obj))).toThrow('Invalid chain');
    });

    it('throws when chain.parentId is not a string', () => {
      const obj = {
        id: 'a'.repeat(64),
        version: PROTOCOL_VERSION,
        issuer: { id: 'i', publicKey: 'pk', role: 'issuer' },
        beneficiary: { id: 'b', publicKey: 'pk', role: 'beneficiary' },
        constraints: "permit read on 'x'",
        nonce: 'a'.repeat(64),
        createdAt: '2024-01-01T00:00:00.000Z',
        signature: 'a'.repeat(128),
        chain: { parentId: 123, relation: 'delegates', depth: 1 },
      };
      expect(() => deserializeCovenant(JSON.stringify(obj))).toThrow('chain.parentId');
    });

    it('throws when chain.relation is not a string', () => {
      const obj = {
        id: 'a'.repeat(64),
        version: PROTOCOL_VERSION,
        issuer: { id: 'i', publicKey: 'pk', role: 'issuer' },
        beneficiary: { id: 'b', publicKey: 'pk', role: 'beneficiary' },
        constraints: "permit read on 'x'",
        nonce: 'a'.repeat(64),
        createdAt: '2024-01-01T00:00:00.000Z',
        signature: 'a'.repeat(128),
        chain: { parentId: 'a'.repeat(64), relation: 99, depth: 1 },
      };
      expect(() => deserializeCovenant(JSON.stringify(obj))).toThrow('chain.relation');
    });

    it('throws when chain.depth is not a number', () => {
      const obj = {
        id: 'a'.repeat(64),
        version: PROTOCOL_VERSION,
        issuer: { id: 'i', publicKey: 'pk', role: 'issuer' },
        beneficiary: { id: 'b', publicKey: 'pk', role: 'beneficiary' },
        constraints: "permit read on 'x'",
        nonce: 'a'.repeat(64),
        createdAt: '2024-01-01T00:00:00.000Z',
        signature: 'a'.repeat(128),
        chain: { parentId: 'a'.repeat(64), relation: 'delegates', depth: 'one' },
      };
      expect(() => deserializeCovenant(JSON.stringify(obj))).toThrow('chain.depth');
    });

    it('round-trips a document with chain and optional fields', async () => {
      const { doc: root } = await buildValidCovenant();
      const { doc: child } = await buildValidCovenant({
        chain: { parentId: root.id, relation: 'delegates', depth: 1 },
        enforcement: { type: 'monitor', config: { interval: 60 } },
        proof: { type: 'audit_log', config: {} },
        revocation: { method: 'status_endpoint', endpoint: 'https://example.com/status' },
        metadata: { name: 'child-cov', tags: ['test', 'demo'] },
      });

      const json = serializeCovenant(child);
      const restored = deserializeCovenant(json);

      expect(restored).toEqual(child);
      expect(restored.chain?.parentId).toBe(root.id);
      expect(restored.enforcement?.type).toBe('monitor');
      expect(restored.proof?.type).toBe('audit_log');
      expect(restored.revocation?.method).toBe('status_endpoint');
      expect(restored.metadata?.tags).toEqual(['test', 'demo']);

      const result = await verifyCovenant(restored);
      expect(result.valid).toBe(true);
    });
  });

  // ── CovenantVerificationError ───────────────────────────────────────────

  describe('CovenantVerificationError', () => {
    it('has the correct name and checks properties', () => {
      const checks = [
        { name: 'id_match', passed: false, message: 'ID mismatch' },
        { name: 'signature_valid', passed: true, message: 'Signature OK' },
      ];
      const err = new CovenantVerificationError('verification failed', checks);
      expect(err.name).toBe('CovenantVerificationError');
      expect(err.message).toBe('verification failed');
      expect(err.checks).toEqual(checks);
      expect(err instanceof Error).toBe(true);
    });
  });
});
