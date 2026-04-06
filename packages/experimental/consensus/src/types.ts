export type AccountabilityTier = 'unaccountable' | 'basic' | 'verified' | 'trusted' | 'exemplary';

export interface AccountabilityScore {
  agentId: string;
  score: number;
  components: {
    covenantCompleteness: number;
    complianceHistory: number;
    stakeRatio: number;
    attestationCoverage: number;
    canaryPassRate: number;
  };
  tier: AccountabilityTier;
}

export interface InteractionPolicy {
  minimumTier: AccountabilityTier;
  minimumScore: number;
  requireStake: boolean;
  requireAttestation: boolean;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  counterpartyScore: AccountabilityScore;
  riskAdjustment: number;
}

export interface ProtocolData {
  covenantCount: number;
  totalInteractions: number;
  compliantInteractions: number;
  stakeAmount: number;
  maxStake: number;
  attestedInteractions: number;
  canaryTests: number;
  canaryPasses: number;
}
