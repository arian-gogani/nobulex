import type { Severity } from '@stele/ccl';

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

export interface SteleGuardOptions {
  constraints: string;
  mode?: 'enforce' | 'log_only';
  proofType?: 'audit_log' | 'capability_manifest';
  operatorKeyPair?: import('@stele/crypto').KeyPair;
  agentIdentifier?: string;
  model?: import('@stele/identity').ModelAttestation;
  onViolation?: (details: ViolationDetails) => void;
  onToolCall?: (details: ToolCallDetails) => void;
}

export interface WrappedMCPServer extends MCPServer {
  getMonitor(): import('@stele/enforcement').Monitor;
  getIdentity(): import('@stele/identity').AgentIdentity;
  getAuditLog(): import('@stele/enforcement').AuditLog;
  generateProof(): Promise<import('@stele/proof').ComplianceProof>;
  getReceipt(): import('@stele/reputation').ExecutionReceipt | null;
  getCovenant(): import('@stele/core').CovenantDocument;
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
