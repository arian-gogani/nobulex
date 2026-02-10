import type { HashHex } from '@stele/crypto';
import type { Statement, Severity, EvaluationResult } from '@stele/ccl';

export type ExecutionOutcome = 'EXECUTED' | 'DENIED' | 'IMPOSSIBLE';

export interface AuditEntry {
  index: number;
  timestamp: string;
  action: string;
  resource: string;
  context: Record<string, unknown>;
  result: EvaluationResult;
  outcome: ExecutionOutcome;
  error?: string;
  previousHash: HashHex;
  hash: HashHex;
}

export interface AuditLog {
  covenantId: HashHex;
  entries: AuditEntry[];
  merkleRoot: HashHex;
  count: number;
}

export interface CapabilityManifest {
  covenantId: HashHex;
  capabilities: {
    action: string;
    resource: string;
    conditions?: string;
  }[];
  manifestHash: HashHex;
  runtimeType: string;
  runtimeSignature: string;
  runtimePublicKey: string;
  generatedAt: string;
}

export type ActionHandler<T = unknown> = (resource: string, context: Record<string, unknown>) => Promise<T>;

export interface ExecutionLogEntry {
  action: string;
  resource: string;
  outcome: ExecutionOutcome;
  timestamp: string;
  error?: string;
}

export interface MonitorConfig {
  mode: 'enforce' | 'log_only';
  failureMode: 'fail_closed' | 'fail_open';
  onViolation?: (entry: AuditEntry) => void;
  onAction?: (entry: AuditEntry) => void;
}

export interface RateLimitState {
  action: string;
  count: number;
  periodStart: number;
  periodSeconds: number;
  limit: number;
}
