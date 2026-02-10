/**
 * Regression test suite for known bugs and gotchas discovered during
 * development of the Stele SDK.
 *
 * Each test documents a specific issue that was encountered, along with
 * the correct behavior, to prevent future regressions.
 */

import { describe, it, expect, vi } from 'vitest';
import { generateKeyPair, toHex } from '@stele/crypto';
import { buildCovenant, verifyCovenant, resignCovenant, countersignCovenant, computeId, canonicalForm } from '@stele/core';
import type { CovenantDocument, Issuer, Beneficiary } from '@stele/core';
import { parse, evaluate, merge, validateNarrowing } from '@stele/ccl';
import { MemoryStore } from '@stele/store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeParties() {
  const issuerKp = await generateKeyPair();
  const beneficiaryKp = await generateKeyPair();

  const issuer: Issuer = {
    id: 'issuer-1',
    publicKey: issuerKp.publicKeyHex,
    role: 'issuer',
  };

  const beneficiary: Beneficiary = {
    id: 'beneficiary-1',
    publicKey: beneficiaryKp.publicKeyHex,
    role: 'beneficiary',
  };

  return { issuerKp, beneficiaryKp, issuer, beneficiary };
}

async function makeCovenant(constraints: string): Promise<{
  doc: CovenantDocument;
  issuerKp: Awaited<ReturnType<typeof generateKeyPair>>;
  beneficiaryKp: Awaited<ReturnType<typeof generateKeyPair>>;
}> {
  const { issuerKp, beneficiaryKp, issuer, beneficiary } = await makeParties();
  const doc = await buildCovenant({
    issuer,
    beneficiary,
    constraints,
    privateKey: issuerKp.privateKey,
  });
  return { doc, issuerKp, beneficiaryKp };
}

// ---------------------------------------------------------------------------
// CCL regressions
// ---------------------------------------------------------------------------

