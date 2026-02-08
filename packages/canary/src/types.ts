export type ChallengePayload = {
  action: string;
  resource: string;
  context: Record<string, unknown>;
};

export interface Canary {
  id: string;
  targetCovenantId: string;
  constraintTested: string;
  challenge: ChallengePayload;
  expectedBehavior: 'deny' | 'permit' | 'limit';
  issuedAt: number;
  expiresAt: number;
}

export interface CanaryResult {
  canaryId: string;
  passed: boolean;
  actualBehavior: string;
  detectionTimestamp: number;
  breachEvidence?: string;
}
