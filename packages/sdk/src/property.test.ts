/*
 * Property-based tests for the SDK handshake protocol.
 *
 * These use fast-check to exercise the generateProof / verifyCounterparty
 * pipeline against arbitrary but bounded inputs. APIs are taken directly
 * from packages/sdk/src/handshake.ts and examples/demo.ts, no invented
 * surface area.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createDID } from '@nobulex/identity';
import { parseSource } from '@nobulex/covenant-lang';
import { EnforcementMiddleware } from '@nobulex/middleware';
import type { ActionLog, ActionLogEntry } from '@nobulex/types';
import { generateProof, verifyCounterparty } from './handshake.js';

// --- shared helpers ---

/**
 * Classify which handshake step produced a failure. Step IDs match the
 * 8 steps in verifyCounterparty() (packages/sdk/src/handshake.ts), and
 * the classifier is copied from examples/demo.ts#classifyFailure.
 */
function classifyFailure(reason: string): number | null {
  const r = reason.toLowerCase();
  if (r.includes('covenant signature')) return 1;
  if (r.includes('proof signature')) return 2;
  if (r.includes('integrity')) return 3;
  if (r.includes('violation')) return 4;
  if (r.includes('minimum required')) return 5;
  if (r.includes('does not match required')) return 6;
  if (r.includes('audience')) return 7;
  if (r.includes('task class')) return 8;
  return null;
}

async function buildLog(
  src: string,
  actions: Array<{ action: string; params: Record<string, unknown> }>,
) {
  const identity = await createDID();
  const spec = parseSource(src);
  const mw = new EnforcementMiddleware({ agentDid: identity.did, spec });
  for (const a of actions) {
    await mw.execute(a, async () => ({ ok: true }));
  }
  return { identity, spec, log: mw.getLog() };
}

// Arbitrary for a single action drawn from a fixed covenant vocabulary.
// The covenant used below permits read and transfer(amount <= 500).
const boundedActionArb = fc.oneof(
  fc.record({
    action: fc.constant('read'),
    params: fc.constant({} as Record<string, unknown>),
  }),
  fc.record({
    action: fc.constant('transfer'),
    params: fc.record({ amount: fc.integer({ min: 0, max: 500 }) }),
  }),
);

const DEMO_COVENANT = `covenant SafeTrader {
  permit read;
  permit transfer (amount <= 500);
  forbid transfer (amount > 500);
  forbid delete;
}`;

