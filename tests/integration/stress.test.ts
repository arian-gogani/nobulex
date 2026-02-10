/**
 * Stress tests for the Stele SDK.
 *
 * Exercises high-volume, concurrent, and boundary-condition scenarios
 * across crypto, core, CCL, store, and verifier packages.
 */

import { describe, it, expect } from 'vitest';
import { generateKeyPair, toHex } from '@stele/crypto';
import { buildCovenant, verifyCovenant } from '@stele/core';
import type { CovenantDocument, Issuer, Beneficiary } from '@stele/core';
import { parse, evaluate, merge, serialize } from '@stele/ccl';
import { MemoryStore } from '@stele/store';
import { Verifier, verifyBatch } from '@stele/verifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssuer(publicKeyHex: string): Issuer {
  return { id: 'issuer-stress', publicKey: publicKeyHex, role: 'issuer' as const };
}

function makeBeneficiary(publicKeyHex: string): Beneficiary {
  return { id: 'beneficiary-stress', publicKey: publicKeyHex, role: 'beneficiary' as const };
}

async function buildSimpleCovenant(
  issuerKp: { publicKeyHex: string; privateKey: Uint8Array },
  beneficiaryKp: { publicKeyHex: string },
  constraints = "permit read on '**'",
) {
  return buildCovenant({
    issuer: makeIssuer(issuerKp.publicKeyHex),
    beneficiary: makeBeneficiary(beneficiaryKp.publicKeyHex),
    constraints,
    privateKey: issuerKp.privateKey,
  });
}

// ===========================================================================
// 1. Sequential covenant creation
// ===========================================================================

describe('Sequential covenant creation', () => {
  it('creates and verifies 500 covenants in sequence', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 500; i++) {
      const doc = await buildSimpleCovenant(
        issuerKp,
        beneficiaryKp,
        `permit read on '/resource-${i}'`,
      );
      docs.push(doc);
    }

    expect(docs.length).toBe(500);

    // Verify all are unique
    const ids = new Set(docs.map((d) => d.id));
    expect(ids.size).toBe(500);

    // Spot-check first, middle, and last
    for (const idx of [0, 250, 499]) {
      const result = await verifyCovenant(docs[idx]!);
      expect(result.valid).toBe(true);
    }
  }, 30000);
});

// ===========================================================================
// 2. Concurrent covenant creation
// ===========================================================================

describe('Concurrent covenant creation', () => {
  it('creates 100 covenants concurrently and verifies all', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const promises = Array.from({ length: 100 }, (_, i) =>
      buildSimpleCovenant(
        issuerKp,
        beneficiaryKp,
        `permit read on '/concurrent-${i}'`,
      ),
    );

    const docs = await Promise.all(promises);
    expect(docs.length).toBe(100);

    // Verify all are unique
    const ids = new Set(docs.map((d) => d.id));
    expect(ids.size).toBe(100);

    // Verify all are valid
    const verifications = await Promise.all(docs.map((d) => verifyCovenant(d)));
    const allValid = verifications.every((v) => v.valid);
    expect(allValid).toBe(true);
  }, 15000);
});

// ===========================================================================
// 3. Chain depth 8
// ===========================================================================

describe('Chain building', () => {
  it('builds and verifies a chain of depth 8', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();
    const issuer = makeIssuer(issuerKp.publicKeyHex);
    const beneficiary = makeBeneficiary(beneficiaryKp.publicKeyHex);

    // Root document
    const root = await buildCovenant({
      issuer,
      beneficiary,
      constraints: "permit read on '**'",
      privateKey: issuerKp.privateKey,
    });

    const chain: CovenantDocument[] = [root];

    for (let depth = 1; depth <= 7; depth++) {
      const parent = chain[chain.length - 1]!;
      const child = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '**'",
        privateKey: issuerKp.privateKey,
        chain: {
          parentId: parent.id,
          relation: 'delegates',
          depth,
        },
      });
      chain.push(child);
    }

    expect(chain.length).toBe(8);

    // Verify each document individually
    for (const doc of chain) {
      const result = await verifyCovenant(doc);
      expect(result.valid).toBe(true);
    }
  }, 15000);
});

