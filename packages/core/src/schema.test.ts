import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '@stele/crypto';

import {
  validateDocumentSchema,
  validatePartySchema,
  validateConstraintsSchema,
  validateChainSchema,
  buildCovenant,
  PROTOCOL_VERSION,
} from './index';

import type { ValidationError, ValidationResult } from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a structurally valid document object for schema tests. */
async function makeValidDocObject(): Promise<Record<string, unknown>> {
  const issuerKp = await generateKeyPair();
  const beneficiaryKp = await generateKeyPair();

  const doc = await buildCovenant({
    issuer: { id: 'issuer-1', publicKey: issuerKp.publicKeyHex, role: 'issuer' },
    beneficiary: { id: 'beneficiary-1', publicKey: beneficiaryKp.publicKeyHex, role: 'beneficiary' },
    constraints: "permit read on 'data'",
    privateKey: issuerKp.privateKey,
  });

  // Return as a plain object (not typed as CovenantDocument)
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
}

function findError(errors: ValidationError[], path: string): ValidationError | undefined {
  return errors.find((e) => e.path === path);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateDocumentSchema', () => {
  // ── Valid document ──────────────────────────────────────────────────────

  it('valid document passes with no errors', async () => {
    const doc = await makeValidDocObject();
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('valid document with optional fields passes', async () => {
    const doc = await makeValidDocObject();
    doc.expiresAt = '2099-12-31T23:59:59.000Z';
    doc.activatesAt = '2020-01-01T00:00:00.000Z';
    doc.metadata = { name: 'test' };
    doc.countersignatures = [];

    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // ── Non-object inputs ──────────────────────────────────────────────────

  it('rejects null', () => {
    const result = validateDocumentSchema(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.message).toContain('must be an object');
  });

  it('rejects an array', () => {
    const result = validateDocumentSchema([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toContain('must be an object');
  });

  it('rejects a string', () => {
    const result = validateDocumentSchema('hello');
    expect(result.valid).toBe(false);
  });

  it('rejects undefined', () => {
    const result = validateDocumentSchema(undefined);
    expect(result.valid).toBe(false);
  });

  // ── Missing required fields ────────────────────────────────────────────

  it('reports error when id is missing', async () => {
    const doc = await makeValidDocObject();
    delete doc.id;
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    const err = findError(result.errors, 'id');
    expect(err).toBeDefined();
    expect(err!.message).toContain('non-empty string');
  });

  it('reports error when id is empty string', async () => {
    const doc = await makeValidDocObject();
    doc.id = '';
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'id')).toBeDefined();
  });

  it('reports error when version is missing', async () => {
    const doc = await makeValidDocObject();
    delete doc.version;
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'version')).toBeDefined();
  });

  it('reports error when version does not match X.Y pattern', async () => {
    const doc = await makeValidDocObject();
    doc.version = 'v1';
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    const err = findError(result.errors, 'version');
    expect(err).toBeDefined();
    expect(err!.message).toContain('X.Y');
  });

  it('reports error when issuer is missing', async () => {
    const doc = await makeValidDocObject();
    delete doc.issuer;
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'issuer')).toBeDefined();
  });

  it('reports error when beneficiary is missing', async () => {
    const doc = await makeValidDocObject();
    delete doc.beneficiary;
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'beneficiary')).toBeDefined();
  });

  it('reports error when constraints is missing', async () => {
    const doc = await makeValidDocObject();
    delete doc.constraints;
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'constraints')).toBeDefined();
  });

  it('reports error when nonce is missing', async () => {
    const doc = await makeValidDocObject();
    delete doc.nonce;
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'nonce')).toBeDefined();
  });

  it('reports error when createdAt is missing', async () => {
    const doc = await makeValidDocObject();
    delete doc.createdAt;
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'createdAt')).toBeDefined();
  });

  it('reports error when signature is missing', async () => {
    const doc = await makeValidDocObject();
    delete doc.signature;
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'signature')).toBeDefined();
  });

  // ── Invalid hex strings ────────────────────────────────────────────────

  it('reports error when nonce is not a 64-char hex', async () => {
    const doc = await makeValidDocObject();
    doc.nonce = 'not-hex';
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    const err = findError(result.errors, 'nonce');
    expect(err).toBeDefined();
    expect(err!.message).toContain('64-character hex');
  });

  it('reports error when nonce is too short hex', async () => {
    const doc = await makeValidDocObject();
    doc.nonce = 'abcdef';
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'nonce')).toBeDefined();
  });

  it('reports error when signature is not hex', async () => {
    const doc = await makeValidDocObject();
    doc.signature = 'not-a-hex-signature!';
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'signature')).toBeDefined();
  });

  it('reports error when signature is empty', async () => {
    const doc = await makeValidDocObject();
    doc.signature = '';
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'signature')).toBeDefined();
  });

  it('reports error when issuer.publicKey is not 64-char hex', async () => {
    const doc = await makeValidDocObject();
    (doc.issuer as Record<string, unknown>).publicKey = 'too-short';
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'issuer.publicKey')).toBeDefined();
  });

  it('reports error when beneficiary.publicKey is not 64-char hex', async () => {
    const doc = await makeValidDocObject();
    (doc.beneficiary as Record<string, unknown>).publicKey = 'GGGG' + 'a'.repeat(60);
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'beneficiary.publicKey')).toBeDefined();
  });

  // ── Invalid ISO dates ──────────────────────────────────────────────────

  it('reports error when createdAt is not valid ISO 8601', async () => {
    const doc = await makeValidDocObject();
    doc.createdAt = 'not-a-date';
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    const err = findError(result.errors, 'createdAt');
    expect(err).toBeDefined();
    expect(err!.message).toContain('ISO 8601');
  });

  it('reports error when expiresAt is present but not valid ISO 8601', async () => {
    const doc = await makeValidDocObject();
    doc.expiresAt = '2099-13-45';
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    const err = findError(result.errors, 'expiresAt');
    expect(err).toBeDefined();
    expect(err!.message).toContain('ISO 8601');
  });

  it('reports error when activatesAt is present but not valid ISO 8601', async () => {
    const doc = await makeValidDocObject();
    doc.activatesAt = 'yesterday';
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    const err = findError(result.errors, 'activatesAt');
    expect(err).toBeDefined();
    expect(err!.message).toContain('ISO 8601');
  });

  // ── Multiple errors returned at once ───────────────────────────────────

  it('returns multiple errors at once when multiple fields are invalid', () => {
    const result = validateDocumentSchema({});

    expect(result.valid).toBe(false);
    // Should have errors for id, version, issuer, beneficiary, constraints, nonce, createdAt, signature
    expect(result.errors.length).toBeGreaterThanOrEqual(8);

    // Check specific paths are all present
    const paths = result.errors.map((e) => e.path);
    expect(paths).toContain('id');
    expect(paths).toContain('version');
    expect(paths).toContain('issuer');
    expect(paths).toContain('beneficiary');
    expect(paths).toContain('constraints');
    expect(paths).toContain('nonce');
    expect(paths).toContain('createdAt');
    expect(paths).toContain('signature');
  });

  it('returns errors for all invalid party subfields at once', async () => {
    const doc = await makeValidDocObject();
    doc.issuer = { id: '', publicKey: 'not-hex', role: '' };
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    const issuerErrors = result.errors.filter((e) => e.path.startsWith('issuer.'));
    expect(issuerErrors.length).toBe(3);
  });

  // ── Optional fields don't error when absent ────────────────────────────

  it('does not report error when chain is absent', async () => {
    const doc = await makeValidDocObject();
    delete doc.chain;
    const result = validateDocumentSchema(doc);

    expect(findError(result.errors, 'chain')).toBeUndefined();
    expect(findError(result.errors, 'chain.parentId')).toBeUndefined();
    expect(findError(result.errors, 'chain.relation')).toBeUndefined();
    expect(findError(result.errors, 'chain.depth')).toBeUndefined();
  });

  it('does not report error when expiresAt is absent', async () => {
    const doc = await makeValidDocObject();
    delete doc.expiresAt;
    const result = validateDocumentSchema(doc);

    expect(findError(result.errors, 'expiresAt')).toBeUndefined();
  });

  it('does not report error when activatesAt is absent', async () => {
    const doc = await makeValidDocObject();
    delete doc.activatesAt;
    const result = validateDocumentSchema(doc);

    expect(findError(result.errors, 'activatesAt')).toBeUndefined();
  });

  it('does not report error when metadata is absent', async () => {
    const doc = await makeValidDocObject();
    delete doc.metadata;
    const result = validateDocumentSchema(doc);

    expect(findError(result.errors, 'metadata')).toBeUndefined();
  });

  it('does not report error when countersignatures is absent', async () => {
    const doc = await makeValidDocObject();
    delete doc.countersignatures;
    const result = validateDocumentSchema(doc);

    expect(findError(result.errors, 'countersignatures')).toBeUndefined();
  });

  // ── Chain validation when present ──────────────────────────────────────

  it('validates chain when present and valid', async () => {
    const doc = await makeValidDocObject();
    doc.chain = {
      parentId: 'a'.repeat(64),
      relation: 'delegates',
      depth: 1,
    };
    const result = validateDocumentSchema(doc);

    expect(findError(result.errors, 'chain.parentId')).toBeUndefined();
    expect(findError(result.errors, 'chain.relation')).toBeUndefined();
    expect(findError(result.errors, 'chain.depth')).toBeUndefined();
  });

  it('reports errors when chain is present but has invalid fields', async () => {
    const doc = await makeValidDocObject();
    doc.chain = {
      parentId: '',
      relation: '',
      depth: 0,
    };
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'chain.parentId')).toBeDefined();
    expect(findError(result.errors, 'chain.relation')).toBeDefined();
    expect(findError(result.errors, 'chain.depth')).toBeDefined();
  });

  it('reports error when chain is not an object', async () => {
    const doc = await makeValidDocObject();
    doc.chain = 'not-an-object';
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'chain')).toBeDefined();
  });

  it('reports error when chain.depth is negative', async () => {
    const doc = await makeValidDocObject();
    doc.chain = { parentId: 'abc', relation: 'delegates', depth: -1 };
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'chain.depth')).toBeDefined();
  });

  it('reports error when chain.depth is a float', async () => {
    const doc = await makeValidDocObject();
    doc.chain = { parentId: 'abc', relation: 'delegates', depth: 1.5 };
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    const err = findError(result.errors, 'chain.depth');
    expect(err).toBeDefined();
    expect(err!.message).toContain('positive integer');
  });

  // ── Deeply nested error paths ──────────────────────────────────────────

  it('produces dot-delimited error paths for nested party fields', async () => {
    const doc = await makeValidDocObject();
    (doc.issuer as Record<string, unknown>).publicKey = 'bad';
    (doc.beneficiary as Record<string, unknown>).id = '';

    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'issuer.publicKey')).toBeDefined();
    expect(findError(result.errors, 'beneficiary.id')).toBeDefined();
  });

  it('error objects include the actual value', async () => {
    const doc = await makeValidDocObject();
    doc.nonce = 12345;
    const result = validateDocumentSchema(doc);

    const err = findError(result.errors, 'nonce');
    expect(err).toBeDefined();
    expect(err!.value).toBe(12345);
  });

  // ── metadata validation ────────────────────────────────────────────────

  it('reports error when metadata is not an object', async () => {
    const doc = await makeValidDocObject();
    doc.metadata = 'string-meta';
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'metadata')).toBeDefined();
  });

  it('reports error when metadata is an array', async () => {
    const doc = await makeValidDocObject();
    doc.metadata = [1, 2, 3];
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'metadata')).toBeDefined();
  });

  // ── countersignatures validation ───────────────────────────────────────

  it('reports error when countersignatures is not an array', async () => {
    const doc = await makeValidDocObject();
    doc.countersignatures = 'not-array';
    const result = validateDocumentSchema(doc);

    expect(result.valid).toBe(false);
    expect(findError(result.errors, 'countersignatures')).toBeDefined();
  });

  // ── version pattern ────────────────────────────────────────────────────

  it('accepts valid version patterns', async () => {
    const doc = await makeValidDocObject();

    for (const v of ['1.0', '0.1', '2.5', '10.20']) {
      doc.version = v;
      const result = validateDocumentSchema(doc);
      expect(findError(result.errors, 'version')).toBeUndefined();
    }
  });

  it('rejects invalid version patterns', async () => {
    const doc = await makeValidDocObject();

    for (const v of ['1', '1.0.0', 'v1.0', 'abc', '']) {
      doc.version = v;
      const result = validateDocumentSchema(doc);
      expect(findError(result.errors, 'version')).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Standalone party validator
// ---------------------------------------------------------------------------

describe('validatePartySchema', () => {
  it('returns no errors for a valid party', async () => {
    const kp = await generateKeyPair();
    const errors = validatePartySchema(
      { id: 'party-1', publicKey: kp.publicKeyHex, role: 'issuer' },
      'issuer',
    );
    expect(errors).toHaveLength(0);
  });

  it('returns error when party is null', () => {
    const errors = validatePartySchema(null, 'issuer');
    expect(errors.length).toBe(1);
    expect(errors[0]!.path).toBe('issuer');
    expect(errors[0]!.message).toContain('must be an object');
  });

  it('returns error when party is a string', () => {
    const errors = validatePartySchema('not-an-object', 'beneficiary');
    expect(errors.length).toBe(1);
    expect(errors[0]!.path).toBe('beneficiary');
  });

  it('reports all three sub-field errors at once', () => {
    const errors = validatePartySchema({ id: '', publicKey: 'bad', role: '' }, 'issuer');
    expect(errors.length).toBe(3);
    expect(errors.map((e) => e.path)).toContain('issuer.id');
    expect(errors.map((e) => e.path)).toContain('issuer.publicKey');
    expect(errors.map((e) => e.path)).toContain('issuer.role');
  });

  it('uses the provided path prefix', () => {
    const errors = validatePartySchema(null, 'custom.nested.party');
    expect(errors[0]!.path).toBe('custom.nested.party');
  });
});

// ---------------------------------------------------------------------------
// Standalone constraints validator
// ---------------------------------------------------------------------------

describe('validateConstraintsSchema', () => {
  it('returns no errors for a valid constraints string', () => {
    const errors = validateConstraintsSchema("permit read on '/data/**'");
    expect(errors).toHaveLength(0);
  });

  it('returns error for non-string', () => {
    const errors = validateConstraintsSchema(123);
    expect(errors.length).toBe(1);
    expect(errors[0]!.path).toBe('constraints');
  });

  it('returns error for empty string', () => {
    const errors = validateConstraintsSchema('');
    expect(errors.length).toBe(1);
    expect(errors[0]!.message).toContain('non-empty string');
  });

  it('returns error for whitespace-only string', () => {
    const errors = validateConstraintsSchema('   ');
    expect(errors.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Standalone chain validator
// ---------------------------------------------------------------------------

describe('validateChainSchema', () => {
  it('returns no errors for a valid chain', () => {
    const errors = validateChainSchema({
      parentId: 'a'.repeat(64),
      relation: 'delegates',
      depth: 1,
    });
    expect(errors).toHaveLength(0);
  });

  it('returns error when chain is not an object', () => {
    const errors = validateChainSchema('invalid');
    expect(errors.length).toBe(1);
    expect(errors[0]!.path).toBe('chain');
  });

  it('returns errors for all invalid chain fields at once', () => {
    const errors = validateChainSchema({ parentId: '', relation: '', depth: -5 });
    expect(errors.length).toBe(3);
    expect(errors.map((e) => e.path)).toContain('chain.parentId');
    expect(errors.map((e) => e.path)).toContain('chain.relation');
    expect(errors.map((e) => e.path)).toContain('chain.depth');
  });

  it('returns error when depth is not a number', () => {
    const errors = validateChainSchema({ parentId: 'abc', relation: 'del', depth: 'one' });
    expect(errors.length).toBe(1);
    expect(errors[0]!.path).toBe('chain.depth');
    expect(errors[0]!.message).toContain('positive integer');
  });

  it('returns error when depth is zero', () => {
    const errors = validateChainSchema({ parentId: 'abc', relation: 'del', depth: 0 });
    expect(errors.length).toBe(1);
    expect(errors[0]!.path).toBe('chain.depth');
  });

  it('accepts depth of 1', () => {
    const errors = validateChainSchema({ parentId: 'abc', relation: 'del', depth: 1 });
    expect(errors).toHaveLength(0);
  });

  it('accepts large integer depth', () => {
    const errors = validateChainSchema({ parentId: 'abc', relation: 'del', depth: 100 });
    expect(errors).toHaveLength(0);
  });
});
