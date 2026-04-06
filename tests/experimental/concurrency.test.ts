/**
 * Concurrency and stress tests for the Nobulex SDK.
 *
 * Exercises parallel operations, race conditions, and high-volume
 * scenarios across crypto, core, store, verifier, identity,
 * enforcement, and reputation packages.
 */

import { describe, it, expect } from 'vitest';

import {
  generateKeyPair,
  sign,
  verify,
  sha256,
  toHex,
  generateNonce,
} from '@nobulex/crypto';
import type { KeyPair, HashHex } from '@nobulex/crypto';

import {
  buildCovenant,
  verifyCovenant,
  countersignCovenant,
  computeId,
  serializeCovenant,
  deserializeCovenant,
} from '@nobulex/core';
import type { CovenantDocument, Issuer, Beneficiary } from '@nobulex/core';

import { parse, evaluate } from '@nobulex/ccl';

import { MemoryStore } from '@nobulex/store';

import { Verifier, verifyBatch } from '@nobulex/verifier';

import {
  createIdentity,
  evolveIdentity,
  verifyIdentity,
  serializeIdentity,
  deserializeIdentity,
} from '@nobulex/identity';

import {
  Monitor,
  MonitorDeniedError,
  CapabilityGate,
} from '@nobulex/enforcement';

import {
  createReceipt,
  verifyReceipt,
  computeReputationScore,
} from '@nobulex/reputation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssuer(publicKeyHex: string): Issuer {
  return { id: 'issuer-conc', publicKey: publicKeyHex, role: 'issuer' as const };
}

function makeBeneficiary(publicKeyHex: string): Beneficiary {
  return { id: 'beneficiary-conc', publicKey: publicKeyHex, role: 'beneficiary' as const };
}

async function buildSimpleDoc(
  issuerKp: KeyPair,
  beneficiaryKp: KeyPair,
  constraints = "permit read on '/data/**'",
): Promise<CovenantDocument> {
  return buildCovenant({
    issuer: makeIssuer(issuerKp.publicKeyHex),
    beneficiary: makeBeneficiary(beneficiaryKp.publicKeyHex),
    constraints,
    privateKey: issuerKp.privateKey,
  });
}

const encoder = new TextEncoder();

// ===========================================================================
// 1. Parallel Store Operations
// ===========================================================================