// ===========================================================================
// 4. CCL with many statements
// ===========================================================================

describe('CCL with many statements', () => {
  it('parses and evaluates CCL with 20 statements 100 times', () => {
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push(`permit read on '/resource-${i}'`);
    }
    for (let i = 0; i < 10; i++) {
      lines.push(`deny write on '/secret-${i}'`);
    }
    const source = lines.join('\n');

    for (let run = 0; run < 100; run++) {
      const doc = parse(source);
      expect(doc.statements.length).toBe(20);

      // Test a permit
      const permitResult = evaluate(doc, 'read', '/resource-5');
      expect(permitResult.permitted).toBe(true);

      // Test a deny
      const denyResult = evaluate(doc, 'write', '/secret-3');
      expect(denyResult.permitted).toBe(false);

      // Test an unmatched action (default deny)
      const unmatchedResult = evaluate(doc, 'delete', '/resource-1');
      expect(unmatchedResult.permitted).toBe(false);
    }
  }, 10000);
});

// ===========================================================================
// 5. MemoryStore: 1000 documents
// ===========================================================================

describe('MemoryStore high volume', () => {
  it('puts 1000 documents, lists with filter, counts', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 1000; i++) {
      const doc = await buildSimpleCovenant(
        issuerKp,
        beneficiaryKp,
        `permit read on '/doc-${i}'`,
      );
      docs.push(doc);
    }

    await store.putBatch(docs);
    expect(store.size).toBe(1000);

    // Count all
    const totalCount = await store.count();
    expect(totalCount).toBe(1000);

    // Filter by issuer
    const filtered = await store.list({ issuerId: 'issuer-stress' });
    expect(filtered.length).toBe(1000);

    // Filter by nonexistent issuer
    const empty = await store.list({ issuerId: 'nonexistent' });
    expect(empty.length).toBe(0);

    // Count by issuer
    const issuerCount = await store.count({ issuerId: 'issuer-stress' });
    expect(issuerCount).toBe(1000);
  }, 30000);
});

// ===========================================================================
// 6. MemoryStore: rapid put/delete cycles
// ===========================================================================

describe('MemoryStore put/delete cycles', () => {
  it('performs 200 rapid put/delete cycles', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    for (let i = 0; i < 200; i++) {
      const doc = await buildSimpleCovenant(
        issuerKp,
        beneficiaryKp,
        `permit read on '/cycle-${i}'`,
      );
      await store.put(doc);
      expect(await store.has(doc.id)).toBe(true);

      const deleted = await store.delete(doc.id);
      expect(deleted).toBe(true);
      expect(await store.has(doc.id)).toBe(false);
    }

    expect(store.size).toBe(0);
  }, 30000);
});

// ===========================================================================
// 7. Verifier batch: 200 documents
// ===========================================================================

describe('Verifier batch', () => {
  it('verifies 200 documents at once', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 200; i++) {
      const doc = await buildSimpleCovenant(
        issuerKp,
        beneficiaryKp,
        `permit read on '/batch-${i}'`,
      );
      docs.push(doc);
    }

    const report = await verifyBatch(docs);
    expect(report.summary.total).toBe(200);
    expect(report.summary.passed).toBe(200);
    expect(report.summary.failed).toBe(0);
    expect(report.reports.length).toBe(200);
  }, 30000);
});

// ===========================================================================
// 8. Event system stress
// ===========================================================================

describe('Event system stress', () => {
  it('handles 50 listeners receiving 100 rapid events', async () => {
    const store = new MemoryStore();
    const counters = Array.from({ length: 50 }, () => ({ count: 0 }));

    // Register 50 listeners
    for (let i = 0; i < 50; i++) {
      const counter = counters[i]!;
      store.onEvent(() => {
        counter.count++;
      });
    }

    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    // Fire 100 put events
    for (let i = 0; i < 100; i++) {
      const doc = await buildSimpleCovenant(
        issuerKp,
        beneficiaryKp,
        `permit read on '/event-${i}'`,
      );
      await store.put(doc);
    }

    // Each listener should have received 100 events
    for (const counter of counters) {
      expect(counter.count).toBe(100);
    }
  }, 30000);
});

// ===========================================================================
// 9. Large metadata
// ===========================================================================

