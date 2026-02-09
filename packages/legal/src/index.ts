import { sha256Object } from '@stele/crypto';

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

// ---------------------------------------------------------------------------
// Jurisdiction & compliance registries
// ---------------------------------------------------------------------------

export interface JurisdictionInfo {
  legalFramework: string;
  complianceStandard: string;
  requiredFields: string[];
}

export interface ComplianceStandardInfo {
  requiredScore: number;
  requiredAttestationCoverage: number;
  requiredCanaryPassRate: number;
  description: string;
}

export interface ComplianceWeights {
  covenantCoverage: number;
  breachFreedom: number;
  attestationCoverage: number;
  canaryPassRate: number;
}

const DEFAULT_WEIGHTS: ComplianceWeights = {
  covenantCoverage: 0.3,
  breachFreedom: 0.3,
  attestationCoverage: 0.2,
  canaryPassRate: 0.2,
};

/**
 * Known jurisdictions and their legal frameworks.
 * Use registerJurisdiction() to add custom entries.
 */
const jurisdictionRegistry: Record<string, JurisdictionInfo> = {
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

/** Read-only snapshot of the jurisdiction registry. */
export const JURISDICTIONS: Record<string, JurisdictionInfo> = jurisdictionRegistry;

/**
 * Register a custom jurisdiction. Throws if code is empty or info is incomplete.
 */
export function registerJurisdiction(code: string, info: JurisdictionInfo): void {
  if (!code || code.trim() === '') {
    throw new Error('Jurisdiction code must be a non-empty string');
  }
  if (!info.legalFramework || !info.complianceStandard || !Array.isArray(info.requiredFields)) {
    throw new Error('JurisdictionInfo must include legalFramework, complianceStandard, and requiredFields');
  }
  jurisdictionRegistry[code] = { ...info, requiredFields: [...info.requiredFields] };
}

/**
 * Compliance standard requirements.
 */
export const COMPLIANCE_STANDARDS: Record<ComplianceStandard, ComplianceStandardInfo> = {
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

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateNonEmpty(value: string, name: string): void {
  if (!value || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function validateComplianceRecord(record: ComplianceRecord): void {
  if (record.totalInteractions < 0) {
    throw new Error('totalInteractions must be non-negative');
  }
  if (record.covenantedInteractions < 0) {
    throw new Error('covenantedInteractions must be non-negative');
  }
  if (record.breaches < 0) {
    throw new Error('breaches must be non-negative');
  }
  if (record.canaryTests < 0) {
    throw new Error('canaryTests must be non-negative');
  }
  if (record.canaryPasses < 0) {
    throw new Error('canaryPasses must be non-negative');
  }
  if (record.attestationCoverage < 0 || record.attestationCoverage > 1) {
    throw new Error('attestationCoverage must be between 0 and 1');
  }
  if (record.covenantedInteractions > record.totalInteractions) {
    throw new Error('covenantedInteractions cannot exceed totalInteractions');
  }
  if (record.breaches > record.totalInteractions) {
    throw new Error('breaches cannot exceed totalInteractions');
  }
  if (record.canaryPasses > record.canaryTests) {
    throw new Error('canaryPasses cannot exceed canaryTests');
  }
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Creates a LegalIdentityPackage.
 * Validates agentId and operatorId are non-empty.
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
  validateNonEmpty(agentId, 'agentId');
  validateNonEmpty(operatorId, 'operatorId');

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
 * Custom jurisdictions can be added via registerJurisdiction().
 * Returns JurisdictionalMapping with legalFramework, requiredFields, complianceStandard, and mappedFields.
 */
export function mapToJurisdiction(
  pkg: LegalIdentityPackage,
  jurisdiction: string,
): JurisdictionalMapping {
  const jurisdictionInfo = jurisdictionRegistry[jurisdiction];

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
 * Validates the ComplianceRecord and uses configurable weights.
 * Returns { standard, passed, score, gaps, details }.
 */
export function generateComplianceReport(
  compliance: ComplianceRecord,
  standard: ComplianceStandard,
  weights: ComplianceWeights = DEFAULT_WEIGHTS,
): { standard: ComplianceStandard; passed: boolean; score: number; gaps: string[]; details: Record<string, number> } {
  validateComplianceRecord(compliance);

  const requirements = COMPLIANCE_STANDARDS[standard];
  const gaps: string[] = [];

  const covenantCoverage = compliance.totalInteractions > 0
    ? compliance.covenantedInteractions / compliance.totalInteractions
    : 0;
  const breachRate = compliance.totalInteractions > 0
    ? compliance.breaches / compliance.totalInteractions
    : 0;
  const canaryPassRate = compliance.canaryTests > 0
    ? compliance.canaryPasses / compliance.canaryTests
    : 0;

  const score =
    (covenantCoverage * weights.covenantCoverage) +
    ((1 - breachRate) * weights.breachFreedom) +
    (compliance.attestationCoverage * weights.attestationCoverage) +
    (canaryPassRate * weights.canaryPassRate);

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
    details: {
      covenantCoverage,
      breachRate,
      canaryPassRate,
      attestationCoverage: compliance.attestationCoverage,
    },
  };
}
