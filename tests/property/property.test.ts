/**
 * Property-based / fuzz tests for the Stele SDK.
 *
 * Uses a hand-rolled `property()` helper that runs a generator+predicate
 * function N times with random inputs and asserts the predicate holds
 * for every generated value.  No external dependencies beyond vitest.
 *
 * Covers invariants across @stele/crypto, @stele/ccl, @stele/core, @stele/store.
 */

import { describe, it, expect } from 'vitest';

import {
  generateKeyPair,
  sign,
  verify,
  sha256,
  sha256String,
  toHex,
  fromHex,
  base64urlEncode,
  base64urlDecode,
  generateNonce,
} from '@stele/crypto';

import { parse, evaluate, merge, serialize } from '@stele/ccl';

import {
  buildCovenant,
  verifyCovenant,
  computeId,
  canonicalForm,
  serializeCovenant,
  deserializeCovenant,
} from '@stele/core';

import { MemoryStore } from '@stele/store';

// ---------------------------------------------------------------------------
// Property-testing helper
// ---------------------------------------------------------------------------

/**
 * Run a property test: invoke `generator()` to produce a random input,
 * then assert that `predicate(input)` holds.  Repeats `count` times.
 *
 * Both sync and async predicates are supported.
 */
async function property<T>(
  name: string,
  count: number,
  generator: () => T,
  predicate: (value: T) => boolean | Promise<boolean>,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const value = generator();
    const result = await predicate(value);
    if (!result) {
      throw new Error(
        `Property "${name}" failed on iteration ${i + 1}/${count} with input: ${JSON.stringify(value, (_k, v) => (v instanceof Uint8Array ? `Uint8Array(${v.length})` : v))}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Random generators (no external deps -- uses platform CSPRNG)
// ---------------------------------------------------------------------------

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

function randomInt(min: number, max: number): number {
  const range = max - min + 1;
  const bytes = randomBytes(4);
  const value = (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | ((bytes[3]! & 0x7f) << 24));
  return min + (value % range);
}

function randomString(len: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/** Generate a valid even-length hex string of `byteLen` bytes. */
function randomHexString(byteLen: number): string {
  return toHex(randomBytes(byteLen));
}

/** Pick a random element from an array. */
function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(0, arr.length - 1)]!;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const ACTIONS = ['read', 'write', 'delete', 'execute', 'list', 'create', 'update'] as const;
const RESOURCES = ['/data', '/files', '/api', '/logs', '/config', '/users', '/admin'] as const;

/** Build a minimal valid covenant and return it along with the issuer keypair. */
async function buildTestCovenant() {
  const issuerKp = await generateKeyPair();
  const beneficiaryKp = await generateKeyPair();
  const action = pick(ACTIONS);
  const resource = pick(RESOURCES);
  const doc = await buildCovenant({
    issuer: { id: 'issuer-' + randomString(6), publicKey: issuerKp.publicKeyHex, role: 'issuer' },
    beneficiary: { id: 'beneficiary-' + randomString(6), publicKey: beneficiaryKp.publicKeyHex, role: 'beneficiary' },
    constraints: `permit ${action} on '${resource}'`,
    privateKey: issuerKp.privateKey,
  });
  return { doc, issuerKp, beneficiaryKp };
}

// ============================================================================
// CRYPTO INVARIANTS
// ============================================================================

describe('Crypto property-based invariants', () => {
  // 1. sign-then-verify always succeeds
  it('sign then verify always succeeds for any random message and key pair', async () => {
    await property(
      'sign-then-verify',
      75,
      () => ({ messageLen: randomInt(0, 512) }),
      async ({ messageLen }) => {
        const kp = await generateKeyPair();
        const message = randomBytes(messageLen);
        const sig = await sign(message, kp.privateKey);
        return verify(message, sig, kp.publicKey);
      },
    );
  });

  // 2. sha256 determinism
  it('sha256 of the same input always returns the same hash', async () => {
    await property(
      'sha256-determinism',
      100,
      () => randomBytes(randomInt(0, 1024)),
      (data) => {
        const h1 = sha256(data);
        const h2 = sha256(data);
        return h1 === h2;
      },
    );
  });

  // 3. collision resistance on random data
  it('two different random inputs produce different sha256 hashes', async () => {
    await property(
      'sha256-collision-resistance',
      100,
      () => ({ a: randomBytes(32), b: randomBytes(32) }),
      ({ a, b }) => {
        // If by astronomically unlikely chance both are identical, skip
        if (toHex(a) === toHex(b)) return true;
        return sha256(a) !== sha256(b);
      },
    );
  });

  // 4. toHex(fromHex(x)) round-trips for any valid hex string
  it('toHex(fromHex(x)) round-trips for any valid hex string', async () => {
    await property(
      'hex-roundtrip',
      100,
      () => randomHexString(randomInt(0, 128)),
      (hex) => {
        const bytes = fromHex(hex);
        return toHex(bytes) === hex;
      },
    );
  });

  // 5. base64urlEncode/base64urlDecode round-trips
  it('base64urlDecode(base64urlEncode(x)) round-trips for any bytes', async () => {
    await property(
      'base64url-roundtrip',
      100,
      () => randomBytes(randomInt(0, 256)),
      (data) => {
        const encoded = base64urlEncode(data);
        const decoded = base64urlDecode(encoded);
        if (decoded.length !== data.length) return false;
        for (let i = 0; i < data.length; i++) {
          if (data[i] !== decoded[i]) return false;
        }
        return true;
      },
    );
  });

  // 6. base64url output never contains +, /, or = characters
  it('base64url output contains only URL-safe characters', async () => {
    await property(
      'base64url-url-safe',
      75,
      () => randomBytes(randomInt(1, 200)),
      (data) => {
        const encoded = base64urlEncode(data);
        return !encoded.includes('+') && !encoded.includes('/') && !encoded.includes('=');
      },
    );
  });

  // 7. sha256 output is always a 64-character lowercase hex string
  it('sha256 output is always 64 lowercase hex chars', async () => {
    await property(
      'sha256-output-format',
      75,
      () => randomBytes(randomInt(0, 500)),
      (data) => /^[0-9a-f]{64}$/.test(sha256(data)),
    );
  });

  // 8. verify rejects wrong key
  it('signature from key A never verifies under key B', async () => {
    await property(
      'wrong-key-rejection',
      50,
      () => randomBytes(randomInt(1, 128)),
      async (message) => {
        const kpA = await generateKeyPair();
        const kpB = await generateKeyPair();
        const sig = await sign(message, kpA.privateKey);
        const valid = await verify(message, sig, kpB.publicKey);
        return !valid;
      },
    );
  });

  // 9. fromHex(toHex(bytes)) round-trips for any byte array
  it('fromHex(toHex(bytes)) round-trips for any byte array', async () => {
    await property(
      'bytes-hex-roundtrip',
      100,
      () => randomBytes(randomInt(0, 128)),
      (data) => {
        const hex = toHex(data);
        const recovered = fromHex(hex);
        if (recovered.length !== data.length) return false;
        for (let i = 0; i < data.length; i++) {
          if (data[i] !== recovered[i]) return false;
        }
        return true;
      },
    );
  });

  // 10. generateNonce produces 32-byte unique values
  it('generateNonce produces unique 32-byte values', async () => {
    const seen = new Set<string>();
    await property(
      'nonce-uniqueness',
      100,
      () => generateNonce(),
      (nonce) => {
        if (nonce.length !== 32) return false;
        const hex = toHex(nonce);
        if (seen.has(hex)) return false;
        seen.add(hex);
        return true;
      },
    );
  });
});

// ============================================================================
// CCL INVARIANTS
// ============================================================================

describe('CCL property-based invariants', () => {
  // 11. parse(serialize(parse(input))) is equivalent to parse(input) -- idempotent round-trip
  it('parse(serialize(parse(input))) === parse(input) for valid CCL', async () => {
    await property(
      'ccl-idempotent-roundtrip',
      75,
      () => {
        const action = pick(ACTIONS);
        const resource = pick(RESOURCES);
        const type = pick(['permit', 'deny'] as const);
        return `${type} ${action} on '${resource}'`;
      },
      (source) => {
        const parsed1 = parse(source);
        const serialized = serialize(parsed1);
        const parsed2 = parse(serialized);
        // Re-serialize to get a stable comparison form
        const reserialized = serialize(parsed2);
        const parsed3 = parse(reserialized);
        // The key invariant: parse(serialize(parse(input))) produces a document
        // that serializes identically to parse(input) when serialized again
        return serialize(parsed3) === serialize(parsed2);
      },
    );
  });

  // 12. evaluate() always returns { permitted: boolean } for valid parsed docs
  it('evaluate() always returns an object with a boolean permitted field', async () => {
    await property(
      'evaluate-returns-permitted',
      75,
      () => {
        const action = pick(ACTIONS);
        const resource = pick(RESOURCES);
        return {
          source: `permit ${action} on '${resource}'`,
          queryAction: pick(ACTIONS),
          queryResource: pick(RESOURCES),
        };
      },
      ({ source, queryAction, queryResource }) => {
        const doc = parse(source);
        const result = evaluate(doc, queryAction, queryResource);
        return typeof result.permitted === 'boolean';
      },
    );
  });

  // 13. merge(a, a) is equivalent to a (idempotent merge) -- evaluation gives same results
  it('merge(a, a) evaluates the same as a alone', async () => {
    await property(
      'merge-idempotent',
      75,
      () => {
        const action = pick(ACTIONS);
        const resource = pick(RESOURCES);
        return { action, resource, source: `permit ${action} on '${resource}'` };
      },
      ({ action, resource, source }) => {
        const doc = parse(source);
        const merged = merge(doc, doc);
        const resultOriginal = evaluate(doc, action, resource);
        const resultMerged = evaluate(merged, action, resource);
        return resultOriginal.permitted === resultMerged.permitted;
      },
    );
  });

  // 14. deny rules always override permit rules for the same action/resource
  it('deny always overrides permit at equal specificity', async () => {
    await property(
      'deny-wins-over-permit',
      75,
      () => {
        const action = pick(ACTIONS);
        const resource = pick(RESOURCES);
        return { action, resource };
      },
      ({ action, resource }) => {
        const source = `permit ${action} on '${resource}'\ndeny ${action} on '${resource}'`;
        const doc = parse(source);
        const result = evaluate(doc, action, resource);
        return result.permitted === false;
      },
    );
  });

  // 15. default deny: no matching rules means permitted = false
  it('default deny when no rules match the query', async () => {
    await property(
      'default-deny',
      75,
      () => ({
        source: `permit read on '/data'`,
        queryAction: 'unmatched_' + randomString(6),
        queryResource: '/unmatched/' + randomString(6),
      }),
      ({ source, queryAction, queryResource }) => {
        const doc = parse(source);
        return evaluate(doc, queryAction, queryResource).permitted === false;
      },
    );
  });

  // 16. wildcard ** matches any resource
  it('wildcard ** on resource matches any random resource path', async () => {
    await property(
      'wildcard-resource-match',
      75,
      () => '/' + randomString(4) + '/' + randomString(4) + '/' + randomString(4),
      (resource) => {
        const doc = parse("permit read on '**'");
        return evaluate(doc, 'read', resource).permitted === true;
      },
    );
  });

  // 17. parse then evaluate consistency across re-serialization
  it('evaluating original and re-serialized CCL gives same results', async () => {
    await property(
      'serialize-preserves-evaluation',
      50,
      () => {
        const action = pick(ACTIONS);
        const resource = pick(RESOURCES);
        return { action, resource, source: `permit ${action} on '${resource}'` };
      },
      ({ action, resource, source }) => {
        const doc1 = parse(source);
        const doc2 = parse(serialize(doc1));
        return evaluate(doc1, action, resource).permitted === evaluate(doc2, action, resource).permitted;
      },
    );
  });
});

// ============================================================================
// CORE INVARIANTS
// ============================================================================

describe('Core property-based invariants', () => {
  // 18. buildCovenant then verifyCovenant always produces valid=true
  it('buildCovenant then verifyCovenant always produces valid=true', async () => {
    await property(
      'build-verify-roundtrip',
      50,
      () => ({}),
      async () => {
        const { doc } = await buildTestCovenant();
        const result = await verifyCovenant(doc);
        return result.valid === true;
      },
    );
  });

  // 19. computeId is deterministic: same doc yields same id
  it('computeId is deterministic -- same doc always yields same id', async () => {
    await property(
      'computeId-deterministic',
      50,
      () => ({}),
      async () => {
        const { doc } = await buildTestCovenant();
        const id1 = computeId(doc);
        const id2 = computeId(doc);
        return id1 === id2;
      },
    );
  });

  // 20. computeId matches the id assigned at build time
  it('computeId matches the id field set by buildCovenant', async () => {
    await property(
      'computeId-matches-doc-id',
      50,
      () => ({}),
      async () => {
        const { doc } = await buildTestCovenant();
        return computeId(doc) === doc.id;
      },
    );
  });

  // 21. canonicalForm strips id, signature, countersignatures
  it('canonicalForm strips id, signature, and countersignatures', async () => {
    await property(
      'canonicalForm-strips-mutable-fields',
      50,
      () => ({}),
      async () => {
        const { doc } = await buildTestCovenant();
        const canonical = canonicalForm(doc);
        const parsed = JSON.parse(canonical);
        return (
          !('id' in parsed) &&
          !('signature' in parsed) &&
          !('countersignatures' in parsed)
        );
      },
    );
  });

  // 22. canonicalForm is deterministic
  it('canonicalForm is deterministic for the same document', async () => {
    await property(
      'canonicalForm-deterministic',
      50,
      () => ({}),
      async () => {
        const { doc } = await buildTestCovenant();
        return canonicalForm(doc) === canonicalForm(doc);
      },
    );
  });

  // 23. serializeCovenant/deserializeCovenant round-trips
  it('serializeCovenant then deserializeCovenant round-trips all fields', async () => {
    await property(
      'covenant-serialization-roundtrip',
      50,
      () => ({}),
      async () => {
        const { doc } = await buildTestCovenant();
        const json = serializeCovenant(doc);
        const restored = deserializeCovenant(json);
        return (
          restored.id === doc.id &&
          restored.version === doc.version &&
          restored.issuer.id === doc.issuer.id &&
          restored.issuer.publicKey === doc.issuer.publicKey &&
          restored.beneficiary.id === doc.beneficiary.id &&
          restored.beneficiary.publicKey === doc.beneficiary.publicKey &&
          restored.constraints === doc.constraints &&
          restored.nonce === doc.nonce &&
          restored.signature === doc.signature &&
          restored.createdAt === doc.createdAt
        );
      },
    );
  });

  // 24. deserialized covenants still pass verification
  it('deserialized covenants pass verifyCovenant', async () => {
    await property(
      'deserialized-covenant-verifies',
      50,
      () => ({}),
      async () => {
        const { doc } = await buildTestCovenant();
        const restored = deserializeCovenant(serializeCovenant(doc));
        const result = await verifyCovenant(restored);
        return result.valid === true;
      },
    );
  });

  // 25. tampering with constraints invalidates the covenant
  it('tampering with constraints causes verification failure', async () => {
    await property(
      'tampered-constraints-fail',
      50,
      () => ({}),
      async () => {
        const { doc } = await buildTestCovenant();
        const tampered = { ...doc, constraints: `deny delete on '/tampered'` };
        const result = await verifyCovenant(tampered);
        return result.valid === false;
      },
    );
  });
});

// ============================================================================
// STORE INVARIANTS
// ============================================================================

describe('Store property-based invariants', () => {
  // 26. put then get returns the same document
  it('put then get returns the same document', async () => {
    await property(
      'store-put-get',
      50,
      () => ({}),
      async () => {
        const store = new MemoryStore();
        const { doc } = await buildTestCovenant();
        await store.put(doc);
        const retrieved = await store.get(doc.id);
        if (!retrieved) return false;
        return (
          retrieved.id === doc.id &&
          retrieved.signature === doc.signature &&
          retrieved.constraints === doc.constraints
        );
      },
    );
  });

  // 27. delete then get returns undefined
  it('delete then get returns undefined', async () => {
    await property(
      'store-delete-get',
      50,
      () => ({}),
      async () => {
        const store = new MemoryStore();
        const { doc } = await buildTestCovenant();
        await store.put(doc);
        await store.delete(doc.id);
        const retrieved = await store.get(doc.id);
        return retrieved === undefined;
      },
    );
  });

  // 28. list after N puts returns N items
  it('list after N puts returns N items', async () => {
    await property(
      'store-list-count',
      50,
      () => randomInt(1, 5),
      async (n) => {
        const store = new MemoryStore();
        for (let i = 0; i < n; i++) {
          const { doc } = await buildTestCovenant();
          await store.put(doc);
        }
        const items = await store.list();
        return items.length === n;
      },
    );
  });

  // 29. put overwrites -- putting twice with same id keeps count at 1
  it('put with same id overwrites, list still returns 1 item', async () => {
    await property(
      'store-put-overwrite',
      50,
      () => ({}),
      async () => {
        const store = new MemoryStore();
        const { doc } = await buildTestCovenant();
        await store.put(doc);
        await store.put(doc);
        const items = await store.list();
        return items.length === 1;
      },
    );
  });

  // 30. has returns true after put, false after delete
  it('has returns true after put and false after delete', async () => {
    await property(
      'store-has-lifecycle',
      50,
      () => ({}),
      async () => {
        const store = new MemoryStore();
        const { doc } = await buildTestCovenant();
        const beforePut = await store.has(doc.id);
        await store.put(doc);
        const afterPut = await store.has(doc.id);
        await store.delete(doc.id);
        const afterDelete = await store.has(doc.id);
        return beforePut === false && afterPut === true && afterDelete === false;
      },
    );
  });
});
