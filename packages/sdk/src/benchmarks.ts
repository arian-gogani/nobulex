/**
 * @stele/sdk -- Performance benchmark suite with SLA targets.
 *
 * Defines production-quality SLA targets for all critical protocol operations
 * and provides a benchmark runner that validates them. This proves the protocol
 * is fast enough for real-world use.
 *
 * @packageDocumentation
 */

import { generateKeyPair, sign, verify, sha256, sha256String } from '@stele/crypto';
import { buildCovenant, verifyCovenant } from '@stele/core';
import { parse as cclParse, evaluate as cclEvaluate } from '@stele/ccl';
import { MemoryStore } from '@stele/store';
import { SteleClient } from './index.js';
import {
  initiate as negotiationInitiate,
  propose as negotiationPropose,
  agree as negotiationAgree,
  evaluate as negotiationEvaluate,
} from '@stele/negotiation';

// ─── SLA Targets ────────────────────────────────────────────────────────────

/** Performance SLA target definition. */
export interface SLATarget {
  /** p99 latency in the specified unit. */
  readonly p99: number;
  /** Unit of measurement (always 'ms'). */
  readonly unit: 'ms';
  /** Human-readable description of the operation. */
  readonly description: string;
}

/**
 * Production SLA targets for all critical Stele protocol operations.
 *
 * These targets are conservative and should be met by any modern machine.
 * All latencies are p99 in milliseconds.
 */
export const PERFORMANCE_SLAS = {
  'crypto.generateKeyPair':   { p99: 10,   unit: 'ms', description: 'Ed25519 key generation' },
  'crypto.sign':              { p99: 10,   unit: 'ms', description: 'Ed25519 signing' },
  'crypto.verify':            { p99: 10,   unit: 'ms', description: 'Ed25519 verification' },
  'crypto.sha256':            { p99: 2,    unit: 'ms', description: 'SHA-256 hashing (1KB)' },
  'ccl.parse':                { p99: 10,   unit: 'ms', description: 'CCL parsing (10 rules)' },
  'ccl.evaluate':             { p99: 2,    unit: 'ms', description: 'CCL evaluation' },
  'covenant.build':           { p99: 25,   unit: 'ms', description: 'Build + sign covenant' },
  'covenant.verify':          { p99: 15,   unit: 'ms', description: 'Full 11-check verification' },
  'store.put':                { p99: 2,    unit: 'ms', description: 'MemoryStore put' },
  'store.get':                { p99: 1,    unit: 'ms', description: 'MemoryStore get' },
  'store.list_1000':          { p99: 100,  unit: 'ms', description: 'MemoryStore list with 1000 docs' },
  'sdk.evaluateAction':       { p99: 15,   unit: 'ms', description: 'Full SDK evaluate pipeline' },
  'negotiation.handshake':    { p99: 100,  unit: 'ms', description: 'Two-party covenant negotiation' },
} as const;

/** All SLA operation names. */
export type SLAOperationName = keyof typeof PERFORMANCE_SLAS;

// ─── Result types ───────────────────────────────────────────────────────────

/** Result from a single benchmark run. */
export interface BenchmarkResult {
  /** Benchmark name (matches a key in PERFORMANCE_SLAS). */
  name: string;
  /** Number of timed iterations (excludes warmup). */
  iterations: number;
  /** 50th percentile latency in ms. */
  p50: number;
  /** 95th percentile latency in ms. */
  p95: number;
  /** 99th percentile latency in ms. */
  p99: number;
  /** Minimum observed latency in ms. */
  min: number;
  /** Maximum observed latency in ms. */
  max: number;
  /** Arithmetic mean latency in ms. */
  mean: number;
  /** The p99 SLA target in ms. */
  slaTarget: number;
  /** Whether the p99 latency met the SLA target. */
  slaPassed: boolean;
}

/** Result from running the full benchmark suite. */
export interface BenchmarkSuiteResult {
  /** Per-benchmark results. */
  results: BenchmarkResult[];
  /** True if every SLA target was met. */
  allPassed: boolean;
  /** Total wall-clock duration of the suite in ms. */
  totalDuration: number;
  /** ISO 8601 timestamp of the run. */
  timestamp: string;
}

// ─── Timing utility ─────────────────────────────────────────────────────────

/** Get current time in ms with sub-ms precision when available. */
function now(): number {
  try {
    // performance.now() provides sub-ms precision
    return performance.now();
  } catch {
    return Date.now();
  }
}

// ─── Percentile computation ─────────────────────────────────────────────────

/**
 * Compute the value at a given percentile from a sorted array.
 * Uses nearest-rank method.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

// ─── Core benchmark function ────────────────────────────────────────────────

/**
 * Run a benchmark for a given function.
 *
 * 1. Runs warmup iterations (10% of total, minimum 5).
 * 2. Runs the specified number of timed iterations (default 1000).
 * 3. Records each duration using performance.now() or Date.now() fallback.
 * 4. Computes percentiles (p50, p95, p99), min, max, and mean.
 * 5. Checks against the SLA target if the benchmark name matches a known SLA.
 *
 * @param name - Benchmark name (used for SLA lookup).
 * @param fn - The function to benchmark. May be sync or async.
 * @param iterations - Number of timed iterations (default 1000).
 * @returns Full benchmark result with statistics and SLA pass/fail.
 */
