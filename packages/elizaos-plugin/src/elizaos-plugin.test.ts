import { describe, it, expect } from 'vitest';
import {
  CovenantRuntime,
  createCovenantPlugin,
  createCheckAction,
  createExecuteAction,
  createVerifyAction,
  createLogAction,
  createComplianceEvaluator,
  createPermissionEvaluator,
  createSpecProvider,
  createStatusProvider,
} from './index';
import type {
  ElizaAction,
  ElizaEvaluator,
  ElizaProvider,
  ElizaPlugin,
  CovenantPluginConfig,
} from './index';

const TEST_COVENANT = `
  covenant TestAgent {
    permit read;
    permit write;
    forbid delete;
    forbid transfer (amount > 1000);
    permit transfer;
  }
`;

function makeConfig(overrides: Partial<CovenantPluginConfig> = {}): CovenantPluginConfig {
  return {
    agentDid: 'did:nobulex:test-agent-001',
    covenantSource: TEST_COVENANT,
    ...overrides,
  };
}

describe('@nobulex/elizaos-plugin', () => {

  // ── CovenantRuntime ────────────────────────────────────────────────────────

  describe('CovenantRuntime', () => {
    it('initializes with config', () => {
      const rt = new CovenantRuntime(makeConfig());
      expect(rt.agentDid).toBe('did:nobulex:test-agent-001');
      expect(rt.spec.name).toBe('TestAgent');
      expect(rt.actionCount).toBe(0);
    });

    it('check: allows permitted actions', () => {
      const rt = new CovenantRuntime(makeConfig());
      const decision = rt.check('read');
      expect(decision.action).toBe('allow');
    });

    it('check: blocks forbidden actions', () => {
      const rt = new CovenantRuntime(makeConfig());
      const decision = rt.check('delete');
      expect(decision.action).toBe('block');
    });

    it('check: handles conditional forbids', () => {
      const rt = new CovenantRuntime(makeConfig());
      const allowed = rt.check('transfer', { amount: 100 });
      expect(allowed.action).toBe('allow');
      const blocked = rt.check('transfer', { amount: 5000 });
      expect(blocked.action).toBe('block');
    });

    it('execute: allows and logs permitted actions', async () => {
      const rt = new CovenantRuntime(makeConfig());
      const result = await rt.execute('read');
      expect(result.success).toBe(true);
      expect(rt.actionCount).toBe(1);
    });

    it('execute: blocks and logs forbidden actions', async () => {
      const rt = new CovenantRuntime(makeConfig());
      const result = await rt.execute('delete');
      expect(result.success).toBe(false);
      expect(result.error).toContain('blocked by covenant');
      expect(rt.actionCount).toBe(1);
    });

    it('execute: calls registered handler', async () => {
      const rt = new CovenantRuntime(makeConfig({
        handlers: {
          read: async () => ({ data: [1, 2, 3] }),
        },
      }));
      const result = await rt.execute('read');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: [1, 2, 3] });
    });

    it('execute: handles handler errors', async () => {
      const rt = new CovenantRuntime(makeConfig({
        handlers: {
          read: async () => { throw new Error('DB connection failed'); },
        },
      }));
      const result = await rt.execute('read');
      expect(result.success).toBe(false);
      expect(result.error).toBe('DB connection failed');
    });

    it('getLog: returns valid action log', async () => {
      const rt = new CovenantRuntime(makeConfig());
      await rt.execute('read');
      await rt.execute('delete');
      const log = rt.getLog();
      expect(log.entries).toHaveLength(2);
      expect(log.entries[0]!.outcome).toBe('success');
      expect(log.entries[1]!.outcome).toBe('blocked');
    });

    it('verify: compliant agent', async () => {
      const rt = new CovenantRuntime(makeConfig());
      await rt.execute('read');
      await rt.execute('write');
      const result = rt.verify();
      expect(result.compliant).toBe(true);
    });

    it('history: tracks all results', async () => {
      const rt = new CovenantRuntime(makeConfig());
      await rt.execute('read');
      await rt.execute('delete');
      expect(rt.history).toHaveLength(2);
      expect(rt.history[0]!.success).toBe(true);
      expect(rt.history[1]!.success).toBe(false);
    });

    it('logBlocked: false skips logging blocked actions', async () => {
      const rt = new CovenantRuntime(makeConfig({ logBlocked: false }));
      await rt.execute('read');
      await rt.execute('delete');
      const log = rt.getLog();
      expect(log.entries).toHaveLength(1);
      expect(log.entries[0]!.outcome).toBe('success');
    });
  });

  // ── Actions ────────────────────────────────────────────────────────────────

  describe('Actions', () => {
    it('check-covenant action', async () => {
      const rt = new CovenantRuntime(makeConfig());
      const action = createCheckAction(rt);
      expect(action.name).toBe('check-covenant');

      const result = await action.handler({ action: 'read' });
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).action).toBe('allow');
    });

    it('check-covenant with missing action param', async () => {
      const rt = new CovenantRuntime(makeConfig());
      const action = createCheckAction(rt);
      const result = await action.handler({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing');
    });

    it('check-covenant validate', () => {
      const rt = new CovenantRuntime(makeConfig());
      const action = createCheckAction(rt);
      expect(action.validate!({ action: 'read' })).toBe(true);
      expect(action.validate!({ foo: 'bar' })).toBe(false);
    });

    it('execute-action action', async () => {
      const rt = new CovenantRuntime(makeConfig());
      const action = createExecuteAction(rt);
      expect(action.name).toBe('execute-action');

      const result = await action.handler({ action: 'read' });
      expect(result.success).toBe(true);
    });

    it('execute-action blocks forbidden', async () => {
      const rt = new CovenantRuntime(makeConfig());
      const action = createExecuteAction(rt);
      const result = await action.handler({ action: 'delete' });
      expect(result.success).toBe(false);
    });

    it('execute-action with missing action', async () => {
      const rt = new CovenantRuntime(makeConfig());
      const action = createExecuteAction(rt);
      const result = await action.handler({});
      expect(result.success).toBe(false);
    });

    it('verify-compliance action', async () => {
      const rt = new CovenantRuntime(makeConfig());
      await rt.execute('read');
      const action = createVerifyAction(rt);
      expect(action.name).toBe('verify-compliance');
      const result = await action.handler({});
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).compliant).toBe(true);
    });

    it('get-action-log action', async () => {
      const rt = new CovenantRuntime(makeConfig());
      await rt.execute('read');
      const action = createLogAction(rt);
      expect(action.name).toBe('get-action-log');
      const result = await action.handler({});
      expect(result.success).toBe(true);
      expect((result.data as Record<string, Record<string, unknown>>).integrity.valid).toBe(true);
    });
  });

  // ── Evaluators ─────────────────────────────────────────────────────────────

  describe('Evaluators', () => {
    it('covenant-compliance evaluator: compliant', async () => {
      const rt = new CovenantRuntime(makeConfig());
      await rt.execute('read');
      const evaluator = createComplianceEvaluator(rt);
      expect(evaluator.name).toBe('covenant-compliance');
      const result = await evaluator.handler({
        agentDid: rt.agentDid,
        action: 'read',
        params: {},
        history: [],
      });
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
    });

    it('covenant-compliance evaluator: no actions', async () => {
      const rt = new CovenantRuntime(makeConfig());
      const evaluator = createComplianceEvaluator(rt);
      const result = await evaluator.handler({
        agentDid: rt.agentDid,
        action: '',
        params: {},
        history: [],
      });
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
    });

    it('action-permission evaluator: allowed', async () => {
      const rt = new CovenantRuntime(makeConfig());
      const evaluator = createPermissionEvaluator(rt);
      expect(evaluator.name).toBe('action-permission');
      const result = await evaluator.handler({
        agentDid: rt.agentDid,
        action: 'read',
        params: {},
        history: [],
      });
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
    });

    it('action-permission evaluator: blocked', async () => {
      const rt = new CovenantRuntime(makeConfig());
      const evaluator = createPermissionEvaluator(rt);
      const result = await evaluator.handler({
        agentDid: rt.agentDid,
        action: 'delete',
        params: {},
        history: [],
      });
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0.0);
    });
  });

  // ── Providers ──────────────────────────────────────────────────────────────

  describe('Providers', () => {
    it('covenant-spec provider', async () => {
      const rt = new CovenantRuntime(makeConfig());
      const provider = createSpecProvider(rt);
      expect(provider.name).toBe('covenant-spec');
      const spec = await provider.get() as Record<string, unknown>;
      expect(spec.name).toBe('TestAgent');
    });

    it('agent-status provider', async () => {
      const rt = new CovenantRuntime(makeConfig());
      await rt.execute('read');
      const provider = createStatusProvider(rt);
      expect(provider.name).toBe('agent-status');
      const status = await provider.get() as Record<string, unknown>;
      expect(status.agentDid).toBe('did:nobulex:test-agent-001');
      expect(status.covenantName).toBe('TestAgent');
      expect(status.actionCount).toBe(1);
      expect(status.compliant).toBe(true);
    });
  });

  // ── Plugin Factory ─────────────────────────────────────────────────────────

  describe('createCovenantPlugin', () => {
    it('creates a complete plugin', () => {
      const plugin = createCovenantPlugin(makeConfig());
      expect(plugin.name).toBe('@nobulex/elizaos-plugin');
      expect(plugin.version).toBe('0.1.0');
      expect(plugin.actions).toHaveLength(4);
      expect(plugin.evaluators).toHaveLength(2);
      expect(plugin.providers).toHaveLength(2);
      expect(plugin.runtime).toBeInstanceOf(CovenantRuntime);
    });

    it('actions have expected names', () => {
      const plugin = createCovenantPlugin(makeConfig());
      const names = plugin.actions.map(a => a.name);
      expect(names).toContain('check-covenant');
      expect(names).toContain('execute-action');
      expect(names).toContain('verify-compliance');
      expect(names).toContain('get-action-log');
    });

    it('evaluators have expected names', () => {
      const plugin = createCovenantPlugin(makeConfig());
      const names = plugin.evaluators.map(e => e.name);
      expect(names).toContain('covenant-compliance');
      expect(names).toContain('action-permission');
    });

    it('providers have expected names', () => {
      const plugin = createCovenantPlugin(makeConfig());
      const names = plugin.providers.map(p => p.name);
      expect(names).toContain('covenant-spec');
      expect(names).toContain('agent-status');
    });
  });

  // ── Full Pipeline ──────────────────────────────────────────────────────────

  describe('Full pipeline: plugin → enforce → verify', () => {
    it('end-to-end ElizaOS plugin flow', async () => {
      const plugin = createCovenantPlugin({
        agentDid: 'did:nobulex:eliza-agent-001',
        covenantSource: `
          covenant ElizaBot {
            permit read;
            permit respond;
            permit analyze;
            forbid delete;
            forbid transfer (amount > 500);
            permit transfer;
          }
        `,
        handlers: {
          read: async () => ({ result: 'data loaded' }),
          respond: async (p) => ({ message: `Hello, ${p.user ?? 'world'}!` }),
          analyze: async () => ({ sentiment: 0.8 }),
        },
      });

      // 1. Execute allowed actions
      const readResult = await plugin.runtime.execute('read');
      expect(readResult.success).toBe(true);
      expect(readResult.data).toEqual({ result: 'data loaded' });

      const respondResult = await plugin.runtime.execute('respond', { user: 'Alice' });
      expect(respondResult.success).toBe(true);

      // 2. Execute blocked action
      const deleteResult = await plugin.runtime.execute('delete');
      expect(deleteResult.success).toBe(false);

      // 3. Conditional enforcement
      const smallTransfer = await plugin.runtime.execute('transfer', { amount: 100 });
      expect(smallTransfer.success).toBe(true);

      const bigTransfer = await plugin.runtime.execute('transfer', { amount: 1000 });
      expect(bigTransfer.success).toBe(false);

      // 4. Verify compliance
      const verifyAction = plugin.actions.find(a => a.name === 'verify-compliance')!;
      const verifyResult = await verifyAction.handler({});
      expect(verifyResult.success).toBe(true);
      expect((verifyResult.data as Record<string, unknown>).compliant).toBe(true);

      // 5. Check status via provider
      const statusProvider = plugin.providers.find(p => p.name === 'agent-status')!;
      const status = await statusProvider.get() as Record<string, unknown>;
      expect(status.actionCount).toBe(5);
      expect(status.compliant).toBe(true);

      // 6. Run compliance evaluator
      const complianceEval = plugin.evaluators.find(e => e.name === 'covenant-compliance')!;
      const evalResult = await complianceEval.handler({
        agentDid: 'did:nobulex:eliza-agent-001',
        action: '',
        params: {},
        history: [],
      });
      expect(evalResult.passed).toBe(true);
    });
  });
});