describe('Large metadata', () => {
  it('creates covenant with 10KB of metadata tags', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    // Generate tags totaling ~10KB
    const tags: string[] = [];
    for (let i = 0; i < 200; i++) {
      tags.push(`tag-${'x'.repeat(48)}-${i}`);
    }

    const doc = await buildCovenant({
      issuer: makeIssuer(issuerKp.publicKeyHex),
      beneficiary: makeBeneficiary(beneficiaryKp.publicKeyHex),
      constraints: "permit read on '**'",
      privateKey: issuerKp.privateKey,
      metadata: {
        name: 'large-metadata-test',
        description: 'Testing large metadata payloads',
        tags,
      },
    });

    expect(doc.metadata?.tags?.length).toBe(200);

    const result = await verifyCovenant(doc);
    expect(result.valid).toBe(true);

    // Verify the serialized size is reasonable (under 1 MiB limit)
    const serialized = JSON.stringify(doc);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(1_048_576);
  });
});

// ===========================================================================
// 10. Merge 10 CCL documents sequentially
// ===========================================================================

describe('CCL merge stress', () => {
  it('merges 10 CCL documents sequentially', () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      parse(`permit read on '/resource-${i}'`),
    );

    let merged = docs[0]!;
    for (let i = 1; i < docs.length; i++) {
      merged = merge(merged, docs[i]!);
    }

    // The merged document should have all 10 permit statements
    expect(merged.permits.length).toBe(10);

    // Each resource should be evaluable
    for (let i = 0; i < 10; i++) {
      const result = evaluate(merged, 'read', `/resource-${i}`);
      expect(result.permitted).toBe(true);
    }
  });
});

// ===========================================================================
// 11. Parse/serialize/re-parse 100 CCL documents
// ===========================================================================

describe('CCL parse/serialize/re-parse', () => {
  it('roundtrips 100 CCL documents through parse/serialize/re-parse', () => {
    for (let i = 0; i < 100; i++) {
      const source = [
        `permit read on '/resource-${i}'`,
        `deny write on '/secret-${i}'`,
        `limit api.call 100 per 1 hours`,
      ].join('\n');

      const doc = parse(source);
      expect(doc.statements.length).toBe(3);

      const serialized = serialize(doc);
      expect(typeof serialized).toBe('string');
      expect(serialized.length).toBeGreaterThan(0);

      const reparsed = parse(serialized);
      expect(reparsed.statements.length).toBe(3);
      expect(reparsed.permits.length).toBe(doc.permits.length);
      expect(reparsed.denies.length).toBe(doc.denies.length);
      expect(reparsed.limits.length).toBe(doc.limits.length);
    }
  });
});

// ===========================================================================
// 12. Verifier history stress
// ===========================================================================

describe('Verifier history limit', () => {
  it('respects maxHistorySize limit', async () => {
    const verifier = new Verifier({ maxHistorySize: 50 });
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    for (let i = 0; i < 100; i++) {
      const doc = await buildSimpleCovenant(
        issuerKp,
        beneficiaryKp,
        `permit read on '/history-${i}'`,
      );
      await verifier.verify(doc);
    }

    // History should be capped at 50
    const history = verifier.getHistory();
    expect(history.length).toBe(50);
  }, 15000);
});

// ===========================================================================
// 13. Concurrent verifications
// ===========================================================================

describe('Concurrent verification', () => {
  it('runs 100 concurrent single-document verifications', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();
    const verifier = new Verifier();

    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 100; i++) {
      const doc = await buildSimpleCovenant(
        issuerKp,
        beneficiaryKp,
        `permit read on '/concurrent-verify-${i}'`,
      );
      docs.push(doc);
    }

    const results = await Promise.all(docs.map((d) => verifier.verify(d)));
    const allValid = results.every((r) => r.valid);
    expect(allValid).toBe(true);
  }, 15000);
});

// ===========================================================================
// 14. Store filter stress
// ===========================================================================

