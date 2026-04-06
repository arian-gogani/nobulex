export interface RobustnessProof {
  covenantId: string;
  constraint: string;
  inputBound: InputBound;
  verified: boolean;
  counterexample?: unknown;
  confidence: number;
  method: 'exhaustive' | 'statistical' | 'formal';
}

export interface InputBound {
  dimensions: string[];
  ranges: Record<string, { min: number; max: number }>;
  distribution: 'uniform' | 'adversarial' | 'realistic';
}

export interface RobustnessReport {
  covenantId: string;
  constraintsTested: number;
  constraintsPassed: number;
  vulnerabilities: Vulnerability[];
  overallRobustness: number;
}

export interface Vulnerability {
  constraint: string;
  counterexample: unknown;
  severity: 'critical' | 'high' | 'medium' | 'low';
  recommendation: string;
}

export interface CovenantSpec {
  id: string;
  constraints: ConstraintSpec[];
}

export interface ConstraintSpec {
  rule: string;
  type: 'permit' | 'deny' | 'require' | 'limit';
  action?: string;
  resource?: string;
}

export interface RobustnessOptions {
  /** Maximum input space size for exhaustive testing (default 1000) */
  exhaustiveThreshold?: number;
  /** Sample size for statistical testing (default 500) */
  statisticalSampleSize?: number;
  /** Target confidence level (default 0.95) */
  confidenceLevel?: number;
}

export interface FormalVerificationResult {
  /** Whether the constraint set is free of contradictions */
  consistent: boolean;
  /** Specific contradictions found (permit-deny overlaps) */
  contradictions: Contradiction[];
  /** Unreachable rules (rules shadowed by other rules) */
  unreachableRules: string[];
  /** Number of rules analyzed */
  rulesAnalyzed: number;
  /** Verification method used */
  method: 'symbolic';
}

export interface Contradiction {
  /** First rule in the conflict */
  ruleA: string;
  /** Second rule in the conflict */
  ruleB: string;
  /** Description of the contradiction */
  description: string;
  /** Severity of the contradiction */
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface RobustnessScoreResult {
  /** Overall robustness score from 0 to 1 */
  score: number;
  /** Breakdown of contributing factors */
  factors: RobustnessFactor[];
  /** Classification: 'strong', 'moderate', 'weak' */
  classification: 'strong' | 'moderate' | 'weak';
  /** Recommendations for improvement */
  recommendations: string[];
}

export interface RobustnessFactor {
  /** Factor name */
  name: string;
  /** Factor score from 0 to 1 */
  score: number;
  /** Weight in the overall calculation */
  weight: number;
  /** Contribution to overall score */
  contribution: number;
}
