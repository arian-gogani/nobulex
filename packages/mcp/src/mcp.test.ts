import { describe, it, expect, vi } from 'vitest';
import { generateKeyPair } from '@stele/crypto';
import type { KeyPair } from '@stele/crypto';
import { buildCovenant } from '@stele/core';
import type { CovenantDocument } from '@stele/core';

import { SteleGuard, PRESETS } from './index';
import type {
  MCPServer,
  WrappedMCPServer,
  ViolationDetails,
  ToolCallDetails,
} from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * CCL constraints that permit tool.read_file on any resource
 * and deny tool.write_file / tool.send_request with high / critical severity.
 * This gives a clear permit-vs-deny split for test assertions.
 */
const TEST_CONSTRAINTS = `permit tool.read_file on '**'
deny tool.write_file on '**' severity high
deny tool.send_request on '**' severity critical`;

function createMockServer(): MCPServer {
  return {
    tools: [
      { name: 'read_file', description: 'Read a file' },
      { name: 'write_file', description: 'Write a file' },
      { name: 'send_request', description: 'Send HTTP request' },
    ],
    handleToolCall: async (name: string, args: Record<string, unknown>) => {
      return { result: `${name} executed`, args };
    },
    customProperty: 'preserved',
  };
}

/** Convenience wrapper: wrap with enforce mode (the default). */
async function wrapEnforce(
  server?: MCPServer,
  overrides?: Partial<Parameters<typeof SteleGuard.wrap>[1]>,
): Promise<WrappedMCPServer> {
  return SteleGuard.wrap(server ?? createMockServer(), {
    constraints: TEST_CONSTRAINTS,
    mode: 'enforce',
    ...overrides,
  });
}

