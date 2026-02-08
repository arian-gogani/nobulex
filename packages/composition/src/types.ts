export interface CompositionProof {
  agents: string[];
  individualCovenants: string[];
  composedConstraints: ComposedConstraint[];
  systemProperties: SystemProperty[];
  proof: string;
}

export interface ComposedConstraint {
  source: string;
  constraint: string;
  type: 'permit' | 'deny' | 'require' | 'limit';
}

export interface SystemProperty {
  property: string;
  holds: boolean;
  derivedFrom: string[];
}

export interface CovenantSummary {
  id: string;
  agentId: string;
  constraints: string[];
}
