import { sha256Object, generateId } from '@stele/crypto';

export type {
  LegalIdentityPackage,
  ComplianceRecord,
  JurisdictionalMapping,
  CovenantRecord,
  ReputationSnapshot,
  AttestationRecord,
  InsuranceRecord,
  ComplianceStandard,
} from './types';

import type {
  LegalIdentityPackage,
  ComplianceRecord,
  JurisdictionalMapping,
  CovenantRecord,
  ReputationSnapshot,
  AttestationRecord,
  InsuranceRecord,
  ComplianceStandard,
} from './types';

/**
 * Known jurisdictions and their legal frameworks.
 */
export const JURISDICTIONS: Record<string, { legalFramework: string; complianceStandard: string; requiredFields: string[] }> = {
  US: {
    legalFramework: 'US Federal / State Law',
    complianceStandard: 'SOC2',
    requiredFields: ['agentId', 'operatorId', 'complianceRecord', 'attestations', 'insurancePolicies'],
  },
  EU: {
    legalFramework: 'EU General Data Protection Regulation',
    complianceStandard: 'GDPR',
    requiredFields: ['agentId', 'operatorId', 'complianceRecord', 'covenantHistory', 'attestations', 'reputationSnapshot'],
  },
  UK: {
    legalFramework: 'UK General Data Protection Regulation',
    complianceStandard: 'UK-GDPR',
    requiredFields: ['agentId', 'operatorId', 'complianceRecord', 'covenantHistory', 'attestations'],
  },
  JP: {
    legalFramework: 'Act on the Protection of Personal Information',
    complianceStandard: 'APPI',
    requiredFields: ['agentId', 'operatorId', 'complianceRecord', 'attestations'],
  },
};

/**
 * Compliance standard requirements.
 */
export const COMPLIANCE_STANDARDS: Record<ComplianceStandard, { requiredScore: number; requiredAttestationCoverage: number; requiredCanaryPassRate: number; description: string }> = {
  SOC2: {
    requiredScore: 0.8,
    requiredAttestationCoverage: 0.9,
    requiredCanaryPassRate: 0.95,
    description: 'Service Organization Control 2 - Trust Services Criteria',
  },
  ISO27001: {
    requiredScore: 0.85,
    requiredAttestationCoverage: 0.85,
    requiredCanaryPassRate: 0.9,
    description: 'Information Security Management System',
  },
  GDPR: {
    requiredScore: 0.75,
    requiredAttestationCoverage: 0.8,
    requiredCanaryPassRate: 0.9,
    description: 'General Data Protection Regulation',
  },
  CCPA: {
    requiredScore: 0.7,
    requiredAttestationCoverage: 0.75,
    requiredCanaryPassRate: 0.85,
    description: 'California Consumer Privacy Act',
  },
  HIPAA: {
    requiredScore: 0.9,
    requiredAttestationCoverage: 0.95,
    requiredCanaryPassRate: 0.98,
    description: 'Health Insurance Portability and Accountability Act',
  },
};

/**
 * Creates a LegalIdentityPackage.
 * packageHash = sha256 of all content.
 */
export function exportLegalPackage(
  agentId: string,
  operatorId: string,
  data: {
    covenants: CovenantRecord[];
    compliance: ComplianceRecord;
    reputation: ReputationSnapshot;
    attestations: AttestationRecord[];
    insurance: InsuranceRecord[];
  },
  format: 'json' | 'pdf' | 'legal-xml' = 'json',
): LegalIdentityPackage {
  const exportedAt = Date.now();

  const content = {
    agentId,
    operatorId,
    covenantHistory: data.covenants,
    complianceRecord: data.compliance,
    reputationSnapshot: data.reputation,
    attestations: data.attestations,
    insurancePolicies: data.insurance,
    exportFormat: format,
    exportedAt,
  };

  const packageHash = sha256Object(content);

  return {
    agentId,
    operatorId,
    covenantHistory: data.covenants,
    complianceRecord: data.compliance,
    reputationSnapshot: data.reputation,
    attestations: data.attestations,
    insurancePolicies: data.insurance,
    exportFormat: format,
    exportedAt,
    packageHash,
  };
}