export async function benchmark(
  name: string,
  fn: () => Promise<void> | void,
  iterations: number = 1000,
): Promise<BenchmarkResult> {
  // Warmup: 10% of iterations, minimum 5
  const warmupCount = Math.max(5, Math.floor(iterations * 0.1));

  for (let i = 0; i < warmupCount; i++) {
    await fn();
  }

  // Timed iterations
  const durations: number[] = new Array(iterations);

  for (let i = 0; i < iterations; i++) {
    const start = now();
    await fn();
    const end = now();
    durations[i] = end - start;
  }

  // Sort for percentile computation
  const sorted = durations.slice().sort((a, b) => a - b);

  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const mean = durations.reduce((sum, d) => sum + d, 0) / durations.length;

  // Look up SLA target
  const sla = (PERFORMANCE_SLAS as Record<string, SLATarget>)[name];
  const slaTarget = sla ? sla.p99 : Infinity;
  const slaPassed = p99 <= slaTarget;

  return {
    name,
    iterations,
    p50: round(p50),
    p95: round(p95),
    p99: round(p99),
    min: round(min),
    max: round(max),
    mean: round(mean),
    slaTarget,
    slaPassed,
  };
}

/** Round to 3 decimal places for readable output. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ─── Benchmark suite ────────────────────────────────────────────────────────

/**
 * Run the full benchmark suite against all defined SLA targets.
 *
 * Executes real protocol operations (key generation, signing, verification,
 * CCL parsing/evaluation, covenant build/verify, store operations, and SDK
 * evaluate pipeline) and checks each against its SLA target.
 *
 * @returns Full suite results including per-benchmark details and overall pass/fail.
 */
