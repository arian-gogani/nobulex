/**
 * Nobulex end-to-end interactive demo.
 *
 * Two scenarios:
 *   1. Agent A behaves honestly, builds a proof, Agent B verifies and trusts.
 *   2. Agent C tampers its log, builds a proof, Agent B refuses.
 *
 * Run: npx tsx examples/demo.ts
 *
 * API-mapping notes (from reading the real source — see packages/sdk/src/handshake.ts
 * and packages/sdk/src/handshake.test.ts):
 *   - "Agent identities" = DIDKeyPair from @nobulex/identity::createDID()
 *   - "Covenant doc w/ permit/forbid/limit rules" = a CovenantSpec parsed from
 *     covenant-lang source via @nobulex/covenant-lang::parseSource(). The CCL
 *     "limit" rule is not a covenant-lang keyword, so the "amount <= 500" limit
 *     is expressed as `permit transfer (amount <= 500); forbid transfer (amount > 500);`
 *     exactly as the handshake.test.ts file does.
 *   - "Signing the covenant" happens inside generateProof() (it hashes the
 *     covenant and signs the hash with the agent's DID key). There is no
 *     standalone signCovenant() in this API — signing is folded into proof
 *     generation.
 *   - "Enforcement middleware" = EnforcementMiddleware from @nobulex/middleware.
 *     Each mw.execute() call appends a hash-chained ActionLogEntry.
 *   - "Proof of behavior" = generateProof() from @nobulex/sdk.
 *   - "8-step handshake" = verifyCounterparty() from @nobulex/sdk. The step
 *     labels in this demo are copied verbatim from the comments and error
 *     branches in packages/sdk/src/handshake.ts.
 *   - Tampered log: we mutate one entry's `.hash` field directly, which breaks
 *     the action-log hash chain and trips step 3 ("log integrity") in the real
 *     verifyIntegrity() call.
 */

import { createDID } from '@nobulex/identity';
import { parseSource } from '@nobulex/covenant-lang';
import { EnforcementMiddleware } from '@nobulex/middleware';
import { generateProof, verifyCounterparty } from '@nobulex/sdk';
import type { ProofOfBehavior, HandshakeResult } from '@nobulex/sdk';
import type { ActionLog, ActionLogEntry } from '@nobulex/core-types';

// --- ANSI helpers (no deps) ---
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};

