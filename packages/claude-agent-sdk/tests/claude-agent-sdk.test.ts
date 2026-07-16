import { describe, it, expect, vi } from 'vitest';
import { createNobulexHooks, parseSource } from '../src/index.js';
import { computeOutcomeHash, verifyIntegrity } from '@nobulex/core';
import type { ActionLogEntry } from '@nobulex/core';

const AGENT_DID = 'did:nobulex:test-agent';
const SPEC = parseSource(`
  covenant TestAgent {
    permit read;
    permit list;
    forbid delete;
    forbid transfer (amount > 500);
    permit transfer;
  }
`);

describe('createNobulexHooks', () => {
  // ── PreToolUse decisions ────────────────────────────────────────────────

  it('PreToolUse allows permitted actions', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC });
    const result = hooks.PreToolUse({ toolName: 'read', toolInput: {} });
    expect(result).toBeUndefined();
  });

  it('PreToolUse blocks forbidden actions in enforce mode', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC });
    const result = hooks.PreToolUse({ toolName: 'delete', toolInput: {} });
    expect(result).toBeDefined();
    expect(result!.blocked).toBeDefined();
    expect(result!.blocked).toContain('Nobulex');
  });

  it('blocked actions are written to the log immediately', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC });
    hooks.PreToolUse({ toolName: 'delete', toolInput: {} });
    const log = hooks.getLog();
    expect(log.length).toBe(1);
    expect(log.entries[0]!.outcome).toBe('blocked');
    expect(log.entries[0]!.action).toBe('delete');
  });

  it('PreToolUse honours covenant conditions on parameters', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC });
    const okay = hooks.PreToolUse({ toolName: 'transfer', toolInput: { amount: 100 } });
    const bad = hooks.PreToolUse({ toolName: 'transfer', toolInput: { amount: 999 } });
    expect(okay).toBeUndefined();
    expect(bad?.blocked).toBeDefined();
  });

  it('onBlocked fires when a call is refused', () => {
    const onBlocked = vi.fn();
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC, onBlocked });
    hooks.PreToolUse({ toolName: 'delete', toolInput: {} });
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked.mock.calls[0]![0]).toBe('delete');
  });

  // ── Observe mode ────────────────────────────────────────────────────────

  it('observe mode logs but does not block', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC, mode: 'observe' });
    const result = hooks.PreToolUse({ toolName: 'delete', toolInput: {} });
    // Not blocked, SDK is free to run the tool.
    expect(result).toBeUndefined();

    // After PostToolUse the entry lands with outcome 'would_block'.
    hooks.PostToolUse({ toolName: 'delete', toolInput: {}, result: { ok: true } });
    const log = hooks.getLog();
    expect(log.length).toBe(1);
    expect(log.entries[0]!.outcome).toBe('would_block');
  });

  // ── PostToolUse outcome hash ────────────────────────────────────────────

  it('PostToolUse adds the canonical outcomeHash on success', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC });
    hooks.PreToolUse({ toolName: 'read', toolInput: { path: '/data' } });
    const resultValue = { bytes: 1234, content: 'hello' };
    hooks.PostToolUse({ toolName: 'read', toolInput: { path: '/data' }, result: resultValue });

    const entries = hooks.getLog().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.outcome).toBe('success');
    expect(entries[0]!.outcomeHash).toBe(computeOutcomeHash(resultValue));
    // extractResource lifted the `path` field as the log's resource
    expect(entries[0]!.resource).toBe('/data');
  });

  it('PostToolUse records failure hash when tool erred', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC });
    hooks.PreToolUse({ toolName: 'read', toolInput: {} });
    hooks.PostToolUse({ toolName: 'read', toolInput: {}, result: null, error: 'timeout' });

    const entry = hooks.getLog().entries[0]!;
    expect(entry.outcome).toBe('failure');
    expect(entry.outcomeHash).toBeDefined();
  });

  it('onAction fires for every finalised entry', () => {
    const onAction = vi.fn<(e: ActionLogEntry) => void>();
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC, onAction });
    hooks.PreToolUse({ toolName: 'read', toolInput: {} });
    hooks.PostToolUse({ toolName: 'read', toolInput: {}, result: 'ok' });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  // ── Halt / resume ───────────────────────────────────────────────────────

  it('halt blocks everything, including permitted actions', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC });
    hooks.halt();
    expect(hooks.halted()).toBe(true);
    const result = hooks.PreToolUse({ toolName: 'read', toolInput: {} });
    expect(result?.blocked).toBeDefined();
    expect(hooks.getLog().entries[0]!.outcome).toBe('halted');
  });

  it('halt even overrides observe mode', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC, mode: 'observe' });
    hooks.halt();
    const result = hooks.PreToolUse({ toolName: 'read', toolInput: {} });
    expect(result?.blocked).toBeDefined();
  });

  it('resume restores normal enforcement', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC });
    hooks.halt();
    hooks.PreToolUse({ toolName: 'read', toolInput: {} });
    hooks.resume();
    expect(hooks.halted()).toBe(false);
    const allowed = hooks.PreToolUse({ toolName: 'read', toolInput: {} });
    expect(allowed).toBeUndefined();
    hooks.PostToolUse({ toolName: 'read', toolInput: {}, result: 'ok' });
    const outcomes = hooks.getLog().entries.map((e) => e.outcome);
    expect(outcomes).toEqual(['halted', 'success']);
  });

  // ── getLog ──────────────────────────────────────────────────────────────

  it('getLog returns the full hash-chained log', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC });
    hooks.PreToolUse({ toolName: 'read', toolInput: {} });
    hooks.PostToolUse({ toolName: 'read', toolInput: {}, result: 'a' });
    hooks.PreToolUse({ toolName: 'list', toolInput: {} });
    hooks.PostToolUse({ toolName: 'list', toolInput: {}, result: ['x'] });
    hooks.PreToolUse({ toolName: 'delete', toolInput: {} });

    const log = hooks.getLog();
    expect(log.agentDid).toBe(AGENT_DID);
    expect(log.length).toBe(3);
    expect(log.entries.map((e) => e.outcome)).toEqual(['success', 'success', 'blocked']);
    expect(log.rootHash).toBe(log.entries[0]!.hash);
    expect(log.headHash).toBe(log.entries[2]!.hash);
  });

  // ── verifyChain ─────────────────────────────────────────────────────────

  it('verifyChain returns valid for an untampered log', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC });
    hooks.PreToolUse({ toolName: 'read', toolInput: {} });
    hooks.PostToolUse({ toolName: 'read', toolInput: {}, result: 'ok' });
    hooks.PreToolUse({ toolName: 'list', toolInput: {} });
    hooks.PostToolUse({ toolName: 'list', toolInput: {}, result: [] });

    const { valid, errors } = hooks.verifyChain();
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('verifyChain detects tampering via the underlying log', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC });
    hooks.PreToolUse({ toolName: 'read', toolInput: {} });
    hooks.PostToolUse({ toolName: 'read', toolInput: {}, result: 'ok' });
    hooks.PreToolUse({ toolName: 'list', toolInput: {} });
    hooks.PostToolUse({ toolName: 'list', toolInput: {}, result: [] });

    // Forge a new entry outside the hash chain and re-verify.
    const tampered = hooks.getLog();
    const mutated = {
      ...tampered,
      entries: tampered.entries.map((e, i) =>
        i === 1 ? { ...e, action: 'HIJACKED' } : e,
      ),
    };
    const result = verifyIntegrity(mutated);
    expect(result.valid).toBe(false);
    expect(result.errors.some((err: string) => err.includes('hash mismatch'))).toBe(true);
  });

  // ── Hook API completeness ───────────────────────────────────────────────

  it('SessionStart / SessionEnd are callable without error', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC });
    expect(() => hooks.SessionStart({ sessionId: 's1' })).not.toThrow();
    expect(() => hooks.SessionEnd({ sessionId: 's1' })).not.toThrow();
  });

  it('SessionEnd flushes a dangling pending call as failure', () => {
    const hooks = createNobulexHooks({ agentDid: AGENT_DID, spec: SPEC });
    hooks.PreToolUse({ toolName: 'read', toolInput: {} });
    // Session ends before PostToolUse arrives.
    hooks.SessionEnd({ sessionId: 's1' });
    const entries = hooks.getLog().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.outcome).toBe('failure');
  });
});