export async function runBenchmarkSuite(): Promise<BenchmarkSuiteResult> {
  const suiteStart = now();
  const results: BenchmarkResult[] = [];

  // ── Shared fixtures ──────────────────────────────────────────────────────

  // Pre-generate keys for benchmarks that need them
  const kp = await generateKeyPair();
  const kp2 = await generateKeyPair();
  const message = new TextEncoder().encode('benchmark payload for Stele protocol');
  const signature = await sign(message, kp.privateKey);
  const oneKBData = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) oneKBData[i] = i & 0xff;

  const cclSource10Rules = [
    "permit read on '/data/**'",
    "permit write on '/data/public/**'",
    "deny write on '/data/system/**'",
    "deny delete on '/data/**'",
    "permit read on '/api/**'",
    "deny write on '/api/admin/**'",
    "permit execute on '/scripts/**'",
    "deny execute on '/scripts/dangerous/**'",
    "permit read on '/config/**'",
    "deny write on '/config/**'",
  ].join('\n');

  const cclDoc = cclParse(cclSource10Rules);

  const issuer = { id: 'bench-issuer', publicKey: kp.publicKeyHex, role: 'issuer' as const };
  const beneficiary = { id: 'bench-beneficiary', publicKey: kp2.publicKeyHex, role: 'beneficiary' as const };
  const constraints = "permit read on '/data/**'\ndeny write on '/system/**'";

  // Build a covenant once for verify and evaluate benchmarks
  const covenantDoc = await buildCovenant({
    issuer,
    beneficiary,
    constraints,
    privateKey: kp.privateKey,
  });

  // Pre-populate a store with 1000 documents for the list benchmark
  const store = new MemoryStore();
  const storeDocs: Array<typeof covenantDoc> = [];
  for (let i = 0; i < 1000; i++) {
    const doc = await buildCovenant({
      issuer,
      beneficiary,
      constraints: `permit read on '/data/item${i}/**'`,
      privateKey: kp.privateKey,
    });
    storeDocs.push(doc);
    await store.put(doc);
  }

  // SDK client for evaluateAction benchmark
  const client = new SteleClient({ keyPair: kp });

  // ── Benchmarks ───────────────────────────────────────────────────────────

  // Use fewer iterations for expensive operations to keep total time reasonable
  const FAST_ITERS = 1000;
  const MEDIUM_ITERS = 200;
  const SLOW_ITERS = 50;

  // crypto.generateKeyPair
  results.push(await benchmark('crypto.generateKeyPair', async () => {
    await generateKeyPair();
  }, MEDIUM_ITERS));

  // crypto.sign
  results.push(await benchmark('crypto.sign', async () => {
    await sign(message, kp.privateKey);
  }, MEDIUM_ITERS));

  // crypto.verify
  results.push(await benchmark('crypto.verify', async () => {
    await verify(message, signature, kp.publicKey);
  }, MEDIUM_ITERS));

  // crypto.sha256
  results.push(await benchmark('crypto.sha256', () => {
    sha256(oneKBData);
  }, FAST_ITERS));

  // ccl.parse
  results.push(await benchmark('ccl.parse', () => {
    cclParse(cclSource10Rules);
  }, FAST_ITERS));

  // ccl.evaluate
  results.push(await benchmark('ccl.evaluate', () => {
    cclEvaluate(cclDoc, 'read', '/data/users');
  }, FAST_ITERS));

  // covenant.build
  results.push(await benchmark('covenant.build', async () => {
    await buildCovenant({
      issuer,
      beneficiary,
      constraints,
      privateKey: kp.privateKey,
    });
  }, MEDIUM_ITERS));

  // covenant.verify
  results.push(await benchmark('covenant.verify', async () => {
    await verifyCovenant(covenantDoc);
  }, MEDIUM_ITERS));

  // store.put
  results.push(await benchmark('store.put', async () => {
    await store.put(covenantDoc);
  }, FAST_ITERS));

  // store.get
  results.push(await benchmark('store.get', async () => {
    await store.get(covenantDoc.id);
  }, FAST_ITERS));

  // store.list_1000
  results.push(await benchmark('store.list_1000', async () => {
    await store.list();
  }, SLOW_ITERS));

  // sdk.evaluateAction
  results.push(await benchmark('sdk.evaluateAction', async () => {
    await client.evaluateAction(covenantDoc, 'read', '/data/users');
  }, MEDIUM_ITERS));

  // negotiation.handshake (full two-party initiate -> propose -> evaluate -> agree cycle)
  results.push(await benchmark('negotiation.handshake', () => {
    const policyA = {
      requiredConstraints: ['deny:exfiltrate-data', 'require:audit-log'],
      preferredConstraints: ['permit:read-public'],
      dealbreakers: ['permit:delete-all'],
      maxRounds: 10,
      timeoutMs: 30000,
    };

    // Initiate session
    let session = negotiationInitiate('alice', 'bob', policyA);

    // Bob counter-proposes
    const counterProposal = {
      from: 'bob',
      constraints: ['deny:exfiltrate-data', 'require:audit-log', 'permit:read-public', 'require:encryption'],
      requirements: ['deny:exfiltrate-data', 'require:encryption'],
      timestamp: Date.now(),
    };
    session = negotiationPropose(session, counterProposal);

    // Alice evaluates Bob's proposal
    negotiationEvaluate(counterProposal, policyA);

    // Reach agreement
    negotiationAgree(session);
  }, MEDIUM_ITERS));

  // ── Aggregate ────────────────────────────────────────────────────────────

  const suiteEnd = now();
  const allPassed = results.every((r) => r.slaPassed);

  return {
    results,
    allPassed,
    totalDuration: round(suiteEnd - suiteStart),
    timestamp: new Date().toISOString(),
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/**
 * Format benchmark results as a human-readable ASCII table.
 *
 * Shows each benchmark name, p50/p95/p99 latencies, SLA target,
 * and PASS/FAIL status. Includes a summary footer with total
 * duration and overall pass/fail.
 *
 * @param results - The benchmark suite results to format.
 * @returns A multi-line string suitable for console output.
 */
export function formatBenchmarkResults(results: BenchmarkSuiteResult): string {
  const lines: string[] = [];

  // Header
  const sep = '+' + '-'.repeat(32) + '+' + '-'.repeat(10) + '+' + '-'.repeat(10) + '+' + '-'.repeat(10) + '+' + '-'.repeat(10) + '+' + '-'.repeat(8) + '+';
  lines.push('');
  lines.push('  Stele Performance Benchmark Suite');
  lines.push('  ' + results.timestamp);
  lines.push('');
  lines.push(sep);
  lines.push(
    '| ' + 'Operation'.padEnd(30) + ' | ' +
    'p50'.padStart(8) + ' | ' +
    'p95'.padStart(8) + ' | ' +
    'p99'.padStart(8) + ' | ' +
    'SLA'.padStart(8) + ' | ' +
    'Status'.padEnd(6) + ' |'
  );
  lines.push(sep);

  for (const r of results.results) {
    const status = r.slaPassed ? 'PASS' : 'FAIL';
    lines.push(
      '| ' + r.name.padEnd(30) + ' | ' +
      fmtMs(r.p50).padStart(8) + ' | ' +
      fmtMs(r.p95).padStart(8) + ' | ' +
      fmtMs(r.p99).padStart(8) + ' | ' +
      fmtMs(r.slaTarget).padStart(8) + ' | ' +
      status.padEnd(6) + ' |'
    );
  }

  lines.push(sep);

  // Summary
  const passCount = results.results.filter((r) => r.slaPassed).length;
  const totalCount = results.results.length;
  const overallStatus = results.allPassed ? 'ALL PASSED' : 'SOME FAILED';

  lines.push('');
  lines.push(`  ${passCount}/${totalCount} SLAs met | Total: ${fmtMs(results.totalDuration)} | ${overallStatus}`);
  lines.push('');

  return lines.join('\n');
}

/** Format a millisecond value with unit suffix. */
function fmtMs(ms: number): string {
  if (ms === Infinity) return '  N/A';
  if (ms < 1) return ms.toFixed(3) + 'ms';
  if (ms < 10) return ms.toFixed(2) + 'ms';
  if (ms < 100) return ms.toFixed(1) + 'ms';
  return ms.toFixed(0) + 'ms';
}
