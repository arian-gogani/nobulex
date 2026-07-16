/*
 * Nobulex performance benchmark suite.
 *
 * Run: npx tsx benchmarks/bench.ts
 *
 * No external benchmarking libraries, pure Node + workspace packages.
 * Uses the same APIs the demo (examples/demo.ts) and real users take:
 *   - @nobulex/crypto:       generateKeyPair, sha256, sign, verify
 *   - @nobulex/covenant-lang: parseSource + compile (covenant evaluator entry point)
 *   - @nobulex/identity:      createDID
 *   - @nobulex/middleware:    EnforcementMiddleware (to build action logs)
 *   - @nobulex/action-log:    verifyIntegrity, ActionLogBuilder (chain build/verify)
 *   - @nobulex/sdk:           generateProof, verifyCounterparty (handshake)
 */

import os from 'node:os';
import { performance } from 'node:perf_hooks';

import {
  generateKeyPair, sha256, sign, verify,
  parseSource, compile,
  createDID,
  EnforcementMiddleware,
  ActionLogBuilder, verifyIntegrity, verifyPartial,
} from '@nobulex/core';
import type { EnforcementFn, ActionLog } from '@nobulex/core';
import { generateProof, verifyCounterparty } from '@nobulex/sdk';
import type { ProofOfBehavior } from '@nobulex/sdk';

// ─── ANSI (dim separators only; numbers stay uncolored) ──────────────────────
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const dim = (s: string) => `${DIM}${s}${RESET}`;

// ─── Stats ───────────────────────────────────────────────────────────────────
interface Stats {
  name: string;
  iters: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  opsPerSec: number | null; // null → print em dash
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function finish(name: string, samples: number[], showOps: boolean): Stats {
  const sorted = samples.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  return {
    name,
    iters: sorted.length,
    mean,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    opsPerSec: showOps ? 1000 / mean : null,
  };
}

async function runBench(
  name: string,
  iters: number,
  showOps: boolean,
  fn: () => void | Promise<void>,
): Promise<Stats> {
  const warmup = Math.max(1, Math.floor(iters * 0.05));
  for (let i = 0; i < warmup; i++) await fn();

  const samples = new Array<number>(iters);
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    await fn();
    samples[i] = performance.now() - t0;
  }
  return finish(name, samples, showOps);
}

// ─── Formatting ──────────────────────────────────────────────────────────────
function fmtMs(ms: number): string {
  if (ms >= 10) return ms.toFixed(2);
  if (ms >= 1) return ms.toFixed(3);
  if (ms >= 0.01) return ms.toFixed(4);
  return ms.toFixed(5);
}

function fmtOps(ops: number | null): string {
  if (ops === null) return ', ';
  if (ops >= 1_000_000) return (ops / 1_000_000).toFixed(2) + 'M';
  if (ops >= 1000) return (ops / 1000).toFixed(1) + 'k';
  return ops.toFixed(0);
}

function printTable(rows: Stats[]): void {
  const cols: Array<{ key: keyof Stats | 'opsPerSec'; label: string; align: 'l' | 'r' }> = [
    { key: 'name', label: 'name', align: 'l' },
    { key: 'iters', label: 'iters', align: 'r' },
    { key: 'mean', label: 'mean(ms)', align: 'r' },
    { key: 'p50', label: 'p50(ms)', align: 'r' },
    { key: 'p95', label: 'p95(ms)', align: 'r' },
    { key: 'p99', label: 'p99(ms)', align: 'r' },
    { key: 'opsPerSec', label: 'ops/sec', align: 'r' },
  ];

  const cells = rows.map((r) => [
    r.name,
    String(r.iters),
    fmtMs(r.mean),
    fmtMs(r.p50),
    fmtMs(r.p95),
    fmtMs(r.p99),
    fmtOps(r.opsPerSec),
  ]);

  const widths = cols.map((c, i) =>
    Math.max(c.label.length, ...cells.map((row) => row[i]!.length)),
  );

  const pad = (s: string, w: number, align: 'l' | 'r') =>
    align === 'l' ? s.padEnd(w) : s.padStart(w);

  const sep = dim(' | ');
  const header = cols.map((c, i) => pad(c.label, widths[i]!, c.align)).join(sep);
  const divider = dim(widths.map((w) => '-'.repeat(w)).join('-+-'));

  console.log(header);
  console.log(divider);
  for (const row of cells) {
    console.log(row.map((v, i) => pad(v, widths[i]!, cols[i]!.align)).join(sep));
  }
}

// ─── Data helpers ────────────────────────────────────────────────────────────
function makeBytes(size: number): Uint8Array {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = (i * 31) & 0xff;
  return b;
}

const SMALL_COVENANT = `covenant SafeTrader {
  permit read;
  permit transfer (amount <= 500);
  forbid transfer (amount > 500);
  forbid delete;
}`;

/** Generate a 50-rule covenant with alternating permit/forbid constraints. */
function makeLargeCovenantSource(ruleCount: number): string {
  const lines: string[] = [`covenant BigPolicy {`];
  for (let i = 0; i < ruleCount; i++) {
    const action = `action_${i}`;
    if (i % 3 === 0) {
      lines.push(`  permit ${action};`);
    } else if (i % 3 === 1) {
      lines.push(`  permit ${action} (amount <= ${100 + i});`);
      lines.push(`  forbid ${action} (amount > ${100 + i});`);
    } else {
      lines.push(`  forbid ${action};`);
    }
  }
  lines.push(`}`);
  return lines.join('\n');
}

