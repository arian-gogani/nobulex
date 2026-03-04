import { describe, it, expect, vi } from 'vitest';
import { protect, transformSyntax } from './index';

describe('@nobulex/quickstart', () => {
  // ── transformSyntax ───────────────────────────────────────────────────────

  describe('transformSyntax', () => {
    it('wraps bare statements in covenant block', () => {
      const result = transformSyntax('permit read;');
      expect(result).toBe('covenant Quickstart { permit read; }');
    });

    it('converts where keyword to parenthesized condition', () => {
      const result = transformSyntax('forbid transfer where amount > 500;');
      expect(result).toBe('covenant Quickstart { forbid transfer (amount > 500); }');
    });

    it('strips require log_all directive', () => {
      const result = transformSyntax('permit read; require log_all;');
      expect(result).toBe('covenant Quickstart { permit read; }');
    });

    it('handles full simplified syntax', () => {
      const result = transformSyntax(
        'permit read; forbid transfer where amount > 500; require log_all;',
      );
      expect(result).toBe(
        'covenant Quickstart { permit read; forbid transfer (amount > 500); }',
      );
    });

    it('passes through already-wrapped covenant syntax', () => {
      const source = 'covenant Custom { permit read; }';
      expect(transformSyntax(source)).toBe(source);
    });
  });

  // ── protect ───────────────────────────────────────────────────────────────

  describe('protect', () => {
    it('creates a protected agent from simplified syntax', () => {
      const agent = protect('permit read;');
      expect(agent).toBeDefined();
      expect(agent.spec.name).toBe('Quickstart');
    });

    it('exposes the parsed covenant spec', () => {
      const agent = protect('permit read; forbid write;');
      expect(agent.spec.statements).toHaveLength(2);
    });

    it('throws on invalid covenant syntax', () => {
      expect(() => protect('not valid at all')).toThrow();
    });
  });

  // ── check ─────────────────────────────────────────────────────────────────

  describe('check', () => {
    it('allows permitted actions', () => {
      const agent = protect('permit read;');
      const result = agent.check({ action: 'read' });
      expect(result.action).toBe('allow');
    });

    it('blocks forbidden actions', () => {
      const agent = protect('forbid write;');
      const result = agent.check({ action: 'write' });
      expect(result.action).toBe('block');
    });

    it('blocks actions with no matching permit (default deny)', () => {
      const agent = protect('permit read;');
      const result = agent.check({ action: 'write' });
      expect(result.action).toBe('block');
    });

    it('evaluates conditions from where clause', () => {
      const agent = protect('forbid transfer where amount > 500; permit transfer;');
      const allowed = agent.check({ action: 'transfer', amount: 200 });
      expect(allowed.action).toBe('allow');

      const blocked = agent.check({ action: 'transfer', amount: 600 });
      expect(blocked.action).toBe('block');
    });

    it('maps flat input to action context params', () => {
      const agent = protect('forbid send where value >= 1000; permit send;');
      expect(agent.check({ action: 'send', value: 999 }).action).toBe('allow');
      expect(agent.check({ action: 'send', value: 1000 }).action).toBe('block');
    });
  });

  // ── execute ───────────────────────────────────────────────────────────────

  describe('execute', () => {
    it('executes handler for allowed actions', async () => {
      const agent = protect('permit read;');
      const result = await agent.execute({ action: 'read' }, () => 'data');
      expect(result.executed).toBe(true);
      expect(result.value).toBe('data');
    });

    it('blocks handler for forbidden actions', async () => {
      const agent = protect('forbid delete;');
      const handler = vi.fn(() => 'nope');
      const result = await agent.execute({ action: 'delete' }, handler);
      expect(result.executed).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('passes flat params through to handler context', async () => {
      const agent = protect('permit transfer;');
      const result = await agent.execute(
        { action: 'transfer', amount: 100, to: 'alice' },
        (ctx) => ctx.params,
      );
      expect(result.value).toEqual({ amount: 100, to: 'alice' });
    });
  });

  // ── action log ────────────────────────────────────────────────────────────

  describe('action log', () => {
    it('tracks executed and blocked actions', async () => {
      const agent = protect('permit read; forbid write;');
      await agent.execute({ action: 'read' }, () => 'ok');
      await agent.execute({ action: 'write' }, () => 'no');

      const log = agent.log;
      expect(log.entries).toHaveLength(2);
      expect(log.entries[0]!.outcome).toBe('success');
      expect(log.entries[1]!.outcome).toBe('blocked');
    });
  });

  // ── full integration (user's 3-line example) ──────────────────────────────

  describe('integration', () => {
    it('works with the user example (with added permit)', () => {
      const agent = protect(
        'permit read; permit transfer; forbid transfer where amount > 500; require log_all;',
      );
      // Transfer 200 — not forbidden (200 < 500), permitted by permit transfer
      const result = agent.check({ action: 'transfer', amount: 200 });
      expect(result.action).toBe('allow');

      // Transfer 600 — forbidden (600 > 500)
      const blocked = agent.check({ action: 'transfer', amount: 600 });
      expect(blocked.action).toBe('block');

      // Read — permitted
      const read = agent.check({ action: 'read' });
      expect(read.action).toBe('allow');
    });
  });
});
