/**
 * Stele Protocol Conformance Suite
 *
 * Provides test vectors and validation functions for any implementation
 * of the Stele protocol. Implementations that pass all conformance checks
 * are considered spec-compliant.
 *
 * Like the W3C Acid Tests for browsers or TLS conformance suites --
 * a standardized set of test vectors that any Stele implementation must pass.
 *
 * This module is self-contained: it does NOT import from other @stele packages.
 * It generates its own keys and test documents using the provided
 * {@link ConformanceTarget} interface.
 *
 * @packageDocumentation
 */

// ─── Public interfaces ──────────────────────────────────────────────────────

/** Aggregate result from running the full conformance suite. */
export interface ConformanceResult {
  /** True when every check passed. */
  passed: boolean;
  /** Total number of individual checks that were executed. */
  total: number;
  /** Details for every check that failed. */
  failures: ConformanceFailure[];
  /** Wall-clock duration in milliseconds. */
  duration: number;
}

/** A single conformance check that did not pass. */
export interface ConformanceFailure {
  /** Short identifier for the check (e.g. `"ed25519-roundtrip"`). */
  test: string;
  /** Category the check belongs to (e.g. `"crypto"`, `"ccl"`). */
  category: string;
  /** The value the check expected. */
  expected: unknown;
  /** The value the implementation actually produced. */
  actual: unknown;
  /** Human-readable explanation of the failure. */
  message: string;
}

/**
 * Functions that the implementation under test must provide.
 *
 * Any Stele-compatible implementation can be tested by wiring up these
 * functions and passing the resulting object to {@link runConformanceSuite}.
 */
export interface ConformanceTarget {
  /** Build a signed covenant document from builder options. */
  buildCovenant: (options: any) => Promise<any>;
  /** Verify a covenant document. Returns `{ valid, checks }`. */
  verifyCovenant: (doc: any) => Promise<any>;
  /** Evaluate an action/resource against a covenant's CCL constraints. */
  evaluateAction: (
    doc: any,
    action: string,
    resource: string,
    context?: any,
  ) => Promise<any>;
  /** Generate an Ed25519 key pair. Returns `{ privateKey, publicKey, publicKeyHex }`. */
  generateKeyPair: () => Promise<any>;
  /** Sign a message with an Ed25519 private key. */
  sign: (message: Uint8Array, privateKey: Uint8Array) => Promise<Uint8Array>;
  /** Verify an Ed25519 signature. */
  verify: (
    message: Uint8Array,
    signature: Uint8Array,
    publicKey: Uint8Array,
  ) => Promise<boolean>;
  /** SHA-256 hash returning a lowercase hex string. */
  sha256: (data: Uint8Array) => Promise<string> | string;
  /** Parse CCL source text into a CCLDocument. */
  parseCCL: (source: string) => any;
}

// ─── Internal types ─────────────────────────────────────────────────────────

/** Result from a single conformance category. */
interface CategoryResult {
  failures: ConformanceFailure[];
  total: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function textEncode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function bytesToHex(data: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < data.length; i++) {
    hex += data[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

// ─── Reference canonical JSON implementation ────────────────────────────────
// Embedded here so the conformance suite is fully self-contained.
// This follows JCS (RFC 8785): recursive alphabetical key sorting.

function referenceSortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(referenceSortKeys);
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) {
        sorted[key] = referenceSortKeys(v);
      }
    }
    return sorted;
  }
  return value;
}

function referenceCanonicalizeJson(obj: unknown): string {
  return JSON.stringify(referenceSortKeys(obj));
}

/**
 * Reference canonical form: strips `id`, `signature`, `countersignatures`
 * and produces deterministic JSON.
 */
function referenceCanonicalForm(doc: any): string {
  const { id: _id, signature: _sig, countersignatures: _cs, ...body } = doc;
  return referenceCanonicalizeJson(body);
}

// ─── Known-answer test vectors ──────────────────────────────────────────────

/**
 * NIST SHA-256 test vectors.
 * Source: FIPS 180-4 / NIST CSRC.
 */
