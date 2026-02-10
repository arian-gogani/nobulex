import { describe, it, expect, beforeEach } from 'vitest';
import { SteleServer, JSON_RPC_ERRORS } from './index';
import type {
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  ToolDefinition,
  ToolResult,
} from './index';
import { MemoryStore } from '@stele/store';
import { generateKeyPair, toHex } from '@stele/crypto';
import type { KeyPair } from '@stele/crypto';
import { buildCovenant } from '@stele/core';
import type { CovenantDocument, Issuer, Beneficiary } from '@stele/core';

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Create a valid JSON-RPC request. */
function rpc(method: string, params?: Record<string, unknown>, id: string | number = 1): JsonRpcRequest {
  return { jsonrpc: '2.0', method, params, id };
}

/** Helper to check if response is a success response. */
function isSuccess(r: JsonRpcSuccessResponse | JsonRpcErrorResponse): r is JsonRpcSuccessResponse {
  return 'result' in r;
}

/** Helper to check if response is an error response. */
function isError(r: JsonRpcSuccessResponse | JsonRpcErrorResponse): r is JsonRpcErrorResponse {
  return 'error' in r;
}

/** Parse ToolResult text content as JSON. */
function parseToolResult(result: ToolResult): unknown {
  return JSON.parse(result.content[0]!.text);
}

/** Counter for unique party IDs across test invocations. */
let partyCounter = 0;

/** Create a standard issuer/beneficiary pair and key pair for testing. */
async function createTestParties(): Promise<{
  issuerKp: KeyPair;
  beneficiaryKp: KeyPair;
  issuer: Issuer;
  beneficiary: Beneficiary;
}> {
  partyCounter++;
  const issuerKp = await generateKeyPair();
  const beneficiaryKp = await generateKeyPair();
  return {
    issuerKp,
    beneficiaryKp,
    issuer: {
      id: `issuer-${partyCounter}`,
      publicKey: issuerKp.publicKeyHex,
      role: 'issuer' as const,
      name: 'Test Issuer',
    },
    beneficiary: {
      id: `beneficiary-${partyCounter}`,
      publicKey: beneficiaryKp.publicKeyHex,
      role: 'beneficiary' as const,
      name: 'Test Beneficiary',
    },
  };
}

