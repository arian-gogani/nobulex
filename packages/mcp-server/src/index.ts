/**
 * @stele/mcp-server -- Model Context Protocol server that exposes
 * Stele tools to any AI agent.
 *
 * Implements JSON-RPC 2.0 over stdio, with tool definitions that map
 * to @stele/sdk, @stele/store, and @stele/crypto operations.
 *
 * @packageDocumentation
 */

import { SteleClient } from '@stele/sdk';
import { MemoryStore } from '@stele/store';
import { generateKeyPair, toHex } from '@stele/crypto';
import type { KeyPair } from '@stele/crypto';

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcErrorDetail,
  ToolDefinition,
  ToolResult,
  ToolResultContent,
  ToolInputSchema,
  MCPServerOptions,
} from './types';

import {
  JSON_RPC_ERRORS,
} from './types';

// Re-export all types
export type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcErrorDetail,
  ToolDefinition,
  ToolResult,
  ToolResultContent,
  ToolInputSchema,
  MCPServerOptions,
} from './types';

export { JSON_RPC_ERRORS } from './types';

export { createAuthMiddleware } from './auth';
export type { MCPAuthOptions, AuthenticatedRequest } from './auth';

// ─── Tool definitions ───────────────────────────────────────────────────────────

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'create_covenant',
    description: 'Create a new signed covenant document with CCL constraints between an issuer and beneficiary.',
    inputSchema: {
      type: 'object',
      properties: {
        issuer: {
          type: 'object',
          description: 'The issuing party. Must have id, publicKey, and role="issuer".',
          properties: {
            id: { type: 'string', description: 'Unique identifier for the issuer.' },
            publicKey: { type: 'string', description: 'Hex-encoded Ed25519 public key.' },
            role: { type: 'string', description: 'Must be "issuer".', enum: ['issuer'] },
            name: { type: 'string', description: 'Optional human-readable name.' },
          },
          required: ['id', 'publicKey', 'role'],
        },
        beneficiary: {
          type: 'object',
          description: 'The beneficiary party. Must have id, publicKey, and role="beneficiary".',
          properties: {
            id: { type: 'string', description: 'Unique identifier for the beneficiary.' },
            publicKey: { type: 'string', description: 'Hex-encoded Ed25519 public key.' },
            role: { type: 'string', description: 'Must be "beneficiary".', enum: ['beneficiary'] },
            name: { type: 'string', description: 'Optional human-readable name.' },
          },
          required: ['id', 'publicKey', 'role'],
        },
        constraints: {
          type: 'string',
          description: 'CCL constraint source text (e.g. "permit read on \'**\'").',
        },
        privateKeyHex: {
          type: 'string',
          description: 'Hex-encoded issuer private key for signing.',
        },
      },
      required: ['issuer', 'beneficiary', 'constraints', 'privateKeyHex'],
    },
  },
  {
    name: 'verify_covenant',
    description: 'Verify a covenant document by running all specification checks (signature, expiry, CCL syntax, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        covenantId: {
          type: 'string',
          description: 'The ID of the covenant document in the store to verify.',
        },
      },
      required: ['covenantId'],
    },
  },
  {
    name: 'evaluate_action',
    description: 'Evaluate whether a specific action on a resource is permitted by a covenant\'s CCL constraints.',
    inputSchema: {
      type: 'object',
      properties: {
        covenantId: {
          type: 'string',
          description: 'The ID of the covenant document to evaluate against.',
        },
        action: {
          type: 'string',
          description: 'The action to evaluate (e.g. "read", "write", "file.delete").',
        },
        resource: {
          type: 'string',
          description: 'The resource path to evaluate (e.g. "/data", "/files/**").',
        },
        context: {
          type: 'object',
          description: 'Optional evaluation context with additional variables for condition matching.',
        },
      },
      required: ['covenantId', 'action', 'resource'],
    },
  },
  {
    name: 'create_identity',
    description: 'Create a new agent identity with model attestation, capabilities, and deployment context.',
    inputSchema: {
      type: 'object',
      properties: {
        operatorIdentifier: {
          type: 'string',
          description: 'Optional human-readable operator identifier.',
        },
        model: {
          type: 'object',
          description: 'Model attestation describing the AI model.',
          properties: {
            provider: { type: 'string', description: 'Model provider (e.g. "anthropic").' },
            modelId: { type: 'string', description: 'Model identifier (e.g. "claude-3").' },
            modelVersion: { type: 'string', description: 'Optional model version.' },
          },
          required: ['provider', 'modelId'],
        },
        capabilities: {
          type: 'array',
          description: 'List of capability strings this agent has.',
          items: { type: 'string' },
        },
        deployment: {
          type: 'object',
          description: 'Deployment context describing where the agent runs.',
          properties: {
            runtime: { type: 'string', description: 'Runtime type (e.g. "process", "container", "wasm").', enum: ['wasm', 'container', 'tee', 'firecracker', 'process', 'browser'] },
            region: { type: 'string', description: 'Optional deployment region.' },
            provider: { type: 'string', description: 'Optional cloud provider.' },
          },
          required: ['runtime'],
        },
        privateKeyHex: {
          type: 'string',
          description: 'Optional hex-encoded operator private key. A new key pair is generated if omitted.',
        },
      },
      required: ['model', 'capabilities', 'deployment'],
    },
  },
  {
    name: 'parse_ccl',
    description: 'Parse CCL (Covenant Constraint Language) source text and return the structured document.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'The CCL source text to parse.',
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'list_covenants',
    description: 'List all covenant documents currently in the store, optionally filtered by issuer or beneficiary.',
    inputSchema: {
      type: 'object',
      properties: {
        issuerId: {
          type: 'string',
          description: 'Optional filter: only return covenants from this issuer.',
        },
        beneficiaryId: {
          type: 'string',
          description: 'Optional filter: only return covenants for this beneficiary.',
        },
      },
    },
  },
];

