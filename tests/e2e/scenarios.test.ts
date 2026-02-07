import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '@stele/crypto';
import type { KeyPair, HashHex } from '@stele/crypto';
import {
  buildCovenant,
  verifyCovenant,
  MemoryChainResolver,
  resolveChain,
  computeEffectiveConstraints,
  validateChainNarrowing,
} from '@stele/core';
import type { CovenantDocument } from '@stele/core';
import { evaluate, parse } from '@stele/ccl';
import { MonitorDeniedError } from '@stele/enforcement';
import { SteleGuard } from '@stele/mcp';
import type { MCPServer, WrappedMCPServer, ViolationDetails, ToolCallDetails } from '@stele/mcp';
import { createReceipt, computeReputationScore } from '@stele/reputation';
import type { ExecutionReceipt } from '@stele/reputation';
import { generateComplianceProof, verifyComplianceProof } from '@stele/proof';

// ---------------------------------------------------------------------------
// Scenario 1: Chain Delegation with Constraint Narrowing (3 levels)
// ---------------------------------------------------------------------------

describe('Scenario 1: Chain Delegation with Constraint Narrowing', () => {
  // Shared state across the scenario
  let rootKeyPair: KeyPair;
  let midKeyPair: KeyPair;
  let leafKeyPair: KeyPair;

  let rootCovenant: CovenantDocument;
  let midCovenant: CovenantDocument;
  let leafCovenant: CovenantDocument;

  // ── Constraint definitions ────────────────────────────────────────────

  const ROOT_CONSTRAINTS = [
    "permit file.read on '/data/**'",
    "permit file.write on '/data/**'",
    "permit network.send on '**'",
    "deny network.send on '**' when payload.contains_pii = true severity critical",
  ].join('\n');

  const MID_CONSTRAINTS = [
    "permit file.read on '/data/**'",
    "permit file.write on '/data/output/**'",
    "deny file.write on '/data/system/**' severity critical",
    "deny network.send on '**' severity high",
  ].join('\n');

  const LEAF_CONSTRAINTS = [
    "permit file.read on '/data/public/**'",
    "deny file.write on '**' severity critical",
    "deny network.send on '**' severity critical",
  ].join('\n');

  // ── Step 1: Generate key pairs ────────────────────────────────────────

  it('Step 1: generates three distinct key pairs (root, mid, leaf)', async () => {
    rootKeyPair = await generateKeyPair();
    midKeyPair = await generateKeyPair();
    leafKeyPair = await generateKeyPair();

    expect(rootKeyPair.publicKeyHex).toHaveLength(64);
    expect(midKeyPair.publicKeyHex).toHaveLength(64);
    expect(leafKeyPair.publicKeyHex).toHaveLength(64);

    // All three keys must be distinct
    const keys = new Set([
      rootKeyPair.publicKeyHex,
      midKeyPair.publicKeyHex,
      leafKeyPair.publicKeyHex,
    ]);
    expect(keys.size).toBe(3);
  });

  // ── Step 2: Build ROOT covenant ───────────────────────────────────────

  it('Step 2: builds and verifies the ROOT covenant with broad constraints', async () => {
    rootCovenant = await buildCovenant({
      issuer: {
        id: 'root-authority',
        publicKey: rootKeyPair.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'mid-agent',
        publicKey: midKeyPair.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: ROOT_CONSTRAINTS,
      privateKey: rootKeyPair.privateKey,
      enforcement: { type: 'monitor', config: { mode: 'enforce' } },
      proof: { type: 'audit_log', config: {} },
    });

    expect(rootCovenant.id).toHaveLength(64);
    expect(rootCovenant.constraints).toBe(ROOT_CONSTRAINTS);
    expect(rootCovenant.chain).toBeUndefined();

    // Verify the root covenant
    const verification = await verifyCovenant(rootCovenant);
    expect(verification.valid).toBe(true);
    for (const check of verification.checks) {
      expect(check.passed).toBe(true);
    }
  });

  // ── Step 3: Build MID covenant (child of root) ────────────────────────

  it('Step 3: builds and verifies the MID covenant that narrows root', async () => {
    midCovenant = await buildCovenant({
      issuer: {
        id: 'mid-agent',
        publicKey: midKeyPair.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'leaf-agent',
        publicKey: leafKeyPair.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: MID_CONSTRAINTS,
      privateKey: midKeyPair.privateKey,
      chain: {
        parentId: rootCovenant.id,
        relation: 'restricts',
        depth: 1,
      },
      enforcement: { type: 'monitor', config: { mode: 'enforce' } },
      proof: { type: 'audit_log', config: {} },
    });

    expect(midCovenant.id).toHaveLength(64);
    expect(midCovenant.chain).toBeDefined();
    expect(midCovenant.chain!.parentId).toBe(rootCovenant.id);
    expect(midCovenant.chain!.relation).toBe('restricts');
    expect(midCovenant.chain!.depth).toBe(1);

    // Verify the mid covenant
    const verification = await verifyCovenant(midCovenant);
    expect(verification.valid).toBe(true);
  });

  // ── Step 4: Build LEAF covenant (child of mid, grandchild of root) ────

  it('Step 4: builds and verifies the LEAF covenant that narrows further', async () => {
    leafCovenant = await buildCovenant({
      issuer: {
        id: 'leaf-agent',
        publicKey: leafKeyPair.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'end-user',
        publicKey: leafKeyPair.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: LEAF_CONSTRAINTS,
      privateKey: leafKeyPair.privateKey,
      chain: {
        parentId: midCovenant.id,
        relation: 'restricts',
        depth: 2,
      },
      enforcement: { type: 'monitor', config: { mode: 'enforce' } },
      proof: { type: 'audit_log', config: {} },
    });

    expect(leafCovenant.id).toHaveLength(64);
    expect(leafCovenant.chain).toBeDefined();
    expect(leafCovenant.chain!.parentId).toBe(midCovenant.id);
    expect(leafCovenant.chain!.relation).toBe('restricts');
    expect(leafCovenant.chain!.depth).toBe(2);

    // Verify the leaf covenant
    const verification = await verifyCovenant(leafCovenant);
    expect(verification.valid).toBe(true);
  });

  // ── Step 5: Chain resolution ──────────────────────────────────────────

  it('Step 5: resolves the full chain from leaf to root via MemoryChainResolver', async () => {
    const resolver = new MemoryChainResolver();
    resolver.add(rootCovenant);
    resolver.add(midCovenant);
    resolver.add(leafCovenant);

    // Resolve the chain starting from the leaf
    const ancestors = await resolveChain(leafCovenant, resolver);

    // Ancestors should be ordered: immediate parent first, root last
    expect(ancestors).toHaveLength(2);
    expect(ancestors[0]!.id).toBe(midCovenant.id);
    expect(ancestors[1]!.id).toBe(rootCovenant.id);
  });

  it('Step 5b: resolves the chain from mid (should only find root)', async () => {
    const resolver = new MemoryChainResolver();
    resolver.add(rootCovenant);
    resolver.add(midCovenant);

    const ancestors = await resolveChain(midCovenant, resolver);
    expect(ancestors).toHaveLength(1);
    expect(ancestors[0]!.id).toBe(rootCovenant.id);
  });

  it('Step 5c: resolves empty chain for root (no parent)', async () => {
    const resolver = new MemoryChainResolver();
    resolver.add(rootCovenant);

    const ancestors = await resolveChain(rootCovenant, resolver);
    expect(ancestors).toHaveLength(0);
  });

  // ── Step 6: Compute effective constraints ─────────────────────────────

  it('Step 6: computes effective constraints merging all three levels', async () => {
    const resolver = new MemoryChainResolver();
    resolver.add(rootCovenant);
    resolver.add(midCovenant);
    resolver.add(leafCovenant);

    const ancestors = await resolveChain(leafCovenant, resolver);
    const effective = await computeEffectiveConstraints(leafCovenant, ancestors);

    // The effective CCL document must contain statements
    expect(effective.statements.length).toBeGreaterThan(0);

    // The effective constraints include denials from all levels.
    // The deny rules from leaf, mid, and root should all be present.
    expect(effective.denies.length).toBeGreaterThan(0);

    // Evaluate: file.read on /data/public/readme.txt should be permitted
    // (leaf permits file.read on /data/public/**)
    const readPublic = evaluate(effective, 'file.read', '/data/public/readme.txt');
    expect(readPublic.permitted).toBe(true);

    // Evaluate: file.write on a path OUTSIDE /data/** should be denied
    // The leaf's deny file.write on '**' catches it, and no permit covers /tmp/**
    const writeOutside = evaluate(effective, 'file.write', '/tmp/scratch.txt');
    expect(writeOutside.permitted).toBe(false);

    // Evaluate: file.write on /data/output/** is STILL permitted because the
    // merged constraints include the mid-level's permit file.write on '/data/output/**'
    // which is more specific (higher specificity) than the leaf's deny file.write on '**'
    const writeOutput = evaluate(effective, 'file.write', '/data/output/result.txt');
    expect(writeOutput.permitted).toBe(true);

    // Evaluate: network.send should be denied
    // All three levels have deny rules for network.send at equal or higher
    // specificity than the root's permit, so deny wins
    const netSend = evaluate(effective, 'network.send', 'https://api.example.com');
    expect(netSend.permitted).toBe(false);
  });

  it('Step 6b: effective constraints for mid-level preserve root denials', async () => {
    const resolver = new MemoryChainResolver();
    resolver.add(rootCovenant);
    resolver.add(midCovenant);

    const ancestors = await resolveChain(midCovenant, resolver);
    const effective = await computeEffectiveConstraints(midCovenant, ancestors);

    // file.read on /data/** should be permitted (both root and mid allow it)
    const readData = evaluate(effective, 'file.read', '/data/reports/q1.csv');
    expect(readData.permitted).toBe(true);

    // file.write on /data/output/result.txt should be permitted (mid allows /data/output/**)
    const writeOutput = evaluate(effective, 'file.write', '/data/output/result.txt');
    expect(writeOutput.permitted).toBe(true);

    // file.write on /data/system/config.json should be denied (mid denies /data/system/**)
    const writeSystem = evaluate(effective, 'file.write', '/data/system/config.json');
    expect(writeSystem.permitted).toBe(false);

    // network.send should be denied (mid denies it with high severity)
    const netSend = evaluate(effective, 'network.send', 'https://example.com');
    expect(netSend.permitted).toBe(false);
  });

  // ── Step 7: Validate chain narrowing ──────────────────────────────────

  it('Step 7: validates that mid correctly narrows root (valid)', async () => {
    const result = await validateChainNarrowing(midCovenant, rootCovenant);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('Step 7b: validates that leaf correctly narrows mid (valid)', async () => {
    const result = await validateChainNarrowing(leafCovenant, midCovenant);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('Step 7c: validates that leaf correctly narrows root (transitive, valid)', async () => {
    const result = await validateChainNarrowing(leafCovenant, rootCovenant);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  // ── Step 8: Verify document IDs are unique and deterministic ──────────

  it('Step 8: all three covenants have distinct, 64-char hex IDs', () => {
    const ids = new Set([rootCovenant.id, midCovenant.id, leafCovenant.id]);
    expect(ids.size).toBe(3);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  // ── Step 9: Direct CCL evaluation against each level ──────────────────

  it('Step 9: root constraints permit broad access', () => {
    const doc = parse(ROOT_CONSTRAINTS);

    // file.read and file.write on /data/** are both permitted
    expect(evaluate(doc, 'file.read', '/data/any/path').permitted).toBe(true);
    expect(evaluate(doc, 'file.write', '/data/any/path').permitted).toBe(true);

    // network.send is permitted normally
    expect(evaluate(doc, 'network.send', 'https://api.example.com').permitted).toBe(true);

    // network.send with PII context is denied (condition uses dot-path resolution:
    // payload.contains_pii resolves to context.payload.contains_pii)
    const piiResult = evaluate(doc, 'network.send', 'https://api.example.com', {
      payload: { contains_pii: true },
    });
    expect(piiResult.permitted).toBe(false);
    expect(piiResult.severity).toBe('critical');
  });

  it('Step 9b: mid constraints are more restrictive than root', () => {
    const doc = parse(MID_CONSTRAINTS);

    // file.read on /data/** is still permitted
    expect(evaluate(doc, 'file.read', '/data/docs/readme.txt').permitted).toBe(true);

    // file.write on /data/output/** is permitted
    expect(evaluate(doc, 'file.write', '/data/output/results.json').permitted).toBe(true);

    // file.write on /data/system/** is denied (critical)
    const sysWrite = evaluate(doc, 'file.write', '/data/system/config.yaml');
    expect(sysWrite.permitted).toBe(false);
    expect(sysWrite.severity).toBe('critical');

    // network.send is blanket denied (high)
    const netSend = evaluate(doc, 'network.send', 'https://anywhere.com');
    expect(netSend.permitted).toBe(false);
    expect(netSend.severity).toBe('high');
  });

  it('Step 9c: leaf constraints are the most restrictive', () => {
    const doc = parse(LEAF_CONSTRAINTS);

    // file.read on /data/public/** is permitted
    expect(evaluate(doc, 'file.read', '/data/public/info.txt').permitted).toBe(true);

    // file.read on /data/private/** is NOT permitted (no matching permit)
    expect(evaluate(doc, 'file.read', '/data/private/secret.txt').permitted).toBe(false);

    // file.write on anything is denied (critical)
    const writeResult = evaluate(doc, 'file.write', '/data/output/x.txt');
    expect(writeResult.permitted).toBe(false);
    expect(writeResult.severity).toBe('critical');

    // network.send is denied (critical)
    const netResult = evaluate(doc, 'network.send', 'https://example.com');
    expect(netResult.permitted).toBe(false);
    expect(netResult.severity).toBe('critical');
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: MCP Server Wrap -> Execute Tools -> Receipt -> Reputation
// ---------------------------------------------------------------------------

describe('Scenario 2: MCP Server Wrap, Execute, Receipt, and Reputation', () => {
  // Shared state across the scenario
  let operatorKeyPair: KeyPair;
  let wrappedServer: WrappedMCPServer;
  const violations: ViolationDetails[] = [];
  const toolCalls: ToolCallDetails[] = [];

  // Constraints: permit readFile, permit writeFile on /output/**,
  // deny writeFile on /system/**, deny sendData
  const SERVER_CONSTRAINTS = [
    "permit tool.readFile on '**'",
    "permit tool.writeFile on '/output/**'",
    "deny tool.writeFile on '/system/**' severity critical",
    "deny tool.sendData on '**' severity high",
  ].join('\n');

  /**
   * Create a mock MCP server with three tools.
   */
  function createMockMCPServer(): MCPServer {
    return {
      tools: [
        { name: 'readFile', description: 'Read a file from disk' },
        { name: 'writeFile', description: 'Write a file to disk' },
        { name: 'sendData', description: 'Send data over the network' },
      ],
      handleToolCall: async (name: string, args: Record<string, unknown>) => {
        switch (name) {
          case 'readFile':
            return { content: `Contents of ${args.path ?? 'unknown'}`, size: 1024 };
          case 'writeFile':
            return { written: true, path: args.path ?? 'unknown' };
          case 'sendData':
            return { sent: true, url: args.url ?? 'unknown' };
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      },
    };
  }

  // ── Step 1: Wrap the MCP server with SteleGuard ───────────────────────

  it('Step 1: wraps the MCP server with SteleGuard and constraints', async () => {
    operatorKeyPair = await generateKeyPair();

    wrappedServer = await SteleGuard.wrap(createMockMCPServer(), {
      constraints: SERVER_CONSTRAINTS,
      mode: 'enforce',
      operatorKeyPair,
      agentIdentifier: 'test-agent-e2e',
      model: {
        provider: 'test-provider',
        modelId: 'test-model-v1',
        attestationType: 'self_reported',
      },
      onViolation: (d) => violations.push(d),
      onToolCall: (d) => toolCalls.push(d),
    });

    // Verify the wrapped server has all expected properties
    expect(wrappedServer).toBeDefined();
    expect(typeof wrappedServer.handleToolCall).toBe('function');
    expect(typeof wrappedServer.getMonitor).toBe('function');
    expect(typeof wrappedServer.getIdentity).toBe('function');
    expect(typeof wrappedServer.getAuditLog).toBe('function');
    expect(typeof wrappedServer.generateProof).toBe('function');
    expect(typeof wrappedServer.getReceipt).toBe('function');
    expect(typeof wrappedServer.getCovenant).toBe('function');

    // Tools should be preserved
    expect(wrappedServer.tools).toHaveLength(3);

    // Covenant should be valid
    const covenant = wrappedServer.getCovenant();
    expect(covenant.id).toHaveLength(64);
    expect(covenant.issuer.id).toBe('test-agent-e2e');
    expect(covenant.enforcement).toBeDefined();
    expect(covenant.enforcement!.type).toBe('monitor');
    expect(covenant.enforcement!.config).toEqual({ mode: 'enforce' });

    // Identity should have correct model
    const identity = wrappedServer.getIdentity();
    expect(identity.model.provider).toBe('test-provider');
    expect(identity.model.modelId).toBe('test-model-v1');
    expect(identity.operatorPublicKey).toBe(operatorKeyPair.publicKeyHex);

    // Receipt should be null before any calls
    expect(wrappedServer.getReceipt()).toBeNull();
  });

  // ── Step 2: Execute permitted tool calls ──────────────────────────────

  it('Step 2a: readFile is permitted and returns correct data', async () => {
    const result = await wrappedServer.handleToolCall!('readFile', {
      path: '/data/reports/summary.txt',
    });

    expect(result).toEqual({
      content: 'Contents of /data/reports/summary.txt',
      size: 1024,
    });
  });

  it('Step 2b: another readFile call succeeds', async () => {
    const result = await wrappedServer.handleToolCall!('readFile', {
      path: '/data/logs/access.log',
    });

    expect(result).toEqual({
      content: 'Contents of /data/logs/access.log',
      size: 1024,
    });
  });

  it('Step 2c: writeFile to permitted path succeeds', async () => {
    const result = await wrappedServer.handleToolCall!('writeFile', {
      path: '/output/results.json',
    });

    expect(result).toEqual({
      written: true,
      path: '/output/results.json',
    });
  });

  // ── Step 3: Execute denied tool calls ─────────────────────────────────

  it('Step 3a: writeFile to /system/** is denied (critical)', async () => {
    try {
      await wrappedServer.handleToolCall!('writeFile', {
        path: '/system/config.yaml',
      });
      // If we get here, the call was not denied -- fail the test
      expect.unreachable('Expected handleToolCall to throw for denied action');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(MonitorDeniedError);
      const denied = err as MonitorDeniedError;
      expect(denied.action).toBe('tool.writeFile');
      expect(denied.resource).toBe('/system/config.yaml');
    }
  });

  it('Step 3b: sendData is denied (high severity)', async () => {
    await expect(
      wrappedServer.handleToolCall!('sendData', {
        url: 'https://exfiltrate.example.com/data',
      }),
    ).rejects.toThrow(/denied/i);
  });

  it('Step 3c: another sendData denial', async () => {
    await expect(
      wrappedServer.handleToolCall!('sendData', {
        url: 'https://malicious.example.com/upload',
      }),
    ).rejects.toThrow(/denied/i);
  });

  // ── Step 4: Execute one more permitted call after denials ─────────────

  it('Step 4: readFile still works after denials', async () => {
    const result = await wrappedServer.handleToolCall!('readFile', {
      path: '/data/config/settings.json',
    });

    expect(result).toEqual({
      content: 'Contents of /data/config/settings.json',
      size: 1024,
    });
  });

  // ── Step 5: Verify callback tracking ──────────────────────────────────

  it('Step 5a: onToolCall was fired for every call (permitted and denied)', () => {
    // 4 permitted + 3 denied = 7 total
    expect(toolCalls).toHaveLength(7);

    // Check that permitted calls are marked correctly
    const permitted = toolCalls.filter((c) => c.permitted);
    expect(permitted).toHaveLength(4);
    expect(permitted.every((c) => c.toolName === 'readFile' || c.toolName === 'writeFile')).toBe(true);

    // Check that denied calls are marked correctly
    const denied = toolCalls.filter((c) => !c.permitted);
    expect(denied).toHaveLength(3);
  });

  it('Step 5b: onViolation was fired only for denied calls', () => {
    expect(violations).toHaveLength(3);
    expect(violations[0]!.toolName).toBe('writeFile');
    expect(violations[1]!.toolName).toBe('sendData');
    expect(violations[2]!.toolName).toBe('sendData');

    // Each violation should have severity
    for (const v of violations) {
      expect(['critical', 'high', 'medium', 'low']).toContain(v.severity);
    }
  });

  // ── Step 6: Verify audit log integrity ────────────────────────────────

  it('Step 6: audit log has correct count and passes integrity check', () => {
    const log = wrappedServer.getAuditLog();

    // Should have 7 entries (4 permitted + 3 denied)
    expect(log.entries).toHaveLength(7);
    expect(log.count).toBe(7);

    // Covenant ID must match
    const covenant = wrappedServer.getCovenant();
    expect(log.covenantId).toBe(covenant.id);

    // Verify hash chain integrity
    const firstEntry = log.entries[0]!;
    expect(firstEntry.previousHash).toBe(
      '0000000000000000000000000000000000000000000000000000000000000000',
    );

    for (let i = 1; i < log.entries.length; i++) {
      expect(log.entries[i]!.previousHash).toBe(log.entries[i - 1]!.hash);
    }

    // All hashes should be unique
    const hashes = new Set(log.entries.map((e) => e.hash));
    expect(hashes.size).toBe(7);

    // Merkle root should be a 64-char hex string
    expect(log.merkleRoot).toMatch(/^[0-9a-f]{64}$/);

    // Verify audit log integrity through the monitor
    const monitor = wrappedServer.getMonitor();
    expect(monitor.verifyAuditLogIntegrity()).toBe(true);
  });

  it('Step 6b: audit entries have correct outcome values', () => {
    const log = wrappedServer.getAuditLog();

    // Entries 0-2 are permitted (readFile, readFile, writeFile)
    expect(log.entries[0]!.outcome).toBe('EXECUTED');
    expect(log.entries[1]!.outcome).toBe('EXECUTED');
    expect(log.entries[2]!.outcome).toBe('EXECUTED');

    // Entries 3-5 are denied (writeFile, sendData, sendData)
    expect(log.entries[3]!.outcome).toBe('DENIED');
    expect(log.entries[4]!.outcome).toBe('DENIED');
    expect(log.entries[5]!.outcome).toBe('DENIED');

    // Entry 6 is the final permitted readFile
    expect(log.entries[6]!.outcome).toBe('EXECUTED');
  });

  // ── Step 7: Generate and verify compliance proof ──────────────────────

  it('Step 7: generates a valid compliance proof and verifies it', async () => {
    const proof = await wrappedServer.generateProof();

    // Structural checks
    expect(proof).toBeDefined();
    expect(proof.version).toBe('1.0');
    expect(proof.proofSystem).toBe('poseidon_hash');
    expect(proof.covenantId).toBe(wrappedServer.getCovenant().id);
    expect(proof.entryCount).toBe(7);
    expect(typeof proof.proof).toBe('string');
    expect(proof.proof.length).toBeGreaterThan(0);
    expect(typeof proof.auditLogCommitment).toBe('string');
    expect(typeof proof.constraintCommitment).toBe('string');
    expect(proof.publicInputs).toHaveLength(4);
    expect(proof.publicInputs[0]).toBe(proof.covenantId);
    expect(proof.publicInputs[1]).toBe(proof.auditLogCommitment);
    expect(proof.publicInputs[2]).toBe(proof.constraintCommitment);
    expect(proof.publicInputs[3]).toBe(String(proof.entryCount));

    // Verify the proof
    const verificationResult = await verifyComplianceProof(proof);
    expect(verificationResult.valid).toBe(true);
    expect(verificationResult.errors).toHaveLength(0);
    expect(verificationResult.covenantId).toBe(proof.covenantId);
    expect(verificationResult.entryCount).toBe(7);
  });

  // ── Step 8: Get execution receipt ─────────────────────────────────────

  it('Step 8: the latest receipt reflects breached outcome due to denials', () => {
    const receipt = wrappedServer.getReceipt();

    expect(receipt).not.toBeNull();
    expect(receipt!.covenantId).toBe(wrappedServer.getCovenant().id);
    expect(receipt!.outcome).toBe('breached');
    expect(receipt!.breachSeverity).toBeDefined();
    expect(typeof receipt!.receiptHash).toBe('string');
    expect(receipt!.receiptHash).toHaveLength(64);
    expect(typeof receipt!.agentSignature).toBe('string');
    expect(receipt!.agentSignature.length).toBeGreaterThan(0);
    expect(typeof receipt!.durationMs).toBe('number');
    expect(receipt!.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof receipt!.completedAt).toBe('string');
    expect(typeof receipt!.proofHash).toBe('string');
    expect(receipt!.principalPublicKey).toBe(operatorKeyPair.publicKeyHex);
  });

  // ── Step 9: Create multiple receipts and compute reputation score ─────

  it('Step 9: creates multiple receipts and computes a reputation score', async () => {
    const agentKeyPair = await generateKeyPair();
    const agentIdentityHash = agentKeyPair.publicKeyHex as HashHex;
    const principalPublicKey = operatorKeyPair.publicKeyHex;
    const covenantId = wrappedServer.getCovenant().id;
    const dummyProofHash = '0000000000000000000000000000000000000000000000000000000000000001' as HashHex;

    const receipts: ExecutionReceipt[] = [];

    // Receipt 1: fulfilled (no previous)
    const r1 = await createReceipt(
      covenantId,
      agentIdentityHash,
      principalPublicKey,
      'fulfilled',
      dummyProofHash,
      100,
      agentKeyPair,
      null,
    );
    expect(r1.outcome).toBe('fulfilled');
    expect(r1.previousReceiptHash).toBeNull();
    receipts.push(r1);

    // Receipt 2: fulfilled (chained to r1)
    const r2 = await createReceipt(
      covenantId,
      agentIdentityHash,
      principalPublicKey,
      'fulfilled',
      dummyProofHash,
      150,
      agentKeyPair,
      r1.receiptHash,
    );
    expect(r2.previousReceiptHash).toBe(r1.receiptHash);
    receipts.push(r2);

    // Receipt 3: fulfilled (chained to r2)
    const r3 = await createReceipt(
      covenantId,
      agentIdentityHash,
      principalPublicKey,
      'fulfilled',
      dummyProofHash,
      200,
      agentKeyPair,
      r2.receiptHash,
    );
    receipts.push(r3);

    // Receipt 4: breached with high severity (chained to r3)
    const r4 = await createReceipt(
      covenantId,
      agentIdentityHash,
      principalPublicKey,
      'breached',
      dummyProofHash,
      50,
      agentKeyPair,
      r3.receiptHash,
      'high',
    );
    expect(r4.outcome).toBe('breached');
    expect(r4.breachSeverity).toBe('high');
    receipts.push(r4);

    // Receipt 5: fulfilled (chained to r4)
    const r5 = await createReceipt(
      covenantId,
      agentIdentityHash,
      principalPublicKey,
      'fulfilled',
      dummyProofHash,
      120,
      agentKeyPair,
      r4.receiptHash,
    );
    receipts.push(r5);

    // Verify all receipts have unique hashes
    const receiptHashes = new Set(receipts.map((r) => r.receiptHash));
    expect(receiptHashes.size).toBe(5);

    // Verify chain linkage
    expect(receipts[0]!.previousReceiptHash).toBeNull();
    for (let i = 1; i < receipts.length; i++) {
      expect(receipts[i]!.previousReceiptHash).toBe(receipts[i - 1]!.receiptHash);
    }

    // Compute reputation score
    const score = computeReputationScore(agentIdentityHash, receipts);

    expect(score).toBeDefined();
    expect(score.agentIdentityHash).toBe(agentIdentityHash);
    expect(score.totalExecutions).toBe(5);
    expect(score.fulfilled).toBe(4);
    expect(score.breached).toBe(1);
    expect(score.partial).toBe(0);
    expect(score.failed).toBe(0);

    // Success rate: (4 fulfilled + 0 partial) / 5 total = 0.8
    expect(score.successRate).toBeCloseTo(0.8, 5);

    // Weighted score should be between 0 and 1 (penalized for breach and below minimum)
    expect(score.weightedScore).toBeGreaterThan(0);
    expect(score.weightedScore).toBeLessThanOrEqual(1);

    // Since totalExecutions (5) < minimumExecutions (default 10),
    // the score is scaled down by 5/10 = 0.5
    // The raw weighted score (before scaling) would be high but reduced
    expect(score.weightedScore).toBeLessThan(1);

    // Merkle root should be computed
    expect(typeof score.receiptsMerkleRoot).toBe('string');
    expect(score.receiptsMerkleRoot.length).toBe(64);

    // lastUpdatedAt should be a valid ISO 8601 timestamp
    expect(typeof score.lastUpdatedAt).toBe('string');
    expect(new Date(score.lastUpdatedAt).getTime()).not.toBeNaN();
  });

  it('Step 9b: computes a higher score for a clean execution history', async () => {
    const agentKeyPair = await generateKeyPair();
    const agentIdentityHash = agentKeyPair.publicKeyHex as HashHex;
    const principalPublicKey = operatorKeyPair.publicKeyHex;
    const covenantId = wrappedServer.getCovenant().id;
    const dummyProofHash = '0000000000000000000000000000000000000000000000000000000000000002' as HashHex;

    const cleanReceipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;

    // Create 12 fulfilled receipts (above minimumExecutions threshold)
    for (let i = 0; i < 12; i++) {
      const receipt = await createReceipt(
        covenantId,
        agentIdentityHash,
        principalPublicKey,
        'fulfilled',
        dummyProofHash,
        100 + i * 10,
        agentKeyPair,
        prevHash,
      );
      cleanReceipts.push(receipt);
      prevHash = receipt.receiptHash;
    }

    const cleanScore = computeReputationScore(agentIdentityHash, cleanReceipts);

    expect(cleanScore.totalExecutions).toBe(12);
    expect(cleanScore.fulfilled).toBe(12);
    expect(cleanScore.breached).toBe(0);
    expect(cleanScore.successRate).toBe(1.0);

    // With all fulfilled and above minimum, the score should be close to 1.0
    expect(cleanScore.weightedScore).toBeGreaterThan(0.9);

    // Now compare with a history that has breaches
    const mixedReceipts: ExecutionReceipt[] = [];
    prevHash = null;

    for (let i = 0; i < 12; i++) {
      const outcome = i % 4 === 3 ? 'breached' as const : 'fulfilled' as const;
      const receipt = await createReceipt(
        covenantId,
        agentIdentityHash,
        principalPublicKey,
        outcome,
        dummyProofHash,
        100,
        agentKeyPair,
        prevHash,
        outcome === 'breached' ? 'medium' : undefined,
      );
      mixedReceipts.push(receipt);
      prevHash = receipt.receiptHash;
    }

    const mixedScore = computeReputationScore(agentIdentityHash, mixedReceipts);

    expect(mixedScore.totalExecutions).toBe(12);
    expect(mixedScore.breached).toBe(3);
    expect(mixedScore.fulfilled).toBe(9);

    // The mixed score should be lower than the clean score
    expect(mixedScore.weightedScore).toBeLessThan(cleanScore.weightedScore);
  });

  // ── Step 10: Generate proof from standalone audit entries ──────────────

  it('Step 10: generates and verifies a standalone compliance proof', async () => {
    const auditLog = wrappedServer.getAuditLog();
    const covenant = wrappedServer.getCovenant();

    // Build audit entry data from the audit log
    const auditEntries = auditLog.entries.map((entry) => ({
      action: entry.action,
      resource: entry.resource,
      outcome: entry.outcome,
      timestamp: entry.timestamp,
      hash: entry.hash,
    }));

    // Generate proof directly
    const proof = await generateComplianceProof({
      covenantId: covenant.id,
      constraints: covenant.constraints,
      auditEntries,
    });

    expect(proof.covenantId).toBe(covenant.id);
    expect(proof.entryCount).toBe(auditLog.entries.length);
    expect(proof.proofSystem).toBe('poseidon_hash');

    // Verify it
    const verificationResult = await verifyComplianceProof(proof);
    expect(verificationResult.valid).toBe(true);
    expect(verificationResult.errors).toHaveLength(0);
  });

  // ── Step 11: Verify covenant integrity ────────────────────────────────

  it('Step 11: wrapped covenant passes full verification', async () => {
    const covenant = wrappedServer.getCovenant();
    const result = await verifyCovenant(covenant);

    expect(result.valid).toBe(true);
    expect(result.checks.length).toBeGreaterThanOrEqual(11);

    // Verify each specific check passed
    const checkNames = result.checks.map((c) => c.name);
    expect(checkNames).toContain('id_match');
    expect(checkNames).toContain('signature_valid');
    expect(checkNames).toContain('not_expired');
    expect(checkNames).toContain('active');
    expect(checkNames).toContain('ccl_parses');
    expect(checkNames).toContain('enforcement_valid');
    expect(checkNames).toContain('proof_valid');
    expect(checkNames).toContain('chain_depth');
    expect(checkNames).toContain('document_size');
    expect(checkNames).toContain('countersignatures');
    expect(checkNames).toContain('nonce_present');

    for (const check of result.checks) {
      expect(check.passed).toBe(true);
    }
  });

  // ── Step 12: Identity consistency ─────────────────────────────────────

  it('Step 12: identity contains correct capabilities and lineage', () => {
    const identity = wrappedServer.getIdentity();

    // Capabilities should match the tools
    expect(identity.capabilities).toContain('tool.readFile');
    expect(identity.capabilities).toContain('tool.writeFile');
    expect(identity.capabilities).toContain('tool.sendData');
    expect(identity.capabilities).toHaveLength(3);

    // Lineage should have a single 'created' entry
    expect(identity.lineage).toHaveLength(1);
    expect(identity.lineage[0]!.changeType).toBe('created');
    expect(identity.lineage[0]!.parentHash).toBeNull();

    // Deployment info
    expect(identity.deployment.runtime).toBe('process');

    // Version
    expect(identity.version).toBe(1);

    // Identity hash should be 64 hex chars
    expect(identity.id).toMatch(/^[0-9a-f]{64}$/);
  });
});
