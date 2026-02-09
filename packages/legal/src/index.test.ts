import { describe, it, expect } from 'vitest';
import {
  exportLegalPackage,
  mapToJurisdiction,
  generateComplianceReport,
  registerJurisdiction,
  crossJurisdictionCompliance,
  auditTrailExport,
  regulatoryGapAnalysis,
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
import type { ComplianceWeights } from './index';

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

  it('throws for empty agentId', () => {
    expect(() => exportLegalPackage('', 'operator-1', sampleData)).toThrow('agentId must be a non-empty string');
  });

  it('throws for whitespace-only agentId', () => {
    expect(() => exportLegalPackage('  ', 'operator-1', sampleData)).toThrow('agentId must be a non-empty string');
  });

  it('throws for empty operatorId', () => {
    expect(() => exportLegalPackage('agent-1', '', sampleData)).toThrow('operatorId must be a non-empty string');
  });
});

// ---------------------------------------------------------------------------
// mapToJurisdiction
// ---------------------------------------------------------------------------
describe('mapToJurisdiction', () => {
  it('maps to US jurisdiction with SOC2 standard', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'US');
    expect(mapping.jurisdiction).toBe('US');
    expect(mapping.legalFramework).toBe('US Federal / State Law');
    expect(mapping.complianceStandard).toBe('SOC2');
    expect(mapping.requiredFields).toContain('agentId');
    expect(mapping.requiredFields).toContain('operatorId');
  });

  it('maps to EU jurisdiction with GDPR standard', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'EU');
    expect(mapping.jurisdiction).toBe('EU');
    expect(mapping.legalFramework).toBe('EU General Data Protection Regulation');
    expect(mapping.complianceStandard).toBe('GDPR');
    expect(mapping.requiredFields).toContain('reputationSnapshot');
  });

  it('maps to UK jurisdiction with UK-GDPR standard', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'UK');
    expect(mapping.jurisdiction).toBe('UK');
    expect(mapping.complianceStandard).toBe('UK-GDPR');
  });

  it('maps to JP jurisdiction with APPI standard', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'JP');
    expect(mapping.jurisdiction).toBe('JP');
    expect(mapping.legalFramework).toBe('Act on the Protection of Personal Information');
    expect(mapping.complianceStandard).toBe('APPI');
  });

  it('populates mappedFields with actual package data', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'US');
    expect(mapping.mappedFields['agentId']).toBe('agent-1');
    expect(mapping.mappedFields['operatorId']).toBe('operator-1');
    expect(mapping.mappedFields['complianceRecord']).toBeTruthy();
  });

  it('returns unknown for unrecognized jurisdiction', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'MARS');
    expect(mapping.jurisdiction).toBe('MARS');
    expect(mapping.legalFramework).toBe('Unknown');
    expect(mapping.complianceStandard).toBe('Unknown');
    expect(mapping.requiredFields).toEqual([]);
    expect(mapping.mappedFields).toEqual({});
  });

  it('EU mapping includes covenantHistory', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'EU');
    expect(mapping.requiredFields).toContain('covenantHistory');
    expect(mapping.mappedFields['covenantHistory']).toBeTruthy();
  });

  it('throws for empty jurisdiction string', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    expect(() => mapToJurisdiction(pkg, '')).toThrow('jurisdiction must be a non-empty string');
  });

  it('throws for whitespace-only jurisdiction string', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    expect(() => mapToJurisdiction(pkg, '   ')).toThrow('jurisdiction must be a non-empty string');
  });
});