describe('Parallel Store Operations', () => {
  it('100 concurrent put operations do not lose data', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    // Pre-build 100 documents
    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 100; i++) {
      docs.push(await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/put-${i}'`));
    }

    // Put all 100 concurrently
    await Promise.all(docs.map((doc) => store.put(doc)));

    expect(store.size).toBe(100);
    for (const doc of docs) {
      const retrieved = await store.get(doc.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(doc.id);
    }
  }, 30_000);

  it('100 concurrent get operations return correct data', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 100; i++) {
      const doc = await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/get-${i}'`);
      docs.push(doc);
      await store.put(doc);
    }

    // Get all 100 concurrently
    const results = await Promise.all(docs.map((doc) => store.get(doc.id)));

    expect(results.length).toBe(100);
    for (let i = 0; i < 100; i++) {
      expect(results[i]).toBeDefined();
      expect(results[i]!.id).toBe(docs[i]!.id);
    }
  }, 30_000);

  it('concurrent put and get on same key always returns valid state', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    // Build two versions of a doc with same constraints but different nonces
    const docA = await buildSimpleDoc(issuerKp, beneficiaryKp);
    const docB = await buildSimpleDoc(issuerKp, beneficiaryKp);

    // Store docA initially
    await store.put(docA);

    // Concurrently: overwrite with docB and read docA's key
    const [, getResult] = await Promise.all([
      store.put(docB),
      store.get(docA.id),
    ]);

    // getResult should be either docA (if read happened before put) or undefined
    // (if put replaced key and docA.id differs from docB.id)
    // Both are valid states -- no corruption
    if (getResult !== undefined) {
      expect(getResult.id).toBe(docA.id);
    }

    // docB should be in the store
    const bResult = await store.get(docB.id);
    expect(bResult).toBeDefined();
    expect(bResult!.id).toBe(docB.id);
  }, 15_000);

  it('concurrent put and delete — final state is consistent', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const doc = await buildSimpleDoc(issuerKp, beneficiaryKp);
    await store.put(doc);

    // Concurrently put (same doc again) and delete
    await Promise.allSettled([
      store.put(doc),
      store.delete(doc.id),
    ]);

    // Final state: either the doc exists or it doesn't -- both are consistent
    const exists = await store.has(doc.id);
    if (exists) {
      const retrieved = await store.get(doc.id);
      expect(retrieved!.id).toBe(doc.id);
    }
    // No matter what, store.size should be 0 or 1
    expect(store.size).toBeLessThanOrEqual(1);
  }, 15_000);

  it('concurrent putBatch operations do not corrupt', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    // Build 3 batches of 30 docs each
    const batches: CovenantDocument[][] = [];
    for (let b = 0; b < 3; b++) {
      const batch: CovenantDocument[] = [];
      for (let i = 0; i < 30; i++) {
        batch.push(await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/batch-${b}-${i}'`));
      }
      batches.push(batch);
    }

    // Put all batches concurrently
    await Promise.all(batches.map((batch) => store.putBatch(batch)));

    expect(store.size).toBe(90);

    // Every document should be retrievable
    for (const batch of batches) {
      for (const doc of batch) {
        expect(await store.has(doc.id)).toBe(true);
      }
    }
  }, 30_000);

  it('concurrent list during mutations returns valid results', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    // Pre-populate with 50 docs
    for (let i = 0; i < 50; i++) {
      await store.put(await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/list-${i}'`));
    }

    // Concurrently: add 10 more docs AND list
    const newDocs: CovenantDocument[] = [];
    for (let i = 0; i < 10; i++) {
      newDocs.push(await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/list-new-${i}'`));
    }

    const [, listResult] = await Promise.all([
      Promise.all(newDocs.map((d) => store.put(d))),
      store.list(),
    ]);

    // List result should be a valid array of documents
    expect(Array.isArray(listResult)).toBe(true);
    expect(listResult.length).toBeGreaterThanOrEqual(50);
    expect(listResult.length).toBeLessThanOrEqual(60);

    // All returned docs should have valid ids
    for (const doc of listResult) {
      expect(doc.id).toBeTruthy();
    }
  }, 30_000);

  it('1000 sequential puts then concurrent getBatch', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 1000; i++) {
      const doc = await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/large-${i}'`);
      docs.push(doc);
    }
    await store.putBatch(docs);
    expect(store.size).toBe(1000);

    // Concurrent getBatch calls (10 batches of 100)
    const batchPromises = Array.from({ length: 10 }, (_, batchIdx) => {
      const ids = docs.slice(batchIdx * 100, (batchIdx + 1) * 100).map((d) => d.id);
      return store.getBatch(ids);
    });

    const results = await Promise.all(batchPromises);

    for (const batch of results) {
      expect(batch.length).toBe(100);
      expect(batch.every((d) => d !== undefined)).toBe(true);
    }
  }, 60_000);

  it('concurrent delete of same key does not throw', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const doc = await buildSimpleDoc(issuerKp, beneficiaryKp);
    await store.put(doc);

    // 10 concurrent deletes of the same key
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => store.delete(doc.id)),
    );

    // None should reject
    for (const result of results) {
      expect(result.status).toBe('fulfilled');
    }

    // Exactly one should have returned true (the one that actually deleted)
    const trueCount = results.filter(
      (r) => r.status === 'fulfilled' && (r as PromiseFulfilledResult<boolean>).value === true,
    ).length;
    expect(trueCount).toBe(1);

    expect(await store.has(doc.id)).toBe(false);
  }, 15_000);

  it('concurrent has checks during mutations', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const doc = await buildSimpleDoc(issuerKp, beneficiaryKp);
    await store.put(doc);

    // Concurrently check has, put, delete, has
    const [has1, , , has2] = await Promise.all([
      store.has(doc.id),
      store.put(doc),
      store.delete(doc.id),
      store.has(doc.id),
    ]);

    // has1 should be true (doc was there before operations)
    expect(has1).toBe(true);
    // has2 could be true or false depending on ordering -- just check it's boolean
    expect(typeof has2).toBe('boolean');
  }, 15_000);

  it('store size is consistent after parallel operations', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    // Build 50 docs
    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 50; i++) {
      docs.push(await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/size-${i}'`));
    }

    // Put all concurrently
    await Promise.all(docs.map((d) => store.put(d)));
    expect(store.size).toBe(50);

    // Delete first 20 concurrently
    await Promise.all(docs.slice(0, 20).map((d) => store.delete(d.id)));
    expect(store.size).toBe(30);

    // Count should agree
    const count = await store.count();
    expect(count).toBe(30);
  }, 30_000);
});

// ===========================================================================
// 2. Parallel Crypto Operations
// ===========================================================================

