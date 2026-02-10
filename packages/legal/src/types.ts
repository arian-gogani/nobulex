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

export type ComplianceStandard = 'SOC2' | 'ISO27001' | 'GDPR' | 'CCPA' | 'HIPAA';

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
