export interface BreachAntibody {
  id: string;
  derivedFromBreach: string;
  proposedConstraint: string;
  category: string;
  status: 'proposed' | 'adopted' | 'rejected';
  adoptionVotes: number;
  adoptionThreshold: number;
}

export interface NetworkHealth {
  totalBreaches: number;
  antibodiesGenerated: number;
  antibodiesAdopted: number;
  resistanceScore: number;
  vulnerableCategories: string[];
}

export interface GovernanceProposal {
  id: string;
  antibodyId: string;
  proposedAt: number;
  description: string;
}

export interface BreachSummary {
  id: string;
  violatedConstraint: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category?: string;
}

export interface StressTestResult {
  /** Number of attack rounds simulated */
  rounds: number;
  /** Resistance score at each round (should trend upward for antifragile systems) */
  resistanceOverTime: number[];
  /** Number of antibodies adopted at each round */
  antibodiesAdoptedOverTime: number[];
  /** Whether the system improved (resistance score at end > start) */
  improved: boolean;
  /** Final resistance score */
  finalResistanceScore: number;
}

export interface AntifragilityIndexResult {
  /** The antifragility index: positive = antifragile, zero = robust, negative = fragile */
  index: number;
  /** Classification based on the index value */
  classification: 'antifragile' | 'robust' | 'fragile';
  /** Trend of resistance scores over successive attack waves */
  resistanceTrend: number[];
  /** Average improvement per wave */
  averageImprovement: number;
}
