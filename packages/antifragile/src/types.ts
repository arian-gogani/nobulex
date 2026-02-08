export interface BreachAntibody {
  id: string;
  derivedFromBreach: string;
  proposedConstraint: string;
  category: string;
  status: 'proposed' | 'adopted' | 'rejected';
  adoptionVotes: number;
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
