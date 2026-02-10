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

export interface DecomposedCovenant {
  /** Original covenant ID this was extracted from */
  sourceCovenantId: string;
  /** Agent that owns this sub-covenant */
  agentId: string;
  /** Single atomic constraint */
  constraint: string;
  /** Type of the constraint */
  type: 'permit' | 'deny' | 'require' | 'limit';
}

export interface CompositionComplexityResult {
  /** Total number of rules across all covenants */
  totalRules: number;
  /** Maximum nesting depth of conditions */
  maxConditionDepth: number;
  /** Number of distinct agents */
  agentCount: number;
  /** Number of conflicts (permit-deny overlaps) */
  conflictCount: number;
  /** Number of distinct action patterns */
  distinctActions: number;
  /** Number of distinct resource patterns */
  distinctResources: number;
  /** Complexity score: weighted combination of factors (0 = trivial, higher = more complex) */
  score: number;
}