describe('Parallel Crypto Operations', () => {
  it('50 concurrent generateKeyPair calls all produce unique keys', async () => {
    const keyPairs = await Promise.all(
      Array.from({ length: 50 }, () => generateKeyPair()),
    );

    const publicKeys = new Set(keyPairs.map((kp) => kp.publicKeyHex));
    expect(publicKeys.size).toBe(50);

    for (const kp of keyPairs) {
      expect(kp.privateKey.length).toBe(32);
      expect(kp.publicKey.length).toBe(32);
      expect(kp.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    }
  }, 15_000);

  it('50 concurrent sign operations all produce valid signatures', async () => {
    const kp = await generateKeyPair();
    const messages = Array.from({ length: 50 }, (_, i) =>
      encoder.encode(`message-${i}`),
    );

    const signatures = await Promise.all(
      messages.map((msg) => sign(msg, kp.privateKey)),
    );

    expect(signatures.length).toBe(50);

    // Each signature should be 64 bytes (Ed25519)
    for (const sig of signatures) {
      expect(sig.length).toBe(64);
    }

    // Verify all signatures concurrently
    const verifications = await Promise.all(
      messages.map((msg, i) => verify(msg, signatures[i]!, kp.publicKey)),
    );
    expect(verifications.every((v) => v === true)).toBe(true);
  }, 15_000);

  it('50 concurrent verify operations all return correct results', async () => {
    const kp = await generateKeyPair();
    const message = encoder.encode('shared-message');
    const signature = await sign(message, kp.privateKey);

    // 50 concurrent verifications of the same message/signature
    const results = await Promise.all(
      Array.from({ length: 50 }, () => verify(message, signature, kp.publicKey)),
    );

    expect(results.length).toBe(50);
    expect(results.every((r) => r === true)).toBe(true);
  }, 15_000);

  it('concurrent sign + verify pipeline (sign then immediately verify)', async () => {
    const kp = await generateKeyPair();

    const pipeline = Array.from({ length: 50 }, async (_, i) => {
      const msg = encoder.encode(`pipeline-${i}`);
      const sig = await sign(msg, kp.privateKey);
      const valid = await verify(msg, sig, kp.publicKey);
      return valid;
    });

    const results = await Promise.all(pipeline);
    expect(results.length).toBe(50);
    expect(results.every((v) => v === true)).toBe(true);
  }, 15_000);

  it('concurrent sha256 calls are deterministic', () => {
    const data = encoder.encode('deterministic-test-data');

    const hashes = Array.from({ length: 50 }, () => sha256(data));

    // All hashes should be identical
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(1);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('parallel nonce generation produces unique values', () => {
    const nonces = Array.from({ length: 50 }, () => generateNonce());

    const nonceHexes = new Set(nonces.map((n) => toHex(n)));
    expect(nonceHexes.size).toBe(50);

    for (const nonce of nonces) {
      expect(nonce.length).toBe(32);
    }
  });

  it('mixed concurrent operations (keygen + sign + verify + hash)', async () => {
    const existingKp = await generateKeyPair();
    const message = encoder.encode('mixed-ops');
    const existingSig = await sign(message, existingKp.privateKey);

    const results = await Promise.allSettled([
      // 10 key generations
      ...Array.from({ length: 10 }, () => generateKeyPair()),
      // 10 signs
      ...Array.from({ length: 10 }, () => sign(message, existingKp.privateKey)),
      // 10 verifies
      ...Array.from({ length: 10 }, () => verify(message, existingSig, existingKp.publicKey)),
    ]);

    // None should reject
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    // First 10: key pairs
    for (let i = 0; i < 10; i++) {
      const kp = (results[i] as PromiseFulfilledResult<KeyPair>).value;
      expect(kp.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    }

    // Last 10: verifications should all be true
    for (let i = 20; i < 30; i++) {
      const valid = (results[i] as PromiseFulfilledResult<boolean>).value;
      expect(valid).toBe(true);
    }
  }, 15_000);

  it('50 concurrent key generations and immediate self-sign-verify', async () => {
    const pipeline = Array.from({ length: 50 }, async (_, i) => {
      const kp = await generateKeyPair();
      const msg = encoder.encode(`self-verify-${i}`);
      const sig = await sign(msg, kp.privateKey);
      const valid = await verify(msg, sig, kp.publicKey);
      return { publicKeyHex: kp.publicKeyHex, valid };
    });

    const results = await Promise.all(pipeline);

    const uniqueKeys = new Set(results.map((r) => r.publicKeyHex));
    expect(uniqueKeys.size).toBe(50);
    expect(results.every((r) => r.valid === true)).toBe(true);
  }, 15_000);
});

// ===========================================================================
// 3. Parallel Covenant Operations
// ===========================================================================

describe('Parallel Covenant Operations', () => {
  it('20 concurrent buildCovenant calls all produce valid, unique docs', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const docs = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/cov-${i}'`),
      ),
    );

    expect(docs.length).toBe(20);

    const ids = new Set(docs.map((d) => d.id));
    expect(ids.size).toBe(20);

    for (const doc of docs) {
      expect(doc.id).toMatch(/^[0-9a-f]{64}$/);
      expect(doc.signature).toBeTruthy();
      expect(doc.nonce).toBeTruthy();
    }
  }, 15_000);

  it('20 concurrent verifyCovenant calls all return valid=true', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 20; i++) {
      docs.push(await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/verify-${i}'`));
    }

    const results = await Promise.all(docs.map((d) => verifyCovenant(d)));

    expect(results.length).toBe(20);
    expect(results.every((r) => r.valid)).toBe(true);
  }, 15_000);

  it('concurrent build + verify pipeline', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const pipeline = Array.from({ length: 20 }, async (_, i) => {
      const doc = await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/pipe-${i}'`);
      const result = await verifyCovenant(doc);
      return { id: doc.id, valid: result.valid };
    });

    const results = await Promise.all(pipeline);

    expect(results.length).toBe(20);
    expect(results.every((r) => r.valid)).toBe(true);

    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(20);
  }, 15_000);

  it('concurrent countersign operations on different docs', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();
    const auditorKp = await generateKeyPair();

    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 20; i++) {
      docs.push(await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/cs-${i}'`));
    }

    const countersigned = await Promise.all(
      docs.map((doc) => countersignCovenant(doc, auditorKp, 'auditor')),
    );

    expect(countersigned.length).toBe(20);
    for (const doc of countersigned) {
      expect(doc.countersignatures).toBeDefined();
      expect(doc.countersignatures!.length).toBe(1);
      expect(doc.countersignatures![0]!.signerPublicKey).toBe(auditorKp.publicKeyHex);
    }

    // Verify all countersigned docs
    const verifications = await Promise.all(countersigned.map((d) => verifyCovenant(d)));
    expect(verifications.every((v) => v.valid)).toBe(true);
  }, 15_000);

  it('parallel serialization/deserialization roundtrips', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 20; i++) {
      docs.push(await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/ser-${i}'`));
    }

    // All serialization/deserialization in parallel via Promise.all
    const roundtripped = await Promise.all(
      docs.map(async (doc) => {
        const json = serializeCovenant(doc);
        const parsed = deserializeCovenant(json);
        return parsed;
      }),
    );

    expect(roundtripped.length).toBe(20);
    for (let i = 0; i < 20; i++) {
      expect(roundtripped[i]!.id).toBe(docs[i]!.id);
      expect(roundtripped[i]!.signature).toBe(docs[i]!.signature);
      expect(roundtripped[i]!.nonce).toBe(docs[i]!.nonce);
    }
  }, 15_000);

  it('building covenants with same parameters still produces unique nonces', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const docs = await Promise.all(
      Array.from({ length: 20 }, () =>
        buildSimpleDoc(issuerKp, beneficiaryKp, "permit read on '/same'"),
      ),
    );

    const nonces = new Set(docs.map((d) => d.nonce));
    expect(nonces.size).toBe(20);

    const ids = new Set(docs.map((d) => d.id));
    expect(ids.size).toBe(20);
  }, 15_000);

  it('concurrent computeId calls are deterministic', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const doc = await buildSimpleDoc(issuerKp, beneficiaryKp);

    // 50 concurrent computeId calls on the same document
    const ids = Array.from({ length: 50 }, () => computeId(doc));

    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(1);
    expect(ids[0]).toBe(doc.id);
  });

  it('20 concurrent builds with different issuers all produce valid docs', async () => {
    const beneficiaryKp = await generateKeyPair();

    const docs = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const kp = await generateKeyPair();
        return buildCovenant({
          issuer: { id: `issuer-${i}`, publicKey: kp.publicKeyHex, role: 'issuer' },
          beneficiary: makeBeneficiary(beneficiaryKp.publicKeyHex),
          constraints: `permit read on '/multi-issuer-${i}'`,
          privateKey: kp.privateKey,
        });
      }),
    );

    expect(docs.length).toBe(20);
    const ids = new Set(docs.map((d) => d.id));
    expect(ids.size).toBe(20);

    const verifications = await Promise.all(docs.map((d) => verifyCovenant(d)));
    expect(verifications.every((v) => v.valid)).toBe(true);
  }, 15_000);
});

