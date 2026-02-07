import type { HashHex } from '@stele/crypto';

export interface ExecutionReceipt {
  id: HashHex;
  covenantId: HashHex;
  agentIdentityHash: HashHex;
  principalPublicKey: string;
  outcome: 'fulfilled' | 'partial' | 'failed' | 'breached';
  breachSeverity?: import('@stele/ccl').Severity;
  proofHash: HashHex;
  durationMs: number;
  completedAt: string;
  agentSignature: string;
  principalSignature?: string;
  previousReceiptHash: HashHex | null;
  receiptHash: HashHex;
}

export interface ReputationScore {
  agentIdentityHash: HashHex;
  totalExecutions: number;
  fulfilled: number;
  partial: number;
  failed: number;
  breached: number;
  successRate: number;
  weightedScore: number;
  receiptsMerkleRoot: HashHex;
  lastUpdatedAt: string;
  currentStake: number;
  totalBurned: number;
}

export interface ReputationStake {
  id: HashHex;
  agentIdentityHash: HashHex;
  covenantId: HashHex;
  amount: number;
  status: 'active' | 'released' | 'burned';
  stakedAt: string;
  resolvedAt?: string;
  signature: string;
}

export interface ReputationDelegation {
  id: HashHex;
  sponsorIdentityHash: HashHex;
  protégéIdentityHash: HashHex;
  riskAmount: number;
  scopes: string[];
  expiresAt: string;
  status: 'active' | 'expired' | 'burned' | 'revoked';
  sponsorSignature: string;
  protégéSignature: string;
}

export interface Endorsement {
  id: HashHex;
  endorserIdentityHash: HashHex;
  endorsedIdentityHash: HashHex;
  basis: {
    covenantsCompleted: number;
    breachRate: number;
    averageOutcomeScore?: number;
  };
  scopes: string[];
  weight: number;
  issuedAt: string;
  signature: string;
}

export interface ScoringConfig {
  recencyDecay: number;
  recencyPeriod: number;
  breachPenalty: Record<import('@stele/ccl').Severity, number>;
  minimumExecutions: number;
  endorsementWeight: number;
}
