import { describe, it, expect } from 'vitest';
import {
  computeComplianceCost,
  createComplianceScore,
  createPreViolationAlert,
  COMPLIANCE_BUDGET_FRACTION_MIN,
  COMPLIANCE_BUDGET_FRACTION_MAX,
} from './index';

describe('computeComplianceCost', () => {
  it('returns 0.5-1% of operational budget (average 0.75%)', () => {
    const cost = computeComplianceCost(10_000);
    const expected = 10_000 * 0.0075; // (0.005 + 0.01) / 2
    expect(cost).toBe(expected);
    expect(cost).toBe(75);
  });

  it('scales with budget', () => {
    expect(computeComplianceCost(1000)).toBe(7.5);
    expect(computeComplianceCost(100_000)).toBe(750);
  });
});

describe('createComplianceScore', () => {
  it('returns score with all fields', () => {
    const score = createComplianceScore('agent-1', 0.9, 0.05, 0.95);
    expect(score.agentId).toBe('agent-1');
    expect(score.score).toBe(0.9);
    expect(score.breachRisk).toBe(0.05);
    expect(score.attestationCoverage).toBe(0.95);
    expect(typeof score.lastUpdated).toBe('number');
  });
});

describe('createPreViolationAlert', () => {
  it('returns alert with all fields', () => {
    const alert = createPreViolationAlert(
      'agent-1',
      'file.write',
      '/system/config',
      "deny file.write on '/system/**'",
      0.85,
    );
    expect(alert.agentId).toBe('agent-1');
    expect(alert.action).toBe('file.write');
    expect(alert.resource).toBe('/system/config');
    expect(alert.constraintAtRisk).toContain('deny');
    expect(alert.confidence).toBe(0.85);
    expect(typeof alert.timestamp).toBe('number');
  });
});

describe('COMPLIANCE_BUDGET_FRACTION', () => {
  it('min is 0.5%, max is 1%', () => {
    expect(COMPLIANCE_BUDGET_FRACTION_MIN).toBe(0.005);
    expect(COMPLIANCE_BUDGET_FRACTION_MAX).toBe(0.01);
  });
});
