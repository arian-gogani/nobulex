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

export interface CanaryScheduleEntry {
  /** Constraint to test */
  constraintTested: string;
  /** Target covenant ID */
  targetCovenantId: string;
  /** Scheduled deployment time offset (ms from start) */
  deployAtOffset: number;
  /** Priority (lower = higher priority) */
  priority: number;
}

export interface CanaryScheduleResult {
  /** Ordered list of canary deployments */
  schedule: CanaryScheduleEntry[];
  /** Total time span of the schedule in ms */
  totalDurationMs: number;
  /** Number of unique constraints covered */
  constraintsCovered: number;
  /** Number of unique covenants covered */
  covenantsCovered: number;
  /** Estimated coverage ratio (0 to 1) */
  estimatedCoverage: number;
}

export interface CanaryCorrelationResult {
  /** Pearson correlation coefficient (-1 to 1) */
  correlation: number;
  /** Number of data points used */
  sampleSize: number;
  /** Canary pass rates per covenant */
  canaryPassRates: Record<string, number>;
  /** Breach rates per covenant (0 = no breaches, 1 = all breaches) */
  breachRates: Record<string, number>;
  /** Whether the correlation is statistically meaningful (n >= 3) */
  meaningful: boolean;
}