/** Create a covenant and put it in the store. */
async function createAndStoreCovenant(
  store: MemoryStore,
  constraints: string = "permit read on '**'",
): Promise<{ doc: CovenantDocument; issuerKp: KeyPair; beneficiaryKp: KeyPair }> {
  const { issuerKp, beneficiaryKp, issuer, beneficiary } = await createTestParties();
  const doc = await buildCovenant({
    issuer,
    beneficiary,
    constraints,
    privateKey: issuerKp.privateKey,
  });
  await store.put(doc);
  return { doc, issuerKp, beneficiaryKp };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('SteleServer', () => {
  let store: MemoryStore;
  let server: SteleServer;

  beforeEach(() => {
    store = new MemoryStore();
    server = new SteleServer(store);
  });

  // ── Server initialization ───────────────────────────────────────────────

  describe('initialization', () => {
    it('should create a server with default options', () => {
      expect(server).toBeInstanceOf(SteleServer);
      expect(server.name).toBe('stele-mcp-server');
      expect(server.version).toBe('0.1.0');
    });

    it('should create a server with custom name and version', () => {
      const custom = new SteleServer(store, { name: 'my-server', version: '2.0.0' });
      expect(custom.name).toBe('my-server');
      expect(custom.version).toBe('2.0.0');
    });

    it('should accept a MemoryStore instance', () => {
      expect(server.store).toBe(store);
    });

    it('should handle initialize JSON-RPC message', async () => {
      const resp = await server.handleMessage(rpc('initialize'));
      expect(isSuccess(resp)).toBe(true);
      const result = (resp as JsonRpcSuccessResponse).result as Record<string, unknown>;
      expect(result.protocolVersion).toBe('2024-11-05');
      expect(result.capabilities).toBeDefined();
      expect(result.serverInfo).toEqual({
        name: 'stele-mcp-server',
        version: '0.1.0',
      });
    });

    it('should respond to ping', async () => {
      const resp = await server.handleMessage(rpc('ping'));
      expect(isSuccess(resp)).toBe(true);
      expect((resp as JsonRpcSuccessResponse).result).toEqual({});
    });
  });

  // ── listTools ───────────────────────────────────────────────────────────

  describe('listTools', () => {
    it('should return 6 tool definitions', () => {
      const tools = server.listTools();
      expect(tools).toHaveLength(6);
    });

    it('should include create_covenant tool', () => {
      const tools = server.listTools();
      const tool = tools.find((t) => t.name === 'create_covenant');
      expect(tool).toBeDefined();
      expect(tool!.description).toContain('covenant');
    });

    it('should include verify_covenant tool', () => {
      const tools = server.listTools();
      const tool = tools.find((t) => t.name === 'verify_covenant');
      expect(tool).toBeDefined();
    });

    it('should include evaluate_action tool', () => {
      const tools = server.listTools();
      const tool = tools.find((t) => t.name === 'evaluate_action');
      expect(tool).toBeDefined();
    });

    it('should include create_identity tool', () => {
      const tools = server.listTools();
      const tool = tools.find((t) => t.name === 'create_identity');
      expect(tool).toBeDefined();
    });

    it('should include parse_ccl tool', () => {
      const tools = server.listTools();
      const tool = tools.find((t) => t.name === 'parse_ccl');
      expect(tool).toBeDefined();
    });

    it('should include list_covenants tool', () => {
      const tools = server.listTools();
      const tool = tools.find((t) => t.name === 'list_covenants');
      expect(tool).toBeDefined();
    });

    it('should have valid input schemas with type "object" for all tools', () => {
      const tools = server.listTools();
      for (const tool of tools) {
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });

    it('should have required fields in create_covenant schema', () => {
      const tools = server.listTools();
      const tool = tools.find((t) => t.name === 'create_covenant')!;
      expect(tool.inputSchema.required).toContain('issuer');
      expect(tool.inputSchema.required).toContain('beneficiary');
      expect(tool.inputSchema.required).toContain('constraints');
      expect(tool.inputSchema.required).toContain('privateKeyHex');
    });

    it('should have required fields in evaluate_action schema', () => {
      const tools = server.listTools();
      const tool = tools.find((t) => t.name === 'evaluate_action')!;
      expect(tool.inputSchema.required).toContain('covenantId');
      expect(tool.inputSchema.required).toContain('action');
      expect(tool.inputSchema.required).toContain('resource');
    });

    it('should return tools via JSON-RPC tools/list', async () => {
      const resp = await server.handleMessage(rpc('tools/list'));
      expect(isSuccess(resp)).toBe(true);
      const result = (resp as JsonRpcSuccessResponse).result as { tools: ToolDefinition[] };
      expect(result.tools).toHaveLength(6);
    });

    it('should return a fresh copy of tool definitions', () => {
      const tools1 = server.listTools();
      const tools2 = server.listTools();
      expect(tools1).not.toBe(tools2);
      expect(tools1).toEqual(tools2);
    });
  });

  // ── create_covenant tool ────────────────────────────────────────────────

  describe('create_covenant', () => {
    it('should create a covenant with valid inputs', async () => {
      const { issuerKp, beneficiaryKp, issuer, beneficiary } = await createTestParties();

      const result = await server.callTool('create_covenant', {
        issuer,
        beneficiary,
        constraints: "permit read on '**'",
        privateKeyHex: toHex(issuerKp.privateKey),
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.id).toBeDefined();
      expect(typeof data.id).toBe('string');
      expect(data.version).toBe('1.0');
      expect(data.constraints).toBe("permit read on '**'");
    });

    it('should store the created covenant', async () => {
      const { issuerKp, beneficiaryKp, issuer, beneficiary } = await createTestParties();

      const result = await server.callTool('create_covenant', {
        issuer,
        beneficiary,
        constraints: "permit read on '**'",
        privateKeyHex: toHex(issuerKp.privateKey),
      });

      const data = parseToolResult(result) as Record<string, unknown>;
      const doc = await store.get(data.id as string);
      expect(doc).toBeDefined();
      expect(doc!.id).toBe(data.id);
    });

    it('should error when issuer is missing', async () => {
      const result = await server.callTool('create_covenant', {
        beneficiary: { id: 'b', publicKey: 'abc', role: 'beneficiary' },
        constraints: "permit read on '**'",
        privateKeyHex: 'deadbeef',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('issuer');
    });

    it('should error when beneficiary is missing', async () => {
      const result = await server.callTool('create_covenant', {
        issuer: { id: 'i', publicKey: 'abc', role: 'issuer' },
        constraints: "permit read on '**'",
        privateKeyHex: 'deadbeef',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('beneficiary');
    });

    it('should error when constraints is missing', async () => {
      const result = await server.callTool('create_covenant', {
        issuer: { id: 'i', publicKey: 'abc', role: 'issuer' },
        beneficiary: { id: 'b', publicKey: 'abc', role: 'beneficiary' },
        privateKeyHex: 'deadbeef',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('constraints');
    });

    it('should error when privateKeyHex is missing', async () => {
      const result = await server.callTool('create_covenant', {
        issuer: { id: 'i', publicKey: 'abc', role: 'issuer' },
        beneficiary: { id: 'b', publicKey: 'abc', role: 'beneficiary' },
        constraints: "permit read on '**'",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('privateKeyHex');
    });

    it('should error with invalid CCL constraints', async () => {
      const { issuerKp, issuer, beneficiary } = await createTestParties();

      const result = await server.callTool('create_covenant', {
        issuer,
        beneficiary,
        constraints: '%%%invalid ccl syntax!!!',
        privateKeyHex: toHex(issuerKp.privateKey),
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Failed to create covenant');
    });

    it('should create covenant via JSON-RPC tools/call', async () => {
      const { issuerKp, issuer, beneficiary } = await createTestParties();

      const resp = await server.handleMessage(rpc('tools/call', {
        name: 'create_covenant',
        arguments: {
          issuer,
          beneficiary,
          constraints: "permit read on '**'",
          privateKeyHex: toHex(issuerKp.privateKey),
        },
      }));

      expect(isSuccess(resp)).toBe(true);
      const result = (resp as JsonRpcSuccessResponse).result as ToolResult;
      expect(result.isError).toBeUndefined();
    });
  });

  // ── verify_covenant tool ────────────────────────────────────────────────

  describe('verify_covenant', () => {
    it('should verify a valid covenant', async () => {
      const { doc } = await createAndStoreCovenant(store);

      const result = await server.callTool('verify_covenant', {
        covenantId: doc.id,
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.valid).toBe(true);
      expect(data.checks).toBeDefined();
      expect(Array.isArray(data.checks)).toBe(true);
    });

    it('should report invalid for tampered covenant', async () => {
      const { doc } = await createAndStoreCovenant(store);

      // Tamper with the document
      const tampered = { ...doc, constraints: "deny write on '**'" };
      await store.put(tampered);

      const result = await server.callTool('verify_covenant', {
        covenantId: tampered.id,
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.valid).toBe(false);
    });

    it('should error when covenantId is missing', async () => {
      const result = await server.callTool('verify_covenant', {});

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('covenantId');
    });

    it('should error when covenant is not found', async () => {
      const result = await server.callTool('verify_covenant', {
        covenantId: 'nonexistent-id',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('not found');
    });

    it('should verify covenant via JSON-RPC tools/call', async () => {
      const { doc } = await createAndStoreCovenant(store);

      const resp = await server.handleMessage(rpc('tools/call', {
        name: 'verify_covenant',
        arguments: { covenantId: doc.id },
      }));

      expect(isSuccess(resp)).toBe(true);
      const result = (resp as JsonRpcSuccessResponse).result as ToolResult;
      const data = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
      expect(data.valid).toBe(true);
    });
  });

  // ── evaluate_action tool ────────────────────────────────────────────────

  describe('evaluate_action', () => {
    it('should permit an action that matches a permit rule', async () => {
      const { doc } = await createAndStoreCovenant(store, "permit read on '**'");

      const result = await server.callTool('evaluate_action', {
        covenantId: doc.id,
        action: 'read',
        resource: '/data',
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.permitted).toBe(true);
    });

    it('should deny an action that matches a deny rule', async () => {
      const { doc } = await createAndStoreCovenant(store, "deny write on '**'");

      const result = await server.callTool('evaluate_action', {
        covenantId: doc.id,
        action: 'write',
        resource: '/data',
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.permitted).toBe(false);
    });

    it('should deny when no rules match (default deny)', async () => {
      const { doc } = await createAndStoreCovenant(store, "permit read on '/specific'");

      const result = await server.callTool('evaluate_action', {
        covenantId: doc.id,
        action: 'write',
        resource: '/other',
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.permitted).toBe(false);
    });

    it('should handle deny-wins semantics', async () => {
      const { doc } = await createAndStoreCovenant(
        store,
        "permit read on '**'\ndeny read on '/secret'",
      );

      const result = await server.callTool('evaluate_action', {
        covenantId: doc.id,
        action: 'read',
        resource: '/secret',
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.permitted).toBe(false);
    });

    it('should error when covenantId is missing', async () => {
      const result = await server.callTool('evaluate_action', {
        action: 'read',
        resource: '/data',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('covenantId');
    });

    it('should error when action is missing', async () => {
      const result = await server.callTool('evaluate_action', {
        covenantId: 'some-id',
        resource: '/data',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('action');
    });

    it('should error when resource is missing', async () => {
      const result = await server.callTool('evaluate_action', {
        covenantId: 'some-id',
        action: 'read',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('resource');
    });

    it('should error when covenant is not found', async () => {
      const result = await server.callTool('evaluate_action', {
        covenantId: 'nonexistent',
        action: 'read',
        resource: '/data',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('not found');
    });

    it('should include matchedRule in result', async () => {
      const { doc } = await createAndStoreCovenant(store, "permit read on '**'");

      const result = await server.callTool('evaluate_action', {
        covenantId: doc.id,
        action: 'read',
        resource: '/data',
      });

      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.matchedRule).toBeDefined();
    });
  });

  // ── create_identity tool ────────────────────────────────────────────────

  describe('create_identity', () => {
    it('should create an identity with valid inputs', async () => {
      const result = await server.callTool('create_identity', {
        model: { provider: 'anthropic', modelId: 'claude-3' },
        capabilities: ['read', 'write'],
        deployment: { runtime: 'process' },
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.id).toBeDefined();
      expect(data.operatorPublicKey).toBeDefined();
      expect(data.model).toEqual({ provider: 'anthropic', modelId: 'claude-3' });
      expect(data.version).toBe(1);
    });

    it('should create an identity with a provided private key', async () => {
      const kp = await generateKeyPair();

      const result = await server.callTool('create_identity', {
        model: { provider: 'openai', modelId: 'gpt-4' },
        capabilities: ['code'],
        deployment: { runtime: 'container' },
        privateKeyHex: toHex(kp.privateKey),
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.operatorPublicKey).toBe(kp.publicKeyHex);
    });

    it('should create an identity with operator identifier', async () => {
      const result = await server.callTool('create_identity', {
        model: { provider: 'anthropic', modelId: 'claude-3' },
        capabilities: ['read'],
        deployment: { runtime: 'process' },
        operatorIdentifier: 'acme-corp',
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.operatorIdentifier).toBe('acme-corp');
    });

    it('should error when model is missing', async () => {
      const result = await server.callTool('create_identity', {
        capabilities: ['read'],
        deployment: { runtime: 'process' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('model');
    });

    it('should error when capabilities is missing', async () => {
      const result = await server.callTool('create_identity', {
        model: { provider: 'anthropic', modelId: 'claude-3' },
        deployment: { runtime: 'process' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('capabilities');
    });

    it('should error when deployment is missing', async () => {
      const result = await server.callTool('create_identity', {
        model: { provider: 'anthropic', modelId: 'claude-3' },
        capabilities: ['read'],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('deployment');
    });

    it('should error when model.provider is missing', async () => {
      const result = await server.callTool('create_identity', {
        model: { modelId: 'claude-3' },
        capabilities: ['read'],
        deployment: { runtime: 'process' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('model');
    });

    it('should sort capabilities in the created identity', async () => {
      const result = await server.callTool('create_identity', {
        model: { provider: 'anthropic', modelId: 'claude-3' },
        capabilities: ['write', 'admin', 'read'],
        deployment: { runtime: 'process' },
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.capabilities).toEqual(['admin', 'read', 'write']);
    });
  });

  // ── parse_ccl tool ──────────────────────────────────────────────────────

  describe('parse_ccl', () => {
    it('should parse valid CCL with a permit statement', async () => {
      const result = await server.callTool('parse_ccl', {
        source: "permit read on '**'",
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.statements).toBe(1);
      expect(data.permits).toBe(1);
      expect(data.denies).toBe(0);
    });

    it('should parse CCL with multiple statement types', async () => {
      const result = await server.callTool('parse_ccl', {
        source: "permit read on '**'\ndeny write on '/system/**'\nlimit api.call 100 per 1 hours",
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.statements).toBe(3);
      expect(data.permits).toBe(1);
      expect(data.denies).toBe(1);
      expect(data.limits).toBe(1);
    });

    it('should include statement details', async () => {
      const result = await server.callTool('parse_ccl', {
        source: "permit read on '/data'",
      });

      const data = parseToolResult(result) as Record<string, unknown>;
      const details = data.details as Array<Record<string, unknown>>;
      expect(details).toHaveLength(1);
      expect(details[0]!.type).toBe('permit');
      expect(details[0]!.action).toBe('read');
      expect(details[0]!.resource).toBe('/data');
    });

    it('should include limit details with count and period', async () => {
      const result = await server.callTool('parse_ccl', {
        source: 'limit api.call 500 per 1 hours',
      });

      const data = parseToolResult(result) as Record<string, unknown>;
      const details = data.details as Array<Record<string, unknown>>;
      expect(details).toHaveLength(1);
      expect(details[0]!.type).toBe('limit');
      expect(details[0]!.count).toBe(500);
      expect(details[0]!.periodSeconds).toBe(3600);
    });

    it('should error on invalid CCL syntax', async () => {
      const result = await server.callTool('parse_ccl', {
        source: '%%%invalid!!!',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('CCL parse error');
    });

    it('should error when source is missing', async () => {
      const result = await server.callTool('parse_ccl', {});

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('source');
    });

    it('should parse deny statement', async () => {
      const result = await server.callTool('parse_ccl', {
        source: "deny delete on '/protected'",
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.denies).toBe(1);
      expect(data.permits).toBe(0);
    });

    it('should parse require statement', async () => {
      const result = await server.callTool('parse_ccl', {
        source: "require audit on '/sensitive'",
      });

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.obligations).toBe(1);
    });
  });

  // ── list_covenants tool ─────────────────────────────────────────────────

  describe('list_covenants', () => {
    it('should return empty list for empty store', async () => {
      const result = await server.callTool('list_covenants', {});

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.count).toBe(0);
      expect(data.covenants).toEqual([]);
    });

    it('should list covenants after adding documents', async () => {
      await createAndStoreCovenant(store);
      await createAndStoreCovenant(store);

      const result = await server.callTool('list_covenants', {});

      expect(result.isError).toBeUndefined();
      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.count).toBe(2);
      const covenants = data.covenants as Array<Record<string, unknown>>;
      expect(covenants).toHaveLength(2);
    });

    it('should include covenant details in listing', async () => {
      const { doc } = await createAndStoreCovenant(store);

      const result = await server.callTool('list_covenants', {});

      const data = parseToolResult(result) as Record<string, unknown>;
      const covenants = data.covenants as Array<Record<string, unknown>>;
      expect(covenants[0]!.id).toBe(doc.id);
      expect(covenants[0]!.constraints).toBe(doc.constraints);
      expect(covenants[0]!.createdAt).toBe(doc.createdAt);
    });

    it('should filter by issuerId', async () => {
      const { doc: doc1 } = await createAndStoreCovenant(store);
      await createAndStoreCovenant(store);

      const result = await server.callTool('list_covenants', {
        issuerId: doc1.issuer.id,
      });

      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.count).toBe(1);
    });

    it('should filter by beneficiaryId', async () => {
      const { doc: doc1 } = await createAndStoreCovenant(store);
      await createAndStoreCovenant(store);

      const result = await server.callTool('list_covenants', {
        beneficiaryId: doc1.beneficiary.id,
      });

      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.count).toBe(1);
    });

    it('should return empty when filter matches nothing', async () => {
      await createAndStoreCovenant(store);

      const result = await server.callTool('list_covenants', {
        issuerId: 'nonexistent-issuer',
      });

      const data = parseToolResult(result) as Record<string, unknown>;
      expect(data.count).toBe(0);
    });
  });

  // ── JSON-RPC error handling ─────────────────────────────────────────────

  describe('JSON-RPC error handling', () => {
    it('should return METHOD_NOT_FOUND for unknown method', async () => {
      const resp = await server.handleMessage(rpc('nonexistent/method'));
      expect(isError(resp)).toBe(true);
      const err = resp as JsonRpcErrorResponse;
      expect(err.error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND);
      expect(err.error.message).toContain('nonexistent/method');
    });

    it('should return INVALID_REQUEST for wrong jsonrpc version', async () => {
      const resp = await server.handleMessage({
        jsonrpc: '1.0' as '2.0',
        method: 'ping',
        id: 1,
      });
      expect(isError(resp)).toBe(true);
      const err = resp as JsonRpcErrorResponse;
      expect(err.error.code).toBe(JSON_RPC_ERRORS.INVALID_REQUEST);
    });

    it('should return INVALID_REQUEST for missing method', async () => {
      const resp = await server.handleMessage({
        jsonrpc: '2.0',
        method: '',
        id: 1,
      });
      expect(isError(resp)).toBe(true);
      const err = resp as JsonRpcErrorResponse;
      expect(err.error.code).toBe(JSON_RPC_ERRORS.INVALID_REQUEST);
    });

    it('should return INVALID_PARAMS when tools/call is missing name', async () => {
      const resp = await server.handleMessage(rpc('tools/call', {}));
      expect(isError(resp)).toBe(true);
      const err = resp as JsonRpcErrorResponse;
      expect(err.error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
      expect(err.error.message).toContain('name');
    });

    it('should return INVALID_PARAMS for unknown tool in tools/call', async () => {
      const resp = await server.handleMessage(rpc('tools/call', {
        name: 'nonexistent_tool',
      }));
      expect(isError(resp)).toBe(true);
      const err = resp as JsonRpcErrorResponse;
      expect(err.error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
      expect(err.error.message).toContain('nonexistent_tool');
    });

    it('should preserve request id in success response', async () => {
      const resp = await server.handleMessage(rpc('ping', undefined, 42));
      expect(resp.id).toBe(42);
    });

    it('should preserve request id in error response', async () => {
      const resp = await server.handleMessage(rpc('nonexistent', undefined, 99));
      expect(resp.id).toBe(99);
    });

    it('should handle string id', async () => {
      const resp = await server.handleMessage(rpc('ping', undefined, 'abc-123'));
      expect(resp.id).toBe('abc-123');
    });

    it('should handle null id', async () => {
      const resp = await server.handleMessage({
        jsonrpc: '2.0',
        method: 'ping',
        id: null,
      });
      expect(resp.id).toBeNull();
    });

    it('should include jsonrpc version in success response', async () => {
      const resp = await server.handleMessage(rpc('ping'));
      expect(resp.jsonrpc).toBe('2.0');
    });

    it('should include jsonrpc version in error response', async () => {
      const resp = await server.handleMessage(rpc('nonexistent'));
      expect(resp.jsonrpc).toBe('2.0');
    });
  });

  // ── MCP lifecycle methods ─────────────────────────────────────────────

  describe('MCP lifecycle', () => {
    it('initialize advertises tools, resources, and prompts capabilities', async () => {
      const resp = await server.handleMessage(rpc('initialize'));
      expect(isSuccess(resp)).toBe(true);
      const result = (resp as JsonRpcSuccessResponse).result as Record<string, unknown>;
      const capabilities = result.capabilities as Record<string, unknown>;
      expect(capabilities.tools).toBeDefined();
      expect(capabilities.resources).toBeDefined();
      expect(capabilities.prompts).toBeDefined();
    });

    it('notifications/initialized returns success', async () => {
      const resp = await server.handleMessage(rpc('notifications/initialized'));
      expect(isSuccess(resp)).toBe(true);
    });

    it('resources/list returns empty resources', async () => {
      const resp = await server.handleMessage(rpc('resources/list'));
      expect(isSuccess(resp)).toBe(true);
      const result = (resp as JsonRpcSuccessResponse).result as Record<string, unknown>;
      expect(result.resources).toEqual([]);
    });

    it('resources/templates/list returns empty templates', async () => {
      const resp = await server.handleMessage(rpc('resources/templates/list'));
      expect(isSuccess(resp)).toBe(true);
      const result = (resp as JsonRpcSuccessResponse).result as Record<string, unknown>;
      expect(result.resourceTemplates).toEqual([]);
    });

    it('prompts/list returns empty prompts', async () => {
      const resp = await server.handleMessage(rpc('prompts/list'));
      expect(isSuccess(resp)).toBe(true);
      const result = (resp as JsonRpcSuccessResponse).result as Record<string, unknown>;
      expect(result.prompts).toEqual([]);
    });
  });

  // ── callTool direct ─────────────────────────────────────────────────────

  describe('callTool', () => {
    it('should return error for unknown tool name', async () => {
      const result = await server.callTool('unknown_tool', {});
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Unknown tool');
    });

    it('should return ToolResult with content array', async () => {
      const result = await server.callTool('parse_ccl', {
        source: "permit read on '**'",
      });
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0]!.type).toBe('text');
    });
  });

  // ── Integration: end-to-end workflows ───────────────────────────────────

  describe('integration', () => {
    it('should create, list, verify, and evaluate a covenant', async () => {
      const { issuerKp, issuer, beneficiary } = await createTestParties();

      // 1. Create
      const createResult = await server.callTool('create_covenant', {
        issuer,
        beneficiary,
        constraints: "permit read on '**'\ndeny write on '/system/**'",
        privateKeyHex: toHex(issuerKp.privateKey),
      });
      expect(createResult.isError).toBeUndefined();
      const createData = parseToolResult(createResult) as Record<string, unknown>;
      const covenantId = createData.id as string;

      // 2. List
      const listResult = await server.callTool('list_covenants', {});
      const listData = parseToolResult(listResult) as Record<string, unknown>;
      expect(listData.count).toBe(1);

      // 3. Verify
      const verifyResult = await server.callTool('verify_covenant', {
        covenantId,
      });
      const verifyData = parseToolResult(verifyResult) as Record<string, unknown>;
      expect(verifyData.valid).toBe(true);

      // 4. Evaluate - should permit read
      const evalPermit = await server.callTool('evaluate_action', {
        covenantId,
        action: 'read',
        resource: '/data',
      });
      const evalPermitData = parseToolResult(evalPermit) as Record<string, unknown>;
      expect(evalPermitData.permitted).toBe(true);

      // 5. Evaluate - should deny write to /system
      const evalDeny = await server.callTool('evaluate_action', {
        covenantId,
        action: 'write',
        resource: '/system/config',
      });
      const evalDenyData = parseToolResult(evalDeny) as Record<string, unknown>;
      expect(evalDenyData.permitted).toBe(false);
    });

    it('should handle multiple covenants independently', async () => {
      const parties1 = await createTestParties();
      const parties2 = await createTestParties();

      // Create two covenants with different constraints
      const r1 = await server.callTool('create_covenant', {
        issuer: parties1.issuer,
        beneficiary: parties1.beneficiary,
        constraints: "permit read on '**'",
        privateKeyHex: toHex(parties1.issuerKp.privateKey),
      });
      const r2 = await server.callTool('create_covenant', {
        issuer: parties2.issuer,
        beneficiary: parties2.beneficiary,
        constraints: "deny read on '**'",
        privateKeyHex: toHex(parties2.issuerKp.privateKey),
      });

      const id1 = (parseToolResult(r1) as Record<string, unknown>).id as string;
      const id2 = (parseToolResult(r2) as Record<string, unknown>).id as string;

      // Evaluate same action against different covenants
      const eval1 = await server.callTool('evaluate_action', {
        covenantId: id1,
        action: 'read',
        resource: '/test',
      });
      const eval2 = await server.callTool('evaluate_action', {
        covenantId: id2,
        action: 'read',
        resource: '/test',
      });

      expect((parseToolResult(eval1) as Record<string, unknown>).permitted).toBe(true);
      expect((parseToolResult(eval2) as Record<string, unknown>).permitted).toBe(false);
    });

    it('should parse CCL then use same constraints to create covenant', async () => {
      const constraints = "permit read on '**'\nlimit api.call 1000 per 1 hours";

      // Parse first to validate
      const parseResult = await server.callTool('parse_ccl', { source: constraints });
      expect(parseResult.isError).toBeUndefined();
      const parseData = parseToolResult(parseResult) as Record<string, unknown>;
      expect(parseData.statements).toBe(2);

      // Use same constraints to create covenant
      const { issuerKp, issuer, beneficiary } = await createTestParties();
      const createResult = await server.callTool('create_covenant', {
        issuer,
        beneficiary,
        constraints,
        privateKeyHex: toHex(issuerKp.privateKey),
      });
      expect(createResult.isError).toBeUndefined();
    });
  });

  // ── tools/call via JSON-RPC dispatch ────────────────────────────────────

  describe('tools/call dispatch', () => {
    it('should handle tools/call with no arguments', async () => {
      const resp = await server.handleMessage(rpc('tools/call', {
        name: 'list_covenants',
        arguments: {},
      }));
      expect(isSuccess(resp)).toBe(true);
    });

    it('should handle tools/call with missing arguments key', async () => {
      const resp = await server.handleMessage(rpc('tools/call', {
        name: 'list_covenants',
      }));
      expect(isSuccess(resp)).toBe(true);
    });

    it('should handle parse_ccl via JSON-RPC', async () => {
      const resp = await server.handleMessage(rpc('tools/call', {
        name: 'parse_ccl',
        arguments: { source: "permit read on '**'" },
      }));
      expect(isSuccess(resp)).toBe(true);
      const result = (resp as JsonRpcSuccessResponse).result as ToolResult;
      expect(result.isError).toBeUndefined();
    });

    it('should handle create_identity via JSON-RPC', async () => {
      const resp = await server.handleMessage(rpc('tools/call', {
        name: 'create_identity',
        arguments: {
          model: { provider: 'anthropic', modelId: 'claude-3' },
          capabilities: ['read'],
          deployment: { runtime: 'process' },
        },
      }));
      expect(isSuccess(resp)).toBe(true);
      const result = (resp as JsonRpcSuccessResponse).result as ToolResult;
      expect(result.isError).toBeUndefined();
    });
  });
});