describe('Store filter stress', () => {
  it('filters correctly among many documents with different issuers', async () => {
    const store = new MemoryStore();
    const beneficiaryKp = await generateKeyPair();

    const issuerA = await generateKeyPair();
    const issuerB = await generateKeyPair();

    // Put 50 docs from issuer A and 50 from issuer B
    for (let i = 0; i < 50; i++) {
      const docA = await buildCovenant({
        issuer: { id: 'issuer-A', publicKey: issuerA.publicKeyHex, role: 'issuer' },
        beneficiary: makeBeneficiary(beneficiaryKp.publicKeyHex),
        constraints: `permit read on '/a-${i}'`,
        privateKey: issuerA.privateKey,
      });
      const docB = await buildCovenant({
        issuer: { id: 'issuer-B', publicKey: issuerB.publicKeyHex, role: 'issuer' },
        beneficiary: makeBeneficiary(beneficiaryKp.publicKeyHex),
        constraints: `permit read on '/b-${i}'`,
        privateKey: issuerB.privateKey,
      });
      await store.put(docA);
      await store.put(docB);
    }

    expect(store.size).toBe(100);

    const listA = await store.list({ issuerId: 'issuer-A' });
    expect(listA.length).toBe(50);

    const listB = await store.list({ issuerId: 'issuer-B' });
    expect(listB.length).toBe(50);

    const countA = await store.count({ issuerId: 'issuer-A' });
    expect(countA).toBe(50);
  }, 15000);
});

// ===========================================================================
// 15. Unique key pair generation
// ===========================================================================

describe('Key pair generation stress', () => {
  it('generates 200 unique key pairs', async () => {
    const keys = await Promise.all(
      Array.from({ length: 200 }, () => generateKeyPair()),
    );

    const publicKeySet = new Set(keys.map((k) => k.publicKeyHex));
    expect(publicKeySet.size).toBe(200);

    // Each private key should be 32 bytes
    for (const kp of keys) {
      expect(kp.privateKey.length).toBe(32);
      expect(kp.publicKey.length).toBe(32);
    }
  }, 10000);
});

// ===========================================================================
// 16. Mixed valid/invalid batch verification
// ===========================================================================

describe('Mixed batch verification', () => {
  it('correctly identifies valid and invalid docs in a batch', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const docs: CovenantDocument[] = [];

    // 50 valid docs
    for (let i = 0; i < 50; i++) {
      const doc = await buildSimpleCovenant(
        issuerKp,
        beneficiaryKp,
        `permit read on '/valid-${i}'`,
      );
      docs.push(doc);
    }

    // 50 tampered docs (broken nonce)
    for (let i = 0; i < 50; i++) {
      const doc = await buildSimpleCovenant(
        issuerKp,
        beneficiaryKp,
        `permit read on '/invalid-${i}'`,
      );
      docs.push({ ...doc, nonce: 'zz' });
    }

    const report = await verifyBatch(docs);
    expect(report.summary.total).toBe(100);
    expect(report.summary.passed).toBe(50);
    expect(report.summary.failed).toBe(50);
  }, 15000);
});

// ===========================================================================
// 17. CCL evaluation with complex conditions
// ===========================================================================

describe('CCL evaluation stress with conditions', () => {
  it('evaluates 200 times with varying contexts', () => {
    const source = [
      "permit read on '/data' when role = 'admin'",
      "permit read on '/public' when role = 'user'",
      "deny write on '/data' when role = 'user'",
      "deny delete on '**'",
    ].join('\n');

    const doc = parse(source);

    for (let i = 0; i < 200; i++) {
      const isAdmin = i % 2 === 0;

      const readData = evaluate(doc, 'read', '/data', { role: isAdmin ? 'admin' : 'user' });
      if (isAdmin) {
        expect(readData.permitted).toBe(true);
      } else {
        expect(readData.permitted).toBe(false);
      }

      const readPublic = evaluate(doc, 'read', '/public', { role: 'user' });
      expect(readPublic.permitted).toBe(true);

      const writeData = evaluate(doc, 'write', '/data', { role: 'user' });
      expect(writeData.permitted).toBe(false);

      const deleteAny = evaluate(doc, 'delete', '/anything');
      expect(deleteAny.permitted).toBe(false);
    }
  }, 10000);
});

// ===========================================================================
// 18. Store putBatch / getBatch / deleteBatch stress
// ===========================================================================

