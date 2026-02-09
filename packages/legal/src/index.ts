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
  JurisdictionComplianceEntry,
  CrossJurisdictionResult,
  AuditTrailEntry,
  AuditTrailExport,
  RegulatoryGap,
  RegulatoryGapAnalysisResult,
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
  JurisdictionComplianceEntry,
  CrossJurisdictionResult,
  AuditTrailEntry,
  AuditTrailExport,
  RegulatoryGap,
  RegulatoryGapAnalysisResult,
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
  validateNonEmpty(jurisdiction, 'jurisdiction');

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

// ---------------------------------------------------------------------------
// crossJurisdictionCompliance
// ---------------------------------------------------------------------------

/**
 * Checks compliance across multiple jurisdictions simultaneously and
 * identifies conflicts between jurisdictional requirements.
 *
 * For each jurisdiction:
 * 1. Maps the package to the jurisdiction
 * 2. Checks which required fields are present
 * 3. If a known ComplianceStandard is found, runs a compliance report
 *
 * Conflicts are identified when jurisdictions have contradictory requirements
 * (e.g., one jurisdiction requires a field that another prohibits, or
 * different standards set conflicting thresholds).
 */
export function crossJurisdictionCompliance(
  pkg: LegalIdentityPackage,
  jurisdictions: string[],
  compliance: ComplianceRecord,
): CrossJurisdictionResult {
  if (!jurisdictions || jurisdictions.length === 0) {
    throw new Error('jurisdictions must be a non-empty array');
  }
  for (const j of jurisdictions) {
    validateNonEmpty(j, 'jurisdiction code');
  }
  validateComplianceRecord(compliance);

  const entries: JurisdictionComplianceEntry[] = [];
  const conflicts: string[] = [];
  const recommendations: string[] = [];

  // Track all required fields per jurisdiction for conflict detection
  const requiredFieldsByJurisdiction: Record<string, string[]> = {};
  const standardsByJurisdiction: Record<string, string> = {};

  for (const jurisdiction of jurisdictions) {
    const info = jurisdictionRegistry[jurisdiction];

    if (!info) {
      entries.push({
        jurisdiction,
        standard: 'Unknown',
        passed: false,
        score: 0,
        gaps: [`Jurisdiction "${jurisdiction}" is not registered`],
        missingFields: [],
      });
      continue;
    }

    requiredFieldsByJurisdiction[jurisdiction] = info.requiredFields;
    standardsByJurisdiction[jurisdiction] = info.complianceStandard;

    // Check which required fields are missing from the package
    const packageFields = new Set<string>();
    if (pkg.agentId) packageFields.add('agentId');
    if (pkg.operatorId) packageFields.add('operatorId');
    if (pkg.complianceRecord) packageFields.add('complianceRecord');
    if (pkg.covenantHistory && pkg.covenantHistory.length > 0) packageFields.add('covenantHistory');
    if (pkg.attestations && pkg.attestations.length > 0) packageFields.add('attestations');
    if (pkg.insurancePolicies && pkg.insurancePolicies.length > 0) packageFields.add('insurancePolicies');
    if (pkg.reputationSnapshot) packageFields.add('reputationSnapshot');

    const missingFields = info.requiredFields.filter(f => !packageFields.has(f));

    // Try to run compliance report if the standard is known
    const knownStandards = Object.keys(COMPLIANCE_STANDARDS) as ComplianceStandard[];
    const matchedStandard = knownStandards.find(s => s === info.complianceStandard);

    let passed = false;
    let score = 0;
    const gaps: string[] = [];

    if (matchedStandard) {
      const report = generateComplianceReport(compliance, matchedStandard);
      passed = report.passed && missingFields.length === 0;
      score = report.score;
      gaps.push(...report.gaps);
    } else {
      gaps.push(`No compliance standard "${info.complianceStandard}" is registered for scoring`);
    }

    if (missingFields.length > 0) {
      gaps.push(`Missing required fields: ${missingFields.join(', ')}`);
      passed = false;
    }

    entries.push({
      jurisdiction,
      standard: info.complianceStandard,
      passed,
      score,
      gaps,
      missingFields,
    });
  }

  // Detect conflicts between jurisdictions
  const jurisdictionPairs: Array<[string, string]> = [];
  for (let i = 0; i < jurisdictions.length; i++) {
    for (let j = i + 1; j < jurisdictions.length; j++) {
      jurisdictionPairs.push([jurisdictions[i], jurisdictions[j]]);
    }
  }

  for (const [jA, jB] of jurisdictionPairs) {
    const fieldsA = requiredFieldsByJurisdiction[jA];
    const fieldsB = requiredFieldsByJurisdiction[jB];
    if (!fieldsA || !fieldsB) continue;

    // Conflict: one jurisdiction requires a field the other does not
    // This is informational -- not a hard conflict, but worth noting
    const onlyInA = fieldsA.filter(f => !fieldsB.includes(f));
    const onlyInB = fieldsB.filter(f => !fieldsA.includes(f));

    if (onlyInA.length > 0 && onlyInB.length > 0) {
      conflicts.push(
        `${jA} and ${jB} have differing field requirements: ${jA} uniquely requires [${onlyInA.join(', ')}], ${jB} uniquely requires [${onlyInB.join(', ')}]`,
      );
    }

    // Conflict: different compliance standards with different thresholds
    const stdA = standardsByJurisdiction[jA];
    const stdB = standardsByJurisdiction[jB];
    if (stdA && stdB && stdA !== stdB) {
      const knownA = COMPLIANCE_STANDARDS[stdA as ComplianceStandard];
      const knownB = COMPLIANCE_STANDARDS[stdB as ComplianceStandard];
      if (knownA && knownB && knownA.requiredScore !== knownB.requiredScore) {
        conflicts.push(
          `${jA} (${stdA}) requires score >= ${knownA.requiredScore} while ${jB} (${stdB}) requires >= ${knownB.requiredScore}`,
        );
      }
    }
  }

  // Generate recommendations
  const failingJurisdictions = entries.filter(e => !e.passed);
  if (failingJurisdictions.length > 0) {
    recommendations.push(
      `Address compliance gaps in: ${failingJurisdictions.map(e => e.jurisdiction).join(', ')}`,
    );
  }

  const allMissingFields = new Set<string>();
  for (const entry of entries) {
    for (const f of entry.missingFields) {
      allMissingFields.add(f);
    }
  }
  if (allMissingFields.size > 0) {
    recommendations.push(
      `Provide missing data fields: ${[...allMissingFields].join(', ')}`,
    );
  }

  if (conflicts.length > 0) {
    recommendations.push(
      'Review jurisdictional conflicts and consider meeting the strictest requirements across all jurisdictions',
    );
  }

  const overallCompliant = entries.every(e => e.passed);

  return {
    overallCompliant,
    jurisdictions: entries,
    conflicts,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// auditTrailExport
// ---------------------------------------------------------------------------

/**
 * Generates a chronological audit trail from a LegalIdentityPackage.
 *
 * Combines events from:
 * - Covenant history (signed, expired, revoked events)
 * - Attestation records
 * - Compliance record (breach and canary test summary events)
 * - Insurance records (coverage changes)
 *
 * All entries are sorted by timestamp (ascending) and include a summary
 * with event counts and time range.
 */
export function auditTrailExport(
  pkg: LegalIdentityPackage,
): AuditTrailExport {
  validateNonEmpty(pkg.agentId, 'agentId');

  const entries: AuditTrailEntry[] = [];

  // Covenant events
  for (const covenant of pkg.covenantHistory) {
    const eventType = covenant.status === 'active'
      ? 'covenant-signed' as const
      : covenant.status === 'expired'
        ? 'covenant-expired' as const
        : 'covenant-revoked' as const;

    entries.push({
      timestamp: covenant.signedAt,
      eventType,
      description: `Covenant ${covenant.id} ${eventType.replace('covenant-', '')}: [${covenant.constraints.join('; ')}]`,
      sourceId: covenant.id,
      metadata: {
        constraints: covenant.constraints,
        status: covenant.status,
      },
    });
  }

  // Attestation events
  for (const attestation of pkg.attestations) {
    entries.push({
      timestamp: attestation.timestamp,
      eventType: 'attestation',
      description: `Attestation ${attestation.id} with ${attestation.counterpartyId}: ${attestation.match ? 'matched' : 'mismatched'}`,
      sourceId: attestation.id,
      metadata: {
        counterpartyId: attestation.counterpartyId,
        match: attestation.match,
      },
    });
  }

  // Compliance summary events (single aggregated entry)
  if (pkg.complianceRecord.totalInteractions > 0) {
    if (pkg.complianceRecord.breaches > 0) {
      entries.push({
        timestamp: pkg.exportedAt,
        eventType: 'breach',
        description: `${pkg.complianceRecord.breaches} breach(es) recorded across ${pkg.complianceRecord.totalInteractions} total interactions`,
        sourceId: pkg.agentId,
        metadata: {
          breaches: pkg.complianceRecord.breaches,
          totalInteractions: pkg.complianceRecord.totalInteractions,
          breachRate: pkg.complianceRecord.breaches / pkg.complianceRecord.totalInteractions,
        },
      });
    }

    if (pkg.complianceRecord.canaryTests > 0) {
      entries.push({
        timestamp: pkg.exportedAt,
        eventType: 'canary-test',
        description: `Canary testing: ${pkg.complianceRecord.canaryPasses}/${pkg.complianceRecord.canaryTests} passed (${((pkg.complianceRecord.canaryPasses / pkg.complianceRecord.canaryTests) * 100).toFixed(1)}%)`,
        sourceId: pkg.agentId,
        metadata: {
          canaryTests: pkg.complianceRecord.canaryTests,
          canaryPasses: pkg.complianceRecord.canaryPasses,
          passRate: pkg.complianceRecord.canaryPasses / pkg.complianceRecord.canaryTests,
        },
      });
    }
  }

  // Insurance events
  for (const insurance of pkg.insurancePolicies) {
    entries.push({
      timestamp: pkg.exportedAt,
      eventType: 'insurance-change',
      description: `Insurance policy ${insurance.id}: coverage ${insurance.coverage}, premium ${insurance.premium}, status ${insurance.status}`,
      sourceId: insurance.id,
      metadata: {
        coverage: insurance.coverage,
        premium: insurance.premium,
        status: insurance.status,
      },
    });
  }

  // Sort chronologically
  entries.sort((a, b) => a.timestamp - b.timestamp);

  // Build summary
  const eventCounts: Record<string, number> = {};
  for (const entry of entries) {
    eventCounts[entry.eventType] = (eventCounts[entry.eventType] ?? 0) + 1;
  }

  const timestamps = entries.map(e => e.timestamp);
  const timeRange = entries.length > 0
    ? { start: Math.min(...timestamps), end: Math.max(...timestamps) }
    : { start: 0, end: 0 };

  return {
    agentId: pkg.agentId,
    generatedAt: Date.now(),
    entries,
    summary: {
      totalEvents: entries.length,
      timeRange,
      eventCounts,
    },
  };
}

// ---------------------------------------------------------------------------
// regulatoryGapAnalysis
// ---------------------------------------------------------------------------

/**
 * Identifies gaps between the current compliance state and a target
 * regulatory standard.
 *
 * Evaluates:
 * - Overall compliance score vs. required score
 * - Attestation coverage vs. required coverage
 * - Canary pass rate vs. required pass rate
 * - Breach rate vs. maximum threshold
 * - Covenant coverage adequacy
 *
 * Returns a detailed gap analysis with severity ratings, remediation
 * suggestions, and an estimated effort level.
 */
export function regulatoryGapAnalysis(
  compliance: ComplianceRecord,
  targetStandard: ComplianceStandard,
  weights: ComplianceWeights = DEFAULT_WEIGHTS,
): RegulatoryGapAnalysisResult {
  validateComplianceRecord(compliance);

  const requirements = COMPLIANCE_STANDARDS[targetStandard];
  if (!requirements) {
    throw new Error(`Unknown compliance standard: "${targetStandard}"`);
  }

  const report = generateComplianceReport(compliance, targetStandard, weights);

  const gaps: RegulatoryGap[] = [];

  // 1. Overall score gap
  if (report.score < requirements.requiredScore) {
    const deficit = requirements.requiredScore - report.score;
    const severity: RegulatoryGap['severity'] = deficit > 0.2 ? 'critical' : deficit > 0.1 ? 'major' : 'minor';
    gaps.push({
      area: 'Overall Compliance Score',
      currentState: `Score: ${report.score.toFixed(3)}`,
      requiredState: `Score >= ${requirements.requiredScore}`,
      severity,
      remediation: `Improve overall compliance by ${(deficit * 100).toFixed(1)} percentage points. Focus on weakest contributing factors.`,
    });
  }

  // 2. Attestation coverage gap
  if (compliance.attestationCoverage < requirements.requiredAttestationCoverage) {
    const deficit = requirements.requiredAttestationCoverage - compliance.attestationCoverage;
    const severity: RegulatoryGap['severity'] = deficit > 0.2 ? 'critical' : deficit > 0.1 ? 'major' : 'minor';
    gaps.push({
      area: 'Attestation Coverage',
      currentState: `Coverage: ${(compliance.attestationCoverage * 100).toFixed(1)}%`,
      requiredState: `Coverage >= ${(requirements.requiredAttestationCoverage * 100).toFixed(1)}%`,
      severity,
      remediation: `Increase attestation coverage by ${(deficit * 100).toFixed(1)} percentage points. Add attestation to ${Math.ceil(deficit * (compliance.totalInteractions || 100))} more interactions.`,
    });
  }

  // 3. Canary pass rate gap
  const canaryPassRate = compliance.canaryTests > 0
    ? compliance.canaryPasses / compliance.canaryTests
    : 0;
  if (canaryPassRate < requirements.requiredCanaryPassRate) {
    const deficit = requirements.requiredCanaryPassRate - canaryPassRate;
    const severity: RegulatoryGap['severity'] = deficit > 0.15 ? 'critical' : deficit > 0.05 ? 'major' : 'minor';
    gaps.push({
      area: 'Canary Test Pass Rate',
      currentState: `Pass rate: ${(canaryPassRate * 100).toFixed(1)}%`,
      requiredState: `Pass rate >= ${(requirements.requiredCanaryPassRate * 100).toFixed(1)}%`,
      severity,
      remediation: `Improve canary test pass rate by ${(deficit * 100).toFixed(1)} percentage points. Investigate and fix ${compliance.canaryTests - compliance.canaryPasses} failing canary tests.`,
    });
  }

  // 4. Breach rate gap
  const breachRate = compliance.totalInteractions > 0
    ? compliance.breaches / compliance.totalInteractions
    : 0;
  if (breachRate > 0.05) {
    const severity: RegulatoryGap['severity'] = breachRate > 0.15 ? 'critical' : breachRate > 0.1 ? 'major' : 'minor';
    gaps.push({
      area: 'Breach Rate',
      currentState: `Breach rate: ${(breachRate * 100).toFixed(1)}%`,
      requiredState: 'Breach rate <= 5.0%',
      severity,
      remediation: `Reduce breach rate by ${((breachRate - 0.05) * 100).toFixed(1)} percentage points. Implement additional safeguards and constraint enforcement.`,
    });
  }

  // 5. Covenant coverage gap
  const covenantCoverage = compliance.totalInteractions > 0
    ? compliance.covenantedInteractions / compliance.totalInteractions
    : 0;
  if (covenantCoverage < 0.9) {
    const deficit = 0.9 - covenantCoverage;
    const severity: RegulatoryGap['severity'] = deficit > 0.3 ? 'critical' : deficit > 0.15 ? 'major' : 'minor';
    gaps.push({
      area: 'Covenant Coverage',
      currentState: `Coverage: ${(covenantCoverage * 100).toFixed(1)}%`,
      requiredState: 'Coverage >= 90.0%',
      severity,
      remediation: `Add covenants to ${Math.ceil(deficit * compliance.totalInteractions)} more interactions to reach 90% coverage.`,
    });
  }

  // Calculate readiness percentage
  const totalChecks = 5;
  const passedChecks = totalChecks - gaps.length;
  const readinessPercentage = (passedChecks / totalChecks) * 100;

  const criticalGapCount = gaps.filter(g => g.severity === 'critical').length;

  // Estimate remediation effort
  let estimatedRemediationEffort: RegulatoryGapAnalysisResult['estimatedRemediationEffort'];
  if (criticalGapCount >= 2 || gaps.length >= 4) {
    estimatedRemediationEffort = 'high';
  } else if (criticalGapCount >= 1 || gaps.length >= 2) {
    estimatedRemediationEffort = 'medium';
  } else {
    estimatedRemediationEffort = 'low';
  }

  return {
    targetStandard,
    currentScore: report.score,
    requiredScore: requirements.requiredScore,
    gaps,
    readinessPercentage,
    criticalGapCount,
    estimatedRemediationEffort,
  };
}
