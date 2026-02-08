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
