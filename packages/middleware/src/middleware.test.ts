import { describe, it, expect, vi } from 'vitest';
import {
  EnforcementMiddleware,
  createMiddleware,
  compileSource,
} from './index';
import { parseSource } from '@nobulex/covenant-lang';
import { verifyIntegrity } from '@nobulex/action-log';

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
