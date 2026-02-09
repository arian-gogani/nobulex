import { describe, it, expect } from 'vitest';

import {
  generateKeyPair,
  sign,
  verify,
  sha256,
  canonicalizeJson,
} from '@stele/crypto';

import {
  parse,
  evaluate,
  merge,
  serialize,
  validateNarrowing,
} from '@stele/ccl';

import {
  buildCovenant,
  verifyCovenant,
  countersignCovenant,
  resolveChain,
  computeEffectiveConstraints,
  MemoryChainResolver,
} from '@stele/core';

import { MemoryStore } from '@stele/store';

// ---------------------------------------------------------------------------
// Benchmark helper
// ---------------------------------------------------------------------------

interface BenchResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  opsPerSec: number;
}

const allResults: BenchResult[] = [];

/**
 * Run `fn` for `iterations` times, measure wall-clock time, compute ops/sec,
 * push to the global results table, and return the result for assertions.
 */
async function bench(
  name: string,
  iterations: number,
  fn: () => void | Promise<void>,
): Promise<BenchResult> {
  // Warm-up: run a few times to let the JIT settle
  for (let i = 0; i < Math.min(5, iterations); i++) {
    await fn();
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
  const totalMs = performance.now() - start;
  const avgMs = totalMs / iterations;
  const opsPerSec = 1000 / avgMs;

  const result: BenchResult = { name, iterations, totalMs, avgMs, opsPerSec };
  allResults.push(result);
  return result;
}

/**
 * Print the full results table to the console after all benchmarks finish.
 */
function printResults(): void {
  console.log('\n' + '='.repeat(90));
  console.log('  BENCHMARK RESULTS');
  console.log('='.repeat(90));
  console.log(
    '  ' +
      'Name'.padEnd(50) +
      'Iters'.padStart(8) +
      'Total(ms)'.padStart(12) +
      'Avg(ms)'.padStart(12) +
      'ops/sec'.padStart(12),
  );
  console.log('-'.repeat(90));

  for (const r of allResults) {
    console.log(
      '  ' +
        r.name.padEnd(50) +
        String(r.iterations).padStart(8) +
        r.totalMs.toFixed(2).padStart(12) +
        r.avgMs.toFixed(4).padStart(12) +
        r.opsPerSec.toFixed(0).padStart(12),
    );
  }

  console.log('='.repeat(90) + '\n');
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function makeBytes(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    buf[i] = i % 256;
  }
  return buf;
}

function makeNestedObject(depth: number): Record<string, unknown> {
  if (depth <= 0) {
    return { value: 42, label: 'leaf', active: true };
  }
  return {
    alpha: makeNestedObject(depth - 1),
    beta: makeNestedObject(depth - 1),
    name: `depth-${depth}`,
    count: depth * 10,
  };
}

// CCL snippets at varying complexity
const CCL_SIMPLE = `permit file.read on '/data'`;

const CCL_MEDIUM = `
permit file.read on '/data'
permit file.write on '/data' when user.role = 'admin'
deny network.send on '/external' when risk_level = 'high'
limit api.call 100 per 60 seconds
`;

const CCL_COMPLEX = `
permit file.read on '/data/**'
permit file.write on '/data/**' when user.role = 'admin'
permit file.delete on '/data/tmp/**' when user.role = 'admin' and env.mode = 'maintenance'
deny file.delete on '/data/critical/**'
deny network.send on '/external/**' when risk_level = 'high'
deny exec.run on '/**' when user.role = 'guest'
require audit.log on '/data/**'
require backup.create on '/data/critical/**' when env.mode = 'production'
limit api.call 1000 per 3600 seconds
limit file.write 500 per 60 seconds
limit network.send 50 per 10 seconds
`;

// Helpers for building covenant documents for core benchmarks
async function makeCovenantPair() {
  const issuerKp = await generateKeyPair();
  const beneficiaryKp = await generateKeyPair();

  const issuer = {
    id: 'issuer-1',
    publicKey: issuerKp.publicKeyHex,
    role: 'issuer' as const,
  };

  const beneficiary = {
    id: 'beneficiary-1',
    publicKey: beneficiaryKp.publicKeyHex,
    role: 'beneficiary' as const,
  };

  return { issuerKp, beneficiaryKp, issuer, beneficiary };
}

// ===========================================================================
// CRYPTO BENCHMARKS
// ===========================================================================

describe('Crypto Benchmarks', () => {
  it('generateKeyPair: 100 iterations', async () => {
    const result = await bench('crypto.generateKeyPair', 100, async () => {
      await generateKeyPair();
    });
    // Generous threshold: at least 10 ops/sec on slow CI
    expect(result.opsPerSec).toBeGreaterThan(10);
  });

  it('sign: 1000 iterations with 100B message', async () => {
    const kp = await generateKeyPair();
    const msg = makeBytes(100);
    const result = await bench('crypto.sign(100B)', 1000, async () => {
      await sign(msg, kp.privateKey);
    });
    expect(result.opsPerSec).toBeGreaterThan(100);
  });

  it('sign: 1000 iterations with 1KB message', async () => {
    const kp = await generateKeyPair();
    const msg = makeBytes(1024);
    const result = await bench('crypto.sign(1KB)', 1000, async () => {
      await sign(msg, kp.privateKey);
    });
    expect(result.opsPerSec).toBeGreaterThan(100);
  });

  it('sign: 1000 iterations with 10KB message', async () => {
    const kp = await generateKeyPair();
    const msg = makeBytes(10240);
    const result = await bench('crypto.sign(10KB)', 1000, async () => {
      await sign(msg, kp.privateKey);
    });
    expect(result.opsPerSec).toBeGreaterThan(50);
  });

  it('verify: 1000 iterations', async () => {
    const kp = await generateKeyPair();
    const msg = makeBytes(256);
    const sig = await sign(msg, kp.privateKey);
    const result = await bench('crypto.verify', 1000, async () => {
      await verify(msg, sig, kp.publicKey);
    });
    expect(result.opsPerSec).toBeGreaterThan(50);
  });

  it('sha256: 10000 iterations with 100B', () => {
    const data = makeBytes(100);
    const result = bench('crypto.sha256(100B)', 10000, () => {
      sha256(data);
    });
    // bench returns a promise due to async signature; for sync fns it resolves immediately
    return result.then((r) => {
      expect(r.opsPerSec).toBeGreaterThan(10000);
    });
  });

  it('sha256: 10000 iterations with 1KB', () => {
    const data = makeBytes(1024);
    return bench('crypto.sha256(1KB)', 10000, () => {
      sha256(data);
    }).then((r) => {
      expect(r.opsPerSec).toBeGreaterThan(5000);
    });
  });

  it('sha256: 10000 iterations with 10KB', () => {
    const data = makeBytes(10240);
    return bench('crypto.sha256(10KB)', 10000, () => {
      sha256(data);
    }).then((r) => {
      expect(r.opsPerSec).toBeGreaterThan(1000);
    });
  });

  it('canonicalizeJson: 10000 iterations with shallow object', () => {
    const obj = { z: 1, a: 2, m: 3, b: 'hello', x: true };
    return bench('crypto.canonicalizeJson(shallow)', 10000, () => {
      canonicalizeJson(obj);
    }).then((r) => {
      expect(r.opsPerSec).toBeGreaterThan(10000);
    });
  });

  it('canonicalizeJson: 10000 iterations with depth-3 object', () => {
    const obj = makeNestedObject(3);
    return bench('crypto.canonicalizeJson(depth3)', 10000, () => {
      canonicalizeJson(obj);
    }).then((r) => {
      expect(r.opsPerSec).toBeGreaterThan(5000);
    });
  });

  it('canonicalizeJson: 10000 iterations with depth-5 object', () => {
    const obj = makeNestedObject(5);
    return bench('crypto.canonicalizeJson(depth5)', 10000, () => {
      canonicalizeJson(obj);
    }).then((r) => {
      expect(r.opsPerSec).toBeGreaterThan(1000);
    });
  });
});

// ===========================================================================
// CCL BENCHMARKS
// ===========================================================================

describe('CCL Benchmarks', () => {
  it('parse: 1000 iterations (simple)', () => {
    return bench('ccl.parse(simple)', 1000, () => {
      parse(CCL_SIMPLE);
    }).then((r) => {
      expect(r.opsPerSec).toBeGreaterThan(1000);
    });
  });

  it('parse: 1000 iterations (medium)', () => {
    return bench('ccl.parse(medium)', 1000, () => {
      parse(CCL_MEDIUM);
    }).then((r) => {
      expect(r.opsPerSec).toBeGreaterThan(500);
    });
  });

  it('parse: 1000 iterations (complex)', () => {
    return bench('ccl.parse(complex)', 1000, () => {
      parse(CCL_COMPLEX);
    }).then((r) => {
      expect(r.opsPerSec).toBeGreaterThan(200);
    });
  });

  it('evaluate: 10000 iterations', () => {
    const doc = parse(CCL_COMPLEX);
    const ctx = { user: { role: 'admin' }, env: { mode: 'production' }, risk_level: 'low' };
    return bench('ccl.evaluate', 10000, () => {
      evaluate(doc, 'file.read', '/data/reports', ctx);
    }).then((r) => {
      expect(r.opsPerSec).toBeGreaterThan(10000);
    });
  });

  it('merge: 1000 iterations', () => {
    const parent = parse(CCL_MEDIUM);
    const child = parse(CCL_SIMPLE);
    return bench('ccl.merge', 1000, () => {
      merge(parent, child);
    }).then((r) => {
      expect(r.opsPerSec).toBeGreaterThan(5000);
    });
  });

  it('serialize: 1000 iterations', () => {
    const doc = parse(CCL_COMPLEX);
    return bench('ccl.serialize', 1000, () => {
      serialize(doc);
    }).then((r) => {
      expect(r.opsPerSec).toBeGreaterThan(5000);
    });
  });

  it('validateNarrowing: 1000 iterations', () => {
    const parent = parse(`
      permit file.read on '/data/**'
      permit file.write on '/data/**'
      deny file.delete on '/data/critical/**'
    `);
    const child = parse(`
      permit file.read on '/data/reports/**'
    `);
    return bench('ccl.validateNarrowing', 1000, () => {
      validateNarrowing(parent, child);
    }).then((r) => {
      expect(r.opsPerSec).toBeGreaterThan(1000);
    });
  });
});

// ===========================================================================
// CORE BENCHMARKS
// ===========================================================================

describe('Core Benchmarks', () => {
  it('buildCovenant: 100 iterations', async () => {
    const { issuerKp, issuer, beneficiary } = await makeCovenantPair();

    const result = await bench('core.buildCovenant', 100, async () => {
      await buildCovenant({
        issuer,
        beneficiary,
        constraints: CCL_SIMPLE,
        privateKey: issuerKp.privateKey,
      });
    });
    expect(result.opsPerSec).toBeGreaterThan(10);
  });

  it('verifyCovenant: 100 iterations', async () => {
    const { issuerKp, issuer, beneficiary } = await makeCovenantPair();
    const doc = await buildCovenant({
      issuer,
      beneficiary,
      constraints: CCL_SIMPLE,
      privateKey: issuerKp.privateKey,
    });

    const result = await bench('core.verifyCovenant', 100, async () => {
      await verifyCovenant(doc);
    });
    expect(result.opsPerSec).toBeGreaterThan(10);
  });

  it('countersignCovenant: 100 iterations', async () => {
    const { issuerKp, issuer, beneficiary } = await makeCovenantPair();
    const doc = await buildCovenant({
      issuer,
      beneficiary,
      constraints: CCL_SIMPLE,
      privateKey: issuerKp.privateKey,
    });
    const auditorKp = await generateKeyPair();

    const result = await bench('core.countersignCovenant', 100, async () => {
      await countersignCovenant(doc, auditorKp, 'auditor');
    });
    expect(result.opsPerSec).toBeGreaterThan(10);
  });

  it('resolveChain: 100 iterations (depth 1)', async () => {
    const { issuerKp, issuer, beneficiary } = await makeCovenantPair();
    const root = await buildCovenant({
      issuer,
      beneficiary,
      constraints: CCL_SIMPLE,
      privateKey: issuerKp.privateKey,
    });

    const child = await buildCovenant({
      issuer,
      beneficiary,
      constraints: CCL_SIMPLE,
      privateKey: issuerKp.privateKey,
      chain: { parentId: root.id, relation: 'delegates', depth: 1 },
    });

    const resolver = new MemoryChainResolver();
    resolver.add(root);

    const result = await bench('core.resolveChain(depth1)', 100, async () => {
      await resolveChain(child, resolver);
    });
    expect(result.opsPerSec).toBeGreaterThan(100);
  });

  it('resolveChain: 100 iterations (depth 5)', async () => {
    const { issuerKp, issuer, beneficiary } = await makeCovenantPair();
    const resolver = new MemoryChainResolver();

    // Build a chain of depth 5
    let prev = await buildCovenant({
      issuer,
      beneficiary,
      constraints: CCL_SIMPLE,
      privateKey: issuerKp.privateKey,
    });
    resolver.add(prev);

    for (let d = 1; d <= 4; d++) {
      const next = await buildCovenant({
        issuer,
        beneficiary,
        constraints: CCL_SIMPLE,
        privateKey: issuerKp.privateKey,
        chain: { parentId: prev.id, relation: 'delegates', depth: d },
      });
      resolver.add(next);
      prev = next;
    }

    // The leaf document (depth 5)
    const leaf = await buildCovenant({
      issuer,
      beneficiary,
      constraints: CCL_SIMPLE,
      privateKey: issuerKp.privateKey,
      chain: { parentId: prev.id, relation: 'delegates', depth: 5 },
    });

    const result = await bench('core.resolveChain(depth5)', 100, async () => {
      await resolveChain(leaf, resolver);
    });
    expect(result.opsPerSec).toBeGreaterThan(50);
  });

  it('resolveChain: 100 iterations (depth 10)', async () => {
    const { issuerKp, issuer, beneficiary } = await makeCovenantPair();
    const resolver = new MemoryChainResolver();

    let prev = await buildCovenant({
      issuer,
      beneficiary,
      constraints: CCL_SIMPLE,
      privateKey: issuerKp.privateKey,
    });
    resolver.add(prev);

    for (let d = 1; d <= 9; d++) {
      const next = await buildCovenant({
        issuer,
        beneficiary,
        constraints: CCL_SIMPLE,
        privateKey: issuerKp.privateKey,
        chain: { parentId: prev.id, relation: 'delegates', depth: d },
      });
      resolver.add(next);
      prev = next;
    }

    const leaf = await buildCovenant({
      issuer,
      beneficiary,
      constraints: CCL_SIMPLE,
      privateKey: issuerKp.privateKey,
      chain: { parentId: prev.id, relation: 'delegates', depth: 10 },
    });

    const result = await bench('core.resolveChain(depth10)', 100, async () => {
      await resolveChain(leaf, resolver);
    });
    expect(result.opsPerSec).toBeGreaterThan(20);
  });

  it('computeEffectiveConstraints: 100 iterations', async () => {
    const { issuerKp, issuer, beneficiary } = await makeCovenantPair();
    const resolver = new MemoryChainResolver();

    const root = await buildCovenant({
      issuer,
      beneficiary,
      constraints: `permit file.read on '/data/**'`,
      privateKey: issuerKp.privateKey,
    });
    resolver.add(root);

    const child = await buildCovenant({
      issuer,
      beneficiary,
      constraints: `permit file.read on '/data/reports/**'`,
      privateKey: issuerKp.privateKey,
      chain: { parentId: root.id, relation: 'restricts', depth: 1 },
    });

    const ancestors = await resolveChain(child, resolver);

    const result = await bench('core.computeEffectiveConstraints', 100, async () => {
      await computeEffectiveConstraints(child, ancestors);
    });
    expect(result.opsPerSec).toBeGreaterThan(100);
  });
});

// ===========================================================================
// STORE BENCHMARKS
// ===========================================================================

describe('Store Benchmarks', () => {
  it('MemoryStore.put: 10000 iterations', async () => {
    const store = new MemoryStore();
    const { issuerKp, issuer, beneficiary } = await makeCovenantPair();

    // Pre-build a document to reuse (we'll mutate its id for uniqueness)
    const templateDoc = await buildCovenant({
      issuer,
      beneficiary,
      constraints: CCL_SIMPLE,
      privateKey: issuerKp.privateKey,
    });

    let counter = 0;
    const result = await bench('store.put', 10000, async () => {
      // Create a lightweight unique doc by overriding the id
      const doc = { ...templateDoc, id: `bench-put-${counter++}` as any };
      await store.put(doc);
    });
    expect(result.opsPerSec).toBeGreaterThan(10000);
  });

  it('MemoryStore.get: 10000 iterations (from 1000 docs)', async () => {
    const store = new MemoryStore();
    const { issuerKp, issuer, beneficiary } = await makeCovenantPair();

    const templateDoc = await buildCovenant({
      issuer,
      beneficiary,
      constraints: CCL_SIMPLE,
      privateKey: issuerKp.privateKey,
    });

    // Fill with 1000 documents
    const ids: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const id = `bench-get-${i}`;
      ids.push(id);
      await store.put({ ...templateDoc, id: id as any });
    }

    let idx = 0;
    const result = await bench('store.get(1000 docs)', 10000, async () => {
      await store.get(ids[idx % 1000]!);
      idx++;
    });
    expect(result.opsPerSec).toBeGreaterThan(100000);
  });

  it('MemoryStore.list with filter: 1000 iterations', async () => {
    const store = new MemoryStore();
    const { issuerKp, issuer, beneficiary } = await makeCovenantPair();

    const templateDoc = await buildCovenant({
      issuer,
      beneficiary,
      constraints: CCL_SIMPLE,
      privateKey: issuerKp.privateKey,
    });

    // Fill with 200 documents, half from one issuer, half from another
    for (let i = 0; i < 200; i++) {
      const iss = i < 100 ? { ...issuer, id: 'issuer-alpha' } : { ...issuer, id: 'issuer-beta' };
      await store.put({
        ...templateDoc,
        id: `bench-list-${i}` as any,
        issuer: iss,
      });
    }

    const result = await bench('store.list(filter)', 1000, async () => {
      await store.list({ issuerId: 'issuer-alpha' });
    });
    expect(result.opsPerSec).toBeGreaterThan(100);
  });

  it('MemoryStore.putBatch: 100 iterations (100 docs each)', async () => {
    const store = new MemoryStore();
    const { issuerKp, issuer, beneficiary } = await makeCovenantPair();

    const templateDoc = await buildCovenant({
      issuer,
      beneficiary,
      constraints: CCL_SIMPLE,
      privateKey: issuerKp.privateKey,
    });

    let batchCounter = 0;
    const result = await bench('store.putBatch(100)', 100, async () => {
      const batch = [];
      for (let i = 0; i < 100; i++) {
        batch.push({
          ...templateDoc,
          id: `bench-batch-${batchCounter++}` as any,
        });
      }
      await store.putBatch(batch);
    });
    // 100 batches of 100 = 10000 docs; should be fast
    expect(result.opsPerSec).toBeGreaterThan(100);
  });
});

// ===========================================================================
// Print results after all suites complete
// ===========================================================================

describe('Benchmark Summary', () => {
  it('prints the results table', () => {
    printResults();
    // This test always passes; it just ensures the table is printed
    expect(allResults.length).toBeGreaterThan(0);
  });
});