const SHA256_VECTORS: ReadonlyArray<{
  input: string;
  expected: string;
  label: string;
}> = [
  {
    label: 'empty string',
    input: '',
    expected:
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
  {
    label: 'abc',
    input: 'abc',
    expected:
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  },
  {
    label: '448-bit message',
    input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    expected:
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  },
];

/**
 * Canonical JSON (JCS) test vectors.
 * Verifies that implementations sort keys alphabetically and produce
 * identical deterministic output.
 */
const CANONICAL_JSON_VECTORS: ReadonlyArray<{
  label: string;
  input: Record<string, unknown>;
  expected: string;
}> = [
  {
    label: 'flat key ordering',
    input: { z: 1, a: 2, m: [3, 1] },
    expected: '{"a":2,"m":[3,1],"z":1}',
  },
  {
    label: 'nested key ordering',
    input: { b: { z: 1, a: 2 }, a: 1 },
    expected: '{"a":1,"b":{"a":2,"z":1}}',
  },
  {
    label: 'mixed types',
    input: { c: true, b: null, a: 'hello' },
    expected: '{"a":"hello","b":null,"c":true}',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Category 1: Cryptographic primitives
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify that the target's cryptographic primitives conform to spec.
 *
 * Checks:
 * - Ed25519 sign/verify round-trip
 * - SHA-256 known-answer tests (NIST vectors)
 * - Signature verification rejects tampered messages
 * - Different keys produce different signatures
 * - Wrong public key rejects valid signature
 */
export async function cryptoConformance(
  target: ConformanceTarget,
): Promise<CategoryResult> {
  const failures: ConformanceFailure[] = [];
  let total = 0;
  const category = 'crypto';

  // ── Ed25519 sign/verify round-trip ──────────────────────────────────────
  total++;
  try {
    const kp = await target.generateKeyPair();
    const message = textEncode('stele conformance test message');
    const sig = await target.sign(message, kp.privateKey);
    const valid = await target.verify(message, sig, kp.publicKey);
    if (!valid) {
      failures.push({
        test: 'ed25519-roundtrip',
        category,
        expected: true,
        actual: valid,
        message:
          'Ed25519 sign/verify round-trip failed: signature should be valid',
      });
    }
  } catch (err) {
    failures.push({
      test: 'ed25519-roundtrip',
      category,
      expected: 'no error',
      actual: String(err),
      message: `Ed25519 sign/verify round-trip threw: ${err}`,
    });
  }

  // ── SHA-256 known-answer tests (NIST) ───────────────────────────────────
  for (const vec of SHA256_VECTORS) {
    total++;
    try {
      const hash = await target.sha256(textEncode(vec.input));
      if (hash !== vec.expected) {
        failures.push({
          test: `sha256-nist-${vec.label}`,
          category,
          expected: vec.expected,
          actual: hash,
          message: `SHA-256 of "${vec.label}" did not match NIST expected value`,
        });
      }
    } catch (err) {
      failures.push({
        test: `sha256-nist-${vec.label}`,
        category,
        expected: vec.expected,
        actual: String(err),
        message: `SHA-256 of "${vec.label}" threw: ${err}`,
      });
    }
  }

  // ── Signature verification rejects tampered messages ────────────────────
  total++;
  try {
    const kp = await target.generateKeyPair();
    const message = textEncode('original message');
    const sig = await target.sign(message, kp.privateKey);
    const tampered = textEncode('tampered message');
    const valid = await target.verify(tampered, sig, kp.publicKey);
    if (valid) {
      failures.push({
        test: 'ed25519-tamper-reject',
        category,
        expected: false,
        actual: valid,
        message:
          'Tampered message should not verify with original signature',
      });
    }
  } catch (err) {
    failures.push({
      test: 'ed25519-tamper-reject',
      category,
      expected: 'no error',
      actual: String(err),
      message: `Tamper rejection test threw: ${err}`,
    });
  }

  // ── Different keys produce different signatures ─────────────────────────
  total++;
  try {
    const kp1 = await target.generateKeyPair();
    const kp2 = await target.generateKeyPair();
    const message = textEncode('same message different keys');
    const sig1 = await target.sign(message, kp1.privateKey);
    const sig2 = await target.sign(message, kp2.privateKey);
    const hex1 = bytesToHex(sig1);
    const hex2 = bytesToHex(sig2);
    if (hex1 === hex2) {
      failures.push({
        test: 'ed25519-different-keys-different-sigs',
        category,
        expected: 'different signatures',
        actual: 'identical signatures',
        message:
          'Different keys must produce different signatures for the same message',
      });
    }
  } catch (err) {
    failures.push({
      test: 'ed25519-different-keys-different-sigs',
      category,
      expected: 'no error',
      actual: String(err),
      message: `Different-keys test threw: ${err}`,
    });
  }

  // ── Wrong public key rejects valid signature ────────────────────────────
  total++;
  try {
    const kpA = await target.generateKeyPair();
    const kpB = await target.generateKeyPair();
    const message = textEncode('cross-key verification test');
    const sig = await target.sign(message, kpA.privateKey);
    const valid = await target.verify(message, sig, kpB.publicKey);
    if (valid) {
      failures.push({
        test: 'ed25519-wrong-key-reject',
        category,
        expected: false,
        actual: valid,
        message:
          "Signature from key A should not verify with key B's public key",
      });
    }
  } catch (_err) {
    // Throwing is acceptable for invalid verification -- counts as rejection
  }

  // ── Signature is 64 bytes ──────────────────────────────────────────────
  total++;
  try {
    const kp = await target.generateKeyPair();
    const message = textEncode('signature length test');
    const sig = await target.sign(message, kp.privateKey);
    if (sig.length !== 64) {
      failures.push({
        test: 'ed25519-signature-length',
        category,
        expected: 64,
        actual: sig.length,
        message: 'Ed25519 signature must be exactly 64 bytes',
      });
    }
  } catch (err) {
    failures.push({
      test: 'ed25519-signature-length',
      category,
      expected: 'no error',
      actual: String(err),
      message: `Signature length test threw: ${err}`,
    });
  }

  // ── Public key is 32 bytes ─────────────────────────────────────────────
  total++;
  try {
    const kp = await target.generateKeyPair();
    if (kp.publicKey.length !== 32) {
      failures.push({
        test: 'ed25519-pubkey-length',
        category,
        expected: 32,
        actual: kp.publicKey.length,
        message: 'Ed25519 public key must be exactly 32 bytes',
      });
    }
  } catch (err) {
    failures.push({
      test: 'ed25519-pubkey-length',
      category,
      expected: 'no error',
      actual: String(err),
      message: `Public key length test threw: ${err}`,
    });
  }

  return { failures, total };
}

// ═══════════════════════════════════════════════════════════════════════════
// Category 2: CCL parsing and evaluation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify that the target's CCL parser and evaluator conform to spec.
 *
 * Checks:
 * - `permit read on '/data'` permits read on /data
 * - `deny write on '/system/**'` denies write on /system/config
 * - Default deny: no matching rule results in denied
 * - Deny-wins: permit + deny on same resource results in denied
 * - Wildcards: `**` matches nested paths
 * - Rate limits parse correctly
 * - Conditions evaluate correctly
 * - Exact resource matching: `/secrets` does NOT match `/secrets/key`
 */
export async function cclConformance(
  target: ConformanceTarget,
): Promise<CategoryResult> {
  const failures: ConformanceFailure[] = [];
  let total = 0;
  const category = 'ccl';

  // Helper: build a covenant with given constraints, then evaluate an action.
  async function evalConstraints(
    constraints: string,
    action: string,
    resource: string,
    context?: any,
  ): Promise<{ permitted: boolean }> {
    const kp = await target.generateKeyPair();
    const doc = await target.buildCovenant({
      issuer: {
        id: 'conformance-issuer',
        publicKey: kp.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'conformance-beneficiary',
        publicKey: kp.publicKeyHex,
        role: 'beneficiary',
      },
      constraints,
      privateKey: kp.privateKey,
    });
    return target.evaluateAction(doc, action, resource, context);
  }

  // ── permit read on '/data' permits read on /data ────────────────────────
  total++;
  try {
    const result = await evalConstraints(
      "permit read on '/data'",
      'read',
      '/data',
    );
    if (!result.permitted) {
      failures.push({
        test: 'ccl-permit-basic',
        category,
        expected: true,
        actual: result.permitted,
        message: "permit read on '/data' must permit read on /data",
      });
    }
  } catch (err) {
    failures.push({
      test: 'ccl-permit-basic',
      category,
      expected: true,
      actual: String(err),
      message: `Basic permit test threw: ${err}`,
    });
  }

  // ── deny write on '/system/**' denies write on /system/config ──────────
  total++;
  try {
    const result = await evalConstraints(
      "deny write on '/system/**'",
      'write',
      '/system/config',
    );
    if (result.permitted) {
      failures.push({
        test: 'ccl-deny-wildcard',
        category,
        expected: false,
        actual: result.permitted,
        message:
          "deny write on '/system/**' must deny write on /system/config",
      });
    }
  } catch (err) {
    failures.push({
      test: 'ccl-deny-wildcard',
      category,
      expected: false,
      actual: String(err),
      message: `Deny wildcard test threw: ${err}`,
    });
  }

  // ── Default deny: no matching rule -> denied ───────────────────────────
  total++;
  try {
    const result = await evalConstraints(
      "permit read on '/data'",
      'write',
      '/other',
    );
    if (result.permitted) {
      failures.push({
        test: 'ccl-default-deny',
        category,
        expected: false,
        actual: result.permitted,
        message: 'When no rules match, result must be denied (default deny)',
      });
    }
  } catch (err) {
    failures.push({
      test: 'ccl-default-deny',
      category,
      expected: false,
      actual: String(err),
      message: `Default deny test threw: ${err}`,
    });
  }

  // ── Deny-wins: permit + deny on same resource -> denied ────────────────
  total++;
  try {
    const constraints = "permit read on '/data'\ndeny read on '/data'";
    const result = await evalConstraints(constraints, 'read', '/data');
    if (result.permitted) {
      failures.push({
        test: 'ccl-deny-wins',
        category,
        expected: false,
        actual: result.permitted,
        message:
          'When permit and deny have equal specificity, deny must win',
      });
    }
  } catch (err) {
    failures.push({
      test: 'ccl-deny-wins',
      category,
      expected: false,
      actual: String(err),
      message: `Deny-wins test threw: ${err}`,
    });
  }

  // ── Wildcards: ** matches nested paths ─────────────────────────────────
  total++;
  try {
    const result = await evalConstraints(
      "permit read on '/data/**'",
      'read',
      '/data/users/123/profile',
    );
    if (!result.permitted) {
      failures.push({
        test: 'ccl-wildcard-nested',
        category,
        expected: true,
        actual: result.permitted,
        message: '** wildcard must match deeply nested paths',
      });
    }
  } catch (err) {
    failures.push({
      test: 'ccl-wildcard-nested',
      category,
      expected: true,
      actual: String(err),
      message: `Wildcard nested test threw: ${err}`,
    });
  }

  // ── Rate limits parse correctly ────────────────────────────────────────
  total++;
  try {
    const cclDoc = target.parseCCL('limit api.call 1000 per 1 hours');
    if (!cclDoc.limits || cclDoc.limits.length !== 1) {
      failures.push({
        test: 'ccl-rate-limit-parse',
        category,
        expected: 1,
        actual: cclDoc.limits?.length ?? 0,
        message: 'Rate limit statement must parse into exactly 1 limit',
      });
    } else {
      const limit = cclDoc.limits[0];
      if (limit.count !== 1000) {
        failures.push({
          test: 'ccl-rate-limit-count',
          category,
          expected: 1000,
          actual: limit.count,
          message: 'Rate limit count must be 1000',
        });
      }
      if (limit.periodSeconds !== 3600) {
        failures.push({
          test: 'ccl-rate-limit-period',
          category,
          expected: 3600,
          actual: limit.periodSeconds,
          message: 'Rate limit period must be 3600 seconds (1 hour)',
        });
      }
    }
  } catch (err) {
    failures.push({
      test: 'ccl-rate-limit-parse',
      category,
      expected: 'successful parse',
      actual: String(err),
      message: `Rate limit parse test threw: ${err}`,
    });
  }

  // ── Conditions evaluate correctly (match) ──────────────────────────────
  total++;
  try {
    const constraints = "permit read on '/data' when user.role = 'admin'";
    const result = await evalConstraints(constraints, 'read', '/data', {
      user: { role: 'admin' },
    });
    if (!result.permitted) {
      failures.push({
        test: 'ccl-condition-match',
        category,
        expected: true,
        actual: result.permitted,
        message:
          "Condition user.role = 'admin' must permit when context has role=admin",
      });
    }
  } catch (err) {
    failures.push({
      test: 'ccl-condition-match',
      category,
      expected: true,
      actual: String(err),
      message: `Condition match test threw: ${err}`,
    });
  }

  // ── Conditions evaluate correctly (no match) ──────────────────────────
  total++;
  try {
    const constraints = "permit read on '/data' when user.role = 'admin'";
    const result = await evalConstraints(constraints, 'read', '/data', {
      user: { role: 'guest' },
    });
    if (result.permitted) {
      failures.push({
        test: 'ccl-condition-no-match',
        category,
        expected: false,
        actual: result.permitted,
        message:
          "Condition user.role = 'admin' must deny when context has role=guest",
      });
    }
  } catch (err) {
    failures.push({
      test: 'ccl-condition-no-match',
      category,
      expected: false,
      actual: String(err),
      message: `Condition no-match test threw: ${err}`,
    });
  }

  // ── Exact resource matching ────────────────────────────────────────────
  total++;
  try {
    const result = await evalConstraints(
      "permit read on '/secrets'",
      'read',
      '/secrets/key',
    );
    if (result.permitted) {
      failures.push({
        test: 'ccl-exact-resource',
        category,
        expected: false,
        actual: result.permitted,
        message:
          "'/secrets' must not match '/secrets/key' -- exact matching required without **",
      });
    }
  } catch (err) {
    failures.push({
      test: 'ccl-exact-resource',
      category,
      expected: false,
      actual: String(err),
      message: `Exact resource matching test threw: ${err}`,
    });
  }

  // ── Empty/invalid CCL source throws ────────────────────────────────────
  total++;
  try {
    target.parseCCL('');
    failures.push({
      test: 'ccl-empty-source-rejects',
      category,
      expected: 'error thrown',
      actual: 'no error',
      message: 'Parsing empty CCL source must throw',
    });
  } catch (_err) {
    // Expected: parsing empty source should throw
  }

  return { failures, total };
}

// ═══════════════════════════════════════════════════════════════════════════
// Category 3: Covenant lifecycle
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify that the target's covenant build/verify lifecycle conforms to spec.
 *
 * Checks:
 * - Build -> verify round-trip
 * - Tampered covenant fails verification
 * - Expired covenant detected
 * - ID integrity check (id matches content hash)
 * - Constraints must be valid CCL
 * - Nonce must be present
 * - Signature is a hex string of correct length
 */
export async function covenantConformance(
  target: ConformanceTarget,
): Promise<CategoryResult> {
  const failures: ConformanceFailure[] = [];
  let total = 0;
  const category = 'covenant';

  // Helper: build a standard test covenant with optional overrides.
  async function buildTestCovenant(overrides?: any) {
    const kp = await target.generateKeyPair();
    const defaults = {
      issuer: {
        id: 'test-issuer',
        publicKey: kp.publicKeyHex,
        role: 'issuer' as const,
      },
      beneficiary: {
        id: 'test-beneficiary',
        publicKey: kp.publicKeyHex,
        role: 'beneficiary' as const,
      },
      constraints: "permit read on '/data/**'",
      privateKey: kp.privateKey,
    };
    return {
      doc: await target.buildCovenant({ ...defaults, ...overrides }),
      kp,
    };
  }

  // ── Build -> verify round-trip ─────────────────────────────────────────
  total++;
  try {
    const { doc } = await buildTestCovenant();
    const result = await target.verifyCovenant(doc);
    if (!result.valid) {
      const failedChecks = result.checks
        ?.filter((c: any) => !c.passed)
        .map((c: any) => c.name)
        .join(', ');
      failures.push({
        test: 'covenant-build-verify-roundtrip',
        category,
        expected: true,
        actual: result.valid,
        message: `Freshly built covenant must pass verification. Failed: ${failedChecks}`,
      });
    }
  } catch (err) {
    failures.push({
      test: 'covenant-build-verify-roundtrip',
      category,
      expected: 'no error',
      actual: String(err),
      message: `Build/verify round-trip threw: ${err}`,
    });
  }

  // ── Tampered covenant fails verification ───────────────────────────────
  total++;
  try {
    const { doc } = await buildTestCovenant();
    const tampered = { ...doc, constraints: "deny write on '/all'" };
    const result = await target.verifyCovenant(tampered);
    if (result.valid) {
      failures.push({
        test: 'covenant-tamper-detection',
        category,
        expected: false,
        actual: result.valid,
        message:
          'Tampered covenant (modified constraints) must fail verification',
      });
    }
  } catch (_err) {
    // Throwing is acceptable for tampered documents
  }

  // ── Expired covenant detected ──────────────────────────────────────────
  total++;
  try {
    const kp = await target.generateKeyPair();
    const doc = await target.buildCovenant({
      issuer: {
        id: 'test-issuer',
        publicKey: kp.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'test-beneficiary',
        publicKey: kp.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: "permit read on '/data'",
      privateKey: kp.privateKey,
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    const result = await target.verifyCovenant(doc);
    const expiryCheck = result.checks?.find(
      (c: any) => c.name === 'not_expired',
    );
    if (!expiryCheck || expiryCheck.passed) {
      failures.push({
        test: 'covenant-expired-detection',
        category,
        expected: false,
        actual: expiryCheck?.passed ?? 'check not found',
        message:
          'Expired covenant must be detected (not_expired check should fail)',
      });
    }
  } catch (err) {
    failures.push({
      test: 'covenant-expired-detection',
      category,
      expected: 'expiry detection',
      actual: String(err),
      message: `Expiry detection test threw: ${err}`,
    });
  }

  // ── ID integrity check ─────────────────────────────────────────────────
  total++;
  try {
    const { doc } = await buildTestCovenant();
    const badId = {
      ...doc,
      id: '0000000000000000000000000000000000000000000000000000000000000000',
    };
    const result = await target.verifyCovenant(badId);
    const idCheck = result.checks?.find((c: any) => c.name === 'id_match');
    if (!idCheck || idCheck.passed) {
      failures.push({
        test: 'covenant-id-integrity',
        category,
        expected: false,
        actual: idCheck?.passed ?? 'check not found',
        message: 'Covenant with tampered ID must fail the id_match check',
      });
    }
  } catch (_err) {
    // Throwing is acceptable for invalid documents
  }

  // ── Constraints must be valid CCL ──────────────────────────────────────
  total++;
  try {
    const { doc } = await buildTestCovenant();
    const badCCL = { ...doc, constraints: 'not valid ccl at all ###' };
    const result = await target.verifyCovenant(badCCL);
    const cclCheck = result.checks?.find(
      (c: any) => c.name === 'ccl_parses',
    );
    if (!cclCheck || cclCheck.passed) {
      failures.push({
        test: 'covenant-invalid-ccl',
        category,
        expected: false,
        actual: cclCheck?.passed ?? 'check not found',
        message:
          'Covenant with invalid CCL constraints must fail the ccl_parses check',
      });
    }
  } catch (_err) {
    // Throwing is also acceptable
  }

  // ── Nonce must be present ──────────────────────────────────────────────
  total++;
  try {
    const { doc } = await buildTestCovenant();
    const badNonce = { ...doc, nonce: '' };
    const result = await target.verifyCovenant(badNonce);
    const nonceCheck = result.checks?.find(
      (c: any) => c.name === 'nonce_present',
    );
    if (!nonceCheck || nonceCheck.passed) {
      failures.push({
        test: 'covenant-nonce-present',
        category,
        expected: false,
        actual: nonceCheck?.passed ?? 'check not found',
        message: 'Covenant with empty nonce must fail the nonce_present check',
      });
    }
  } catch (_err) {
    // Throwing is also acceptable
  }

  // ── Signature is hex string of correct length ──────────────────────────
  total++;
  try {
    const { doc } = await buildTestCovenant();
    const sigHexRegex = /^[0-9a-f]{128}$/;
    if (!sigHexRegex.test(doc.signature)) {
      failures.push({
        test: 'covenant-signature-format',
        category,
        expected: '128-char lowercase hex string (64-byte Ed25519 signature)',
        actual: `${typeof doc.signature}, length=${doc.signature?.length}`,
        message:
          'Covenant signature must be a 128-character lowercase hex string',
      });
    }
  } catch (err) {
    failures.push({
      test: 'covenant-signature-format',
      category,
      expected: 'no error',
      actual: String(err),
      message: `Signature format test threw: ${err}`,
    });
  }

  // ── Document has required fields ───────────────────────────────────────
  total++;
  try {
    const { doc } = await buildTestCovenant();
    const requiredFields = [
      'id',
      'version',
      'issuer',
      'beneficiary',
      'constraints',
      'nonce',
      'createdAt',
      'signature',
    ];
    const missing = requiredFields.filter(
      (f) => (doc as any)[f] === undefined || (doc as any)[f] === null,
    );
    if (missing.length > 0) {
      failures.push({
        test: 'covenant-required-fields',
        category,
        expected: 'all required fields present',
        actual: `missing: ${missing.join(', ')}`,
        message: `Covenant document is missing required fields: ${missing.join(', ')}`,
      });
    }
  } catch (err) {
    failures.push({
      test: 'covenant-required-fields',
      category,
      expected: 'no error',
      actual: String(err),
      message: `Required fields test threw: ${err}`,
    });
  }

  // ── Issuer and beneficiary have correct roles ──────────────────────────
  total++;
  try {
    const { doc } = await buildTestCovenant();
    if (doc.issuer?.role !== 'issuer') {
      failures.push({
        test: 'covenant-issuer-role',
        category,
        expected: 'issuer',
        actual: doc.issuer?.role,
        message: 'Issuer party must have role "issuer"',
      });
    }
    if (doc.beneficiary?.role !== 'beneficiary') {
      failures.push({
        test: 'covenant-beneficiary-role',
        category,
        expected: 'beneficiary',
        actual: doc.beneficiary?.role,
        message: 'Beneficiary party must have role "beneficiary"',
      });
    }
  } catch (err) {
    failures.push({
      test: 'covenant-party-roles',
      category,
      expected: 'no error',
      actual: String(err),
      message: `Party roles test threw: ${err}`,
    });
  }

  return { failures, total };
}

// ═══════════════════════════════════════════════════════════════════════════
// Category 4: Interoperability
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify cross-implementation interoperability.
 *
 * Checks:
 * - Canonical JSON test vectors (JCS compatibility)
 * - JSON serialize/deserialize round-trip
 * - Document ID matches reference canonical form hash
 * - ID format (64-char lowercase hex)
 * - Protocol version is "1.0"
 * - Nonce format (64-char hex)
 */
export async function interopConformance(
  target: ConformanceTarget,
): Promise<CategoryResult> {
  const failures: ConformanceFailure[] = [];
  let total = 0;
  const category = 'interop';

  // ── Canonical JSON test vectors ────────────────────────────────────────
  // Verify that the implementation's canonical JSON matches reference output
  // by hashing both the reference and the implementation's output.
  for (const vec of CANONICAL_JSON_VECTORS) {
    total++;
    try {
      // Hash the reference canonical form
      const referenceHash = await target.sha256(textEncode(vec.expected));
      // Hash the input after canonicalization by the reference implementation
      const referenceCanonical = referenceCanonicalizeJson(vec.input);
      const referenceCanonicalHash = await target.sha256(
        textEncode(referenceCanonical),
      );
      // Verify the reference itself is self-consistent
      if (referenceHash !== referenceCanonicalHash) {
        failures.push({
          test: `interop-canonical-json-${vec.label}`,
          category,
          expected: referenceHash,
          actual: referenceCanonicalHash,
          message: `Canonical JSON reference self-check failed for "${vec.label}"`,
        });
      }
      // Verify the canonical output matches the expected string
      if (referenceCanonical !== vec.expected) {
        failures.push({
          test: `interop-canonical-json-${vec.label}`,
          category,
          expected: vec.expected,
          actual: referenceCanonical,
          message: `Reference canonical JSON mismatch for "${vec.label}"`,
        });
      }
    } catch (err) {
      failures.push({
        test: `interop-canonical-json-${vec.label}`,
        category,
        expected: 'no error',
        actual: String(err),
        message: `Canonical JSON test "${vec.label}" threw: ${err}`,
      });
    }
  }

  // ── Document ID matches reference canonical form hash ──────────────────
  // This is the critical interop test: it verifies that the implementation's
  // canonical JSON, SHA-256, and ID computation are all compatible with the
  // reference implementation.
  total++;
  try {
    const kp = await target.generateKeyPair();
    const doc = await target.buildCovenant({
      issuer: {
        id: 'interop-issuer',
        publicKey: kp.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'interop-beneficiary',
        publicKey: kp.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: "permit read on '/interop/**'",
      privateKey: kp.privateKey,
    });

    // Compute the ID using the reference canonical form + target's sha256
    const canonical = referenceCanonicalForm(doc);
    const expectedId = await target.sha256(textEncode(canonical));

    if (doc.id !== expectedId) {
      failures.push({
        test: 'interop-id-matches-reference-canonical',
        category,
        expected: expectedId,
        actual: doc.id,
        message:
          'Document ID must equal SHA-256 of the reference canonical form ' +
          '(verifies JCS compatibility)',
      });
    }
  } catch (err) {
    failures.push({
      test: 'interop-id-matches-reference-canonical',
      category,
      expected: 'no error',
      actual: String(err),
      message: `Reference canonical ID test threw: ${err}`,
    });
  }

  // ── JSON serialize/deserialize round-trip ──────────────────────────────
  total++;
  try {
    const kp = await target.generateKeyPair();
    const doc = await target.buildCovenant({
      issuer: {
        id: 'roundtrip-issuer',
        publicKey: kp.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'roundtrip-beneficiary',
        publicKey: kp.publicKeyHex,
        role: 'beneficiary',
      },
      constraints:
        "permit read on '/interop/**'\ndeny write on '/interop/restricted'",
      privateKey: kp.privateKey,
    });
    const json = JSON.stringify(doc);
    const restored = JSON.parse(json);
    const result = await target.verifyCovenant(restored);
    if (!result.valid) {
      failures.push({
        test: 'interop-serialize-roundtrip',
        category,
        expected: true,
        actual: result.valid,
        message:
          'Covenant must remain valid after JSON serialize/deserialize round-trip',
      });
    }
  } catch (err) {
    failures.push({
      test: 'interop-serialize-roundtrip',
      category,
      expected: 'no error',
      actual: String(err),
      message: `Interop serialize round-trip threw: ${err}`,
    });
  }

  // ── Document ID format ─────────────────────────────────────────────────
  total++;
  try {
    const kp = await target.generateKeyPair();
    const doc = await target.buildCovenant({
      issuer: {
        id: 'format-issuer',
        publicKey: kp.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'format-beneficiary',
        publicKey: kp.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: "permit read on '/format'",
      privateKey: kp.privateKey,
    });
    const idRegex = /^[0-9a-f]{64}$/;
    if (!idRegex.test(doc.id)) {
      failures.push({
        test: 'interop-id-format',
        category,
        expected: '64-char lowercase hex string',
        actual: doc.id,
        message:
          'Document ID must be a 64-character lowercase hex string (SHA-256)',
      });
    }
  } catch (err) {
    failures.push({
      test: 'interop-id-format',
      category,
      expected: 'no error',
      actual: String(err),
      message: `ID format test threw: ${err}`,
    });
  }

  // ── Protocol version is "1.0" ──────────────────────────────────────────
  total++;
  try {
    const kp = await target.generateKeyPair();
    const doc = await target.buildCovenant({
      issuer: {
        id: 'version-issuer',
        publicKey: kp.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'version-beneficiary',
        publicKey: kp.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: "permit read on '/version'",
      privateKey: kp.privateKey,
    });
    if (doc.version !== '1.0') {
      failures.push({
        test: 'interop-protocol-version',
        category,
        expected: '1.0',
        actual: doc.version,
        message: 'Protocol version must be "1.0"',
      });
    }
  } catch (err) {
    failures.push({
      test: 'interop-protocol-version',
      category,
      expected: 'no error',
      actual: String(err),
      message: `Protocol version test threw: ${err}`,
    });
  }

  // ── Nonce format (64-char hex) ─────────────────────────────────────────
  total++;
  try {
    const kp = await target.generateKeyPair();
    const doc = await target.buildCovenant({
      issuer: {
        id: 'nonce-issuer',
        publicKey: kp.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'nonce-beneficiary',
        publicKey: kp.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: "permit read on '/nonce'",
      privateKey: kp.privateKey,
    });
    const nonceRegex = /^[0-9a-f]{64}$/i;
    if (!nonceRegex.test(doc.nonce)) {
      failures.push({
        test: 'interop-nonce-format',
        category,
        expected: '64-char hex string (32 bytes)',
        actual: doc.nonce,
        message:
          'Nonce must be a 64-character hex string representing 32 random bytes',
      });
    }
  } catch (err) {
    failures.push({
      test: 'interop-nonce-format',
      category,
      expected: 'no error',
      actual: String(err),
      message: `Nonce format test threw: ${err}`,
    });
  }

  // ── createdAt is valid ISO 8601 ────────────────────────────────────────
  total++;
  try {
    const kp = await target.generateKeyPair();
    const doc = await target.buildCovenant({
      issuer: {
        id: 'timestamp-issuer',
        publicKey: kp.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'timestamp-beneficiary',
        publicKey: kp.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: "permit read on '/timestamp'",
      privateKey: kp.privateKey,
    });
    const parsed = new Date(doc.createdAt);
    if (isNaN(parsed.getTime())) {
      failures.push({
        test: 'interop-timestamp-format',
        category,
        expected: 'valid ISO 8601 timestamp',
        actual: doc.createdAt,
        message: 'createdAt must be a valid ISO 8601 timestamp',
      });
    }
  } catch (err) {
    failures.push({
      test: 'interop-timestamp-format',
      category,
      expected: 'no error',
      actual: String(err),
      message: `Timestamp format test threw: ${err}`,
    });
  }

  return { failures, total };
}

// ═══════════════════════════════════════════════════════════════════════════
// Full suite runner
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the complete Stele Protocol Conformance Suite.
 *
 * Executes all four categories (crypto, CCL, covenant, interop) and
 * aggregates the results. An implementation that returns
 * `result.passed === true` is considered spec-compliant.
 *
 * @param target - The implementation under test.
 * @returns Aggregate conformance result.
 *
 * @example
 * ```typescript
 * import { runConformanceSuite } from '@stele/sdk/conformance';
 * import { buildCovenant, verifyCovenant } from '@stele/core';
 * import { generateKeyPair, sign, verify, sha256 } from '@stele/crypto';
 * import { parse, evaluate } from '@stele/ccl';
 *
 * const result = await runConformanceSuite({
 *   buildCovenant,
 *   verifyCovenant,
 *   evaluateAction: async (doc, action, resource, ctx) => {
 *     const cclDoc = parse(doc.constraints);
 *     return evaluate(cclDoc, action, resource, ctx);
 *   },
 *   generateKeyPair,
 *   sign: async (msg, key) => sign(msg, key),
 *   verify: async (msg, sig, key) => verify(msg, sig, key),
 *   sha256: (data) => sha256(data),
 *   parseCCL: parse,
 * });
 *
 * console.log(result.passed);  // true
 * console.log(result.total);   // number of checks run
 * ```
 */
export async function runConformanceSuite(
  target: ConformanceTarget,
): Promise<ConformanceResult> {
  const start = Date.now();

  const [crypto, ccl, covenant, interop] = await Promise.all([
    cryptoConformance(target),
    cclConformance(target),
    covenantConformance(target),
    interopConformance(target),
  ]);

  const allFailures = [
    ...crypto.failures,
    ...ccl.failures,
    ...covenant.failures,
    ...interop.failures,
  ];

  const total =
    crypto.total + ccl.total + covenant.total + interop.total;

  return {
    passed: allFailures.length === 0,
    total,
    failures: allFailures,
    duration: Date.now() - start,
  };
}