describe('SDK property-based tests (fast-check)', () => {
  // --- 1. verification is deterministic ---------------------------------
  it('verification is deterministic for a fixed proof', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(boundedActionArb, { minLength: 1, maxLength: 20 }),
        async (actions) => {
          const { identity, spec, log } = await buildLog(DEMO_COVENANT, actions);
          const proof = await generateProof({ identity, covenant: spec, actionLog: log });
          const r1 = await verifyCounterparty(proof);
          const r2 = await verifyCounterparty(proof);
          expect(r1.trusted).toBe(r2.trusted);
          expect(r1.reason).toBe(r2.reason);
          expect(classifyFailure(r1.reason)).toBe(classifyFailure(r2.reason));
          expect(r1.violationCount).toBe(r2.violationCount);
          expect(r1.totalActions).toBe(r2.totalActions);
        },
      ),
      { numRuns: 25 },
    );
  });

  // --- 2. hash chain integrity detects any single tampered entry --------
  it('any single tampered entry hash fails log integrity (step 3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(boundedActionArb, { minLength: 3, maxLength: 20 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        async (actions, seed) => {
          const { identity, spec, log } = await buildLog(DEMO_COVENANT, actions);
          // only unblocked entries actually land in the log
          if (log.entries.length < 1) return;

          const i = seed % log.entries.length;
          // flip the first hex char of entries[i].hash (same trick as the demo)
          const tamperedEntries: ActionLogEntry[] = log.entries.map((e, idx) => {
            if (idx !== i) return e;
            const h = e.hash;
            const flipped = (h[0] === '0' ? '1' : '0') + h.slice(1);
            return { ...e, hash: flipped };
          });
          const tampered: ActionLog = { ...log, entries: tamperedEntries };

          const proof = await generateProof({
            identity,
            covenant: spec,
            actionLog: tampered,
          });
          const result = await verifyCounterparty(proof);
          expect(result.trusted).toBe(false);
          // step 3, "Action log integrity failed: ..."
          expect(classifyFailure(result.reason)).toBe(3);
          expect(result.logIntegrityValid).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });

  // --- 3. compliant actions never produce violations --------------------
  it('compliant read actions yield zero violations and trusted=true', async () => {
    const readOnly = 'covenant ReadOnly { permit read; }';
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            action: fc.constant('read'),
            params: fc.dictionary(fc.string({ maxLength: 8 }), fc.string({ maxLength: 16 }), {
              maxKeys: 4,
            }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        async (actions) => {
          const { identity, spec, log } = await buildLog(readOnly, actions);
          const proof = await generateProof({ identity, covenant: spec, actionLog: log });
          const result = await verifyCounterparty(proof);
          expect(result.trusted).toBe(true);
          expect(result.violationCount).toBe(0);
          expect(result.compliant).toBe(true);
          expect(result.totalActions).toBe(actions.length);
        },
      ),
      { numRuns: 50 },
    );
  });

  // --- 4. forbidden actions are blocked, never executed ----------------
  // ADAPTATION: In this codebase the EnforcementMiddleware intercepts
  // forbidden actions and records them with outcome='blocked' (not
  // outcome='success'). The handler is never invoked for a blocked
  // action. So the real invariant is: no transfer entry in a
  // `forbid transfer` log ever has outcome==='success'; every
  // transfer attempt is recorded as 'blocked', and the proof still
  // verifies as trusted because blocked entries do not count as
  // compliance violations.
  it('forbidden transfers are always recorded as blocked, never success', async () => {
    const forbidSrc = 'covenant NoTransfer { permit read; forbid transfer; }';
    const mix = fc.oneof(
      fc.record({
        action: fc.constant('read'),
        params: fc.constant({} as Record<string, unknown>),
      }),
      fc.record({
        action: fc.constant('transfer'),
        params: fc.record({ amount: fc.integer({ min: 0, max: 10_000 }) }),
      }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(mix, { minLength: 1, maxLength: 20 }), async (actions) => {
        const { identity, spec, log } = await buildLog(forbidSrc, actions);
        for (const e of log.entries) {
          if (e.action === 'transfer') {
            expect(e.outcome).toBe('blocked');
          }
        }
        const proof = await generateProof({ identity, covenant: spec, actionLog: log });
        const result = await verifyCounterparty(proof);
        expect(result.trusted).toBe(true);
        expect(result.violationCount).toBe(0);
      }),
      { numRuns: 50 },
    );
  });

  // --- 5. handshake is symmetric ----------------------------------------
  it('two compliant agents with identical covenants mutually verify', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        async (nA, nB) => {
          const actionsA = Array.from({ length: nA }, () => ({ action: 'read', params: {} }));
          const actionsB = Array.from({ length: nB }, () => ({ action: 'read', params: {} }));
          const A = await buildLog(DEMO_COVENANT, actionsA);
          const B = await buildLog(DEMO_COVENANT, actionsB);
          const proofA = await generateProof({
            identity: A.identity,
            covenant: A.spec,
            actionLog: A.log,
          });
          const proofB = await generateProof({
            identity: B.identity,
            covenant: B.spec,
            actionLog: B.log,
          });
          // B verifies A, A verifies B, both with minActions=1
          const rBA = await verifyCounterparty(proofA, { minActions: 1 });
          const rAB = await verifyCounterparty(proofB, { minActions: 1 });
          expect(rBA.trusted).toBe(true);
          expect(rAB.trusted).toBe(true);
        },
      ),
      { numRuns: 25 },
    );
  });

  // --- 6. audience binding prevents replay ------------------------------
  it('proof bound to audience X is rejected when verified as audience Y (step 7)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(boundedActionArb, { minLength: 1, maxLength: 10 }),
        fc.uuid(),
        fc.uuid(),
        async (actions, audX, audY) => {
          fc.pre(audX !== audY);
          const audienceX = `did:nobulex:${audX}`;
          const audienceY = `did:nobulex:${audY}`;
          const { identity, spec, log } = await buildLog(DEMO_COVENANT, actions);
          const proof = await generateProof({
            identity,
            covenant: spec,
            actionLog: log,
            audience: audienceX,
          });
          // correct audience, still trusted
          const ok = await verifyCounterparty(proof, { expectedAudience: audienceX });
          expect(ok.trusted).toBe(true);
          // wrong audience, rejected at step 7
          const bad = await verifyCounterparty(proof, { expectedAudience: audienceY });
          expect(bad.trusted).toBe(false);
          expect(classifyFailure(bad.reason)).toBe(7);
        },
      ),
      { numRuns: 25 },
    );
  });
});