// ===========================================================================
// 4. Parallel Verifier Operations
// ===========================================================================

describe('Parallel Verifier Operations', () => {
  it('verifyBatch with 50 documents', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 50; i++) {
      docs.push(await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/vbatch-${i}'`));
    }

    const report = await verifyBatch(docs);

    expect(report.summary.total).toBe(50);
    expect(report.summary.passed).toBe(50);
    expect(report.summary.failed).toBe(0);
    expect(report.reports.length).toBe(50);
  }, 30_000);

  it('multiple Verifier instances running concurrently', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 30; i++) {
      docs.push(await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/multi-v-${i}'`));
    }

    // 5 verifier instances, each verifying 6 docs concurrently
    const verifiers = Array.from({ length: 5 }, () => new Verifier());

    const allResults = await Promise.all(
      verifiers.map((v, vIdx) => {
        const batch = docs.slice(vIdx * 6, (vIdx + 1) * 6);
        return Promise.all(batch.map((d) => v.verify(d)));
      }),
    );

    for (const batchResults of allResults) {
      expect(batchResults.length).toBe(6);
      expect(batchResults.every((r) => r.valid)).toBe(true);
    }

    // Each verifier should have its own history
    for (const v of verifiers) {
      expect(v.getHistory().length).toBe(6);
    }
  }, 30_000);

  it('concurrent chain verification', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();
    const issuer = makeIssuer(issuerKp.publicKeyHex);
    const beneficiary = makeBeneficiary(beneficiaryKp.publicKeyHex);

    // Build 3 independent chains of 3 docs each
    const chains: CovenantDocument[][] = [];
    for (let c = 0; c < 3; c++) {
      const root = await buildCovenant({
        issuer,
        beneficiary,
        constraints: `permit read on '/chain-${c}/**'`,
        privateKey: issuerKp.privateKey,
      });
      const child = await buildCovenant({
        issuer,
        beneficiary,
        constraints: `permit read on '/chain-${c}/**'`,
        privateKey: issuerKp.privateKey,
        chain: { parentId: root.id, relation: 'delegates', depth: 1 },
      });
      const leaf = await buildCovenant({
        issuer,
        beneficiary,
        constraints: `permit read on '/chain-${c}/**'`,
        privateKey: issuerKp.privateKey,
        chain: { parentId: child.id, relation: 'delegates', depth: 2 },
      });
      chains.push([root, child, leaf]);
    }

    // Verify all 3 chains concurrently
    const verifier = new Verifier();
    const results = await Promise.all(
      chains.map((chain) => verifier.verifyChain(chain)),
    );

    expect(results.length).toBe(3);
    for (const result of results) {
      expect(result.valid).toBe(true);
    }
  }, 30_000);

  it('verifier history is correctly maintained during parallel verifies', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();
    const verifier = new Verifier({ maxHistorySize: 200 });

    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 50; i++) {
      docs.push(await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/hist-${i}'`));
    }

    // Verify all 50 concurrently
    await Promise.all(docs.map((d) => verifier.verify(d)));

    const history = verifier.getHistory();
    expect(history.length).toBe(50);

    // All history entries should be valid
    for (const record of history) {
      expect(record.valid).toBe(true);
      expect(record.kind).toBe('single');
      expect(record.documentIds.length).toBe(1);
    }
  }, 30_000);

  it('concurrent action verifications on same document', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();
    const verifier = new Verifier();

    const doc = await buildCovenant({
      issuer: makeIssuer(issuerKp.publicKeyHex),
      beneficiary: makeBeneficiary(beneficiaryKp.publicKeyHex),
      constraints: "permit read on '/data/**'\ndeny write on '/system/**'",
      privateKey: issuerKp.privateKey,
    });

    const actionChecks = await Promise.all([
      ...Array.from({ length: 25 }, (_, i) =>
        verifier.verifyAction(doc, 'read', `/data/file-${i}`),
      ),
      ...Array.from({ length: 25 }, (_, i) =>
        verifier.verifyAction(doc, 'write', `/system/cfg-${i}`),
      ),
    ]);

    // First 25: permitted reads
    for (let i = 0; i < 25; i++) {
      expect(actionChecks[i]!.permitted).toBe(true);
    }
    // Last 25: denied writes
    for (let i = 25; i < 50; i++) {
      expect(actionChecks[i]!.permitted).toBe(false);
    }
  }, 30_000);
});