const CHECK = `${C.green}✓${C.reset}`;
const CROSS = `${C.red}✗${C.reset}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tick = () => sleep(200);

function banner(text: string): void {
  const bar = '═'.repeat(Math.max(text.length + 4, 60));
  console.log(`${C.cyan}${C.bold}${bar}${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ${text}${C.reset}`);
  console.log(`${C.cyan}${C.bold}${bar}${C.reset}`);
}

function sep(label: string): void {
  const line = '─'.repeat(60);
  console.log(`\n${C.magenta}${line}${C.reset}`);
  console.log(`${C.magenta}${C.bold}  ${label}${C.reset}`);
  console.log(`${C.magenta}${line}${C.reset}\n`);
}

function dim(text: string): void {
  console.log(`${C.dim}${text}${C.reset}`);
}

// The 8 step labels, copied from packages/sdk/src/handshake.ts source comments.
// Order and wording match the in-order checks inside verifyCounterparty().
const HANDSHAKE_STEPS: readonly { id: number; label: string }[] = [
  { id: 1, label: 'Covenant signature — did they actually sign this covenant?' },
  { id: 2, label: 'Proof signature — was the whole payload tampered with?' },
  { id: 3, label: 'Action log integrity — hash chain of every entry' },
  { id: 4, label: 'Compliance — did they follow their own rules?' },
  { id: 5, label: 'Minimum history — enough track record?' },
  { id: 6, label: 'Required covenant — running the covenant we require?' },
  { id: 7, label: 'Audience binding — is this proof meant for me?' },
  { id: 8, label: 'Task scoping — is this the task class I need?' },
];

/**
 * Given a handshake result, figure out which step failed (if any).
 * The real handshake.ts returns early on the first failure and sets a
 * distinct `reason` string for each branch; we key off that.
 */
function classifyFailure(r: HandshakeResult): number | null {
  if (r.trusted) return null;
  const reason = r.reason.toLowerCase();
  if (reason.includes('covenant signature')) return 1;
  if (reason.includes('proof signature')) return 2;
  if (reason.includes('integrity')) return 3;
  if (reason.includes('violation')) return 4;
  if (reason.includes('minimum required')) return 5;
  if (reason.includes('does not match required')) return 6;
  if (reason.includes('audience')) return 7;
  if (reason.includes('task class')) return 8;
  return null;
}

async function runHandshakeWithNarration(
  proof: ProofOfBehavior,
  label: string,
): Promise<HandshakeResult> {
  console.log(`${C.bold}${label}${C.reset}\n`);
  await tick();

  const result = await verifyCounterparty(proof);
  const failedAt = classifyFailure(result);

  for (const step of HANDSHAKE_STEPS) {
    await tick();
    if (failedAt !== null && step.id > failedAt) {
      // handshake short-circuits on first failure; later steps never ran
      console.log(`  ${C.gray}·  [${step.id}] ${step.label} (skipped)${C.reset}`);
      continue;
    }
    if (failedAt === step.id) {
      console.log(`  ${CROSS} ${C.red}[${step.id}] ${step.label}${C.reset}`);
      console.log(`     ${C.red}${C.dim}→ ${result.reason}${C.reset}`);
    } else {
      console.log(`  ${CHECK} ${C.dim}[${step.id}] ${step.label}${C.reset}`);
    }
  }

  console.log('');
  return result;
}

async function buildAgent(
  name: string,
  source: string,
  actions: Array<{ action: string; params: Record<string, unknown>; expectBlock?: boolean }>,
): Promise<{
  identity: Awaited<ReturnType<typeof createDID>>;
  spec: ReturnType<typeof parseSource>;
  log: ActionLog;
}> {
  const identity = await createDID();
  const spec = parseSource(source);
  const mw = new EnforcementMiddleware({ agentDid: identity.did, spec });

  console.log(`${C.cyan}${name}${C.reset} ${C.dim}did=${identity.did}${C.reset}`);
  await tick();

  for (const a of actions) {
    const res = await mw.execute(a, async () => ({ ok: true }));
    await tick();
    if (res.executed) {
      console.log(
        `  ${CHECK} ${C.green}ALLOW${C.reset} ${a.action}${
          Object.keys(a.params).length ? ' ' + JSON.stringify(a.params) : ''
        }`,
      );
    } else {
      console.log(
        `  ${CROSS} ${C.red}BLOCK${C.reset} ${a.action}${
          Object.keys(a.params).length ? ' ' + JSON.stringify(a.params) : ''
        } ${C.dim}(${res.decision.reason ?? 'forbidden by covenant'})${C.reset}`,
      );
    }
  }

  return { identity, spec, log: mw.getLog() };
}

/**
 * Return a shallow copy of an ActionLog with entry[index].hash mutated.
 * This breaks the hash chain so verifyIntegrity() fails → handshake step 3 fails.
 */
function tamperLog(log: ActionLog, index: number): ActionLog {
  const entries: ActionLogEntry[] = log.entries.map((e, i) => {
    if (i !== index) return e;
    // flip the first hex char — still a valid-length hash, just the wrong value
    const h = e.hash;
    const flipped = (h[0] === '0' ? '1' : '0') + h.slice(1);
    return { ...e, hash: flipped };
  });
  return { ...log, entries };
}

async function main(): Promise<void> {
  banner('NOBULEX — proof-of-behavior protocol demo');
  dim('Two autonomous agents. One verifies the other before transacting.\n');
  await tick();

  // ─── Scenario 1: honest agent ────────────────────────────────────────
  sep('Scenario 1 — Agent A (honest) is verified by Agent B');

  const covenantSource = `covenant SafeTrader {
    permit read;
    permit transfer (amount <= 500);
    forbid transfer (amount > 500);
    forbid delete;
  }`;

  dim('Covenant source (parsed via @nobulex/covenant-lang):');
  console.log(
    covenantSource
      .split('\n')
      .map((l) => `  ${C.dim}${l}${C.reset}`)
      .join('\n'),
  );
  console.log('');
  await tick();

  dim('Agent A runs 5 actions through the enforcement middleware:\n');
  const agentA = await buildAgent('Agent A', covenantSource, [
    { action: 'read', params: {} },
    { action: 'transfer', params: { amount: 300 } },
    { action: 'read', params: {} },
    { action: 'read', params: {} },
    { action: 'transfer', params: { amount: 600 }, expectBlock: true },
  ]);

  console.log('');
  dim('Agent A builds a portable proof-of-behavior from the log...');
  await tick();
  const proofA = await generateProof({
    identity: agentA.identity,
    covenant: agentA.spec,
    actionLog: agentA.log,
  });
  console.log(
    `  ${CHECK} ${C.dim}proof generated — ${proofA.actionLog.entries.length} log entries, covenantHash=${proofA.covenantHash.slice(0, 12)}…${C.reset}\n`,
  );
  await tick();

  const _resultAB = await runHandshakeWithNarration(
    proofA,
    'Agent B runs the 8-step verifyCounterparty() handshake on Agent A:',
  );

  if (_resultAB.trusted) {
    console.log(`${C.green}${C.bold}  Agent B trusts Agent A ${CHECK}${C.reset}`);
    console.log(
      `${C.dim}  reason: ${_resultAB.reason} (${_resultAB.totalActions} actions, ${_resultAB.violationCount} violations)${C.reset}`,
    );
  } else {
    console.log(`${C.red}${C.bold}  Unexpected: Agent B did NOT trust Agent A${C.reset}`);
    console.log(`${C.red}  reason: ${_resultAB.reason}${C.reset}`);
    process.exitCode = 1;
  }

  // ─── Scenario 2: tampered log ────────────────────────────────────────
  sep('Scenario 2 — Agent C presents a tampered log');

  dim('Agent C starts with the same valid history Agent A had...');
  await tick();
  const agentC = await buildAgent('Agent C', covenantSource, [
    { action: 'read', params: {} },
    { action: 'transfer', params: { amount: 300 } },
    { action: 'read', params: {} },
    { action: 'read', params: {} },
  ]);

  console.log('');
  dim('...then mutates the hash of log entry #2 to try to hide something.');
  await tick();
  const tamperedLog = tamperLog(agentC.log, 2);
  console.log(
    `  ${C.yellow}!${C.reset} entry[2].hash: ${C.dim}${agentC.log.entries[2].hash.slice(0, 16)}…${C.reset} ${C.red}→${C.reset} ${C.dim}${tamperedLog.entries[2].hash.slice(0, 16)}…${C.reset}\n`,
  );
  await tick();

  dim('Agent C signs and presents a proof built from the tampered log...');
  const proofC = await generateProof({
    identity: agentC.identity,
    covenant: agentC.spec,
    actionLog: tamperedLog,
  });
  console.log(`  ${CHECK} ${C.dim}proof generated (signatures are over the tampered data)${C.reset}\n`);
  await tick();

  const resultBC = await runHandshakeWithNarration(
    proofC,
    'Agent B runs the same 8-step handshake on Agent C:',
  );

  if (!resultBC.trusted) {
    console.log(`${C.red}${C.bold}  Agent B refuses Agent C ${CROSS}${C.reset}`);
    console.log(`${C.dim}  reason: ${resultBC.reason}${C.reset}`);
  } else {
    console.log(`${C.red}${C.bold}  Unexpected: Agent B trusted the tampered proof${C.reset}`);
    process.exitCode = 1;
  }

  console.log('');
  banner('Demo complete');
  dim('Honest proofs verify. Tampered proofs get caught at the hash chain.');
  console.log('');
}

main().catch((err) => {
  console.error(`${C.red}${C.bold}demo crashed:${C.reset}`, err);
  process.exit(1);
});
