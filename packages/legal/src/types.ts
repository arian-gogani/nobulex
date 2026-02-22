export interface LegalIdentityPackage {
  agentId: string;
  operatorId: string;
  covenantHistory: CovenantRecord[];
  complianceRecord: ComplianceRecord;
  reputationSnapshot: ReputationSnapshot;
  attestations: AttestationRecord[];
  insurancePolicies: InsuranceRecord[];
  exportFormat: 'json' | 'pdf' | 'legal-xml';
  exportedAt: number;
  packageHash: string;
}

export interface ComplianceRecord {
  totalInteractions: number;
  covenantedInteractions: number;
  breaches: number;
  canaryTests: number;
  canaryPasses: number;
  attestationCoverage: number;
}

export interface JurisdictionalMapping {
  jurisdiction: string;
  legalFramework: string;
  requiredFields: string[];
  complianceStandard: string;
  mappedFields: Record<string, string>;
}

export interface CovenantRecord {
  id: string;
  constraints: string[];
  signedAt: number;
  status: 'active' | 'expired' | 'revoked';
}

export interface ReputationSnapshot {
  score: number;
  tier: string;
  totalExecutions: number;
  successRate: number;
  timestamp: number;
}

export interface AttestationRecord {
  id: string;
  counterpartyId: string;
  match: boolean;
  timestamp: number;
}

export interface InsuranceRecord {
  id: string;
  coverage: number;
  premium: number;
  status: string;
}

export type ComplianceStandard =
  | 'SOC2'
  | 'ISO27001'
  | 'GDPR'
  | 'CCPA'
  | 'HIPAA'
  | 'EU_AI_ACT'
  | 'NIST_AI_RMF'
  | 'UK_GDPR'
  | 'APPI';

export interface JurisdictionComplianceEntry {
  jurisdiction: string;
  standard: string;
  passed: boolean;
  score: number;
  gaps: string[];
  missingFields: string[];
}

export interface CrossJurisdictionResult {
  overallCompliant: boolean;
  jurisdictions: JurisdictionComplianceEntry[];
  conflicts: string[];
  recommendations: string[];
}

export interface AuditTrailEntry {
  timestamp: number;
  eventType: 'covenant-signed' | 'covenant-expired' | 'covenant-revoked' | 'attestation' | 'breach' | 'canary-test' | 'insurance-change' | 'compliance-check';
  description: string;
  sourceId: string;
  metadata: Record<string, unknown>;
}

export interface AuditTrailExport {
  agentId: string;
  generatedAt: number;
  entries: AuditTrailEntry[];
  summary: {
    totalEvents: number;
    timeRange: { start: number; end: number };
    eventCounts: Record<string, number>;
  };
}

export interface RegulatoryGap {
  area: string;
  currentState: string;
  requiredState: string;
  severity: 'critical' | 'major' | 'minor';
  remediation: string;
}

export interface RegulatoryGapAnalysisResult {
  targetStandard: ComplianceStandard;
  currentScore: number;
  requiredScore: number;
  gaps: RegulatoryGap[];
  readinessPercentage: number;
  criticalGapCount: number;
  estimatedRemediationEffort: 'low' | 'medium' | 'high';
}

/**
 * Multidimensional trust profile (Stele Score).
 * Dimensions trade off — gaming one costs another. Open algorithm.
 * The FICO score for agents.
 */
export interface SteleScoreProfile {
  agentId: string;
  /** Covenant coverage: covenantedInteractions / totalInteractions */
  complianceRate: number;
  /** Fraction of interactions with attestation */
  attestationCoverage: number;
  /** Canary pass rate */
  canaryPassRate: number;
  /** 1 - breachRate; breach freedom */
  breachFreedom: number;
  /** Stake level 0–1 (from reputation or external) */
  stakeLevel: number;
  /** Covenant lineage depth (chain length) */
  lineageDepth: number;
  /** Composite score (weighted average); for display only */
  composite: number;
  /** Algorithm version for reproducibility */
  algorithmVersion: string;
  computedAt: number;
}
