import { describe, it, expect } from 'vitest';
import {
  exportLegalPackage,
  mapToJurisdiction,
  generateComplianceReport,
  JURISDICTIONS,
  COMPLIANCE_STANDARDS,
} from './index';
import type {
  ComplianceRecord,
  CovenantRecord,
  ReputationSnapshot,
  AttestationRecord,
  InsuranceRecord,
  ComplianceStandard,
  LegalIdentityPackage,
} from './types';

// ---------------------------------------------------------------------------
// Helper data
// ---------------------------------------------------------------------------
const sampleCovenants: CovenantRecord[] = [
  { id: 'cov-1', constraints: ['speed lt 100 km/h'], signedAt: Date.now() - 86400000, status: 'active' },
  { id: 'cov-2', constraints: ['force lt 50 N'], signedAt: Date.now() - 43200000, status: 'expired' },
];

const sampleCompliance: ComplianceRecord = {
  totalInteractions: 1000,
  covenantedInteractions: 950,
  breaches: 5,
  canaryTests: 100,
  canaryPasses: 97,
  attestationCoverage: 0.92,
};

const sampleReputation: ReputationSnapshot = {
  score: 0.95,
  tier: 'gold',
  totalExecutions: 1000,
  successRate: 0.98,
  timestamp: Date.now(),
};

const sampleAttestations: AttestationRecord[] = [
  { id: 'att-1', counterpartyId: 'agent-2', match: true, timestamp: Date.now() - 3600000 },
  { id: 'att-2', counterpartyId: 'agent-3', match: true, timestamp: Date.now() - 1800000 },
];

const sampleInsurance: InsuranceRecord[] = [
  { id: 'ins-1', coverage: 10000, premium: 500, status: 'active' },
];

const sampleData = {
  covenants: sampleCovenants,
  compliance: sampleCompliance,
  reputation: sampleReputation,
  attestations: sampleAttestations,
  insurance: sampleInsurance,
};

