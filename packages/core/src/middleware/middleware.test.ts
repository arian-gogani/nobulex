import { describe, it, expect, vi } from 'vitest';
import {
  EnforcementMiddleware,
  createMiddleware,
  compileSource,
} from './index';
import { parseSource } from '../covenant-lang/index';
import { verifyIntegrity } from '../action-log/index';
import { generateKeyPair, verify, fromHex, sha256Object } from '../crypto/index';
import { computeOutcomeHash, computeFailureHash } from '../action-log/index';

const SAFE_SPEC = `covenant Safe {
  forbid transfer (amount > 500);
  permit transfer;
  permit read;
  forbid delete;
  require agent.verified == true;
}`;

describe('@nobulex/middleware', () => {
  // ── EnforcementMiddleware ────────────────────────────────────────────────

  describe('EnforcementMiddleware', () => {
    it('allows permitted actions', async () => {
      const mw = createMiddleware('did:nobulex:agent-1', SAFE_SPEC);
      const result = await mw.execute(
        { action: 'read', params: { agent: { verified: true } } },
        () => 'data',
      );
      expect(result.executed).toBe(true);
      expect(result.decision.action).toBe('allow');
      expect(result.value).toBe('data');
    });

    it('blocks forbidden actions', async () => {
      const mw = createMiddleware('did:nobulex:agent-1', SAFE_SPEC);
      const handler = vi.fn(() => 'should not run');
      const result = await mw.execute(
        { action: 'delete', params: {} },
        handler,
      );
      expect(result.executed).toBe(false);
      expect(result.decision.action).toBe('block');
      expect(handler).not.toHaveBeenCalled();
    });

    it('blocks when condition triggers forbid', async () => {
      const mw = createMiddleware('did:nobulex:agent-1', SAFE_SPEC);
      const handler = vi.fn();
      const result = await mw.execute(
        { action: 'transfer', params: { amount: 600 } },
        handler,
      );
      expect(result.executed).toBe(false);
      expect(result.decision.action).toBe('block');
      expect(handler).not.toHaveBeenCalled();
    });

    it('allows transfer when condition does not trigger forbid', async () => {
      const mw = createMiddleware('did:nobulex:agent-1', SAFE_SPEC);
      const result = await mw.execute(
        { action: 'transfer', params: { amount: 100, agent: { verified: true } } },
        () => 'transferred',
      );
      expect(result.executed).toBe(true);
      expect(result.value).toBe('transferred');
    });

    it('logs all actions to the action log', async () => {
      const mw = createMiddleware('did:nobulex:agent-1', SAFE_SPEC);
      await mw.execute({ action: 'read', params: { agent: { verified: true } } }, () => 'ok');
      await mw.execute({ action: 'delete', params: {} }, () => 'no');
      await mw.execute({ action: 'read', params: { agent: { verified: true } } }, () => 'ok');

      const log = mw.getLog();
      expect(log.entries).toHaveLength(3);
      expect(log.entries[0]!.outcome).toBe('success');
      expect(log.entries[1]!.outcome).toBe('blocked');
      expect(log.entries[2]!.outcome).toBe('success');
    });

    it('action log passes integrity verification', async () => {
      const mw = createMiddleware('did:nobulex:agent-1', SAFE_SPEC);
      await mw.execute({ action: 'read', params: { agent: { verified: true } } }, () => 'ok');
      await mw.execute({ action: 'delete', params: {} }, () => 'no');
      await mw.execute({ action: 'read', params: { agent: { verified: true } } }, () => 'ok');

      const log = mw.getLog();
      const result = verifyIntegrity(log);
      expect(result.valid).toBe(true);
    });

    it('tracks action count', async () => {
      const mw = createMiddleware('did:nobulex:agent-1', 'covenant X { permit a; }');
      expect(mw.actionCount).toBe(0);
      await mw.execute({ action: 'a', params: {} }, () => {});
      expect(mw.actionCount).toBe(1);
      await mw.execute({ action: 'b', params: {} }, () => {});
      expect(mw.actionCount).toBe(2);
    });

    it('calls onBlock callback', async () => {
      const onBlock = vi.fn();
      const spec = parseSource('covenant X { forbid write; }');
      const mw = new EnforcementMiddleware({
        agentDid: 'did:nobulex:agent-1',
        spec,
        onBlock,
      });
      await mw.execute({ action: 'write', params: {} }, () => {});
      expect(onBlock).toHaveBeenCalledTimes(1);
      expect(onBlock.mock.calls[0]![0].action).toBe('block');
    });

    it('calls onAllow callback', async () => {
      const onAllow = vi.fn();
      const spec = parseSource('covenant X { permit read; }');
      const mw = new EnforcementMiddleware({
        agentDid: 'did:nobulex:agent-1',
        spec,
        onAllow,
      });
      await mw.execute({ action: 'read', params: {} }, () => 'ok');
      expect(onAllow).toHaveBeenCalledTimes(1);
    });

    it('logs failure when handler throws', async () => {
      const mw = createMiddleware('did:nobulex:agent-1', 'covenant X { permit boom; }');
      try {
        await mw.execute({ action: 'boom', params: {} }, () => {
          throw new Error('handler error');
        });
      } catch (e) {
        expect((e as Error).message).toBe('handler error');
      }
      const log = mw.getLog();
      expect(log.entries[0]!.outcome).toBe('failure');
    });

    it('check() does not execute or log', () => {
      const mw = createMiddleware('did:nobulex:agent-1', 'covenant X { permit read; forbid write; }');
      const d1 = mw.check({ action: 'read', params: {} });
      expect(d1.action).toBe('allow');
      const d2 = mw.check({ action: 'write', params: {} });
      expect(d2.action).toBe('block');
      expect(mw.actionCount).toBe(0);
    });

    it('exposes spec', () => {
      const mw = createMiddleware('did:nobulex:agent-1', 'covenant Test { permit a; }');
      expect(mw.spec.name).toBe('Test');
    });

    it('handles async handlers', async () => {
      const mw = createMiddleware('did:nobulex:agent-1', 'covenant X { permit read; }');
      const result = await mw.execute(
        { action: 'read', params: {} },
        async () => {
          await new Promise(r => setTimeout(r, 10));
          return 42;
        },
      );
      expect(result.value).toBe(42);
    });
  });

  // ── Observe mode ─────────────────────────────────────────────────────────

  describe('observe mode', () => {
    it('logs blocked actions as would_block but still executes the handler', async () => {
      const mw = new EnforcementMiddleware({
        agentDid: 'did:nobulex:agent-observe',
        spec: parseSource('covenant X { permit read; forbid delete; }'),
        mode: 'observe',
      });
      const handler = vi.fn(() => 'deleted');
      const result = await mw.execute({ action: 'delete', params: {} }, handler);
      expect(result.executed).toBe(true);
      expect(result.value).toBe('deleted');
      expect(result.decision.action).toBe('block');
      expect(result.entry.outcome).toBe('would_block');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('permitted actions still log as success in observe mode', async () => {
      const mw = new EnforcementMiddleware({
        agentDid: 'did:nobulex:agent-observe',
        spec: parseSource('covenant X { permit read; }'),
        mode: 'observe',
      });
      const result = await mw.execute({ action: 'read', params: {} }, () => 'ok');
      expect(result.entry.outcome).toBe('success');
    });

    it('onBlock still fires in observe mode for would-be-blocked actions', async () => {
      const onBlock = vi.fn();
      const mw = new EnforcementMiddleware({
        agentDid: 'did:nobulex:agent-observe',
        spec: parseSource('covenant X { forbid write; }'),
        mode: 'observe',
        onBlock,
      });
      await mw.execute({ action: 'write', params: {} }, () => 'ok');
      expect(onBlock).toHaveBeenCalledTimes(1);
    });

    it('exposes mode via getter', () => {
      const mw = new EnforcementMiddleware({
        agentDid: 'did:nobulex:agent-observe',
        spec: parseSource('covenant X { permit read; }'),
        mode: 'observe',
      });
      expect(mw.mode).toBe('observe');
    });

    it('defaults to enforce mode when not specified', () => {
      const mw = createMiddleware('did:nobulex:agent', 'covenant X { permit read; }');
      expect(mw.mode).toBe('enforce');
    });
  });

  // ── Emergency halt ───────────────────────────────────────────────────────

  describe('emergency halt', () => {
    it('halts block subsequent permitted actions', async () => {
      const mw = createMiddleware('did:nobulex:agent-halt', 'covenant X { permit read; }');
      mw.halt();
      expect(mw.halted).toBe(true);
      const handler = vi.fn(() => 'should not run');
      const result = await mw.execute({ action: 'read', params: {} }, handler);
      expect(result.executed).toBe(false);
      expect(result.entry.outcome).toBe('halted');
      expect(handler).not.toHaveBeenCalled();
    });

    it('resume restores normal enforcement', async () => {
      const mw = createMiddleware('did:nobulex:agent-halt', 'covenant X { permit read; }');
      mw.halt();
      await mw.execute({ action: 'read', params: {} }, () => 'x');
      mw.resume();
      expect(mw.halted).toBe(false);
      const result = await mw.execute({ action: 'read', params: {} }, () => 'allowed');
      expect(result.executed).toBe(true);
      expect(result.value).toBe('allowed');
    });

    it('halt overrides observe mode', async () => {
      const mw = new EnforcementMiddleware({
        agentDid: 'did:nobulex:agent-halt',
        spec: parseSource('covenant X { permit everything; }'),
        mode: 'observe',
      });
      mw.halt();
      const handler = vi.fn();
      const result = await mw.execute({ action: 'everything', params: {} }, handler);
      expect(result.executed).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── Outcome hash ─────────────────────────────────────────────────────────

  describe('outcome hash', () => {
    it('stores the hash of the handler return value on success', async () => {
      const mw = createMiddleware('did:nobulex:agent-outcome', 'covenant X { permit compute; }');
      const result = await mw.execute(
        { action: 'compute', params: {} },
        () => ({ total: 7 }),
      );
      expect(result.entry.outcomeHash).toBe(computeOutcomeHash({ total: 7 }));
    });

    it('stores a deterministic failure hash when the handler throws', async () => {
      const mw = createMiddleware('did:nobulex:agent-outcome', 'covenant X { permit boom; }');
      try {
        await mw.execute({ action: 'boom', params: {} }, () => {
          throw new Error('kaboom');
        });
      } catch (e) {
        const thrown = e as Error & { middlewareResult?: { entry: { outcomeHash?: string } } };
        expect(thrown.middlewareResult?.entry.outcomeHash).toBe(computeFailureHash('kaboom'));
      }
    });

    it('blocked entries do not carry an outcome hash', async () => {
      const mw = createMiddleware('did:nobulex:agent-outcome', 'covenant X { forbid delete; }');
      const result = await mw.execute({ action: 'delete', params: {} }, () => 'nope');
      expect(result.entry.outcome).toBe('blocked');
      expect(result.entry.outcomeHash).toBeUndefined();
    });

    it('halted entries do not carry an outcome hash', async () => {
      const mw = createMiddleware('did:nobulex:agent-outcome', 'covenant X { permit read; }');
      mw.halt();
      const result = await mw.execute({ action: 'read', params: {} }, () => 'never');
      expect(result.entry.outcome).toBe('halted');
      expect(result.entry.outcomeHash).toBeUndefined();
    });
  });

  // ── Bilateral receipts ───────────────────────────────────────────────────

  describe('bilateral receipts', () => {
    it('attaches a receipt when a signer is configured', async () => {
      const kp = await generateKeyPair();
      const mw = new EnforcementMiddleware({
        agentDid: 'did:nobulex:agent-receipts',
        spec: parseSource('covenant X { permit read; }'),
        signer: { privateKey: kp.privateKey, publicKeyHex: kp.publicKeyHex },
      });
      const result = await mw.execute({ action: 'read', params: { id: 42 } }, () => 'value');
      expect(result.receipt).toBeDefined();
      const r = result.receipt!;
      expect(r.signerPublicKey).toBe(kp.publicKeyHex);
      expect(r.authorizationHash).toHaveLength(64);
      expect(r.resultHash).toHaveLength(64);
    });

    it('authorization signature verifies against the authorization hash', async () => {
      const kp = await generateKeyPair();
      const mw = new EnforcementMiddleware({
        agentDid: 'did:nobulex:agent-receipts',
        spec: parseSource('covenant X { permit read; }'),
        signer: { privateKey: kp.privateKey, publicKeyHex: kp.publicKeyHex },
      });
      const result = await mw.execute({ action: 'read', params: {} }, () => 'ok');
      const r = result.receipt!;
      const msg = new TextEncoder().encode(r.authorizationHash);
      const sig = fromHex(r.authorizationSignature);
      const pub = fromHex(r.signerPublicKey);
      expect(await verify(msg, sig, pub)).toBe(true);
    });

    it('result signature verifies against the result hash', async () => {
      const kp = await generateKeyPair();
      const mw = new EnforcementMiddleware({
        agentDid: 'did:nobulex:agent-receipts',
        spec: parseSource('covenant X { permit compute; }'),
        signer: { privateKey: kp.privateKey, publicKeyHex: kp.publicKeyHex },
      });
      const result = await mw.execute({ action: 'compute', params: {} }, () => ({ sum: 12 }));
      const r = result.receipt!;
      const msg = new TextEncoder().encode(r.resultHash);
      const sig = fromHex(r.resultSignature);
      const pub = fromHex(r.signerPublicKey);
      expect(await verify(msg, sig, pub)).toBe(true);
      // result hash binds to the handler's return value
      expect(r.resultHash).toBe(sha256Object({ value: { sum: 12 } }));
    });

    it('receipts are attached to blocked-action results too', async () => {
      const kp = await generateKeyPair();
      const mw = new EnforcementMiddleware({
        agentDid: 'did:nobulex:agent-receipts',
        spec: parseSource('covenant X { forbid delete; }'),
        signer: { privateKey: kp.privateKey, publicKeyHex: kp.publicKeyHex },
      });
      const result = await mw.execute({ action: 'delete', params: {} }, () => 'no');
      expect(result.executed).toBe(false);
      expect(result.receipt).toBeDefined();
      expect(result.receipt!.resultHash).toBe(sha256Object({ blocked: true }));
    });

    it('no receipt is produced when no signer is configured', async () => {
      const mw = createMiddleware('did:nobulex:agent', 'covenant X { permit read; }');
      const result = await mw.execute({ action: 'read', params: {} }, () => 'ok');
      expect(result.receipt).toBeUndefined();
    });
  });

  // ── compileSource ────────────────────────────────────────────────────────

  describe('compileSource', () => {
    it('compiles source to enforcement function', () => {
      const enforce = compileSource('covenant X { forbid transfer (amount > 500); permit transfer; }');
      expect(enforce({ action: 'transfer', params: { amount: 600 } }).action).toBe('block');
      expect(enforce({ action: 'transfer', params: { amount: 100 } }).action).toBe('allow');
    });

    it('default deny for unknown actions', () => {
      const enforce = compileSource('covenant X { permit read; }');
      expect(enforce({ action: 'write', params: {} }).action).toBe('block');
    });
  });

  // ── createMiddleware ─────────────────────────────────────────────────────

  describe('createMiddleware', () => {
    it('creates middleware from source string', () => {
      const mw = createMiddleware('did:nobulex:agent-1', 'covenant X { permit read; }');
      expect(mw.spec.name).toBe('X');
    });
  });

  // ── Integration ──────────────────────────────────────────────────────────

  describe('Integration: full enforcement pipeline', () => {
    it('processes multiple actions and produces valid log', async () => {
      const mw = createMiddleware('did:nobulex:agent-1', `
        covenant ApiGuard {
          forbid transfer (amount > 1000);
          permit transfer;
          permit read;
          permit list;
          forbid shutdown;
        }
      `);

      await mw.execute({ action: 'read', params: {} }, () => ['item1', 'item2']);
      await mw.execute({ action: 'transfer', params: { amount: 50 } }, () => 'ok');
      await mw.execute({ action: 'transfer', params: { amount: 5000 } }, () => 'no');
      await mw.execute({ action: 'shutdown', params: {} }, () => 'no');
      await mw.execute({ action: 'list', params: {} }, () => []);

      const log = mw.getLog();
      expect(log.entries).toHaveLength(5);
      expect(log.entries.map(e => e.outcome)).toEqual([
        'success', 'success', 'blocked', 'blocked', 'success',
      ]);

      const integrity = verifyIntegrity(log);
      expect(integrity.valid).toBe(true);
    });
  });
});
