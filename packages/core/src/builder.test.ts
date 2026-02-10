import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '@stele/crypto';
import type { KeyPair } from '@stele/crypto';

import {
  CovenantBuildError,
  verifyCovenant,
} from './index';

import { CovenantBuilder } from './builder';

import type {
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
    id: 'alice',
    publicKey: issuerKeyPair.publicKeyHex,
    role: 'issuer',
    name: 'Alice',
  };

  const beneficiary: Beneficiary = {
    id: 'bob',
    publicKey: beneficiaryKeyPair.publicKeyHex,
    role: 'beneficiary',
    name: 'Bob',
  };

  return { issuerKeyPair, beneficiaryKeyPair, issuer, beneficiary };
}

function validConstraints(): string {
  return "permit read on '/data/**'";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CovenantBuilder', () => {
  // ── 1. Happy path: full chain ──────────────────────────────────────────

  it('builds a valid document with all fields via chaining', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();
    const expires = new Date(Date.now() + 86_400_000).toISOString();

    const doc = await new CovenantBuilder()
      .issuer(issuer)
      .beneficiary(beneficiary)
      .constraints(validConstraints())
      .privateKey(issuerKeyPair.privateKey)
      .expiresAt(expires)
      .metadata({ purpose: 'test' } as any)
      .chain({ parentId: 'a'.repeat(64), relation: 'delegation' as any, depth: 1 })
      .enforcement({ type: 'audit', config: {} })
      .build();

    expect(doc).toBeDefined();
    expect(doc.id).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.issuer.id).toBe('alice');
    expect(doc.beneficiary.id).toBe('bob');
    expect(doc.constraints).toBe(validConstraints());
    expect(doc.expiresAt).toBe(expires);
    expect(doc.metadata).toEqual({ purpose: 'test' });
    expect(doc.chain?.parentId).toBe('a'.repeat(64));
    expect(doc.enforcement?.type).toBe('audit');

    const result = await verifyCovenant(doc);
    expect(result.valid).toBe(true);
  });

  // ── 2. Minimal required fields only ────────────────────────────────────

  it('builds a valid document with only the four required fields', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();

    const doc = await new CovenantBuilder()
      .issuer(issuer)
      .beneficiary(beneficiary)
      .constraints(validConstraints())
      .privateKey(issuerKeyPair.privateKey)
      .build();

    expect(doc.id).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.signature).toMatch(/^[0-9a-f]{128}$/);

    const result = await verifyCovenant(doc);
    expect(result.valid).toBe(true);
  });

  // ── 3-6. Missing required fields (each one) ───────────────────────────

  it('throws CovenantBuildError when issuer is missing', async () => {
    const { issuerKeyPair, beneficiary } = await makeParties();

    await expect(
      new CovenantBuilder()
        .beneficiary(beneficiary)
        .constraints(validConstraints())
        .privateKey(issuerKeyPair.privateKey)
        .build(),
    ).rejects.toThrow(CovenantBuildError);

    try {
      await new CovenantBuilder()
        .beneficiary(beneficiary)
        .constraints(validConstraints())
        .privateKey(issuerKeyPair.privateKey)
        .build();
    } catch (err) {
      expect((err as CovenantBuildError).field).toBe('issuer');
    }
  });

  it('throws CovenantBuildError when beneficiary is missing', async () => {
    const { issuerKeyPair, issuer } = await makeParties();

    await expect(
      new CovenantBuilder()
        .issuer(issuer)
        .constraints(validConstraints())
        .privateKey(issuerKeyPair.privateKey)
        .build(),
    ).rejects.toThrow(CovenantBuildError);

    try {
      await new CovenantBuilder()
        .issuer(issuer)
        .constraints(validConstraints())
        .privateKey(issuerKeyPair.privateKey)
        .build();
    } catch (err) {
      expect((err as CovenantBuildError).field).toBe('beneficiary');
    }
  });

  it('throws CovenantBuildError when constraints is missing', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();

    await expect(
      new CovenantBuilder()
        .issuer(issuer)
        .beneficiary(beneficiary)
        .privateKey(issuerKeyPair.privateKey)
        .build(),
    ).rejects.toThrow(CovenantBuildError);

    try {
      await new CovenantBuilder()
        .issuer(issuer)
        .beneficiary(beneficiary)
        .privateKey(issuerKeyPair.privateKey)
        .build();
    } catch (err) {
      expect((err as CovenantBuildError).field).toBe('constraints');
    }
  });

  it('throws CovenantBuildError when privateKey is missing', async () => {
    const { issuer, beneficiary } = await makeParties();

    await expect(
      new CovenantBuilder()
        .issuer(issuer)
        .beneficiary(beneficiary)
        .constraints(validConstraints())
        .build(),
    ).rejects.toThrow(CovenantBuildError);

    try {
      await new CovenantBuilder()
        .issuer(issuer)
        .beneficiary(beneficiary)
        .constraints(validConstraints())
        .build();
    } catch (err) {
      expect((err as CovenantBuildError).field).toBe('privateKey');
    }
  });

  // ── 7. Optional fields: expiresAt ──────────────────────────────────────

  it('includes expiresAt when set', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();
    const expires = '2099-12-31T23:59:59.000Z';

    const doc = await new CovenantBuilder()
      .issuer(issuer)
      .beneficiary(beneficiary)
      .constraints(validConstraints())
      .privateKey(issuerKeyPair.privateKey)
      .expiresAt(expires)
      .build();

    expect(doc.expiresAt).toBe(expires);
  });

  // ── 8. Optional fields: activatesAt ────────────────────────────────────

  it('includes activatesAt when set', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();
    const activates = '2020-01-01T00:00:00.000Z';

    const doc = await new CovenantBuilder()
      .issuer(issuer)
      .beneficiary(beneficiary)
      .constraints(validConstraints())
      .privateKey(issuerKeyPair.privateKey)
      .activatesAt(activates)
      .build();

    expect(doc.activatesAt).toBe(activates);
  });

  // ── 9. Optional fields: proof ──────────────────────────────────────────

  it('includes proof config when set', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();

    const doc = await new CovenantBuilder()
      .issuer(issuer)
      .beneficiary(beneficiary)
      .constraints(validConstraints())
      .privateKey(issuerKeyPair.privateKey)
      .proof({ type: 'audit_log', config: { interval: 30 } })
      .build();

    expect(doc.proof?.type).toBe('audit_log');
    expect(doc.proof?.config).toEqual({ interval: 30 });
  });

  // ── 10. Optional fields: revocation ────────────────────────────────────

  it('includes revocation config when set', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();

    const doc = await new CovenantBuilder()
      .issuer(issuer)
      .beneficiary(beneficiary)
      .constraints(validConstraints())
      .privateKey(issuerKeyPair.privateKey)
      .revocation({ method: 'crl' })
      .build();

    expect(doc.revocation?.method).toBe('crl');
  });

  // ── 11. Optional fields: obligations ───────────────────────────────────

  it('includes obligations when set', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();

    const doc = await new CovenantBuilder()
      .issuer(issuer)
      .beneficiary(beneficiary)
      .constraints(validConstraints())
      .privateKey(issuerKeyPair.privateKey)
      .obligations([{ id: 'ob-1', description: 'Must audit', action: 'audit' }])
      .build();

    expect(doc.obligations).toHaveLength(1);
    expect(doc.obligations![0]!.id).toBe('ob-1');
  });

  // ── 12. Method chaining order does not matter ──────────────────────────

  it('produces a valid document regardless of method call order', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();

    // Call methods in reverse order compared to the typical pattern
    const doc = await new CovenantBuilder()
      .privateKey(issuerKeyPair.privateKey)
      .enforcement({ type: 'monitor', config: {} })
      .metadata({ name: 'reversed' })
      .constraints(validConstraints())
      .expiresAt('2099-12-31T23:59:59.000Z')
      .beneficiary(beneficiary)
      .issuer(issuer)
      .build();

    expect(doc.id).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.issuer.id).toBe('alice');
    expect(doc.enforcement?.type).toBe('monitor');
    expect(doc.metadata?.name).toBe('reversed');

    const result = await verifyCovenant(doc);
    expect(result.valid).toBe(true);
  });

  // ── 13. reset() clears all fields ──────────────────────────────────────

  it('reset() clears all fields so build throws for missing required fields', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();

    const builder = new CovenantBuilder()
      .issuer(issuer)
      .beneficiary(beneficiary)
      .constraints(validConstraints())
      .privateKey(issuerKeyPair.privateKey)
      .expiresAt('2099-12-31T23:59:59.000Z')
      .metadata({ name: 'before-reset' })
      .chain({ parentId: 'a'.repeat(64), relation: 'delegates', depth: 1 })
      .enforcement({ type: 'audit', config: {} })
      .proof({ type: 'zkp', config: {} })
      .revocation({ method: 'crl' })
      .obligations([{ id: 'ob-1', description: 'x', action: 'y' }]);

    builder.reset();

    // After reset, build should fail because required fields are missing
    await expect(builder.build()).rejects.toThrow(CovenantBuildError);
  });

  // ── 14. reset() returns this for chaining ──────────────────────────────

  it('reset() returns the builder for continued chaining', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();

    const doc = await new CovenantBuilder()
      .issuer(issuer)
      .constraints('invalid')
      .reset()
      .issuer(issuer)
      .beneficiary(beneficiary)
      .constraints(validConstraints())
      .privateKey(issuerKeyPair.privateKey)
      .build();

    expect(doc.id).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── 15. Multiple builds produce different nonces and IDs ───────────────

  it('multiple calls to build() produce different nonces and IDs', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();

    const builder = new CovenantBuilder()
      .issuer(issuer)
      .beneficiary(beneficiary)
      .constraints(validConstraints())
      .privateKey(issuerKeyPair.privateKey);

    const doc1 = await builder.build();
    const doc2 = await builder.build();

    expect(doc1.nonce).not.toBe(doc2.nonce);
    expect(doc1.id).not.toBe(doc2.id);
    expect(doc1.signature).not.toBe(doc2.signature);
  });

  // ── 16. Builder can be reused after reset with new values ──────────────

  it('builder can be reused after reset with entirely new values', async () => {
    const parties1 = await makeParties();
    const parties2 = await makeParties();

    const builder = new CovenantBuilder();

    const doc1 = await builder
      .issuer(parties1.issuer)
      .beneficiary(parties1.beneficiary)
      .constraints(validConstraints())
      .privateKey(parties1.issuerKeyPair.privateKey)
      .build();

    builder.reset();

    const doc2 = await builder
      .issuer(parties2.issuer)
      .beneficiary(parties2.beneficiary)
      .constraints("permit write on '/logs/**'")
      .privateKey(parties2.issuerKeyPair.privateKey)
      .build();

    expect(doc1.issuer.id).toBe('alice');
    expect(doc2.issuer.id).toBe('alice');
    expect(doc1.id).not.toBe(doc2.id);
    expect(doc1.constraints).not.toBe(doc2.constraints);

    const result1 = await verifyCovenant(doc1);
    const result2 = await verifyCovenant(doc2);
    expect(result1.valid).toBe(true);
    expect(result2.valid).toBe(true);
  });

  // ── 17. Error has correct name property ────────────────────────────────

  it('CovenantBuildError from builder has the correct error name', async () => {
    try {
      await new CovenantBuilder().build();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CovenantBuildError);
      expect((err as CovenantBuildError).name).toBe('CovenantBuildError');
    }
  });

  // ── 18. Build delegates validation to buildCovenant for deeper checks ──

  it('delegates deep validation to buildCovenant (invalid CCL syntax)', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();

    await expect(
      new CovenantBuilder()
        .issuer(issuer)
        .beneficiary(beneficiary)
        .constraints('!!! garbage CCL !!!')
        .privateKey(issuerKeyPair.privateKey)
        .build(),
    ).rejects.toThrow(CovenantBuildError);

    try {
      await new CovenantBuilder()
        .issuer(issuer)
        .beneficiary(beneficiary)
        .constraints('!!! garbage CCL !!!')
        .privateKey(issuerKeyPair.privateKey)
        .build();
    } catch (err) {
      expect((err as CovenantBuildError).field).toBe('constraints');
    }
  });

  // ── 19. Every setter returns the same builder instance ─────────────────

  it('every setter method returns the same builder instance', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();

    const builder = new CovenantBuilder();

    expect(builder.issuer(issuer)).toBe(builder);
    expect(builder.beneficiary(beneficiary)).toBe(builder);
    expect(builder.constraints(validConstraints())).toBe(builder);
    expect(builder.privateKey(issuerKeyPair.privateKey)).toBe(builder);
    expect(builder.expiresAt('2099-12-31T23:59:59.000Z')).toBe(builder);
    expect(builder.activatesAt('2020-01-01T00:00:00.000Z')).toBe(builder);
    expect(builder.metadata({ name: 'test' })).toBe(builder);
    expect(builder.chain({ parentId: 'a'.repeat(64), relation: 'delegates', depth: 1 })).toBe(builder);
    expect(builder.enforcement({ type: 'audit', config: {} })).toBe(builder);
    expect(builder.proof({ type: 'zkp', config: {} })).toBe(builder);
    expect(builder.revocation({ method: 'crl' })).toBe(builder);
    expect(builder.obligations([{ id: 'ob-1', description: 'x', action: 'y' }])).toBe(builder);
    expect(builder.reset()).toBe(builder);
  });

  // ── 20. Optional fields are omitted from the document when not set ─────

  it('omits optional fields from the document when they are not set', async () => {
    const { issuerKeyPair, issuer, beneficiary } = await makeParties();

    const doc = await new CovenantBuilder()
      .issuer(issuer)
      .beneficiary(beneficiary)
      .constraints(validConstraints())
      .privateKey(issuerKeyPair.privateKey)
      .build();

    expect(doc.expiresAt).toBeUndefined();
    expect(doc.activatesAt).toBeUndefined();
    expect(doc.metadata).toBeUndefined();
    expect(doc.chain).toBeUndefined();
    expect(doc.enforcement).toBeUndefined();
    expect(doc.proof).toBeUndefined();
    expect(doc.revocation).toBeUndefined();
    expect(doc.obligations).toBeUndefined();
  });
});