// ─── SteleServer ────────────────────────────────────────────────────────────────

/**
 * MCP server that exposes Stele protocol operations as tools via JSON-RPC 2.0.
 *
 * Accepts a {@link MemoryStore} for persisting covenant documents and provides
 * methods for handling MCP protocol messages, listing tools, and calling tools.
 */
export class SteleServer {
  /** The backing store for covenant documents. */
  readonly store: MemoryStore;

  /** The SDK client used for operations. */
  private readonly client: SteleClient;

  /** Server name. */
  readonly name: string;

  /** Server version. */
  readonly version: string;

  constructor(store: MemoryStore, options?: MCPServerOptions) {
    this.store = store;
    this.client = new SteleClient();
    this.name = options?.name ?? 'stele-mcp-server';
    this.version = options?.version ?? '0.1.0';
  }

  // ── Tool listing ────────────────────────────────────────────────────────────

  /**
   * Return all available tool definitions with their JSON Schema input schemas.
   */
  listTools(): ToolDefinition[] {
    return [...TOOL_DEFINITIONS];
  }

  // ── Tool execution ──────────────────────────────────────────────────────────

  /**
   * Call a named tool with the given arguments.
   *
   * @param name - The tool name (must match one of the tool definitions).
   * @param args - The tool arguments matching the tool's input schema.
   * @returns A {@link ToolResult} containing the output or error.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (name) {
      case 'create_covenant':
        return this._createCovenant(args);
      case 'verify_covenant':
        return this._verifyCovenant(args);
      case 'evaluate_action':
        return this._evaluateAction(args);
      case 'create_identity':
        return this._createIdentity(args);
      case 'parse_ccl':
        return this._parseCCL(args);
      case 'list_covenants':
        return this._listCovenants(args);
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  }

  // ── JSON-RPC 2.0 message handler ────────────────────────────────────────────

  /**
   * Handle a JSON-RPC 2.0 message and return the appropriate response.
   *
   * Supports the following MCP methods:
   * - `initialize` -- Returns server info and capabilities
   * - `tools/list` -- Returns available tool definitions
   * - `tools/call` -- Executes a tool and returns the result
   * - `ping` -- Returns a pong
   *
   * @param message - A parsed JSON-RPC request object.
   * @returns A JSON-RPC response object.
   */
  async handleMessage(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    // Validate basic JSON-RPC structure
    if (!message || typeof message !== 'object') {
      return this._errorResponse(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid request object');
    }

    if (message.jsonrpc !== '2.0') {
      return this._errorResponse(
        message.id ?? null,
        JSON_RPC_ERRORS.INVALID_REQUEST,
        'Invalid jsonrpc version, expected "2.0"',
      );
    }

    if (typeof message.method !== 'string' || message.method.length === 0) {
      return this._errorResponse(
        message.id ?? null,
        JSON_RPC_ERRORS.INVALID_REQUEST,
        'Missing or invalid method',
      );
    }

    const id = message.id ?? null;

    switch (message.method) {
      case 'initialize':
        return this._successResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: this.name,
            version: this.version,
          },
        });

