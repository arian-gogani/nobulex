/**
 * Stele Protocol Conformance Test Suite
 *
 * Runs the conformance suite against the real Stele implementation
 * to prove that the reference implementation is spec-compliant.
 */
import { describe, it, expect } from 'vitest';
import {
  runConformanceSuite,
  cryptoConformance,
  cclConformance,
  covenantConformance,
  interopConformance,
} from '../src/conformance';
import type { ConformanceTarget } from '../src/conformance';

import { buildCovenant, verifyCovenant } from '@stele/core';
import { generateKeyPair, sign, verify, sha256 } from '@stele/crypto';
import { parse, evaluate } from '@stele/ccl';

// ─── Wire up the ConformanceTarget ──────────────────────────────────────────

const steleTarget: ConformanceTarget = {
  buildCovenant,
  verifyCovenant,
  evaluateAction: async (doc, action, resource, context) => {
    const cclDoc = parse(doc.constraints);
    return evaluate(cclDoc, action, resource, context);
  },
  generateKeyPair,
  sign: async (msg, key) => sign(msg, key),
  verify: async (msg, sig, key) => verify(msg, sig, key),
  sha256: (data) => sha256(data),
  parseCCL: parse,
};

// ─── Helper to format failures for readable test output ─────────────────────

function formatFailures(failures: Array<{ test: string; message: string }>): string {
  if (failures.length === 0) return '';
  return failures.map((f) => `  [${f.test}] ${f.message}`).join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Full suite
// ═══════════════════════════════════════════════════════════════════════════

describe('Stele Protocol Conformance Suite', () => {
  it('passes the full conformance suite', async () => {
    const result = await runConformanceSuite(steleTarget);

    if (!result.passed) {
      const details = formatFailures(result.failures);
      expect.fail(
        `Conformance suite failed: ${result.failures.length}/${result.total} checks failed.\n${details}`,
      );
    }

    expect(result.passed).toBe(true);
    expect(result.total).toBeGreaterThan(0);
    expect(result.failures).toHaveLength(0);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Individual categories
// ═══════════════════════════════════════════════════════════════════════════

describe('Conformance: Crypto', () => {
  it('passes all cryptographic primitive checks', async () => {
    const result = await cryptoConformance(steleTarget);

    if (result.failures.length > 0) {
      const details = formatFailures(result.failures);
      expect.fail(
        `Crypto conformance failed: ${result.failures.length}/${result.total} checks.\n${details}`,
      );
    }

    expect(result.failures).toHaveLength(0);
    expect(result.total).toBeGreaterThan(0);
  });

  it('validates Ed25519 sign/verify round-trip', async () => {
    const kp = await generateKeyPair();
    const message = new TextEncoder().encode('conformance test');
    const sig = await sign(message, kp.privateKey);
    const valid = await verify(message, sig, kp.publicKey);
    expect(valid).toBe(true);
  });

  it('validates SHA-256 NIST vectors', async () => {
    const vectors = [
      { input: '', expected: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
      { input: 'abc', expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
      {
        input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
        expected: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
      },
    ];
    for (const vec of vectors) {
      const hash = sha256(new TextEncoder().encode(vec.input));
      expect(hash).toBe(vec.expected);
    }
  });

  it('rejects tampered messages', async () => {
    const kp = await generateKeyPair();
    const message = new TextEncoder().encode('original');
    const sig = await sign(message, kp.privateKey);
    const tampered = new TextEncoder().encode('tampered');
    const valid = await verify(tampered, sig, kp.publicKey);
    expect(valid).toBe(false);
  });

  it('rejects wrong public key', async () => {
    const kpA = await generateKeyPair();
    const kpB = await generateKeyPair();
    const message = new TextEncoder().encode('cross-key test');
    const sig = await sign(message, kpA.privateKey);
    const valid = await verify(message, sig, kpB.publicKey);
    expect(valid).toBe(false);
  });
});

describe('Conformance: CCL', () => {
  it('passes all CCL parsing and evaluation checks', async () => {
    const result = await cclConformance(steleTarget);

    if (result.failures.length > 0) {
      const details = formatFailures(result.failures);
      expect.fail(
        `CCL conformance failed: ${result.failures.length}/${result.total} checks.\n${details}`,
      );
    }

    expect(result.failures).toHaveLength(0);
    expect(result.total).toBeGreaterThan(0);
  });

  it('evaluates permit read on /data', async () => {
    const doc = parse("permit read on '/data'");
    const result = evaluate(doc, 'read', '/data');
    expect(result.permitted).toBe(true);
  });

  it('evaluates deny with wildcard', async () => {
    const doc = parse("deny write on '/system/**'");
    const result = evaluate(doc, 'write', '/system/config');
    expect(result.permitted).toBe(false);
  });

  it('applies default deny', async () => {
    const doc = parse("permit read on '/data'");
    const result = evaluate(doc, 'write', '/other');
    expect(result.permitted).toBe(false);
  });

  it('deny wins at equal specificity', async () => {
    const doc = parse("permit read on '/data'\ndeny read on '/data'");
    const result = evaluate(doc, 'read', '/data');
    expect(result.permitted).toBe(false);
  });

  it('** matches nested paths', async () => {
    const doc = parse("permit read on '/data/**'");
    const result = evaluate(doc, 'read', '/data/users/123/profile');
    expect(result.permitted).toBe(true);
  });

  it('exact resource does not match nested', async () => {
    const doc = parse("permit read on '/secrets'");
    const result = evaluate(doc, 'read', '/secrets/key');
    expect(result.permitted).toBe(false);
  });

  it('parses rate limits correctly', async () => {
    const doc = parse('limit api.call 1000 per 1 hours');
    expect(doc.limits).toHaveLength(1);
    expect(doc.limits[0]!.count).toBe(1000);
    expect(doc.limits[0]!.periodSeconds).toBe(3600);
  });

  it('evaluates conditions', async () => {
    const doc = parse("permit read on '/data' when user.role = 'admin'");
    const permitted = evaluate(doc, 'read', '/data', { user: { role: 'admin' } });
    const denied = evaluate(doc, 'read', '/data', { user: { role: 'guest' } });
    expect(permitted.permitted).toBe(true);
    expect(denied.permitted).toBe(false);
  });
});

describe('Conformance: Covenant', () => {
  it('passes all covenant lifecycle checks', async () => {
    const result = await covenantConformance(steleTarget);

    if (result.failures.length > 0) {
      const details = formatFailures(result.failures);
      expect.fail(
        `Covenant conformance failed: ${result.failures.length}/${result.total} checks.\n${details}`,
      );
    }

    expect(result.failures).toHaveLength(0);
    expect(result.total).toBeGreaterThan(0);
  });

  it('build/verify round-trip', async () => {
    const kp = await generateKeyPair();
    const doc = await buildCovenant({
      issuer: { id: 'alice', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'bob', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit read on '/data/**'",
      privateKey: kp.privateKey,
    });
    const result = await verifyCovenant(doc);
    expect(result.valid).toBe(true);
  });

  it('tampered covenant fails verification', async () => {
    const kp = await generateKeyPair();
    const doc = await buildCovenant({
      issuer: { id: 'alice', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'bob', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit read on '/data/**'",
      privateKey: kp.privateKey,
    });
    const tampered = { ...doc, constraints: "deny write on '/all'" };
    const result = await verifyCovenant(tampered);
    expect(result.valid).toBe(false);
  });

  it('expired covenant is detected', async () => {
    const kp = await generateKeyPair();
    const doc = await buildCovenant({
      issuer: { id: 'alice', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'bob', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit read on '/data'",
      privateKey: kp.privateKey,
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    const result = await verifyCovenant(doc);
    const check = result.checks.find((c) => c.name === 'not_expired');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });
});

describe('Conformance: Interop', () => {
  it('passes all interoperability checks', async () => {
    const result = await interopConformance(steleTarget);

    if (result.failures.length > 0) {
      const details = formatFailures(result.failures);
      expect.fail(
        `Interop conformance failed: ${result.failures.length}/${result.total} checks.\n${details}`,
      );
    }

    expect(result.failures).toHaveLength(0);
    expect(result.total).toBeGreaterThan(0);
  });

  it('document ID matches reference canonical form hash', async () => {
    const kp = await generateKeyPair();
    const doc = await buildCovenant({
      issuer: { id: 'interop', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'interop-b', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit read on '/interop/**'",
      privateKey: kp.privateKey,
    });

    // Reference canonical form: strip id, signature, countersignatures, sort keys
    function sortKeys(value: unknown): unknown {
      if (value === null || value === undefined) return value;
      if (Array.isArray(value)) return value.map(sortKeys);
      if (typeof value === 'object') {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
          const v = (value as Record<string, unknown>)[key];
          if (v !== undefined) sorted[key] = sortKeys(v);
        }
        return sorted;
      }
      return value;
    }

    const { id: _id, signature: _sig, countersignatures: _cs, ...body } = doc;
    const canonical = JSON.stringify(sortKeys(body));
    const expectedId = sha256(new TextEncoder().encode(canonical));

    expect(doc.id).toBe(expectedId);
  });

  it('survives JSON serialize/deserialize round-trip', async () => {
    const kp = await generateKeyPair();
    const doc = await buildCovenant({
      issuer: { id: 'rt', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'rt-b', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit read on '/rt/**'",
      privateKey: kp.privateKey,
    });
    const restored = JSON.parse(JSON.stringify(doc));
    const result = await verifyCovenant(restored);
    expect(result.valid).toBe(true);
  });

  it('protocol version is 1.0', async () => {
    const kp = await generateKeyPair();
    const doc = await buildCovenant({
      issuer: { id: 'ver', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'ver-b', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit read on '/ver'",
      privateKey: kp.privateKey,
    });
    expect(doc.version).toBe('1.0');
  });
});