describe('CCL regressions', () => {
  it('severity is a RESERVED keyword — cannot be used as a when condition field', () => {
    // "severity" is tokenized as a SEVERITY keyword, not as an IDENTIFIER,
    // so using it as a field name in a when-condition will fail to parse
    // or produce unexpected results.
    expect(() => {
      parse("permit read on '/data' when severity = 'critical'");
    }).toThrow();
  });

  it('risk_level works as a when condition field (the recommended alternative)', () => {
    const doc = parse("permit read on '/data' when risk_level = 'critical'");
    expect(doc.permits.length).toBe(1);
    expect(doc.permits[0]!.condition).toBeDefined();
  });

  it('resource matching is exact: /secrets does NOT match /secrets/key', () => {
    const doc = parse("permit read on '/secrets'");
    const result = evaluate(doc, 'read', '/secrets/key');
    expect(result.permitted).toBe(false);
  });

  it('resource matching: /secrets matches /secrets exactly', () => {
    const doc = parse("permit read on '/secrets'");
    const result = evaluate(doc, 'read', '/secrets');
    expect(result.permitted).toBe(true);
  });

  it('resource matching: /secrets/** matches /secrets/key', () => {
    const doc = parse("permit read on '/secrets/**'");
    const result = evaluate(doc, 'read', '/secrets/key');
    expect(result.permitted).toBe(true);
  });

  it('default deny: when no rules match, evaluate returns { permitted: false }', () => {
    const doc = parse("permit read on '/data'");
    const result = evaluate(doc, 'write', '/data');
    expect(result.permitted).toBe(false);
  });

  it('wildcard ** matches any resource path', () => {
    const doc = parse("permit read on '**'");
    expect(evaluate(doc, 'read', '/anything/at/all').permitted).toBe(true);
    expect(evaluate(doc, 'read', '/').permitted).toBe(true);
    expect(evaluate(doc, 'read', '/a/b/c/d/e').permitted).toBe(true);
  });

  it('deny-wins: when both permit and deny match, deny takes precedence', () => {
    const doc = parse([
      "permit read on '/data'",
      "deny read on '/data'",
    ].join('\n'));
    const result = evaluate(doc, 'read', '/data');
    expect(result.permitted).toBe(false);
  });

  it('empty constraints string now throws a helpful parse error', () => {
    // parse('') now throws a CCLSyntaxError with a helpful message.
    // This is the improved behavior: empty input is caught early with guidance.
    expect(() => parse('')).toThrow('CCL parse error: input is empty');
  });

  it('merge of two identical documents produces equivalent evaluation', () => {
    const ccl = "permit read on '/data'";
    const doc1 = parse(ccl);
    const doc2 = parse(ccl);
    const merged = merge(doc1, doc2);
    // The merged result should still permit reading /data
    const result = evaluate(merged, 'read', '/data');
    expect(result.permitted).toBe(true);
  });

  it('validateNarrowing: child that only adds denies is always valid', () => {
    const parent = parse("permit read on '**'");
    const child = parse([
      "permit read on '**'",
      "deny write on '/system'",
    ].join('\n'));
    const { valid, violations } = validateNarrowing(parent, child);
    expect(valid).toBe(true);
    expect(violations.length).toBe(0);
  });

  it('validateNarrowing: child that permits something parent denies is a violation', () => {
    const parent = parse([
      "permit read on '**'",
      "deny write on '/system'",
    ].join('\n'));
    const child = parse("permit write on '/system'");
    const { valid } = validateNarrowing(parent, child);
    expect(valid).toBe(false);
  });

  it('action matching: file.read does not match file.write', () => {
    const doc = parse("permit file.read on '/data'");
    const result = evaluate(doc, 'file.write', '/data');
    expect(result.permitted).toBe(false);
  });

  it('action wildcard: ** matches any action', () => {
    const doc = parse("permit ** on '/data'");
    expect(evaluate(doc, 'read', '/data').permitted).toBe(true);
    expect(evaluate(doc, 'write', '/data').permitted).toBe(true);
    expect(evaluate(doc, 'file.read.deep', '/data').permitted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Core regressions
// ---------------------------------------------------------------------------

describe('Core regressions', () => {
  it('document with modified constraints after signing fails id_match check', async () => {
    const { doc } = await makeCovenant("permit read on '/data'");
    // Tamper with constraints
    const tampered = { ...doc, constraints: "deny read on '/data'" };
    const result = await verifyCovenant(tampered);
    const idCheck = result.checks.find((c) => c.name === 'id_match');
    expect(idCheck!.passed).toBe(false);
  });

  it('document with modified nonce after signing fails id_match', async () => {
    const { doc } = await makeCovenant("permit read on '/data'");
    const tampered = { ...doc, nonce: '00'.repeat(32) };
    const result = await verifyCovenant(tampered);
    const idCheck = result.checks.find((c) => c.name === 'id_match');
    expect(idCheck!.passed).toBe(false);
  });

  it('countersigned document still passes verification', async () => {
    const { doc, beneficiaryKp } = await makeCovenant("permit read on '/data'");
    const countersigned = await countersignCovenant(doc, beneficiaryKp, 'beneficiary');
    const result = await verifyCovenant(countersigned);
    expect(result.valid).toBe(true);
  });

  it('resignCovenant strips countersignatures', async () => {
    const { doc, issuerKp, beneficiaryKp } = await makeCovenant("permit read on '/data'");
    const countersigned = await countersignCovenant(doc, beneficiaryKp, 'beneficiary');
    expect(countersigned.countersignatures).toBeDefined();
    expect(countersigned.countersignatures!.length).toBe(1);

    const resigned = await resignCovenant(countersigned, issuerKp.privateKey);
    expect(resigned.countersignatures).toBeUndefined();
  });

  it('resignCovenant produces a new valid document', async () => {
    const { doc, issuerKp } = await makeCovenant("permit read on '/data'");
    const resigned = await resignCovenant(doc, issuerKp.privateKey);
    const result = await verifyCovenant(resigned);
    expect(result.valid).toBe(true);
    // Nonce and ID should differ from original
    expect(resigned.nonce).not.toBe(doc.nonce);
    expect(resigned.id).not.toBe(doc.id);
  });

  it('chain depth of 0 is invalid', async () => {
    const { issuerKp, issuer, beneficiary } = await makeParties();
    await expect(
      buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data'",
        privateKey: issuerKp.privateKey,
        chain: {
          parentId: 'abc123',
          relation: 'delegates',
          depth: 0,
        },
      }),
    ).rejects.toThrow();
  });

  it('issuer role must be exactly "issuer", not "Issuer" or "ISSUER"', async () => {
    const kp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    await expect(
      buildCovenant({
        issuer: {
          id: 'test',
          publicKey: kp.publicKeyHex,
          role: 'Issuer' as any,
        },
        beneficiary: {
          id: 'ben',
          publicKey: beneficiaryKp.publicKeyHex,
          role: 'beneficiary',
        },
        constraints: "permit read on '/data'",
        privateKey: kp.privateKey,
      }),
    ).rejects.toThrow();

    await expect(
      buildCovenant({
        issuer: {
          id: 'test',
          publicKey: kp.publicKeyHex,
          role: 'ISSUER' as any,
        },
        beneficiary: {
          id: 'ben',
          publicKey: beneficiaryKp.publicKeyHex,
          role: 'beneficiary',
        },
        constraints: "permit read on '/data'",
        privateKey: kp.privateKey,
      }),
    ).rejects.toThrow();
  });

  it('empty constraints string is rejected by buildCovenant', async () => {
    const { issuerKp, issuer, beneficiary } = await makeParties();
    await expect(
      buildCovenant({
        issuer,
        beneficiary,
        constraints: '',
        privateKey: issuerKp.privateKey,
      }),
    ).rejects.toThrow();
  });

  it('whitespace-only constraints string is rejected by buildCovenant', async () => {
    const { issuerKp, issuer, beneficiary } = await makeParties();
    await expect(
      buildCovenant({
        issuer,
        beneficiary,
        constraints: '   \n\t  ',
        privateKey: issuerKp.privateKey,
      }),
    ).rejects.toThrow();
  });

  it('computeId matches document.id for a valid document', async () => {
    const { doc } = await makeCovenant("permit read on '/data'");
    expect(computeId(doc)).toBe(doc.id);
  });

  it('canonical form excludes id, signature, and countersignatures', async () => {
    const { doc } = await makeCovenant("permit read on '/data'");
    const canonical = canonicalForm(doc);
    const parsed = JSON.parse(canonical);
    expect(parsed.id).toBeUndefined();
    expect(parsed.signature).toBeUndefined();
    expect(parsed.countersignatures).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Store regressions
// ---------------------------------------------------------------------------

describe('Store regressions', () => {
  it('MemoryStore.list with no filter returns all documents', async () => {
    const store = new MemoryStore();
    const { doc: doc1 } = await makeCovenant("permit read on '/a'");
    const { doc: doc2 } = await makeCovenant("permit read on '/b'");
    await store.put(doc1);
    await store.put(doc2);
    const all = await store.list();
    expect(all.length).toBe(2);
  });

  it('MemoryStore.delete returns false for nonexistent ID', async () => {
    const store = new MemoryStore();
    const deleted = await store.delete('nonexistent-id');
    expect(deleted).toBe(false);
  });

  it('MemoryStore.delete returns true for existing ID', async () => {
    const store = new MemoryStore();
    const { doc } = await makeCovenant("permit read on '/a'");
    await store.put(doc);
    const deleted = await store.delete(doc.id);
    expect(deleted).toBe(true);
  });

  it('events fire synchronously during put', async () => {
    const store = new MemoryStore();
    const events: string[] = [];
    store.onEvent((event) => {
      events.push(event.type);
    });
    const { doc } = await makeCovenant("permit read on '/a'");
    await store.put(doc);
    // The event should have fired during the put call, not after
    expect(events).toEqual(['put']);
  });

  it('events fire synchronously during delete', async () => {
    const store = new MemoryStore();
    const { doc } = await makeCovenant("permit read on '/a'");
    await store.put(doc);

    const events: string[] = [];
    store.onEvent((event) => {
      events.push(event.type);
    });
    await store.delete(doc.id);
    expect(events).toEqual(['delete']);
  });

  it('delete event does not fire for nonexistent ID', async () => {
    const store = new MemoryStore();
    const events: string[] = [];
    store.onEvent((event) => {
      events.push(event.type);
    });
    await store.delete('nonexistent');
    expect(events).toEqual([]);
  });

  it('MemoryStore.has returns false after delete', async () => {
    const store = new MemoryStore();
    const { doc } = await makeCovenant("permit read on '/a'");
    await store.put(doc);
    expect(await store.has(doc.id)).toBe(true);
    await store.delete(doc.id);
    expect(await store.has(doc.id)).toBe(false);
  });

  it('MemoryStore.count matches list length', async () => {
    const store = new MemoryStore();
    const { doc: doc1 } = await makeCovenant("permit read on '/a'");
    const { doc: doc2 } = await makeCovenant("permit read on '/b'");
    await store.put(doc1);
    await store.put(doc2);
    const count = await store.count();
    const list = await store.list();
    expect(count).toBe(list.length);
  });

  it('MemoryStore.clear removes all documents', async () => {
    const store = new MemoryStore();
    const { doc } = await makeCovenant("permit read on '/a'");
    await store.put(doc);
    expect(store.size).toBe(1);
    store.clear();
    expect(store.size).toBe(0);
  });

  it('MemoryStore.offEvent stops event delivery', async () => {
    const store = new MemoryStore();
    const events: string[] = [];
    const handler = (event: any) => { events.push(event.type); };
    store.onEvent(handler);
    const { doc: doc1 } = await makeCovenant("permit read on '/a'");
    await store.put(doc1);
    expect(events.length).toBe(1);

    store.offEvent(handler);
    const { doc: doc2 } = await makeCovenant("permit read on '/b'");
    await store.put(doc2);
    // Should still be 1 because the handler was removed
    expect(events.length).toBe(1);
  });
});