describe('Store batch operations stress', () => {
  it('handles putBatch, getBatch, and deleteBatch for 300 documents', async () => {
    const store = new MemoryStore();
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();

    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 300; i++) {
      const doc = await buildSimpleCovenant(
        issuerKp,
        beneficiaryKp,
        `permit read on '/batch-op-${i}'`,
      );
      docs.push(doc);
    }

    // Put all at once
    await store.putBatch(docs);
    expect(store.size).toBe(300);

    // Get all at once
    const ids = docs.map((d) => d.id);
    const retrieved = await store.getBatch(ids);
    expect(retrieved.length).toBe(300);
    expect(retrieved.every((d) => d !== undefined)).toBe(true);

    // Delete first 100
    const deleteIds = ids.slice(0, 100);
    const deletedCount = await store.deleteBatch(deleteIds);
    expect(deletedCount).toBe(100);
    expect(store.size).toBe(200);

    // Verify deleted docs are gone
    const recheck = await store.getBatch(deleteIds);
    expect(recheck.every((d) => d === undefined)).toBe(true);
  }, 30000);
});

// ===========================================================================
// 19. Many unique key pairs signing the same constraints
// ===========================================================================

describe('Many issuers stress', () => {
  it('100 different issuers create covenants with same constraints', async () => {
    const beneficiaryKp = await generateKeyPair();

    const docs = await Promise.all(
      Array.from({ length: 100 }, async () => {
        const kp = await generateKeyPair();
        return buildCovenant({
          issuer: makeIssuer(kp.publicKeyHex),
          beneficiary: makeBeneficiary(beneficiaryKp.publicKeyHex),
          constraints: "permit read on '**'",
          privateKey: kp.privateKey,
        });
      }),
    );

    // All docs should be unique (different nonce, different issuer key)
    const ids = new Set(docs.map((d) => d.id));
    expect(ids.size).toBe(100);

    // All should be valid
    const results = await Promise.all(docs.map((d) => verifyCovenant(d)));
    expect(results.every((r) => r.valid)).toBe(true);
  }, 15000);
});

// ===========================================================================
// 20. Merge stress: deny-wins semantics
// ===========================================================================

describe('Merge deny-wins stress', () => {
  it('merge preserves deny-wins semantics across 5 merged documents', () => {
    // 5 documents: first 4 permit, last one denies
    const permitDocs = Array.from({ length: 4 }, (_, i) =>
      parse(`permit read on '/resource-${i}'`),
    );
    const denyDoc = parse("deny read on '/resource-0'");

    // Merge all permits
    let merged = permitDocs[0]!;
    for (let i = 1; i < permitDocs.length; i++) {
      merged = merge(merged, permitDocs[i]!);
    }

    // Now merge in the deny
    merged = merge(merged, denyDoc);

    // /resource-0 should be denied (deny-wins at equal or higher specificity)
    const result0 = evaluate(merged, 'read', '/resource-0');
    expect(result0.permitted).toBe(false);

    // /resource-1 through /resource-3 should still be permitted
    for (let i = 1; i < 4; i++) {
      const result = evaluate(merged, 'read', `/resource-${i}`);
      expect(result.permitted).toBe(true);
    }
  });
});

// ===========================================================================
// 21. Verifier action verification stress
// ===========================================================================

describe('Verifier action stress', () => {
  it('runs 100 action verifications on a single document', async () => {
    const issuerKp = await generateKeyPair();
    const beneficiaryKp = await generateKeyPair();
    const verifier = new Verifier();

    const doc = await buildCovenant({
      issuer: makeIssuer(issuerKp.publicKeyHex),
      beneficiary: makeBeneficiary(beneficiaryKp.publicKeyHex),
      constraints: [
        "permit read on '**'",
        "deny write on '/system/**'",
      ].join('\n'),
      privateKey: issuerKp.privateKey,
    });

    for (let i = 0; i < 100; i++) {
      const readReport = await verifier.verifyAction(doc, 'read', `/data-${i}`);
      expect(readReport.permitted).toBe(true);

      const writeReport = await verifier.verifyAction(doc, 'write', `/system/config-${i}`);
      expect(writeReport.permitted).toBe(false);
    }
  }, 30000);
});
