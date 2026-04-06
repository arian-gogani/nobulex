import type { Severity } from '@nobulex/ccl';

export interface MCPServer {
  tools?: MCPTool[];
  handleToolCall?(name: string, args: Record<string, unknown>): Promise<unknown>;
  [key: string]: unknown;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface NobulexGuardOptions {
  constraints: string;
  mode?: 'enforce' | 'log_only';
  proofType?: 'audit_log' | 'capability_manifest';
  operatorKeyPair?: import('@nobulex/crypto').KeyPair;
  agentIdentifier?: string;
  model?: import('@nobulex/identity').ModelAttestation;
  onViolation?: (details: ViolationDetails) => void;
  onToolCall?: (details: ToolCallDetails) => void;
}

export interface WrappedMCPServer extends MCPServer {
  getMonitor(): import('@nobulex/enforcement').Monitor;
  getIdentity(): import('@nobulex/identity').AgentIdentity;
  getAuditLog(): import('@nobulex/enforcement').AuditLog;
  generateProof(): Promise<import('@nobulex/proof').ComplianceProof>;
  getReceipt(): import('@nobulex/reputation').ExecutionReceipt | null;
  getCovenant(): import('@nobulex/core').CovenantDocument;
}

export interface ViolationDetails {
  toolName: string;
  action: string;
  resource: string;
  constraint: string;
  severity: Severity;
  timestamp: string;
}

export interface ToolCallDetails {
  toolName: string;
  action: string;
  resource: string;
  permitted: boolean;
  timestamp: string;
  durationMs: number;
}