// ===========================================================================
// 5. Parallel Identity Operations
// ===========================================================================

describe('Parallel Identity Operations', () => {
  it('20 concurrent createIdentity calls', async () => {
    const identities = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const kp = await generateKeyPair();
        return createIdentity({
          operatorKeyPair: kp,
          operatorIdentifier: `operator-${i}`,
          model: {
            provider: 'anthropic',
            modelId: 'claude-opus-4',
            modelVersion: '1.0',
            attestationType: 'provider_signed',
          },
          capabilities: ['read', 'write'],
          deployment: { runtime: 'container' },
        });
      }),
    );

    expect(identities.length).toBe(20);

    const ids = new Set(identities.map((id) => id.id));
    expect(ids.size).toBe(20);

    for (const identity of identities) {
      expect(identity.version).toBe(1);
      expect(identity.lineage.length).toBe(1);
      expect(identity.signature).toBeTruthy();
    }
  }, 15_000);

  it('concurrent evolveIdentity from same parent', async () => {
    const kp = await generateKeyPair();

    const parent = await createIdentity({
      operatorKeyPair: kp,
      model: {
        provider: 'anthropic',
        modelId: 'claude-opus-4',
        modelVersion: '1.0',
        attestationType: 'provider_signed',
      },
      capabilities: ['read'],
      deployment: { runtime: 'container' },
    });

    // 10 concurrent evolutions from the same parent
    const evolutions = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        evolveIdentity(parent, {
          operatorKeyPair: kp,
          changeType: 'capability_change',
          description: `Evolution ${i}`,
          updates: {
            capabilities: ['read', `capability-${i}`],
          },
        }),
      ),
    );

    expect(evolutions.length).toBe(10);

    // All should be version 2 (evolved from parent version 1)
    for (const evolved of evolutions) {
      expect(evolved.version).toBe(2);
      expect(evolved.lineage.length).toBe(2);
    }

    // IDs should be unique since capabilities differ
    const ids = new Set(evolutions.map((e) => e.id));
    expect(ids.size).toBe(10);
  }, 15_000);

  it('concurrent verifyIdentity calls', async () => {
    const identities = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const kp = await generateKeyPair();
        return createIdentity({
          operatorKeyPair: kp,
          model: {
            provider: 'anthropic',
            modelId: 'claude-opus-4',
            attestationType: 'provider_signed',
          },
          capabilities: ['read'],
          deployment: { runtime: 'container' },
        });
      }),
    );

    const results = await Promise.all(
      identities.map((id) => verifyIdentity(id)),
    );

    expect(results.length).toBe(20);
    expect(results.every((r) => r.valid)).toBe(true);

    for (const result of results) {
      const checkNames = result.checks.map((c) => c.name);
      expect(checkNames).toContain('capability_manifest_hash');
      expect(checkNames).toContain('composite_identity_hash');
      expect(checkNames).toContain('operator_signature');
    }
  }, 15_000);

  it('parallel serialization roundtrips', async () => {
    const identities = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const kp = await generateKeyPair();
        return createIdentity({
          operatorKeyPair: kp,
          model: {
            provider: 'anthropic',
            modelId: 'claude-opus-4',
            attestationType: 'provider_signed',
          },
          capabilities: ['read', 'write'],
          deployment: { runtime: 'container' },
        });
      }),
    );

    const roundtripped = identities.map((identity) => {
      const json = serializeIdentity(identity);
      return deserializeIdentity(json);
    });

    expect(roundtripped.length).toBe(20);
    for (let i = 0; i < 20; i++) {
      expect(roundtripped[i]!.id).toBe(identities[i]!.id);
      expect(roundtripped[i]!.signature).toBe(identities[i]!.signature);
      expect(roundtripped[i]!.version).toBe(identities[i]!.version);
    }
  }, 15_000);

  it('concurrent create + evolve + verify pipeline', async () => {
    const pipeline = Array.from({ length: 10 }, async (_, i) => {
      const kp = await generateKeyPair();
      const identity = await createIdentity({
        operatorKeyPair: kp,
        model: {
          provider: 'anthropic',
          modelId: 'claude-opus-4',
          attestationType: 'provider_signed',
        },
        capabilities: ['read'],
        deployment: { runtime: 'container' },
      });

      const evolved = await evolveIdentity(identity, {
        operatorKeyPair: kp,
        changeType: 'capability_change',
        description: `Pipeline evolution ${i}`,
        updates: { capabilities: ['read', 'write'] },
      });

      const result = await verifyIdentity(evolved);
      return { id: evolved.id, valid: result.valid, version: evolved.version };
    });

    const results = await Promise.all(pipeline);

    expect(results.length).toBe(10);
    expect(results.every((r) => r.valid)).toBe(true);
    expect(results.every((r) => r.version === 2)).toBe(true);

    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(10);
  }, 15_000);
});

