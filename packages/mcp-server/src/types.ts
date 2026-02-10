/**
 * @stele/mcp-server type definitions.
 *
 * Provides JSON-RPC 2.0, MCP tool definition, and server option types
 * for the Model Context Protocol server implementation.
 *
 * @packageDocumentation
 */

// ─── JSON-RPC 2.0 ──────────────────────────────────────────────────────────────

/** A JSON-RPC 2.0 request object. */
export interface JsonRpcRequest {
  /** Must be exactly "2.0". */
  jsonrpc: '2.0';
  /** The method to invoke. */
  method: string;
  /** Method parameters (positional or named). */
  params?: Record<string, unknown> | unknown[];
  /** Request identifier. May be a string, number, or null for notifications. */
  id: string | number | null;
}

/** A successful JSON-RPC 2.0 response object. */
export interface JsonRpcSuccessResponse {
  /** Must be exactly "2.0". */
  jsonrpc: '2.0';
  /** The result of the method call. */
  result: unknown;
  /** Must match the id of the request. */
  id: string | number | null;
}

/** A JSON-RPC 2.0 error detail object. */
export interface JsonRpcErrorDetail {
  /** A numeric error code. */
  code: number;
  /** A short human-readable description of the error. */
  message: string;
  /** Optional additional data about the error. */
  data?: unknown;
}

/** A JSON-RPC 2.0 error response object. */
export interface JsonRpcErrorResponse {
  /** Must be exactly "2.0". */
  jsonrpc: '2.0';
  /** The error detail. */
  error: JsonRpcErrorDetail;
  /** Must match the id of the request, or null if the id could not be parsed. */
  id: string | number | null;
}

/** Union of success and error JSON-RPC responses. */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// ─── JSON-RPC error codes ───────────────────────────────────────────────────────

/** Standard JSON-RPC 2.0 error codes. */
export const JSON_RPC_ERRORS = {
  /** Invalid JSON was received by the server. */
  PARSE_ERROR: -32700,
  /** The JSON sent is not a valid Request object. */
  INVALID_REQUEST: -32600,
  /** The method does not exist or is not available. */
  METHOD_NOT_FOUND: -32601,
  /** Invalid method parameter(s). */
  INVALID_PARAMS: -32602,
  /** Internal JSON-RPC error. */
  INTERNAL_ERROR: -32603,
} as const;

// ─── MCP Tool Definitions ───────────────────────────────────────────────────────

/** JSON Schema definition for a tool's input parameters. */
export interface ToolInputSchema {
  /** Must be "object". */
  type: 'object';
  /** Property definitions keyed by parameter name. */
  properties: Record<string, {
    type: string;
    description?: string;
    items?: { type: string };
    properties?: Record<string, unknown>;
    required?: string[];
    enum?: string[];
  }>;
  /** List of required parameter names. */
  required?: string[];
}

/** Definition of a single MCP tool. */
export interface ToolDefinition {
  /** The unique name of the tool. */
  name: string;
  /** A human-readable description of what the tool does. */
  description: string;
  /** JSON Schema describing the tool's input parameters. */
  inputSchema: ToolInputSchema;
}

/** Content item in a tool result. */
export interface ToolResultContent {
  /** The type of content. */
  type: 'text';
  /** The textual content. */
  text: string;
}

/** Result returned by a tool call. */
export interface ToolResult {
  /** The content items in the result. */
  content: ToolResultContent[];
  /** Whether the tool call resulted in an error. */
  isError?: boolean;
}

// ─── MCP Server Options ─────────────────────────────────────────────────────────

/** Options for constructing a SteleServer instance. */
export interface MCPServerOptions {
  /** A human-readable name for this server instance. */
  name?: string;
  /** The server version string. */
  version?: string;
}