/**
 * Maps package fields to jurisdiction requirements.
 * Known jurisdictions: 'US' (SOC2), 'EU' (GDPR), 'UK' (UK-GDPR), 'JP' (APPI).
 * Returns JurisdictionalMapping with legalFramework, requiredFields, complianceStandard, and mappedFields.
 */
export function mapToJurisdiction(
  pkg: LegalIdentityPackage,
  jurisdiction: string,
): JurisdictionalMapping {
  const jurisdictionInfo = JURISDICTIONS[jurisdiction];

  if (!jurisdictionInfo) {
    return {
      jurisdiction,
      legalFramework: 'Unknown',
      requiredFields: [],
      complianceStandard: 'Unknown',
      mappedFields: {},
    };
  }

  const mappedFields: Record<string, string> = {};

  for (const field of jurisdictionInfo.requiredFields) {
    switch (field) {
      case 'agentId':
        mappedFields[field] = pkg.agentId;
        break;
      case 'operatorId':
        mappedFields[field] = pkg.operatorId;
        break;
      case 'complianceRecord':
        mappedFields[field] = JSON.stringify(pkg.complianceRecord);
        break;
      case 'covenantHistory':
        mappedFields[field] = JSON.stringify(pkg.covenantHistory);
        break;
      case 'attestations':
        mappedFields[field] = JSON.stringify(pkg.attestations);
        break;
      case 'insurancePolicies':
        mappedFields[field] = JSON.stringify(pkg.insurancePolicies);
        break;
      case 'reputationSnapshot':
        mappedFields[field] = JSON.stringify(pkg.reputationSnapshot);
        break;
    }
  }

  return {
    jurisdiction,
    legalFramework: jurisdictionInfo.legalFramework,
    requiredFields: jurisdictionInfo.requiredFields,
    complianceStandard: jurisdictionInfo.complianceStandard,
    mappedFields,
  };
}

/**
 * Generates a compliance report for a specific standard.
 * Returns { standard, passed: boolean, score: number, gaps: string[] }.
 */
export function generateComplianceReport(
  compliance: ComplianceRecord,
  standard: ComplianceStandard,
): { standard: ComplianceStandard; passed: boolean; score: number; gaps: string[] } {
  const requirements = COMPLIANCE_STANDARDS[standard];
  const gaps: string[] = [];

  // Compute compliance score from the record
  const covenantCoverage = compliance.totalInteractions > 0
    ? compliance.covenantedInteractions / compliance.totalInteractions
    : 0;
  const breachRate = compliance.totalInteractions > 0
    ? compliance.breaches / compliance.totalInteractions
    : 0;
  const canaryPassRate = compliance.canaryTests > 0
    ? compliance.canaryPasses / compliance.canaryTests
    : 0;

  // Overall score: weighted average of metrics
  const score = (covenantCoverage * 0.3) + ((1 - breachRate) * 0.3) + (compliance.attestationCoverage * 0.2) + (canaryPassRate * 0.2);

  // Check each requirement
  if (score < requirements.requiredScore) {
    gaps.push(`Overall compliance score ${score.toFixed(3)} is below required ${requirements.requiredScore}`);
  }

  if (compliance.attestationCoverage < requirements.requiredAttestationCoverage) {
    gaps.push(`Attestation coverage ${compliance.attestationCoverage.toFixed(3)} is below required ${requirements.requiredAttestationCoverage}`);
  }

  if (canaryPassRate < requirements.requiredCanaryPassRate) {
    gaps.push(`Canary pass rate ${canaryPassRate.toFixed(3)} is below required ${requirements.requiredCanaryPassRate}`);
  }

  if (breachRate > 0.05) {
    gaps.push(`Breach rate ${breachRate.toFixed(3)} exceeds maximum threshold of 0.05`);
  }

  const passed = gaps.length === 0;

  return {
    standard,
    passed,
    score,
    gaps,
  };
}