// ---------------------------------------------------------------------------
// registerJurisdiction
// ---------------------------------------------------------------------------
describe('registerJurisdiction', () => {
  it('adds a custom jurisdiction accessible via JURISDICTIONS', () => {
    registerJurisdiction('SG', {
      legalFramework: 'Singapore Personal Data Protection Act',
      complianceStandard: 'PDPA',
      requiredFields: ['agentId', 'operatorId', 'complianceRecord'],
    });
    expect(JURISDICTIONS['SG']).toBeDefined();
    expect(JURISDICTIONS['SG']!.complianceStandard).toBe('PDPA');
  });

  it('custom jurisdiction works with mapToJurisdiction', () => {
    registerJurisdiction('AU', {
      legalFramework: 'Australian Privacy Act 1988',
      complianceStandard: 'APPs',
      requiredFields: ['agentId', 'operatorId'],
    });
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const mapping = mapToJurisdiction(pkg, 'AU');
    expect(mapping.legalFramework).toBe('Australian Privacy Act 1988');
    expect(mapping.complianceStandard).toBe('APPs');
    expect(mapping.mappedFields['agentId']).toBe('agent-1');
  });

  it('throws for empty jurisdiction code', () => {
    expect(() => registerJurisdiction('', {
      legalFramework: 'Test',
      complianceStandard: 'Test',
      requiredFields: [],
    })).toThrow('Jurisdiction code must be a non-empty string');
  });

  it('throws for incomplete jurisdiction info', () => {
    expect(() => registerJurisdiction('XX', {
      legalFramework: '',
      complianceStandard: 'Test',
      requiredFields: [],
    })).toThrow('JurisdictionInfo must include');
  });

  it('copies requiredFields to prevent external mutation', () => {
    const fields = ['agentId'];
    registerJurisdiction('BR', {
      legalFramework: 'LGPD',
      complianceStandard: 'LGPD',
      requiredFields: fields,
    });
    fields.push('mutated');
    expect(JURISDICTIONS['BR']!.requiredFields).toEqual(['agentId']);
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
  });

  it('includes details breakdown in report', () => {
    const report = generateComplianceReport(sampleCompliance, 'SOC2');
    expect(report.details).toBeDefined();
    expect(report.details.covenantCoverage).toBeCloseTo(0.95);
    expect(report.details.breachRate).toBeCloseTo(0.005);
    expect(report.details.canaryPassRate).toBeCloseTo(0.97);
    expect(report.details.attestationCoverage).toBeCloseTo(0.92);
  });

  it('accepts custom compliance weights', () => {
    const customWeights: ComplianceWeights = {
      covenantCoverage: 0.5,
      breachFreedom: 0.2,
      attestationCoverage: 0.2,
      canaryPassRate: 0.1,
    };
    const defaultReport = generateComplianceReport(sampleCompliance, 'SOC2');
    const customReport = generateComplianceReport(sampleCompliance, 'SOC2', customWeights);
    // Different weights should produce different scores
    expect(customReport.score).not.toBeCloseTo(defaultReport.score, 10);
  });

  it('throws for negative totalInteractions', () => {
    const bad: ComplianceRecord = { ...sampleCompliance, totalInteractions: -1 };
    expect(() => generateComplianceReport(bad, 'SOC2')).toThrow('totalInteractions must be non-negative');
  });

  it('throws for negative breaches', () => {
    const bad: ComplianceRecord = { ...sampleCompliance, breaches: -1 };
    expect(() => generateComplianceReport(bad, 'SOC2')).toThrow('breaches must be non-negative');
  });

  it('throws for attestationCoverage > 1', () => {
    const bad: ComplianceRecord = { ...sampleCompliance, attestationCoverage: 1.5 };
    expect(() => generateComplianceReport(bad, 'SOC2')).toThrow('attestationCoverage must be between 0 and 1');
  });

  it('throws for attestationCoverage < 0', () => {
    const bad: ComplianceRecord = { ...sampleCompliance, attestationCoverage: -0.1 };
    expect(() => generateComplianceReport(bad, 'SOC2')).toThrow('attestationCoverage must be between 0 and 1');
  });

  it('throws for covenantedInteractions > totalInteractions', () => {
    const bad: ComplianceRecord = { ...sampleCompliance, covenantedInteractions: 2000 };
    expect(() => generateComplianceReport(bad, 'SOC2')).toThrow('covenantedInteractions cannot exceed totalInteractions');
  });

  it('throws for canaryPasses > canaryTests', () => {
    const bad: ComplianceRecord = { ...sampleCompliance, canaryPasses: 200, canaryTests: 100 };
    expect(() => generateComplianceReport(bad, 'SOC2')).toThrow('canaryPasses cannot exceed canaryTests');
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
      if (['US', 'EU', 'UK', 'JP'].includes(key)) {
        expect(value.legalFramework).toBeTruthy();
        expect(value.complianceStandard).toBeTruthy();
        expect(Array.isArray(value.requiredFields)).toBe(true);
        expect(value.requiredFields.length).toBeGreaterThan(0);
      }
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

// ---------------------------------------------------------------------------
// crossJurisdictionCompliance
// ---------------------------------------------------------------------------
describe('crossJurisdictionCompliance', () => {
  it('reports overall compliance when all jurisdictions pass', () => {
    const goodCompliance: ComplianceRecord = {
      totalInteractions: 1000,
      covenantedInteractions: 980,
      breaches: 2,
      canaryTests: 100,
      canaryPasses: 98,
      attestationCoverage: 0.95,
    };
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const result = crossJurisdictionCompliance(pkg, ['US'], goodCompliance);
    expect(result.overallCompliant).toBe(true);
    expect(result.jurisdictions).toHaveLength(1);
    expect(result.jurisdictions[0].jurisdiction).toBe('US');
    expect(result.jurisdictions[0].passed).toBe(true);
  });

  it('reports non-compliance when at least one jurisdiction fails', () => {
    const poorCompliance: ComplianceRecord = {
      totalInteractions: 100,
      covenantedInteractions: 50,
      breaches: 20,
      canaryTests: 100,
      canaryPasses: 70,
      attestationCoverage: 0.5,
    };
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const result = crossJurisdictionCompliance(pkg, ['US', 'EU'], poorCompliance);
    expect(result.overallCompliant).toBe(false);
  });

  it('identifies conflicts between US and EU jurisdictions', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const result = crossJurisdictionCompliance(pkg, ['US', 'EU'], sampleCompliance);
    // US and EU have different required fields and different standards
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('detects differing compliance standard thresholds', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const result = crossJurisdictionCompliance(pkg, ['US', 'EU'], sampleCompliance);
    const thresholdConflict = result.conflicts.find(c => c.includes('requires score'));
    expect(thresholdConflict).toBeDefined();
  });

  it('flags unknown jurisdictions with appropriate gaps', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const result = crossJurisdictionCompliance(pkg, ['MARS'], sampleCompliance);
    expect(result.overallCompliant).toBe(false);
    expect(result.jurisdictions[0].gaps).toContain('Jurisdiction "MARS" is not registered');
  });

  it('generates recommendations for failing jurisdictions', () => {
    const poorCompliance: ComplianceRecord = {
      totalInteractions: 100,
      covenantedInteractions: 50,
      breaches: 20,
      canaryTests: 100,
      canaryPasses: 70,
      attestationCoverage: 0.5,
    };
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const result = crossJurisdictionCompliance(pkg, ['US'], poorCompliance);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations.some(r => r.includes('Address compliance gaps'))).toBe(true);
  });

  it('handles unregistered compliance standard gracefully (UK-GDPR)', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const result = crossJurisdictionCompliance(pkg, ['UK'], sampleCompliance);
    // UK uses UK-GDPR which is not in COMPLIANCE_STANDARDS, so it should report a gap
    const ukEntry = result.jurisdictions.find(j => j.jurisdiction === 'UK');
    expect(ukEntry).toBeDefined();
    expect(ukEntry!.gaps.some(g => g.includes('UK-GDPR'))).toBe(true);
  });

  it('throws for empty jurisdictions array', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    expect(() => crossJurisdictionCompliance(pkg, [], sampleCompliance)).toThrow('jurisdictions must be a non-empty array');
  });

  it('throws for empty jurisdiction code in array', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    expect(() => crossJurisdictionCompliance(pkg, ['US', ''], sampleCompliance)).toThrow('jurisdiction code must be a non-empty string');
  });

  it('validates compliance record', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const bad: ComplianceRecord = { ...sampleCompliance, totalInteractions: -1 };
    expect(() => crossJurisdictionCompliance(pkg, ['US'], bad)).toThrow('totalInteractions must be non-negative');
  });

  it('detects missing fields for package without attestations', () => {
    const noAttestationsData = {
      covenants: sampleCovenants,
      compliance: sampleCompliance,
      reputation: sampleReputation,
      attestations: [] as AttestationRecord[],
      insurance: sampleInsurance,
    };
    const pkg = exportLegalPackage('agent-1', 'operator-1', noAttestationsData);
    const result = crossJurisdictionCompliance(pkg, ['US'], sampleCompliance);
    // US requires attestations
    const usEntry = result.jurisdictions.find(j => j.jurisdiction === 'US');
    expect(usEntry!.missingFields).toContain('attestations');
  });

  it('recommends providing missing data fields', () => {
    const noAttestationsData = {
      covenants: sampleCovenants,
      compliance: sampleCompliance,
      reputation: sampleReputation,
      attestations: [] as AttestationRecord[],
      insurance: sampleInsurance,
    };
    const pkg = exportLegalPackage('agent-1', 'operator-1', noAttestationsData);
    const result = crossJurisdictionCompliance(pkg, ['US'], sampleCompliance);
    expect(result.recommendations.some(r => r.includes('missing data fields'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// auditTrailExport
// ---------------------------------------------------------------------------
describe('auditTrailExport', () => {
  it('generates audit trail with correct agentId', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const trail = auditTrailExport(pkg);
    expect(trail.agentId).toBe('agent-1');
  });

  it('includes covenant events in audit trail', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const trail = auditTrailExport(pkg);
    const covenantEvents = trail.entries.filter(e => e.eventType.startsWith('covenant-'));
    expect(covenantEvents.length).toBe(2); // active + expired
  });

  it('marks active covenants as covenant-signed', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const trail = auditTrailExport(pkg);
    const signed = trail.entries.find(e => e.eventType === 'covenant-signed');
    expect(signed).toBeDefined();
    expect(signed!.sourceId).toBe('cov-1');
  });

  it('marks expired covenants as covenant-expired', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const trail = auditTrailExport(pkg);
    const expired = trail.entries.find(e => e.eventType === 'covenant-expired');
    expect(expired).toBeDefined();
    expect(expired!.sourceId).toBe('cov-2');
  });

  it('includes attestation events', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const trail = auditTrailExport(pkg);
    const attestationEvents = trail.entries.filter(e => e.eventType === 'attestation');
    expect(attestationEvents.length).toBe(2);
  });

  it('includes breach summary event when breaches > 0', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const trail = auditTrailExport(pkg);
    const breach = trail.entries.find(e => e.eventType === 'breach');
    expect(breach).toBeDefined();
    expect(breach!.description).toContain('5 breach(es)');
  });

  it('includes canary test summary event', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const trail = auditTrailExport(pkg);
    const canary = trail.entries.find(e => e.eventType === 'canary-test');
    expect(canary).toBeDefined();
    expect(canary!.description).toContain('97/100');
  });

  it('includes insurance events', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const trail = auditTrailExport(pkg);
    const insurance = trail.entries.find(e => e.eventType === 'insurance-change');
    expect(insurance).toBeDefined();
    expect(insurance!.sourceId).toBe('ins-1');
  });

  it('sorts entries chronologically (ascending)', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const trail = auditTrailExport(pkg);
    for (let i = 1; i < trail.entries.length; i++) {
      expect(trail.entries[i].timestamp).toBeGreaterThanOrEqual(trail.entries[i - 1].timestamp);
    }
  });

  it('summary includes correct total event count', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const trail = auditTrailExport(pkg);
    expect(trail.summary.totalEvents).toBe(trail.entries.length);
  });

  it('summary includes time range', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const trail = auditTrailExport(pkg);
    expect(trail.summary.timeRange.start).toBeLessThanOrEqual(trail.summary.timeRange.end);
  });

  it('summary includes event counts by type', () => {
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const trail = auditTrailExport(pkg);
    expect(trail.summary.eventCounts['attestation']).toBe(2);
  });

  it('handles empty data arrays gracefully', () => {
    const emptyData = {
      covenants: [] as CovenantRecord[],
      compliance: { totalInteractions: 0, covenantedInteractions: 0, breaches: 0, canaryTests: 0, canaryPasses: 0, attestationCoverage: 0 },
      reputation: sampleReputation,
      attestations: [] as AttestationRecord[],
      insurance: [] as InsuranceRecord[],
    };
    const pkg = exportLegalPackage('agent-1', 'operator-1', emptyData);
    const trail = auditTrailExport(pkg);
    expect(trail.entries).toHaveLength(0);
    expect(trail.summary.totalEvents).toBe(0);
    expect(trail.summary.timeRange.start).toBe(0);
    expect(trail.summary.timeRange.end).toBe(0);
  });

  it('handles revoked covenants', () => {
    const revokedData = {
      covenants: [{ id: 'cov-r', constraints: ['test'], signedAt: 1000, status: 'revoked' as const }],
      compliance: sampleCompliance,
      reputation: sampleReputation,
      attestations: [] as AttestationRecord[],
      insurance: [] as InsuranceRecord[],
    };
    const pkg = exportLegalPackage('agent-1', 'operator-1', revokedData);
    const trail = auditTrailExport(pkg);
    const revoked = trail.entries.find(e => e.eventType === 'covenant-revoked');
    expect(revoked).toBeDefined();
  });

  it('generatedAt is a recent timestamp', () => {
    const before = Date.now();
    const pkg = exportLegalPackage('agent-1', 'operator-1', sampleData);
    const trail = auditTrailExport(pkg);
    const after = Date.now();
    expect(trail.generatedAt).toBeGreaterThanOrEqual(before);
    expect(trail.generatedAt).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// regulatoryGapAnalysis
// ---------------------------------------------------------------------------
describe('regulatoryGapAnalysis', () => {
  it('returns no gaps for fully compliant record against CCPA', () => {
    const good: ComplianceRecord = {
      totalInteractions: 1000,
      covenantedInteractions: 950,
      breaches: 2,
      canaryTests: 100,
      canaryPasses: 98,
      attestationCoverage: 0.95,
    };
    const result = regulatoryGapAnalysis(good, 'CCPA');
    expect(result.gaps).toHaveLength(0);
    expect(result.readinessPercentage).toBe(100);
    expect(result.criticalGapCount).toBe(0);
    expect(result.estimatedRemediationEffort).toBe('low');
  });

  it('identifies all 5 gap areas for severely non-compliant record', () => {
    const terrible: ComplianceRecord = {
      totalInteractions: 100,
      covenantedInteractions: 10,
      breaches: 30,
      canaryTests: 100,
      canaryPasses: 50,
      attestationCoverage: 0.1,
    };
    const result = regulatoryGapAnalysis(terrible, 'HIPAA');
    expect(result.gaps.length).toBe(5);
    expect(result.readinessPercentage).toBe(0);
    expect(result.estimatedRemediationEffort).toBe('high');
  });

  it('identifies attestation coverage gap', () => {
    const lowAttestation: ComplianceRecord = {
      totalInteractions: 1000,
      covenantedInteractions: 950,
      breaches: 2,
      canaryTests: 100,
      canaryPasses: 99,
      attestationCoverage: 0.5,
    };
    const result = regulatoryGapAnalysis(lowAttestation, 'SOC2');
    const attestationGap = result.gaps.find(g => g.area === 'Attestation Coverage');
    expect(attestationGap).toBeDefined();
    expect(attestationGap!.severity).toBe('critical');
    expect(attestationGap!.remediation).toContain('Increase attestation coverage');
  });

  it('identifies breach rate gap', () => {
    const highBreach: ComplianceRecord = {
      totalInteractions: 100,
      covenantedInteractions: 90,
      breaches: 12,
      canaryTests: 100,
      canaryPasses: 99,
      attestationCoverage: 0.95,
    };
    const result = regulatoryGapAnalysis(highBreach, 'GDPR');
    const breachGap = result.gaps.find(g => g.area === 'Breach Rate');
    expect(breachGap).toBeDefined();
    expect(breachGap!.severity).toBe('major');
  });

  it('identifies canary pass rate gap', () => {
    const lowCanary: ComplianceRecord = {
      totalInteractions: 1000,
      covenantedInteractions: 950,
      breaches: 5,
      canaryTests: 100,
      canaryPasses: 60,
      attestationCoverage: 0.95,
    };
    const result = regulatoryGapAnalysis(lowCanary, 'HIPAA');
    const canaryGap = result.gaps.find(g => g.area === 'Canary Test Pass Rate');
    expect(canaryGap).toBeDefined();
    expect(canaryGap!.severity).toBe('critical');
  });

  it('identifies covenant coverage gap', () => {
    const lowCovenant: ComplianceRecord = {
      totalInteractions: 1000,
      covenantedInteractions: 500,
      breaches: 5,
      canaryTests: 100,
      canaryPasses: 99,
      attestationCoverage: 0.95,
    };
    const result = regulatoryGapAnalysis(lowCovenant, 'SOC2');
    const covenantGap = result.gaps.find(g => g.area === 'Covenant Coverage');
    expect(covenantGap).toBeDefined();
    expect(covenantGap!.severity).toBe('critical');
    expect(covenantGap!.remediation).toContain('Add covenants to');
  });

  it('returns correct targetStandard and score', () => {
    const result = regulatoryGapAnalysis(sampleCompliance, 'SOC2');
    expect(result.targetStandard).toBe('SOC2');
    expect(result.currentScore).toBeGreaterThan(0);
    expect(result.requiredScore).toBe(0.8);
  });

  it('estimates medium remediation effort for 2 gaps', () => {
    const mediumCompliance: ComplianceRecord = {
      totalInteractions: 1000,
      covenantedInteractions: 950,
      breaches: 5,
      canaryTests: 100,
      canaryPasses: 85,
      attestationCoverage: 0.7,
    };
    const result = regulatoryGapAnalysis(mediumCompliance, 'SOC2');
    expect(result.gaps.length).toBeGreaterThanOrEqual(2);
    expect(['medium', 'high']).toContain(result.estimatedRemediationEffort);
  });

  it('validates compliance record', () => {
    const bad: ComplianceRecord = { ...sampleCompliance, totalInteractions: -1 };
    expect(() => regulatoryGapAnalysis(bad, 'SOC2')).toThrow('totalInteractions must be non-negative');
  });

  it('each gap includes remediation suggestion', () => {
    const terrible: ComplianceRecord = {
      totalInteractions: 100,
      covenantedInteractions: 10,
      breaches: 30,
      canaryTests: 100,
      canaryPasses: 50,
      attestationCoverage: 0.1,
    };
    const result = regulatoryGapAnalysis(terrible, 'HIPAA');
    for (const gap of result.gaps) {
      expect(gap.remediation).toBeTruthy();
      expect(gap.remediation.length).toBeGreaterThan(0);
    }
  });

  it('severity is always one of critical, major, minor', () => {
    const terrible: ComplianceRecord = {
      totalInteractions: 100,
      covenantedInteractions: 10,
      breaches: 30,
      canaryTests: 100,
      canaryPasses: 50,
      attestationCoverage: 0.1,
    };
    const result = regulatoryGapAnalysis(terrible, 'HIPAA');
    for (const gap of result.gaps) {
      expect(['critical', 'major', 'minor']).toContain(gap.severity);
    }
  });
});