// ---------------------------------------------------------------------------
// exportLegalPackage
// ---------------------------------------------------------------------------
describe('exportLegalPackage', () => {
  it('creates a LegalIdentityPackage with correct agentId and operatorId', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    expect(pkg.agentId).toBe('agent-1');
    expect(pkg.operatorId).toBe('operator-1');
  });

  it('includes all provided data fields', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    expect(pkg.covenantHistory).toEqual(sampleCovenants);
    expect(pkg.complianceRecord).toEqual(sampleCompliance);
    expect(pkg.reputationSnapshot).toEqual(sampleReputation);
    expect(pkg.attestations).toEqual(sampleAttestations);
    expect(pkg.insurancePolicies).toEqual(sampleInsurance);
  });

  it('defaults export format to json', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    expect(pkg.exportFormat).toBe('json');
  });

  it('accepts pdf format', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData, 'pdf');
    expect(pkg.exportFormat).toBe('pdf');
  });

  it('accepts legal-xml format', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData, 'legal-xml');
    expect(pkg.exportFormat).toBe('legal-xml');
  });

  it('generates a valid sha256 packageHash', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    expect(pkg.packageHash).toBeTruthy();
    expect(typeof pkg.packageHash).toBe('string');
    expect(pkg.packageHash.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(pkg.packageHash)).toBe(true);
  });

  it('sets exportedAt to a recent timestamp', () => {
    const before = Date.now();
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const after = Date.now();
    expect(pkg.exportedAt).toBeGreaterThanOrEqual(before);
    expect(pkg.exportedAt).toBeLessThanOrEqual(after);
  });

  it('produces different hashes for different agent ids', () => {
    const pkg1 = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const pkg2 = exportLegalPackage('agent-2', 'operator-1', sampleData);
    expect(pkg1.packageHash).not.toBe(pkg2.packageHash);
  });

  it('handles empty data arrays', () => {
    const emptyData = {
      covenants: [],
      compliance: sampleCompliance,
      reputation: sampleReputation,
      attestations: [],
      insurance: [],
    };
    const pkg = exportLegalPackage('agent-1', 'operator-1', emptyData);
    expect(pkg.covenantHistory).toEqual([]);
    expect(pkg.attestations).toEqual([]);
    expect(pkg.insurancePolicies).toEqual([]);
    expect(pkg.packageHash.length).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// mapToJurisdiction
// ---------------------------------------------------------------------------
describe('mapToJurisdiction', () => {
  let pkg: LegalIdentityPackage;

  // We need a stable package for testing
  it('setup: create a package for jurisdiction tests', () => {
    pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    expect(pkg).toBeDefined();
  });

  it('maps to US jurisdiction with SOC2 standard', () => {
    pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'US');
    expect(mapping.jurisdiction).toBe('US');
    expect(mapping.legalFramework).toBe('US Federal / State Law');
    expect(mapping.complianceStandard).toBe('SOC2');
    expect(mapping.requiredFields).toContain('agentId');
    expect(mapping.requiredFields).toContain('operatorId');
  });

  it('maps to EU jurisdiction with GDPR standard', () => {
    pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'EU');
    expect(mapping.jurisdiction).toBe('EU');
    expect(mapping.legalFramework).toBe('EU General Data Protection Regulation');
    expect(mapping.complianceStandard).toBe('GDPR');
    expect(mapping.requiredFields).toContain('reputationSnapshot');
  });

  it('maps to UK jurisdiction with UK-GDPR standard', () => {
    pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'UK');
    expect(mapping.jurisdiction).toBe('UK');
    expect(mapping.complianceStandard).toBe('UK-GDPR');
  });

  it('maps to JP jurisdiction with APPI standard', () => {
    pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'JP');
    expect(mapping.jurisdiction).toBe('JP');
    expect(mapping.legalFramework).toBe('Act on the Protection of Personal Information');
    expect(mapping.complianceStandard).toBe('APPI');
  });

  it('populates mappedFields with actual package data', () => {
    pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'US');
    expect(mapping.mappedFields['agentId']).toBe('agent-1');
    expect(mapping.mappedFields['operatorId']).toBe('operator-1');
    expect(mapping.mappedFields['complianceRecord']).toBeTruthy();
  });

  it('returns unknown for unrecognized jurisdiction', () => {
    pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'MARS');
    expect(mapping.jurisdiction).toBe('MARS');
    expect(mapping.legalFramework).toBe('Unknown');
    expect(mapping.complianceStandard).toBe('Unknown');
    expect(mapping.requiredFields).toEqual([]);
    expect(mapping.mappedFields).toEqual({});
  });

  it('EU mapping includes covenantHistory', () => {
    pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'EU');
    expect(mapping.requiredFields).toContain('covenantHistory');
    expect(mapping.mappedFields['covenantHistory']).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// generateComplianceReport
// ---------------------------------------------------------------------------
describe('generateComplianceReport', () => {
  it('passing SOC2 compliance returns passed = true with no gaps', () => {
    const goodCompliance: ComplianceRecord = {
      totalInteractions: 1000,
      covenantedInteractions: 980,
      breaches: 2,
      canaryTests: 100,
      canaryPasses: 98,
      attestationCoverage: 0.95,
    };
    const report = generateComplianceReport(goodCompliance, 'SOC2');
    expect(report.standard).toBe('SOC2');
    expect(report.passed).toBe(true);
    expect(report.gaps).toHaveLength(0);
    expect(report.score).toBeGreaterThan(0);
  });

  it('failing SOC2 compliance returns passed = false with gaps', () => {
    const poorCompliance: ComplianceRecord = {
      totalInteractions: 100,
      covenantedInteractions: 50,
      breaches: 20,
      canaryTests: 100,
      canaryPasses: 70,
      attestationCoverage: 0.5,
    };
    const report = generateComplianceReport(poorCompliance, 'SOC2');
    expect(report.passed).toBe(false);
    expect(report.gaps.length).toBeGreaterThan(0);
  });

  it('report includes correct standard name', () => {
    const report = generateComplianceReport(sampleCompliance, 'GDPR');
    expect(report.standard).toBe('GDPR');
  });

  it('score is between 0 and 1', () => {
    const report = generateComplianceReport(sampleCompliance, 'SOC2');
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(1);
  });

  it('identifies attestation coverage gap', () => {
    const lowAttestation: ComplianceRecord = {
      totalInteractions: 1000,
      covenantedInteractions: 950,
      breaches: 5,
      canaryTests: 100,
      canaryPasses: 99,
      attestationCoverage: 0.5,
    };
    const report = generateComplianceReport(lowAttestation, 'SOC2');
    expect(report.gaps.some(g => g.includes('Attestation coverage'))).toBe(true);
  });

  it('identifies canary pass rate gap', () => {
    const lowCanary: ComplianceRecord = {
      totalInteractions: 1000,
      covenantedInteractions: 950,
      breaches: 5,
      canaryTests: 100,
      canaryPasses: 80,
      attestationCoverage: 0.95,
    };
    const report = generateComplianceReport(lowCanary, 'SOC2');
    expect(report.gaps.some(g => g.includes('Canary pass rate'))).toBe(true);
  });

  it('identifies high breach rate gap', () => {
    const highBreach: ComplianceRecord = {
      totalInteractions: 100,
      covenantedInteractions: 90,
      breaches: 10,
      canaryTests: 100,
      canaryPasses: 99,
      attestationCoverage: 0.95,
    };
    const report = generateComplianceReport(highBreach, 'GDPR');
    expect(report.gaps.some(g => g.includes('Breach rate'))).toBe(true);
  });

  it('HIPAA has stricter requirements than CCPA', () => {
    expect(COMPLIANCE_STANDARDS['HIPAA'].requiredScore).toBeGreaterThan(COMPLIANCE_STANDARDS['CCPA'].requiredScore);
    expect(COMPLIANCE_STANDARDS['HIPAA'].requiredAttestationCoverage).toBeGreaterThan(COMPLIANCE_STANDARDS['CCPA'].requiredAttestationCoverage);
  });

  it('handles zero totalInteractions without error', () => {
    const zeroCompliance: ComplianceRecord = {
      totalInteractions: 0,
      covenantedInteractions: 0,
      breaches: 0,
      canaryTests: 0,
      canaryPasses: 0,
      attestationCoverage: 0,
    };
    const report = generateComplianceReport(zeroCompliance, 'SOC2');
    // With zero interactions: covenantCoverage=0, breachRate=0 (so 1-breachRate=1), attestation=0, canaryPass=0
    // score = (0*0.3) + (1*0.3) + (0*0.2) + (0*0.2) = 0.3
    expect(report.score).toBeCloseTo(0.3, 10);
    expect(report.passed).toBe(false);
  });

  it('generates different reports for different standards', () => {
    const report1 = generateComplianceReport(sampleCompliance, 'SOC2');
    const report2 = generateComplianceReport(sampleCompliance, 'HIPAA');
    expect(report1.standard).not.toBe(report2.standard);
    // HIPAA is stricter, so it may have more gaps
  });
});

// ---------------------------------------------------------------------------
// JURISDICTIONS
// ---------------------------------------------------------------------------
describe('JURISDICTIONS', () => {
  it('has entries for US, EU, UK, JP', () => {
    expect(JURISDICTIONS['US']).toBeDefined();
    expect(JURISDICTIONS['EU']).toBeDefined();
    expect(JURISDICTIONS['UK']).toBeDefined();
    expect(JURISDICTIONS['JP']).toBeDefined();
  });

  it('each jurisdiction has legalFramework, complianceStandard, and requiredFields', () => {
    for (const [key, value] of Object.entries(JURISDICTIONS)) {
      expect(value.legalFramework).toBeTruthy();
      expect(value.complianceStandard).toBeTruthy();
      expect(Array.isArray(value.requiredFields)).toBe(true);
      expect(value.requiredFields.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// COMPLIANCE_STANDARDS
// ---------------------------------------------------------------------------
describe('COMPLIANCE_STANDARDS', () => {
  it('has entries for all 5 standards', () => {
    const standards: ComplianceStandard[] = ['SOC2', 'ISO27001', 'GDPR', 'CCPA', 'HIPAA'];
    for (const std of standards) {
      expect(COMPLIANCE_STANDARDS[std]).toBeDefined();
      expect(COMPLIANCE_STANDARDS[std].requiredScore).toBeGreaterThan(0);
      expect(COMPLIANCE_STANDARDS[std].requiredAttestationCoverage).toBeGreaterThan(0);
      expect(COMPLIANCE_STANDARDS[std].requiredCanaryPassRate).toBeGreaterThan(0);
      expect(COMPLIANCE_STANDARDS[std].description).toBeTruthy();
    }
  });

  it('all required scores are between 0 and 1', () => {
    for (const std of Object.values(COMPLIANCE_STANDARDS)) {
      expect(std.requiredScore).toBeGreaterThanOrEqual(0);
      expect(std.requiredScore).toBeLessThanOrEqual(1);
    }
  });
});
