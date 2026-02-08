export interface TrustFuture {
  id: string;
  agentId: string;
  metric: 'trustScore' | 'complianceRate' | 'breachProbability';
  targetValue: number;
  settlementDate: number;
  premium: number;
  holder: string;
  status: 'active' | 'settled' | 'expired';
}

export interface AgentInsurancePolicy {
  id: string;
  agentId: string;
  covenantId: string;
  coverage: number;
  premium: number;
  underwriter: string;
  riskScore: number;
  term: number;
  status: 'active' | 'claimed' | 'expired';
  createdAt: number;
}

export interface RiskAssessment {
  agentId: string;
  breachProbability: number;
  expectedLoss: number;
  recommendedPremium: number;
  factors: RiskFactor[];
}

export interface RiskFactor {
  name: string;
  weight: number;
  value: number;
}

export interface Settlement {
  futureId: string;
  actualValue: number;
  targetValue: number;
  payout: number;
  settledAt: number;
}

export interface ReputationData {
  trustScore: number;
  complianceRate: number;
  breachCount: number;
  totalInteractions: number;
  stakeAmount: number;
  age: number;
}
