/**
 * Performance regression guards.
 *
 * These are NOT micro-benchmarks. They are regression guards that fail only
 * if something is catastrophically slow (> 5-10x expected). Each test runs
 * a key operation N times and asserts it completes within a generous time
 * bound. If a test fails, it means something has regressed badly.
 */
import { describe, it, expect } from 'vitest';
import { generateKeyPair, sign, verify, sha256 } from '@nobulex/crypto';
import { parse, evaluate } from '@nobulex/ccl';
import { buildCovenant, verifyCovenant } from '@nobulex/core';
import { MemoryStore } from '@nobulex/store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple CCL source for parse/evaluate benchmarks. */
const SIMPLE_CCL = "permit read on '/data/**'";

/** Pre-encoded message for sign/verify benchmarks. */
const MESSAGE = new TextEncoder().encode('benchmark payload for performance regression testing');

/** Pre-encoded data for hashing benchmarks. */
const HASH_DATA = new TextEncoder().encode('sha256 benchmark data for performance regression testing');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Performance regression guards', () => {
  it('generateKeyPair x 10 completes in < 500ms', async () => {
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      await generateKeyPair();
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('sign x 100 completes in < 2000ms', async () => {
    const kp = await generateKeyPair();
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await sign(MESSAGE, kp.privateKey);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('verify x 100 completes in < 3000ms', async () => {
    const kp = await generateKeyPair();
    const sig = await sign(MESSAGE, kp.privateKey);
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await verify(MESSAGE, sig, kp.publicKey);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });

  it('sha256 x 1000 completes in < 500ms', () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      sha256(HASH_DATA);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('parse (simple CCL) x 500 completes in < 500ms', () => {
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      parse(SIMPLE_CCL);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('evaluate x 1000 completes in < 500ms', () => {
    const doc = parse(SIMPLE_CCL);
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      evaluate(doc, 'read', '/data/file.txt');
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('buildCovenant x 10 completes in < 2000ms', async () => {
    const kp = await generateKeyPair();
    const bobKp = await generateKeyPair();
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      await buildCovenant({
        issuer: { id: 'alice', publicKey: kp.publicKeyHex, role: 'issuer' },
        beneficiary: { id: 'bob', publicKey: bobKp.publicKeyHex, role: 'beneficiary' },
        constraints: SIMPLE_CCL,
        privateKey: kp.privateKey,
      });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('verifyCovenant x 10 completes in < 3000ms', async () => {
    const kp = await generateKeyPair();
    const bobKp = await generateKeyPair();
    const doc = await buildCovenant({
      issuer: { id: 'alice', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'bob', publicKey: bobKp.publicKeyHex, role: 'beneficiary' },
      constraints: SIMPLE_CCL,
      privateKey: kp.privateKey,
    });
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      await verifyCovenant(doc);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });

  it('MemoryStore.put x 1000 completes in < 500ms', async () => {
    const kp = await generateKeyPair();
    const bobKp = await generateKeyPair();
    const doc = await buildCovenant({
      issuer: { id: 'alice', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'bob', publicKey: bobKp.publicKeyHex, role: 'beneficiary' },
      constraints: SIMPLE_CCL,
      privateKey: kp.privateKey,
    });
    const store = new MemoryStore();
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      // Use a unique id for each put to avoid overwriting
      await store.put({ ...doc, id: `doc-${i}` as any });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('MemoryStore.get x 1000 completes in < 200ms', async () => {
    const kp = await generateKeyPair();
    const bobKp = await generateKeyPair();
    const doc = await buildCovenant({
      issuer: { id: 'alice', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'bob', publicKey: bobKp.publicKeyHex, role: 'beneficiary' },
      constraints: SIMPLE_CCL,
      privateKey: kp.privateKey,
    });
    const store = new MemoryStore();
    // Seed the store with documents
    for (let i = 0; i < 100; i++) {
      await store.put({ ...doc, id: `doc-${i}` as any });
    }
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      await store.get(`doc-${i % 100}`);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});
