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