/**
 * Build a valid ActionLog of `n` entries by driving real actions through
 * EnforcementMiddleware, same path the demo uses.
 */
async function buildValidLog(
  n: number,
): Promise<{ identity: Awaited<ReturnType<typeof createDID>>; spec: ReturnType<typeof parseSource>; log: ActionLog }> {
  const identity = await createDID();
  const spec = parseSource(SMALL_COVENANT);
  const mw = new EnforcementMiddleware({ agentDid: identity.did, spec });
  for (let i = 0; i < n; i++) {
    // alternate allowed actions so the log is realistic and stays compliant
    const act =
      i % 3 === 0
        ? { action: 'read', params: {} }
        : i % 3 === 1
          ? { action: 'transfer', params: { amount: 100 + (i % 300) } }
          : { action: 'read', params: { resource: `/doc/${i}` } };
    await mw.execute(act, async () => ({ ok: true }));
  }
  return { identity, spec, log: mw.getLog() };
}

// ─── Benchmarks ──────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const cpu = os.cpus()[0]?.model ?? 'unknown';
  console.log(`Node ${process.version} ${dim('·')} ${os.arch()} ${dim('·')} ${cpu}`);
  console.log(`${dim(new Date().toISOString())}\n`);

  const rows: Stats[] = [];

  // --- crypto fast-path ---
  rows.push(await runBench('keygen', 1000, true, async () => { await generateKeyPair(); }));

  const buf1k = makeBytes(1024);
  const buf10k = makeBytes(10 * 1024);
  const buf100k = makeBytes(100 * 1024);
  rows.push(await runBench('sha256-1kb', 5000, true, () => { sha256(buf1k); }));
  rows.push(await runBench('sha256-10kb', 3000, true, () => { sha256(buf10k); }));
  rows.push(await runBench('sha256-100kb', 1000, true, () => { sha256(buf100k); }));

  const kp = await generateKeyPair();
  const digest = makeBytes(32);
  rows.push(await runBench('sign', 1000, true, async () => { await sign(digest, kp.privateKey); }));

  const sig = await sign(digest, kp.privateKey);
  rows.push(await runBench('verify', 1000, true, async () => { await verify(digest, sig, kp.publicKey); }));

  // --- covenant-eval (compile once, evaluate many) ---
  const smallSpec = parseSource(SMALL_COVENANT);
  const smallEnforce: EnforcementFn = compile(smallSpec);
  const smallCtx = { action: 'transfer', params: { amount: 250 } };
  rows.push(
    await runBench('covenant-eval-3', 10000, true, () => {
      smallEnforce(smallCtx);
    }),
  );

  const largeSpec = parseSource(makeLargeCovenantSource(50));
  const largeEnforce: EnforcementFn = compile(largeSpec);
  const largeCtx = { action: 'action_25', params: { amount: 50 } };
  rows.push(
    await runBench('covenant-eval-50', 10000, true, () => {
      largeEnforce(largeCtx);
    }),
  );

  // --- handshake (build proof once per N, time verifyCounterparty) ---
  const handshakeSizes: Array<{ n: number; iters: number }> = [
    { n: 10, iters: 200 },
    { n: 100, iters: 100 },
    { n: 1000, iters: 50 },
    { n: 10000, iters: 50 },
  ];
  for (const { n, iters } of handshakeSizes) {
    const { identity, spec, log } = await buildValidLog(n);
    const proof: ProofOfBehavior = await generateProof({ identity, covenant: spec, actionLog: log });
    rows.push(
      await runBench(`handshake-${n}`, iters, false, async () => {
        await verifyCounterparty(proof);
      }),
    );
  }

  // --- chain build / verify ---
  // Pre-build a pool of entry templates once to avoid timing middleware overhead
  // on the BUILD bench. For build, we time ActionLogBuilder.append only (the chain work).
  const buildTemplates = Array.from({ length: 1000 }, (_, i) => ({
    action: i % 2 === 0 ? 'read' : 'transfer',
    resource: `/res/${i}`,
    params: { idx: i, amount: (i * 7) % 400 },
    outcome: 'success' as const,
  }));

  rows.push(
    await runBench('chain-build-1000', 50, false, () => {
      const b = new ActionLogBuilder('did:nobulex:bench');
      for (const tpl of buildTemplates) b.append(tpl);
      // force log materialization
      b.toLog();
    }),
  );

  // 10K-entry log used for both full and partial verification, so the two
  // numbers are directly comparable.
  const verifyTemplates = Array.from({ length: 10_000 }, (_, i) => ({
    action: i % 2 === 0 ? 'read' : 'transfer',
    resource: `/res/${i}`,
    params: { idx: i, amount: (i * 7) % 400 },
    outcome: 'success' as const,
  }));
  const verifyLog = (() => {
    const b = new ActionLogBuilder('did:nobulex:bench');
    for (const tpl of verifyTemplates) b.append(tpl);
    return b.toLog();
  })();
  rows.push(
    await runBench('chain-verify-1000', 50, false, () => {
      const r = verifyIntegrity(verifyLog);
      if (!r.valid) throw new Error('chain-verify-1000: integrity failed unexpectedly');
    }),
  );
  rows.push(
    await runBench('chain-verify-partial-100', 50, false, () => {
      const r = verifyPartial(verifyLog, 100);
      if (!r.valid) throw new Error('chain-verify-partial-100: integrity failed unexpectedly');
    }),
  );

  console.log('');
  printTable(rows);
  console.log('');
}

main().catch((err) => {
  console.error('bench crashed:', err);
  process.exit(1);
});