// ===========================================================================
// 6. Parallel Enforcement Operations
// ===========================================================================

describe('Parallel Enforcement Operations', () => {
  it('Monitor handling 100 concurrent evaluate calls', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const doc = await buildSimpleDoc(issuerKp, beneficiaryKp, "permit read on '/data/**'");
    const monitor = new Monitor(doc.id, doc.constraints, { mode: 'enforce' });

    // 100 concurrent permitted evaluations
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        monitor.evaluate('read', `/data/file-${i}`),
      ),
    );

    expect(results.length).toBe(100);
    expect(results.every((r) => r.permitted)).toBe(true);

    const auditLog = monitor.getAuditLog();
    expect(auditLog.count).toBe(100);
    expect(monitor.verifyAuditLogIntegrity()).toBe(true);
  }, 30_000);

  it('Monitor audit log consistency after concurrent operations', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const constraints = "permit read on '/data/**'\ndeny write on '/data/**' severity high";
    const doc = await buildCovenant({
      issuer: makeIssuer(issuerKp.publicKeyHex),
      beneficiary: makeBeneficiary(beneficiaryKp.publicKeyHex),
      constraints,
      privateKey: issuerKp.privateKey,
    });

    const monitor = new Monitor(doc.id, constraints, { mode: 'log_only' });

    // Mix of permitted and denied actions concurrently
    const actions = [
      ...Array.from({ length: 30 }, (_, i) => ({ action: 'read', resource: `/data/r-${i}` })),
      ...Array.from({ length: 20 }, (_, i) => ({ action: 'write', resource: `/data/w-${i}` })),
    ];

    const results = await Promise.all(
      actions.map((a) => monitor.evaluate(a.action, a.resource)),
    );

    expect(results.length).toBe(50);

    // 30 reads should be permitted, 20 writes denied
    const permitted = results.filter((r) => r.permitted).length;
    const denied = results.filter((r) => !r.permitted).length;
    expect(permitted).toBe(30);
    expect(denied).toBe(20);

    // Audit log should have all 50 entries
    const auditLog = monitor.getAuditLog();
    expect(auditLog.count).toBe(50);

    // Hash chain integrity should hold
    expect(monitor.verifyAuditLogIntegrity()).toBe(true);
  }, 30_000);

  it('concurrent CapabilityGate.execute calls', async () => {
    const runtimeKp = await generateKeyPair();
    const covenantId = sha256(encoder.encode('cap-gate-cov'));

    const gate = await CapabilityGate.fromConstraints(
      covenantId,
      "permit read on '/data/**'\npermit write on '/data/**'",
      runtimeKp,
    );

    // Register handlers
    gate.register('read', async (resource) => ({ data: `read-${resource}` }));
    gate.register('write', async (resource) => ({ data: `write-${resource}` }));

    // 50 concurrent execute calls
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        gate.execute<{ data: string }>(
          i % 2 === 0 ? 'read' : 'write',
          `/data/file-${i}`,
        ),
      ),
    );

    expect(results.length).toBe(50);
    for (let i = 0; i < 50; i++) {
      const action = i % 2 === 0 ? 'read' : 'write';
      expect(results[i]!.data).toBe(`${action}-/data/file-${i}`);
    }
  }, 15_000);

  it('Monitor rate limiting under concurrent pressure', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const constraints = "permit read on '/data/**'\nlimit read 10 per 60 seconds";
    const doc = await buildCovenant({
      issuer: makeIssuer(issuerKp.publicKeyHex),
      beneficiary: makeBeneficiary(beneficiaryKp.publicKeyHex),
      constraints,
      privateKey: issuerKp.privateKey,
    });

    const monitor = new Monitor(doc.id, constraints, { mode: 'log_only' });

    // Fire 20 concurrent reads -- first 10 should be permitted, rest rate-limited
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        monitor.evaluate('read', `/data/rate-${i}`),
      ),
    );

    expect(results.length).toBe(20);

    const permittedCount = results.filter((r) => r.permitted).length;
    const deniedCount = results.filter((r) => !r.permitted).length;

    // At least some should be permitted and some denied
    expect(permittedCount).toBeGreaterThan(0);
    expect(permittedCount).toBeLessThanOrEqual(10);
    expect(deniedCount).toBeGreaterThan(0);
  }, 15_000);

  it('multiple Monitor instances are isolated under concurrent use', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const doc = await buildSimpleDoc(issuerKp, beneficiaryKp, "permit read on '/data/**'");

    const monitors = Array.from({ length: 5 }, () =>
      new Monitor(doc.id, doc.constraints, { mode: 'enforce' }),
    );

    // Each monitor gets 10 concurrent evaluations
    await Promise.all(
      monitors.flatMap((m, mIdx) =>
        Array.from({ length: 10 }, (_, i) =>
          m.evaluate('read', `/data/m${mIdx}-${i}`),
        ),
      ),
    );

    // Each monitor should have exactly 10 entries
    for (const m of monitors) {
      expect(m.getAuditLog().count).toBe(10);
      expect(m.verifyAuditLogIntegrity()).toBe(true);
    }
  }, 30_000);
});

