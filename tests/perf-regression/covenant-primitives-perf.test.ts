/**
 * Performance regression guards for covenant primitives.
 *
 * These tests verify that core covenant operations (verification, enforcement,
 * DSL parsing, hash chain building, and Merkle proofs) complete within
 * acceptable time budgets. A failure indicates a severe performance regression.
 */
import { describe, it, expect } from 'vitest';
import { parseSource, compile } from '@nobulex/covenant-lang';
import {
  ActionLogBuilder,
  verifyIntegrity,
  generateMerkleProof,
  verifyMerkleProof,
} from '@nobulex/action-log';
import { EnforcementMiddleware } from '@nobulex/middleware';
import { verify } from '@nobulex/verification';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** A realistic covenant DSL source used throughout the benchmarks. */
const COVENANT_SOURCE = `covenant BenchmarkCovenant {
  forbid transfer (amount > 500);
  permit transfer;
  permit read;
  permit write;
  forbid delete;
  require counterparty.compliance_score >= 0.8;
}`;

/** Pre-parsed spec to avoid repeated parse overhead in non-parse benchmarks. */
const SPEC = parseSource(COVENANT_SOURCE);

/** Pre-compiled enforcement function. */
const ENFORCE = compile(SPEC);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an ActionLog with `n` entries. Even-indexed entries use a permitted
 * action ("read"), odd-indexed entries use another permitted action ("write").
 * All entries have monotonically increasing timestamps.
 */
function buildLog(n: number) {
  const builder = new ActionLogBuilder('did:nobulex:perf-agent');
  const baseTime = new Date('2025-01-01T00:00:00.000Z').getTime();
  for (let i = 0; i < n; i++) {
    builder.append({
      action: i % 2 === 0 ? 'read' : 'write',
      resource: `/resource/${i}`,
      params: { index: i, counterparty: { compliance_score: 0.95 } },
      outcome: 'success',
      timestamp: new Date(baseTime + i * 1000).toISOString(),
    });
  }
  return builder.toLog();
}

/**
 * Generate an array of distinct covenant DSL source strings.
 */
function generateCovenantSources(n: number): string[] {
  const sources: string[] = [];
  for (let i = 0; i < n; i++) {
    sources.push(`covenant Benchmark_${i} {
  forbid transfer (amount > ${500 + i});
  permit transfer;
  permit read;
  forbid delete;
  require counterparty.trust_score >= ${(0.7 + (i % 30) * 0.01).toFixed(2)};
}`);
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Pre-built fixtures for large-scale tests (built once, reused across tests)
// ---------------------------------------------------------------------------

const LOG_10K = buildLog(10_000);
const LOG_1K = buildLog(1_000);

// ---------------------------------------------------------------------------
// Performance regression tests
// ---------------------------------------------------------------------------

describe('Covenant primitives performance regression', () => {
  // -----------------------------------------------------------------------
  // 1. Verification of 10K action log entries in < 1 second
  // -----------------------------------------------------------------------
  it('verify() over 10K action log entries completes in < 1 second', () => {
    const start = performance.now();

    const result = verify(SPEC, LOG_10K, {
      includeMerkleProofs: false,
      verifyLogIntegrity: true,
    });

    const elapsed = performance.now() - start;

    expect(result.compliant).toBe(true);
    expect(result.totalActions).toBe(10_000);
    expect(elapsed).toBeLessThan(1000);
  });

  // -----------------------------------------------------------------------
  // 2. Middleware enforcement evaluation of 1000 actions in < 100ms
  // -----------------------------------------------------------------------
  it('EnforcementMiddleware.check() for 1000 actions completes in < 100ms', () => {
    const middleware = new EnforcementMiddleware({
      agentDid: 'did:nobulex:perf-agent',
      spec: SPEC,
    });

    // Pre-build action contexts to isolate enforcement evaluation time
    const actions = [];
    for (let i = 0; i < 1000; i++) {
      actions.push({
        action: i % 3 === 0 ? 'read' : i % 3 === 1 ? 'write' : 'transfer',
        params: {
          amount: i % 5 === 0 ? 600 : 100,
          counterparty: { compliance_score: 0.95 },
        },
      });
    }

    const start = performance.now();

    for (const ctx of actions) {
      middleware.check(ctx);
    }

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
  });

  // -----------------------------------------------------------------------
  // 3. Covenant DSL parsing of 100 covenants in < 50ms
  // -----------------------------------------------------------------------
  it('parseSource() for 100 distinct covenants completes in < 50ms', () => {
    const sources = generateCovenantSources(100);

    const start = performance.now();

    for (const src of sources) {
      parseSource(src);
    }

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  // -----------------------------------------------------------------------
  // 4. Action log hash chain building for 10K entries
  // -----------------------------------------------------------------------
  it('ActionLogBuilder appending 10K entries builds a valid hash chain in < 1 second', () => {
    const builder = new ActionLogBuilder('did:nobulex:perf-chain');
    const baseTime = new Date('2025-06-01T00:00:00.000Z').getTime();

    const start = performance.now();

    for (let i = 0; i < 10_000; i++) {
      builder.append({
        action: i % 2 === 0 ? 'read' : 'write',
        resource: `/data/${i}`,
        params: { idx: i },
        outcome: 'success',
        timestamp: new Date(baseTime + i * 100).toISOString(),
      });
    }

    const log = builder.toLog();
    const elapsed = performance.now() - start;

    // Verify the chain was built correctly
    expect(log.length).toBe(10_000);
    expect(log.rootHash).toBeTruthy();
    expect(log.headHash).toBeTruthy();
    expect(log.rootHash).not.toBe(log.headHash);
    expect(elapsed).toBeLessThan(1000);

    // Spot-check integrity of the built chain
    const integrity = verifyIntegrity(log);
    expect(integrity.valid).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 5. Merkle proof generation and verification for 1K entries
  // -----------------------------------------------------------------------
  it('generateMerkleProof + verifyMerkleProof for every entry in a 1K log completes in < 3 seconds', () => {
    const start = performance.now();

    for (let i = 0; i < LOG_1K.entries.length; i++) {
      const proof = generateMerkleProof(LOG_1K, i);
      const valid = verifyMerkleProof(proof);
      // Verify correctness inline -- if proof generation is broken,
      // we want to know immediately rather than silently timing out.
      expect(valid).toBe(true);
    }

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(3000);
  });
});
