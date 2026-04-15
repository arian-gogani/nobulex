/**
 * API Surface Snapshot Tests
 *
 * These tests verify the public API surface of each foundation package
 * has not changed accidentally. For each package, we import everything
 * and verify the exported names match a known list. Only value exports
 * (functions, classes, constants) are checked since type-only exports
 * do not appear in runtime Object.keys().
 */
import { describe, it, expect } from 'vitest';

describe('API Surface Tests', () => {

  // ─── @nobulex/crypto ──────────────────────────────────────────────────────────

  it('@nobulex/crypto exports', async () => {
    const mod = await import('@nobulex/crypto');
    const exports = Object.keys(mod).sort();
    // Verify key exports exist
    expect(exports).toContain('generateKeyPair');
    expect(exports).toContain('sign');
    expect(exports).toContain('verify');
    expect(exports).toContain('sha256');
    expect(exports).toContain('toHex');
    expect(exports).toContain('fromHex');
  });

  // ─── @nobulex/ccl ─────────────────────────────────────────────────────────────

  it('@nobulex/ccl exports', async () => {
    const mod = await import('@nobulex/ccl');
    const exports = Object.keys(mod).sort();
    expect(exports).toEqual([
      'CCLSyntaxError',
      'CCLValidationError',
      'checkRateLimit',
      'evaluate',
      'evaluateCondition',
      'matchAction',
      'matchResource',
      'merge',
      'parse',
      'parseTokens',
      'serialize',
      'specificity',
      'tokenize',
      'validateCCL',
      'validateNarrowing',
    ].sort());
  });

  // ─── @nobulex/core ────────────────────────────────────────────────────────────

  it('@nobulex/core exports', async () => {
    const mod = await import('@nobulex/core');
    const exports = Object.keys(mod).sort();
    expect(exports).toContain('buildCovenant');
    expect(exports).toContain('verifyCovenant');
  });

  // ─── @nobulex/store ───────────────────────────────────────────────────────────

  it('@nobulex/store exports', async () => {
    const mod = await import('@nobulex/store');
    const exports = Object.keys(mod).sort();
    expect(exports).toEqual([
      'FileStore',
      'IndexedStore',
      'MemoryStore',
      'QueryBuilder',
      'SqliteStore',
      'StoreIndex',
      'createQuery',
      'createTransaction',
    ].sort());
  });

  // ─── @nobulex/types ───────────────────────────────────────────────────────────

  it('@nobulex/types exports', async () => {
    const mod = await import('@nobulex/types');
    const exports = Object.keys(mod).sort();
    expect(exports).toEqual([
      'ActiveSpan',
      'CCLError',
      'ChainError',
      'CircuitBreaker',
      'ContentType',
      'Counter',
      'CryptoError',
      'DEFAULT_SEVERITY',
      'DidRelationship',
      'DocumentedErrorCode',
      'DocumentedNobulexError',
      'Gauge',
      'HashAlg',
      'HealthChecker',
      'Histogram',
      'InMemoryCollector',
      'LogLevel',
      'Logger',
      'MetricsRegistry',
      'STELE_VERSION',
      'SUPPORTED_HASH_ALGORITHMS',
      'SUPPORTED_SIGNATURE_SCHEMES',
      'NobulexError',
      'NobulexErrorCode',
      'ProofType',
      'StorageError',
      'Tracer',
      'ValidationError',
      'assertNever',
      'createDebugLogger',
      'createLogger',
      'createMetricsRegistry',
      'createTracer',
      'debug',
      'defaultLogger',
      'defaultMetrics',
      'deprecated',
      'err',
      'errorDocsUrl',
      'formatError',
      'freezeDeep',
      'getEmittedWarnings',
      'isDebugEnabled',
      'isNonEmptyString',
      'isPlainObject',
      'isValidHex',
      'isValidISODate',
      'isValidId',
      'isValidPublicKey',
      'isValidSignature',
      'isValidVersion',
      'ok',
      'resetDeprecationWarnings',
      'sanitizeJsonInput',
      'sanitizeString',
      'validateHex',
      'validateNonEmpty',
      'validateProbability',
      'validateRange',
      'withRetry',
      'wrapDeprecated',
    ].sort());
  });

  // ─── @nobulex/identity ────────────────────────────────────────────────────────

  it('@nobulex/identity exports', async () => {
    const mod = await import('@nobulex/identity');
    const exports = Object.keys(mod).sort();
    expect(exports).toEqual([
      'DEFAULT_EVOLUTION_POLICY',
      'DIDResolver',
      'computeCapabilityManifestHash',
      'computeCarryForward',
      'computeIdentityHash',
      'createDID',
      'createIdentity',
      'deserializeIdentity',
      'didFromKeyPair',
      'evolveIdentity',
      'getLineage',
      'issueSessionCertificate',
      'parseDID',
      'publicKeyToDid',
      'serializeIdentity',
      'shareAncestor',
      'signWithDID',
      'verifyIdentity',
      'verifySessionCertificate',
      'verifyWithDID',
    ].sort());
  });

  // ─── @nobulex/verifier ────────────────────────────────────────────────────────

  it('@nobulex/verifier exports', async () => {
    const mod = await import('@nobulex/verifier');
    const exports = Object.keys(mod).sort();
    expect(exports).toEqual([
      'Verifier',
      'verifyBatch',
    ].sort());
  });

  // ─── @nobulex/enforcement ─────────────────────────────────────────────────────

  it('@nobulex/enforcement exports', async () => {
    const mod = await import('@nobulex/enforcement');
    const exports = Object.keys(mod).sort();
    expect(exports).toEqual([
      'AuditChain',
      'CapabilityError',
      'CapabilityGate',
      'Monitor',
      'MonitorDeniedError',
      'verifyMerkleProof',
    ].sort());
  });

  // ─── @nobulex/sdk ─────────────────────────────────────────────────────────────

  it('@nobulex/sdk exports', async () => {
    const mod = await import('@nobulex/sdk');
    const exports = Object.keys(mod).sort();
    expect(exports).toContain('NobulexClient');
    expect(exports).toContain('generateProof');
    expect(exports).toContain('verifyCounterparty');
    expect(exports).toContain('buildCovenant');
  });

  // ─── Cross-package consistency checks ───────────────────────────────────────

  describe('Cross-package consistency', () => {

    it('PROTOCOL_VERSION is consistent across core and sdk', async () => {
      const core = await import('@nobulex/core');
      const sdk = await import('@nobulex/sdk');
      expect(core.PROTOCOL_VERSION).toBe(sdk.PROTOCOL_VERSION);
    });

    it('MAX_CHAIN_DEPTH is consistent across core and sdk', async () => {
      const core = await import('@nobulex/core');
      const sdk = await import('@nobulex/sdk');
      expect(core.MAX_CHAIN_DEPTH).toBe(sdk.MAX_CHAIN_DEPTH);
    });

    it('buildCovenant is the same function in core and sdk', async () => {
      const core = await import('@nobulex/core');
      const sdk = await import('@nobulex/sdk');
      expect(core.buildCovenant).toBe(sdk.buildCovenant);
    });

    it('generateKeyPair is the same function in crypto and sdk', async () => {
      const crypto = await import('@nobulex/crypto');
      const sdk = await import('@nobulex/sdk');
      expect(crypto.generateKeyPair).toBe(sdk.generateKeyPair);
    });

    it('parse from ccl is the same function as parseCCL from sdk', async () => {
      const ccl = await import('@nobulex/ccl');
      const sdk = await import('@nobulex/sdk');
      expect(ccl.parse).toBe(sdk.parseCCL);
    });
  });
});