// ===========================================================================
// 7. High-Volume Integration
// ===========================================================================

describe('High-Volume Integration', () => {
  it('full pipeline: 50 concurrent (build -> store -> verify -> evaluate)', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const pipeline = Array.from({ length: 50 }, async (_, i) => {
      // Build
      const doc = await buildCovenant({
        issuer: makeIssuer(issuerKp.publicKeyHex),
        beneficiary: makeBeneficiary(beneficiaryKp.publicKeyHex),
        constraints: `permit read on '/pipeline-${i}/**'`,
        privateKey: issuerKp.privateKey,
      });

      // Store
      await store.put(doc);

      // Verify
      const verifyResult = await verifyCovenant(doc);

      // Evaluate CCL
      const cclDoc = parse(doc.constraints);
      const evalResult = evaluate(cclDoc, 'read', `/pipeline-${i}/data`);

      return {
        id: doc.id,
        stored: true,
        valid: verifyResult.valid,
        permitted: evalResult.permitted,
      };
    });

    const results = await Promise.all(pipeline);

    expect(results.length).toBe(50);
    expect(results.every((r) => r.valid)).toBe(true);
    expect(results.every((r) => r.permitted)).toBe(true);
    expect(results.every((r) => r.stored)).toBe(true);
    expect(store.size).toBe(50);

    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(50);
  }, 60_000);

  it('store with 5000 documents, then 100 concurrent reads', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    // Build and store 5000 docs in batches
    const allDocs: CovenantDocument[] = [];
    for (let batch = 0; batch < 50; batch++) {
      const batchDocs: CovenantDocument[] = [];
      for (let i = 0; i < 100; i++) {
        const idx = batch * 100 + i;
        batchDocs.push(
          await buildSimpleDoc(issuerKp, beneficiaryKp, `permit read on '/big-${idx}'`),
        );
      }
      await store.putBatch(batchDocs);
      allDocs.push(...batchDocs);
    }

    expect(store.size).toBe(5000);

    // 100 concurrent random reads
    const readIndices = Array.from({ length: 100 }, (_, i) => i * 50); // spread across the range
    const readResults = await Promise.all(
      readIndices.map((idx) => store.get(allDocs[idx]!.id)),
    );

    expect(readResults.length).toBe(100);
    expect(readResults.every((r) => r !== undefined)).toBe(true);
    for (let i = 0; i < 100; i++) {
      expect(readResults[i]!.id).toBe(allDocs[readIndices[i]!]!.id);
    }
  }, 120_000);

  it('reputation: 50 concurrent receipt creations', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const covenantId = sha256(encoder.encode('rep-cov'));
    const agentIdentityHash = sha256(encoder.encode('rep-agent'));
    const proofHash = sha256(encoder.encode('rep-proof'));

    const receipts = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        createReceipt(
          covenantId,
          agentIdentityHash,
          principalKp.publicKeyHex,
          'fulfilled',
          proofHash,
          1000 + i,
          agentKp,
          null,
        ),
      ),
    );

    expect(receipts.length).toBe(50);

    // All receipts should be unique
    const receiptIds = new Set(receipts.map((r) => r.id));
    expect(receiptIds.size).toBe(50);

    // All should have valid receipt hashes
    for (const receipt of receipts) {
      expect(receipt.receiptHash).toMatch(/^[0-9a-f]{64}$/);
      expect(receipt.agentSignature).toBeTruthy();
      expect(receipt.outcome).toBe('fulfilled');
    }

    // Compute reputation score from all receipts
    const score = computeReputationScore(agentIdentityHash, receipts);
    expect(score.totalExecutions).toBe(50);
    expect(score.fulfilled).toBe(50);
    expect(score.successRate).toBe(1.0);
    expect(score.weightedScore).toBeGreaterThan(0);
    expect(score.weightedScore).toBeLessThanOrEqual(1);
  }, 30_000);

  it('full lifecycle: create identity -> build covenant -> enforce -> receipt, all concurrent', async () => {
    const pipeline = Array.from({ length: 20 }, async (_, i) => {
      // Step 1: Create identity
      const kp = await generateKeyPair();
      const beneficiaryKp = await generateKeyPair();

      const identity = await createIdentity({
        operatorKeyPair: kp,
        operatorIdentifier: `lifecycle-op-${i}`,
        model: {
          provider: 'anthropic',
          modelId: 'claude-opus-4',
          attestationType: 'provider_signed',
        },
        capabilities: ['read'],
        deployment: { runtime: 'container' },
      });

      // Step 2: Build covenant
      const doc = await buildCovenant({
        issuer: {
          id: identity.id,
          publicKey: kp.publicKeyHex,
          role: 'issuer',
        },
        beneficiary: {
          id: `beneficiary-${i}`,
          publicKey: beneficiaryKp.publicKeyHex,
          role: 'beneficiary',
        },
        constraints: "permit read on '/data/**'",
        privateKey: kp.privateKey,
      });

      // Step 3: Verify covenant
      const verifyResult = await verifyCovenant(doc);

      // Step 4: Enforce via monitor
      const monitor = new Monitor(doc.id, doc.constraints, { mode: 'enforce' });
      const evalResult = await monitor.evaluate('read', '/data/test');

      // Step 5: Create receipt
      const receipt = await createReceipt(
        doc.id,
        identity.id,
        beneficiaryKp.publicKeyHex,
        'fulfilled',
        sha256(encoder.encode(`proof-${i}`)),
        500 + i,
        kp,
        null,
      );

      return {
        identityValid: (await verifyIdentity(identity)).valid,
        covenantValid: verifyResult.valid,
        actionPermitted: evalResult.permitted,
        receiptId: receipt.id,
        auditLogIntact: monitor.verifyAuditLogIntegrity(),
      };
    });

    const results = await Promise.all(pipeline);

    expect(results.length).toBe(20);
    for (const result of results) {
      expect(result.identityValid).toBe(true);
      expect(result.covenantValid).toBe(true);
      expect(result.actionPermitted).toBe(true);
      expect(result.receiptId).toBeTruthy();
      expect(result.auditLogIntact).toBe(true);
    }

    const receiptIds = new Set(results.map((r) => r.receiptId));
    expect(receiptIds.size).toBe(20);
  }, 60_000);

  it('concurrent receipt chains with reputation scoring', async () => {
    const agentKp = await generateKeyPair();
    const principalKp = await generateKeyPair();
    const covenantId = sha256(encoder.encode('chain-rep-cov'));
    const agentIdentityHash = sha256(encoder.encode('chain-rep-agent'));

    // Create 5 independent receipt chains of 10 receipts each
    const chains = await Promise.all(
      Array.from({ length: 5 }, async (_, chainIdx) => {
        const receipts = [];
        let prevHash: string | null = null;

        for (let i = 0; i < 10; i++) {
          const receipt = await createReceipt(
            covenantId,
            agentIdentityHash,
            principalKp.publicKeyHex,
            i < 8 ? 'fulfilled' : 'partial',
            sha256(encoder.encode(`proof-${chainIdx}-${i}`)),
            1000,
            agentKp,
            prevHash as HashHex | null,
          );
          receipts.push(receipt);
          prevHash = receipt.receiptHash;
        }

        return receipts;
      }),
    );

    expect(chains.length).toBe(5);

    // Flatten all receipts and compute score
    const allReceipts = chains.flat();
    expect(allReceipts.length).toBe(50);

    const score = computeReputationScore(agentIdentityHash, allReceipts);
    expect(score.totalExecutions).toBe(50);
    expect(score.fulfilled).toBe(40); // 8 per chain * 5 chains
    expect(score.partial).toBe(10);   // 2 per chain * 5 chains
    expect(score.successRate).toBe(1.0); // (40+10)/50
    expect(score.weightedScore).toBeGreaterThan(0);
  }, 60_000);
});