      case 'ping':
        return this._successResponse(id, {});

      case 'tools/list':
        return this._successResponse(id, {
          tools: this.listTools(),
        });

      case 'tools/call': {
        const params = message.params as Record<string, unknown> | undefined;
        if (!params || typeof params.name !== 'string') {
          return this._errorResponse(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing required param: name');
        }

        const toolName = params.name as string;
        const toolArgs = (params.arguments as Record<string, unknown>) ?? {};

        // Check that the tool exists
        const toolDef = TOOL_DEFINITIONS.find((t) => t.name === toolName);
        if (!toolDef) {
          return this._errorResponse(id, JSON_RPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${toolName}`);
        }

        const result = await this.callTool(toolName, toolArgs);
        return this._successResponse(id, result);
      }

      default:
        return this._errorResponse(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${message.method}`);
    }
  }

  // ── Tool implementations ──────────────────────────────────────────────────

  private async _createCovenant(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const issuer = args.issuer as Record<string, unknown> | undefined;
      const beneficiary = args.beneficiary as Record<string, unknown> | undefined;
      const constraints = args.constraints as string | undefined;
      const privateKeyHex = args.privateKeyHex as string | undefined;

      if (!issuer || !issuer.id || !issuer.publicKey || !issuer.role) {
        return this._toolError('Missing required field: issuer (must have id, publicKey, role)');
      }
      if (!beneficiary || !beneficiary.id || !beneficiary.publicKey || !beneficiary.role) {
        return this._toolError('Missing required field: beneficiary (must have id, publicKey, role)');
      }
      if (!constraints || typeof constraints !== 'string') {
        return this._toolError('Missing required field: constraints');
      }
      if (!privateKeyHex || typeof privateKeyHex !== 'string') {
        return this._toolError('Missing required field: privateKeyHex');
      }

      const { fromHex } = await import('@stele/crypto');
      const privateKey = fromHex(privateKeyHex);

      const doc = await this.client.createCovenant({
        issuer: {
          id: issuer.id as string,
          publicKey: issuer.publicKey as string,
          role: 'issuer',
          name: issuer.name as string | undefined,
        },
        beneficiary: {
          id: beneficiary.id as string,
          publicKey: beneficiary.publicKey as string,
          role: 'beneficiary',
          name: beneficiary.name as string | undefined,
        },
        constraints,
        privateKey,
      });

      // Store the created document
      await this.store.put(doc);

      return this._toolSuccess({
        id: doc.id,
        version: doc.version,
        issuer: doc.issuer,
        beneficiary: doc.beneficiary,
        constraints: doc.constraints,
        createdAt: doc.createdAt,
      });
    } catch (err) {
      return this._toolError(`Failed to create covenant: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async _verifyCovenant(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const covenantId = args.covenantId as string | undefined;
      if (!covenantId || typeof covenantId !== 'string') {
        return this._toolError('Missing required field: covenantId');
      }

      const doc = await this.store.get(covenantId);
      if (!doc) {
        return this._toolError(`Covenant not found: ${covenantId}`);
      }

      const result = await this.client.verifyCovenant(doc);

      return this._toolSuccess({
        valid: result.valid,
        checks: result.checks,
      });
    } catch (err) {
      return this._toolError(`Failed to verify covenant: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async _evaluateAction(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const covenantId = args.covenantId as string | undefined;
      const action = args.action as string | undefined;
      const resource = args.resource as string | undefined;
      const context = args.context as Record<string, unknown> | undefined;

      if (!covenantId || typeof covenantId !== 'string') {
        return this._toolError('Missing required field: covenantId');
      }
      if (!action || typeof action !== 'string') {
        return this._toolError('Missing required field: action');
      }
      if (!resource || typeof resource !== 'string') {
        return this._toolError('Missing required field: resource');
      }

      const doc = await this.store.get(covenantId);
      if (!doc) {
        return this._toolError(`Covenant not found: ${covenantId}`);
      }

      const result = await this.client.evaluateAction(doc, action, resource, context);

      return this._toolSuccess({
        permitted: result.permitted,
        matchedRule: result.matchedRule,
        reason: result.reason,
        severity: result.severity,
      });
    } catch (err) {
      return this._toolError(`Failed to evaluate action: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async _createIdentity(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const model = args.model as Record<string, unknown> | undefined;
      const capabilities = args.capabilities as string[] | undefined;
      const deployment = args.deployment as Record<string, unknown> | undefined;
      const privateKeyHex = args.privateKeyHex as string | undefined;
      const operatorIdentifier = args.operatorIdentifier as string | undefined;

      if (!model || !model.provider || !model.modelId) {
        return this._toolError('Missing required field: model (must have provider, modelId)');
      }
      if (!capabilities || !Array.isArray(capabilities)) {
        return this._toolError('Missing required field: capabilities (must be an array)');
      }
      if (!deployment || !deployment.runtime) {
        return this._toolError('Missing required field: deployment (must have runtime)');
      }

      let keyPair: KeyPair;
      if (privateKeyHex) {
        const { keyPairFromPrivateKeyHex } = await import('@stele/crypto');
        keyPair = await keyPairFromPrivateKeyHex(privateKeyHex);
      } else {
        keyPair = await generateKeyPair();
      }

      const identity = await this.client.createIdentity({
        operatorKeyPair: keyPair,
        operatorIdentifier,
        model: {
          provider: model.provider as string,
          modelId: model.modelId as string,
          modelVersion: model.modelVersion as string | undefined,
        },
        capabilities,
        deployment: {
          runtime: deployment.runtime as 'process',
          region: deployment.region as string | undefined,
          provider: deployment.provider as string | undefined,
        },
      });

      return this._toolSuccess({
        id: identity.id,
        operatorPublicKey: identity.operatorPublicKey,
        operatorIdentifier: identity.operatorIdentifier,
        model: identity.model,
        capabilities: identity.capabilities,
        version: identity.version,
        createdAt: identity.createdAt,
      });
    } catch (err) {
      return this._toolError(`Failed to create identity: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async _parseCCL(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const source = args.source as string | undefined;
      if (!source || typeof source !== 'string') {
        return this._toolError('Missing required field: source');
      }

      const doc = this.client.parseCCL(source);

      return this._toolSuccess({
        statements: doc.statements.length,
        permits: doc.permits.length,
        denies: doc.denies.length,
        obligations: doc.obligations.length,
        limits: doc.limits.length,
        details: doc.statements.map((s) => {
          if (s.type === 'limit') {
            return {
              type: s.type,
              action: s.action,
              count: s.count,
              periodSeconds: s.periodSeconds,
              severity: s.severity,
            };
          }
          return {
            type: s.type,
            action: s.action,
            resource: 'resource' in s ? s.resource : undefined,
            severity: s.severity,
          };
        }),
      });
    } catch (err) {
      return this._toolError(`CCL parse error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async _listCovenants(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const issuerId = args.issuerId as string | undefined;
      const beneficiaryId = args.beneficiaryId as string | undefined;

      const filter: Record<string, unknown> = {};
      if (issuerId) filter.issuerId = issuerId;
      if (beneficiaryId) filter.beneficiaryId = beneficiaryId;

      const docs = await this.store.list(
        Object.keys(filter).length > 0 ? filter as { issuerId?: string; beneficiaryId?: string } : undefined,
      );

      return this._toolSuccess({
        count: docs.length,
        covenants: docs.map((doc) => ({
          id: doc.id,
          issuer: { id: doc.issuer.id, name: doc.issuer.name },
          beneficiary: { id: doc.beneficiary.id, name: doc.beneficiary.name },
          constraints: doc.constraints,
          createdAt: doc.createdAt,
        })),
      });
    } catch (err) {
      return this._toolError(`Failed to list covenants: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Response helpers ──────────────────────────────────────────────────────

  private _successResponse(id: string | number | null, result: unknown): JsonRpcSuccessResponse {
    return {
      jsonrpc: '2.0',
      result,
      id,
    };
  }

  private _errorResponse(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcErrorResponse {
    return {
      jsonrpc: '2.0',
      error: { code, message, data },
      id,
    };
  }

  private _toolSuccess(data: unknown): ToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  private _toolError(message: string): ToolResult {
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
}