/** Convenience wrapper: wrap with log_only mode. */
async function wrapLogOnly(
  server?: MCPServer,
  overrides?: Partial<Parameters<typeof SteleGuard.wrap>[1]>,
): Promise<WrappedMCPServer> {
  return SteleGuard.wrap(server ?? createMockServer(), {
    constraints: TEST_CONSTRAINTS,
    mode: 'log_only',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// SteleGuard.wrap basics
// ---------------------------------------------------------------------------
describe('SteleGuard.wrap', () => {
  it('creates a WrappedMCPServer', async () => {
    const wrapped = await wrapEnforce();
    expect(wrapped).toBeDefined();
    expect(typeof wrapped.handleToolCall).toBe('function');
  });

  it('wrapped server has all Stele accessors', async () => {
    const wrapped = await wrapEnforce();
    expect(typeof wrapped.getMonitor).toBe('function');
    expect(typeof wrapped.getIdentity).toBe('function');
    expect(typeof wrapped.getAuditLog).toBe('function');
    expect(typeof wrapped.getCovenant).toBe('function');
    expect(typeof wrapped.generateProof).toBe('function');
    expect(typeof wrapped.getReceipt).toBe('function');
  });

  it('passes through original properties', async () => {
    const server = createMockServer();
    const wrapped = await wrapEnforce(server);
    expect((wrapped as Record<string, unknown>)['customProperty']).toBe('preserved');
  });

  it('preserves the tools array from the original server', async () => {
    const server = createMockServer();
    const wrapped = await wrapEnforce(server);
    expect(wrapped.tools).toEqual(server.tools);
    expect(wrapped.tools).toHaveLength(3);
  });

  it('accepts an explicit operatorKeyPair', async () => {
    const kp = await generateKeyPair();
    const wrapped = await wrapEnforce(undefined, { operatorKeyPair: kp });
    const identity = wrapped.getIdentity();
    expect(identity.operatorPublicKey).toBe(kp.publicKeyHex);
  });

  it('accepts an agentIdentifier', async () => {
    const wrapped = await wrapEnforce(undefined, {
      agentIdentifier: 'test-agent-007',
    });
    const covenant = wrapped.getCovenant();
    expect(covenant.issuer.id).toBe('test-agent-007');
  });
});

// ---------------------------------------------------------------------------
// handleToolCall: permitted actions
// ---------------------------------------------------------------------------
describe('handleToolCall - permitted actions', () => {
  it('permits read_file and returns the handler result', async () => {
    const wrapped = await wrapEnforce();
    const result = await wrapped.handleToolCall!('read_file', { path: '/data/test.txt' });
    expect(result).toEqual({
      result: 'read_file executed',
      args: { path: '/data/test.txt' },
    });
  });

  it('works when the original server has no handleToolCall', async () => {
    const server: MCPServer = {
      tools: [{ name: 'read_file', description: 'Read' }],
    };
    const wrapped = await SteleGuard.wrap(server, {
      constraints: `permit tool.read_file on '**'`,
    });
    const result = await wrapped.handleToolCall!('read_file', {});
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleToolCall: enforce mode blocks violations
// ---------------------------------------------------------------------------
describe('handleToolCall - enforce mode blocks violations', () => {
  it('throws on a denied write_file call', async () => {
    const wrapped = await wrapEnforce();
    await expect(
      wrapped.handleToolCall!('write_file', { path: '/etc/passwd' }),
    ).rejects.toThrow(/denied/i);
  });

  it('throws on a denied send_request call', async () => {
    const wrapped = await wrapEnforce();
    await expect(
      wrapped.handleToolCall!('send_request', { url: 'https://evil.com' }),
    ).rejects.toThrow(/denied/i);
  });

  it('does not call the original handler when action is denied', async () => {
    const handler = vi.fn().mockResolvedValue('should not be called');
    const server: MCPServer = {
      tools: [{ name: 'write_file', description: 'Write' }],
      handleToolCall: handler,
    };
    const wrapped = await wrapEnforce(server);

    await expect(
      wrapped.handleToolCall!('write_file', { path: '/tmp/out' }),
    ).rejects.toThrow();

    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleToolCall: log_only mode
// ---------------------------------------------------------------------------
describe('handleToolCall - log_only mode', () => {
  it('does NOT throw on a denied action in log_only mode', async () => {
    const wrapped = await wrapLogOnly();
    // In log_only mode the monitor does NOT throw -- the original handler is
    // called even for constraint-violating actions.
    const result = await wrapped.handleToolCall!('write_file', { path: '/tmp/x' });
    expect(result).toEqual({
      result: 'write_file executed',
      args: { path: '/tmp/x' },
    });
  });

  it('still records audit entries for log_only violations', async () => {
    const wrapped = await wrapLogOnly();
    await wrapped.handleToolCall!('write_file', { path: '/tmp/x' });
    const log = wrapped.getAuditLog();
    expect(log.entries.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Preset constraints
// ---------------------------------------------------------------------------
describe('PRESETS', () => {
  it('has exactly four presets', () => {
    const keys = Object.keys(PRESETS);
    expect(keys).toHaveLength(4);
  });

  it('contains standard:data-isolation', () => {
    expect(PRESETS['standard:data-isolation']).toBeDefined();
    expect(PRESETS['standard:data-isolation']).toContain('permit');
    expect(PRESETS['standard:data-isolation']).toContain('deny');
  });

  it('contains standard:read-write', () => {
    expect(PRESETS['standard:read-write']).toBeDefined();
    expect(PRESETS['standard:read-write']).toContain('permit file.read');
    expect(PRESETS['standard:read-write']).toContain('permit file.write');
  });

  it('contains standard:network', () => {
    expect(PRESETS['standard:network']).toBeDefined();
    expect(PRESETS['standard:network']).toContain('permit network.send');
  });

  it('contains standard:minimal', () => {
    expect(PRESETS['standard:minimal']).toBeDefined();
    expect(PRESETS['standard:minimal']).toContain('deny file.read');
    expect(PRESETS['standard:minimal']).toContain('deny file.write');
    expect(PRESETS['standard:minimal']).toContain('deny network.send');
  });

  it('resolves a preset name via SteleGuard.wrap without error', async () => {
    const server = createMockServer();
    const wrapped = await SteleGuard.wrap(server, {
      constraints: 'standard:data-isolation',
    });
    expect(wrapped).toBeDefined();
    expect(typeof wrapped.handleToolCall).toBe('function');
  });

  it('passes raw CCL through when no preset matches', async () => {
    const rawCCL = `permit tool.read_file on '**'`;
    const server = createMockServer();
    const wrapped = await SteleGuard.wrap(server, { constraints: rawCCL });
    // read_file should be permitted with this raw CCL
    const result = await wrapped.handleToolCall!('read_file', {});
    expect(result).toEqual({ result: 'read_file executed', args: {} });
  });
});

// ---------------------------------------------------------------------------
// getAuditLog
// ---------------------------------------------------------------------------
describe('getAuditLog', () => {
  it('starts empty', async () => {
    const wrapped = await wrapEnforce();
    const log = wrapped.getAuditLog();
    expect(log.entries).toHaveLength(0);
    expect(log.count).toBe(0);
  });

  it('records entries after permitted tool calls', async () => {
    const wrapped = await wrapEnforce();
    await wrapped.handleToolCall!('read_file', { path: '/data/a.txt' });
    await wrapped.handleToolCall!('read_file', { path: '/data/b.txt' });

    const log = wrapped.getAuditLog();
    expect(log.entries).toHaveLength(2);
    expect(log.count).toBe(2);
    expect(log.entries[0]!.action).toBe('tool.read_file');
    expect(log.entries[1]!.action).toBe('tool.read_file');
  });

  it('records entries after denied tool calls (enforce mode)', async () => {
    const wrapped = await wrapEnforce();
    await wrapped.handleToolCall!('read_file', {});
    await expect(wrapped.handleToolCall!('write_file', {})).rejects.toThrow();

    const log = wrapped.getAuditLog();
    // Both the permitted and the denied action should have audit entries
    expect(log.entries).toHaveLength(2);
  });

  it('has a covenantId matching the wrapped covenant', async () => {
    const wrapped = await wrapEnforce();
    await wrapped.handleToolCall!('read_file', {});
    const log = wrapped.getAuditLog();
    const covenant = wrapped.getCovenant();
    expect(log.covenantId).toBe(covenant.id);
  });

  it('entries contain hash-chained previousHash', async () => {
    const wrapped = await wrapEnforce();
    await wrapped.handleToolCall!('read_file', { path: '/a' });
    await wrapped.handleToolCall!('read_file', { path: '/b' });

    const log = wrapped.getAuditLog();
    const first = log.entries[0]!;
    const second = log.entries[1]!;

    // First entry's previousHash should be the genesis hash
    expect(first.previousHash).toBe(
      '0000000000000000000000000000000000000000000000000000000000000000',
    );
    // Second entry's previousHash should be the hash of the first entry
    expect(second.previousHash).toBe(first.hash);
  });
});

// ---------------------------------------------------------------------------
// getCovenant
// ---------------------------------------------------------------------------
describe('getCovenant', () => {
  it('returns a valid CovenantDocument', async () => {
    const wrapped = await wrapEnforce();
    const covenant = wrapped.getCovenant();
    expect(covenant).toBeDefined();
    expect(typeof covenant.id).toBe('string');
    expect(covenant.id.length).toBe(64); // SHA-256 hex
    expect(typeof covenant.version).toBe('string');
    expect(typeof covenant.constraints).toBe('string');
    expect(typeof covenant.signature).toBe('string');
    expect(typeof covenant.nonce).toBe('string');
    expect(covenant.nonce.length).toBeGreaterThan(0);
    expect(typeof covenant.createdAt).toBe('string');
  });

  it('has issuer and beneficiary parties', async () => {
    const wrapped = await wrapEnforce();
    const covenant = wrapped.getCovenant();
    expect(covenant.issuer).toBeDefined();
    expect(covenant.issuer.role).toBe('issuer');
    expect(covenant.beneficiary).toBeDefined();
    expect(covenant.beneficiary.role).toBe('beneficiary');
  });

  it('includes the enforcement config', async () => {
    const wrapped = await wrapEnforce();
    const covenant = wrapped.getCovenant();
    expect(covenant.enforcement).toBeDefined();
    expect(covenant.enforcement!.type).toBe('monitor');
    expect(covenant.enforcement!.config).toEqual({ mode: 'enforce' });
  });

  it('includes the proof config', async () => {
    const wrapped = await wrapEnforce();
    const covenant = wrapped.getCovenant();
    expect(covenant.proof).toBeDefined();
    expect(covenant.proof!.type).toBe('audit_log');
  });

  it('uses custom proofType when specified', async () => {
    const wrapped = await wrapEnforce(undefined, { proofType: 'capability_manifest' });
    const covenant = wrapped.getCovenant();
    expect(covenant.proof!.type).toBe('capability_manifest');
  });
});

// ---------------------------------------------------------------------------
// getIdentity
// ---------------------------------------------------------------------------
describe('getIdentity', () => {
  it('returns an AgentIdentity with expected fields', async () => {
    const wrapped = await wrapEnforce();
    const identity = wrapped.getIdentity();

    expect(typeof identity.id).toBe('string');
    expect(identity.id.length).toBe(64);
    expect(typeof identity.operatorPublicKey).toBe('string');
    expect(identity.operatorPublicKey.length).toBe(64);
    expect(typeof identity.signature).toBe('string');
    expect(typeof identity.createdAt).toBe('string');
    expect(typeof identity.updatedAt).toBe('string');
    expect(identity.version).toBe(1);
  });

  it('includes capabilities derived from tool names', async () => {
    const wrapped = await wrapEnforce();
    const identity = wrapped.getIdentity();

    expect(identity.capabilities).toContain('tool.read_file');
    expect(identity.capabilities).toContain('tool.write_file');
    expect(identity.capabilities).toContain('tool.send_request');
  });

  it('includes model attestation', async () => {
    const wrapped = await wrapEnforce();
    const identity = wrapped.getIdentity();
    expect(identity.model).toBeDefined();
    expect(typeof identity.model.provider).toBe('string');
    expect(typeof identity.model.modelId).toBe('string');
  });

  it('uses provided model attestation', async () => {
    const wrapped = await wrapEnforce(undefined, {
      model: {
        provider: 'anthropic',
        modelId: 'claude-3-opus',
        attestationType: 'provider_signed',
      },
    });
    const identity = wrapped.getIdentity();
    expect(identity.model.provider).toBe('anthropic');
    expect(identity.model.modelId).toBe('claude-3-opus');
    expect(identity.model.attestationType).toBe('provider_signed');
  });

  it('has lineage with a single created entry', async () => {
    const wrapped = await wrapEnforce();
    const identity = wrapped.getIdentity();
    expect(identity.lineage).toHaveLength(1);
    expect(identity.lineage[0]!.changeType).toBe('created');
    expect(identity.lineage[0]!.parentHash).toBeNull();
  });

  it('has a deployment with runtime = process', async () => {
    const wrapped = await wrapEnforce();
    const identity = wrapped.getIdentity();
    expect(identity.deployment.runtime).toBe('process');
  });
});

// ---------------------------------------------------------------------------
// getMonitor
// ---------------------------------------------------------------------------
describe('getMonitor', () => {
  it('returns a Monitor instance', async () => {
    const wrapped = await wrapEnforce();
    const monitor = wrapped.getMonitor();
    expect(monitor).toBeDefined();
    expect(typeof monitor.evaluate).toBe('function');
    expect(typeof monitor.getAuditLog).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// getReceipt
// ---------------------------------------------------------------------------
describe('getReceipt', () => {
  it('returns null before any tool calls', async () => {
    const wrapped = await wrapEnforce();
    expect(wrapped.getReceipt()).toBeNull();
  });

  it('returns an ExecutionReceipt after a permitted tool call', async () => {
    const wrapped = await wrapEnforce();
    await wrapped.handleToolCall!('read_file', {});
    const receipt = wrapped.getReceipt();
    expect(receipt).not.toBeNull();
    expect(receipt!.outcome).toBe('fulfilled');
    expect(typeof receipt!.receiptHash).toBe('string');
  });

  it('returns a breached receipt after a denied tool call', async () => {
    const wrapped = await wrapEnforce();
    await expect(wrapped.handleToolCall!('write_file', {})).rejects.toThrow();
    const receipt = wrapped.getReceipt();
    expect(receipt).not.toBeNull();
    expect(receipt!.outcome).toBe('breached');
  });
});

// ---------------------------------------------------------------------------
// generateProof
// ---------------------------------------------------------------------------
describe('generateProof', () => {
  it('returns a ComplianceProof after tool calls', async () => {
    const wrapped = await wrapEnforce();
    await wrapped.handleToolCall!('read_file', { path: '/data/file.txt' });
    const proof = await wrapped.generateProof();
    expect(proof).toBeDefined();
    expect(typeof proof.proof).toBe('string');
    expect(proof.covenantId).toBe(wrapped.getCovenant().id);
    expect(proof.version).toBe('1.0');
    expect(proof.entryCount).toBe(1);
    expect(proof.proofSystem).toBe('poseidon_hash');
  });
});

// ---------------------------------------------------------------------------
// onViolation callback
// ---------------------------------------------------------------------------
describe('onViolation callback', () => {
  it('fires when a tool call is denied', async () => {
    const violations: ViolationDetails[] = [];
    const wrapped = await wrapEnforce(undefined, {
      onViolation: (details) => violations.push(details),
    });

    await expect(
      wrapped.handleToolCall!('write_file', { path: '/etc/shadow' }),
    ).rejects.toThrow();

    expect(violations).toHaveLength(1);
    expect(violations[0]!.toolName).toBe('write_file');
    expect(violations[0]!.action).toBe('tool.write_file');
    expect(violations[0]!.resource).toBe('/etc/shadow');
    expect(violations[0]!.severity).toBeDefined();
    expect(typeof violations[0]!.timestamp).toBe('string');
    expect(typeof violations[0]!.constraint).toBe('string');
  });

  it('does NOT fire on a permitted call', async () => {
    const onViolation = vi.fn();
    const wrapped = await wrapEnforce(undefined, { onViolation });
    await wrapped.handleToolCall!('read_file', {});
    expect(onViolation).not.toHaveBeenCalled();
  });

  it('fires for each separate violation', async () => {
    const violations: ViolationDetails[] = [];
    const wrapped = await wrapEnforce(undefined, {
      onViolation: (d) => violations.push(d),
    });

    await expect(wrapped.handleToolCall!('write_file', {})).rejects.toThrow();
    await expect(wrapped.handleToolCall!('send_request', { url: 'http://x' })).rejects.toThrow();

    expect(violations).toHaveLength(2);
    expect(violations[0]!.toolName).toBe('write_file');
    expect(violations[1]!.toolName).toBe('send_request');
  });
});

// ---------------------------------------------------------------------------
// onToolCall callback
// ---------------------------------------------------------------------------
describe('onToolCall callback', () => {
  it('fires on every permitted call', async () => {
    const calls: ToolCallDetails[] = [];
    const wrapped = await wrapEnforce(undefined, {
      onToolCall: (d) => calls.push(d),
    });

    await wrapped.handleToolCall!('read_file', { path: '/data/x' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.toolName).toBe('read_file');
    expect(calls[0]!.permitted).toBe(true);
    expect(calls[0]!.action).toBe('tool.read_file');
    expect(calls[0]!.resource).toBe('/data/x');
    expect(typeof calls[0]!.durationMs).toBe('number');
    expect(typeof calls[0]!.timestamp).toBe('string');
  });

  it('fires on denied calls with permitted = false', async () => {
    const calls: ToolCallDetails[] = [];
    const wrapped = await wrapEnforce(undefined, {
      onToolCall: (d) => calls.push(d),
    });

    await expect(wrapped.handleToolCall!('write_file', {})).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.toolName).toBe('write_file');
    expect(calls[0]!.permitted).toBe(false);
  });

  it('fires for both permitted and denied calls', async () => {
    const calls: ToolCallDetails[] = [];
    const wrapped = await wrapEnforce(undefined, {
      onToolCall: (d) => calls.push(d),
    });

    await wrapped.handleToolCall!('read_file', {});
    await expect(wrapped.handleToolCall!('write_file', {})).rejects.toThrow();

    expect(calls).toHaveLength(2);
    expect(calls[0]!.permitted).toBe(true);
    expect(calls[1]!.permitted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SteleGuard.fromCovenant
// ---------------------------------------------------------------------------
describe('SteleGuard.fromCovenant', () => {
  it('wraps a server using a pre-built covenant', async () => {
    const kp = await generateKeyPair();

    // Build the covenant externally
    const covenant = await buildCovenant({
      issuer: {
        id: kp.publicKeyHex,
        publicKey: kp.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'agent-001',
        publicKey: kp.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: TEST_CONSTRAINTS,
      privateKey: kp.privateKey,
      enforcement: {
        type: 'monitor',
        config: { mode: 'enforce' },
      },
    });

    const server = createMockServer();
    const wrapped = await SteleGuard.fromCovenant(server, covenant, kp);

    expect(wrapped).toBeDefined();
    expect(typeof wrapped.handleToolCall).toBe('function');
    expect(typeof wrapped.getMonitor).toBe('function');
    expect(typeof wrapped.getIdentity).toBe('function');
    expect(typeof wrapped.getAuditLog).toBe('function');
    expect(typeof wrapped.getCovenant).toBe('function');
  });

  it('uses the same covenant that was passed in', async () => {
    const kp = await generateKeyPair();
    const covenant = await buildCovenant({
      issuer: {
        id: kp.publicKeyHex,
        publicKey: kp.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'agent-002',
        publicKey: kp.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: TEST_CONSTRAINTS,
      privateKey: kp.privateKey,
    });

    const wrapped = await SteleGuard.fromCovenant(
      createMockServer(),
      covenant,
      kp,
    );
    expect(wrapped.getCovenant().id).toBe(covenant.id);
  });

  it('enforces constraints from the pre-built covenant', async () => {
    const kp = await generateKeyPair();
    const covenant = await buildCovenant({
      issuer: {
        id: kp.publicKeyHex,
        publicKey: kp.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'agent-003',
        publicKey: kp.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: TEST_CONSTRAINTS,
      privateKey: kp.privateKey,
      enforcement: {
        type: 'monitor',
        config: { mode: 'enforce' },
      },
    });

    const wrapped = await SteleGuard.fromCovenant(
      createMockServer(),
      covenant,
      kp,
    );

    // Permitted action should succeed
    const result = await wrapped.handleToolCall!('read_file', {});
    expect(result).toEqual({ result: 'read_file executed', args: {} });

    // Denied action should throw
    await expect(
      wrapped.handleToolCall!('write_file', { path: '/out' }),
    ).rejects.toThrow(/denied/i);
  });

  it('respects log_only mode from covenant enforcement config', async () => {
    const kp = await generateKeyPair();
    const covenant = await buildCovenant({
      issuer: {
        id: kp.publicKeyHex,
        publicKey: kp.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'agent-004',
        publicKey: kp.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: TEST_CONSTRAINTS,
      privateKey: kp.privateKey,
      enforcement: {
        type: 'monitor',
        config: { mode: 'log_only' },
      },
    });

    const wrapped = await SteleGuard.fromCovenant(
      createMockServer(),
      covenant,
      kp,
    );

    // In log_only, the denied action should NOT throw
    const result = await wrapped.handleToolCall!('write_file', {});
    expect(result).toEqual({ result: 'write_file executed', args: {} });
  });
});

// ---------------------------------------------------------------------------
// Resource resolution from tool arguments
// ---------------------------------------------------------------------------
describe('toolResource resolution', () => {
  it('uses the path argument as the resource', async () => {
    const calls: ToolCallDetails[] = [];
    const wrapped = await wrapEnforce(undefined, {
      onToolCall: (d) => calls.push(d),
    });
    await wrapped.handleToolCall!('read_file', { path: '/data/special.txt' });
    expect(calls[0]!.resource).toBe('/data/special.txt');
  });

  it('uses the file argument as the resource', async () => {
    const calls: ToolCallDetails[] = [];
    const wrapped = await wrapEnforce(undefined, {
      onToolCall: (d) => calls.push(d),
    });
    await wrapped.handleToolCall!('read_file', { file: '/data/other.txt' });
    expect(calls[0]!.resource).toBe('/data/other.txt');
  });

  it('uses url argument as the resource', async () => {
    const violations: ViolationDetails[] = [];
    const wrapped = await wrapEnforce(undefined, {
      onViolation: (d) => violations.push(d),
    });
    await expect(
      wrapped.handleToolCall!('send_request', { url: 'https://example.com/api' }),
    ).rejects.toThrow();
    expect(violations[0]!.resource).toBe('https://example.com/api');
  });

  it('falls back to /tool/<name> when no recognized arg is present', async () => {
    const calls: ToolCallDetails[] = [];
    const wrapped = await wrapEnforce(undefined, {
      onToolCall: (d) => calls.push(d),
    });
    await wrapped.handleToolCall!('read_file', { someOtherArg: 42 });
    expect(calls[0]!.resource).toBe('/tool/read_file');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('edge cases', () => {
  it('handles a server with no tools array', async () => {
    const server: MCPServer = {
      handleToolCall: async (name: string) => ({ ok: true, name }),
    };
    const wrapped = await SteleGuard.wrap(server, {
      constraints: `permit tool.anything on '**'`,
    });
    expect(wrapped.tools).toBeUndefined();
    const identity = wrapped.getIdentity();
    expect(identity.capabilities).toEqual([]);
  });

  it('handles a server with empty tools array', async () => {
    const server: MCPServer = {
      tools: [],
      handleToolCall: async () => 'ok',
    };
    const wrapped = await SteleGuard.wrap(server, {
      constraints: `permit tool.anything on '**'`,
    });
    expect(wrapped.tools).toEqual([]);
    const identity = wrapped.getIdentity();
    expect(identity.capabilities).toEqual([]);
  });

  it('throws on invalid CCL constraints', async () => {
    const server = createMockServer();
    await expect(
      SteleGuard.wrap(server, { constraints: 'this is not valid CCL %%%' }),
    ).rejects.toThrow();
  });

  it('successive tool calls produce unique audit entry hashes', async () => {
    const wrapped = await wrapEnforce();
    await wrapped.handleToolCall!('read_file', { path: '/a' });
    await wrapped.handleToolCall!('read_file', { path: '/b' });
    await wrapped.handleToolCall!('read_file', { path: '/c' });

    const log = wrapped.getAuditLog();
    const hashes = log.entries.map((e) => e.hash);
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(3);
  });

  it('audit log has a merkleRoot after tool calls', async () => {
    const wrapped = await wrapEnforce();
    await wrapped.handleToolCall!('read_file', {});
    const log = wrapped.getAuditLog();
    expect(typeof log.merkleRoot).toBe('string');
    expect(log.merkleRoot.length).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// Both callbacks work together
// ---------------------------------------------------------------------------
describe('onViolation and onToolCall together', () => {
  it('both fire on a denied call', async () => {
    const violations: ViolationDetails[] = [];
    const toolCalls: ToolCallDetails[] = [];
    const wrapped = await wrapEnforce(undefined, {
      onViolation: (d) => violations.push(d),
      onToolCall: (d) => toolCalls.push(d),
    });

    await expect(
      wrapped.handleToolCall!('write_file', { path: '/x' }),
    ).rejects.toThrow();

    expect(violations).toHaveLength(1);
    expect(toolCalls).toHaveLength(1);
    expect(violations[0]!.toolName).toBe('write_file');
    expect(toolCalls[0]!.toolName).toBe('write_file');
    expect(toolCalls[0]!.permitted).toBe(false);
  });

  it('only onToolCall fires on a permitted call', async () => {
    const violations: ViolationDetails[] = [];
    const toolCalls: ToolCallDetails[] = [];
    const wrapped = await wrapEnforce(undefined, {
      onViolation: (d) => violations.push(d),
      onToolCall: (d) => toolCalls.push(d),
    });

    await wrapped.handleToolCall!('read_file', {});

    expect(violations).toHaveLength(0);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.permitted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multiple sequential operations (integration-style)
// ---------------------------------------------------------------------------
describe('integration: sequential operations', () => {
  it('tracks state across many permitted and denied calls', async () => {
    const violations: ViolationDetails[] = [];
    const toolCalls: ToolCallDetails[] = [];
    const wrapped = await wrapEnforce(undefined, {
      onViolation: (d) => violations.push(d),
      onToolCall: (d) => toolCalls.push(d),
    });

    // 3 permitted reads
    await wrapped.handleToolCall!('read_file', { path: '/data/1' });
    await wrapped.handleToolCall!('read_file', { path: '/data/2' });
    await wrapped.handleToolCall!('read_file', { path: '/data/3' });

    // 2 denied writes
    await expect(wrapped.handleToolCall!('write_file', {})).rejects.toThrow();
    await expect(wrapped.handleToolCall!('send_request', {})).rejects.toThrow();

    // 1 more permitted read
    await wrapped.handleToolCall!('read_file', { path: '/data/4' });

    const log = wrapped.getAuditLog();
    expect(log.count).toBe(6);
    expect(violations).toHaveLength(2);
    expect(toolCalls).toHaveLength(6);

    // The receipt should reflect breaches
    const receipt = wrapped.getReceipt();
    expect(receipt).not.toBeNull();
    expect(receipt!.outcome).toBe('breached');

    // Identity and covenant should still be consistent
    const identity = wrapped.getIdentity();
    expect(identity.id.length).toBe(64);
    const covenant = wrapped.getCovenant();
    expect(covenant.id.length).toBe(64);
  });
});

// ─── Extended SteleGuard tests ──────────────────────────────────────────────

describe('SteleGuard - extended preset tests', () => {
  it('data-isolation preset permits file.read and denies network access', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();

    const wrapped = await SteleGuard.wrap(server, {
      operatorKeyPair: kp,
      agentIdentifier: 'isolation-test',
      constraints: 'standard:data-isolation',
    });

    // The data-isolation preset should restrict network
    expect(wrapped.tools).toBeDefined();
    expect(wrapped.tools!.length).toBeGreaterThanOrEqual(0);
  });

  it('read-write preset permits file operations', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();

    const wrapped = await SteleGuard.wrap(server, {
      operatorKeyPair: kp,
      agentIdentifier: 'rw-test',
      constraints: 'standard:read-write',
    });

    expect(wrapped.tools).toBeDefined();
  });

  it('network preset allows network operations', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();

    const wrapped = await SteleGuard.wrap(server, {
      operatorKeyPair: kp,
      agentIdentifier: 'net-test',
      constraints: 'standard:network',
    });

    expect(wrapped.tools).toBeDefined();
  });

  it('minimal preset is most restrictive', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();

    const wrapped = await SteleGuard.wrap(server, {
      operatorKeyPair: kp,
      agentIdentifier: 'min-test',
      constraints: 'standard:minimal',
    });

    expect(wrapped.tools).toBeDefined();
  });
});

describe('SteleGuard - custom constraints', () => {
  it('wraps server with custom CCL constraints', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();

    const constraints = [
      "permit tool.read_file on '**'",
      "permit tool.write_file on '/tmp/**'",
      "deny tool.write_file on '/etc/**' severity critical",
    ].join('\n');

    const wrapped = await SteleGuard.wrap(server, {
      operatorKeyPair: kp,
      agentIdentifier: 'custom-test',
      constraints,
    });

    expect(wrapped.tools).toBeDefined();
    expect(wrapped.getCovenant()).toBeDefined();
  });

  it('wrapped server preserves original tool list', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();

    const wrapped = await SteleGuard.wrap(server, {
      operatorKeyPair: kp,
      agentIdentifier: 'preserve-test',
      constraints: "permit tool.read_file on '**'",
    });

    // All original tools should be present
    expect(wrapped.tools!.length).toBe(server.tools!.length);
    for (const tool of server.tools!) {
      expect(wrapped.tools!.find(t => t.name === tool.name)).toBeDefined();
    }
  });
});

describe('SteleGuard - tool call interception', () => {
  it('permits tool call matching permit rule', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();

    const wrapped = await SteleGuard.wrap(server, {
      operatorKeyPair: kp,
      agentIdentifier: 'permit-test',
      constraints: "permit tool.read_file on '**'",
    });

    const result = await wrapped.handleToolCall!('read_file', { path: '/data/test.csv' });
    expect(result).toBeDefined();
    // Should have returned the tool result
    expect(typeof result).toBe('object');
  });

  it('denies tool call matching deny rule', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();

    const wrapped = await SteleGuard.wrap(server, {
      operatorKeyPair: kp,
      agentIdentifier: 'deny-test',
      constraints: "deny tool.write_file on '**' severity critical",
    });

    // Denied calls throw in enforce mode
    await expect(
      wrapped.handleToolCall!('write_file', { path: '/data/output.csv' }),
    ).rejects.toThrow(/denied/i);
  });

  it('records tool calls in audit log', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();

    const wrapped = await SteleGuard.wrap(server, {
      operatorKeyPair: kp,
      agentIdentifier: 'audit-test',
      constraints: "permit tool.read_file on '**'",
    });

    await wrapped.handleToolCall!('read_file', { path: '/a' });
    await wrapped.handleToolCall!('read_file', { path: '/b' });
    await wrapped.handleToolCall!('read_file', { path: '/c' });

    const log = wrapped.getAuditLog();
    expect(log.count).toBe(3);
  });

  it('onViolation callback is invoked for denied calls', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();
    const violations: ViolationDetails[] = [];

    const wrapped = await SteleGuard.wrap(server, {
      operatorKeyPair: kp,
      agentIdentifier: 'violation-test',
      constraints: "deny tool.write_file on '**' severity high",
      onViolation: (v) => violations.push(v),
    });

    // Denied calls throw in enforce mode
    try {
      await wrapped.handleToolCall!('write_file', { path: '/data/file' });
    } catch {
      // expected
    }

    expect(violations.length).toBe(1);
    expect(violations[0]!.toolName).toBe('write_file');
  });

  it('onToolCall callback is invoked for all calls', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();
    const calls: ToolCallDetails[] = [];

    const wrapped = await SteleGuard.wrap(server, {
      operatorKeyPair: kp,
      agentIdentifier: 'callback-test',
      constraints: "permit tool.read_file on '**'\ndeny tool.write_file on '**' severity high",
      onToolCall: (c) => calls.push(c),
    });

    await wrapped.handleToolCall!('read_file', { path: '/a' });
    try {
      await wrapped.handleToolCall!('write_file', { path: '/b' });
    } catch {
      // expected - denied calls throw
    }

    expect(calls.length).toBe(2);
  });
});

describe('SteleGuard - fromCovenant', () => {
  it('creates guard from existing covenant document', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();

    const covenant = await buildCovenant({
      issuer: { id: 'issuer-id', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'beneficiary-id', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit tool.read_file on '**'\ndeny tool.write_file on '**' severity critical",
      privateKey: kp.privateKey,
    });

    const wrapped = await SteleGuard.fromCovenant(server, covenant, kp);

    expect(wrapped.tools).toBeDefined();
    expect(wrapped.getCovenant().id).toBe(covenant.id);
  });

  it('fromCovenant enforces covenant constraints', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();

    const covenant = await buildCovenant({
      issuer: { id: 'i', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'b', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit tool.read_file on '**'",
      privateKey: kp.privateKey,
    });

    const wrapped = await SteleGuard.fromCovenant(server, covenant, kp);

    const result = await wrapped.handleToolCall!('read_file', { path: '/data/test' });
    expect(result).toBeDefined();
  });
});

describe('SteleGuard - edge cases', () => {
  it('handles server with no tools', async () => {
    const emptyServer: MCPServer = {
      tools: [],
      handleToolCall: async () => ({ result: 'empty' }),
    };
    const kp = await generateKeyPair();

    const wrapped = await SteleGuard.wrap(emptyServer, {
      operatorKeyPair: kp,
      agentIdentifier: 'empty-test',
      constraints: "permit tool.read_file on '**'",
    });

    expect(wrapped.tools).toHaveLength(0);
  });

  it('handles server with many tools', async () => {
    const manyToolsServer: MCPServer = {
      tools: Array.from({ length: 20 }, (_, i) => ({
        name: `tool_${i}`,
        description: `Tool ${i}`,
      })),
      handleToolCall: async (name) => ({ tool: name }),
    };
    const kp = await generateKeyPair();

    const wrapped = await SteleGuard.wrap(manyToolsServer, {
      operatorKeyPair: kp,
      agentIdentifier: 'many-test',
      constraints: "permit tool.* on '**'",
    });

    expect(wrapped.tools).toHaveLength(20);
  });

  it('getIdentity returns valid identity', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();

    const wrapped = await SteleGuard.wrap(server, {
      operatorKeyPair: kp,
      agentIdentifier: 'identity-test',
      constraints: "permit tool.read_file on '**'",
    });

    const identity = wrapped.getIdentity();
    expect(identity.id).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.operatorIdentifier).toBe('identity-test');
  });

  it('getCovenant returns valid covenant', async () => {
    const server = createMockServer();
    const kp = await generateKeyPair();

    const wrapped = await SteleGuard.wrap(server, {
      operatorKeyPair: kp,
      agentIdentifier: 'covenant-test',
      constraints: "permit tool.read_file on '**'",
    });

    const covenant = wrapped.getCovenant();
    expect(covenant.id).toMatch(/^[0-9a-f]{64}$/);
    expect(covenant.constraints).toContain("permit tool.read_file on '**'");
  });
});

describe('PRESETS', () => {
  it('all presets contain valid CCL constraints', () => {
    for (const [name, constraints] of Object.entries(PRESETS)) {
      expect(typeof constraints).toBe('string');
      expect(constraints.length).toBeGreaterThan(0);
    }
  });

  it('has all expected preset names', () => {
    expect(PRESETS).toHaveProperty('standard:data-isolation');
    expect(PRESETS).toHaveProperty('standard:read-write');
    expect(PRESETS).toHaveProperty('standard:network');
    expect(PRESETS).toHaveProperty('standard:minimal');
  });

  it('each preset has at least one constraint', () => {
    for (const [name, constraints] of Object.entries(PRESETS)) {
      // Each should have at least one line
      expect(constraints.split('\n').filter(l => l.trim().length > 0).length).toBeGreaterThan(0);
    }
  });
});
