/**
 * @stele/compliance-autopilot — Compliance Autopilot (Improvement 74).
 *
 * Continuous compliance monitoring at 0.5-1% of agent operational budget.
 * Real-time compliance scores, automatic regulatory reports, pre-violation alerts.
 * Never churns because compliance history lives on Kova. Salesforce stickiness model.
 *
 * @packageDocumentation
 */

export interface ComplianceScore {
  agentId: string;
  score: number;
  breachRisk: number;
  attestationCoverage: number;
  lastUpdated: number;
}

export interface PreViolationAlert {
  agentId: string;
  action: string;
  resource: string;
  constraintAtRisk: string;
  confidence: number;
  timestamp: number;
}

/** Budget fraction: 0.5-1% of operational budget. */
export const COMPLIANCE_BUDGET_FRACTION_MIN = 0.005;
export const COMPLIANCE_BUDGET_FRACTION_MAX = 0.01;

/**
 * Compute compliance autopilot cost (0.5-1% of agent operational budget).
 */
export function computeComplianceCost(operationalBudget: number): number {
  const fraction = (COMPLIANCE_BUDGET_FRACTION_MIN + COMPLIANCE_BUDGET_FRACTION_MAX) / 2;
  return operationalBudget * fraction;
}

/**
 * Create a compliance score snapshot.
 */
export function createComplianceScore(
  agentId: string,
  score: number,
  breachRisk: number,
  attestationCoverage: number,
): ComplianceScore {
  return {
    agentId,
    score,
    breachRisk,
    attestationCoverage,
    lastUpdated: Date.now(),
  };
}

/**
 * Create a pre-violation alert when an action would likely violate a constraint.
 */
export function createPreViolationAlert(
  agentId: string,
  action: string,
  resource: string,
  constraintAtRisk: string,
  confidence: number,
): PreViolationAlert {
  return {
    agentId,
    action,
    resource,
    constraintAtRisk,
    confidence,
    timestamp: Date.now(),
  };
}
