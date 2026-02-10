export interface DiscoveredNorm {
  id: string;
  pattern: string;
  prevalence: number;
  correlationWithTrust: number;
  category: string;
  confidence: number;
  proposedAsStandard: boolean;
}

export interface NormAnalysis {
  totalCovenants: number;
  uniqueConstraints: number;
  clusters: NormCluster[];
  emergentNorms: DiscoveredNorm[];
  gaps: string[];
}

export interface NormCluster {
  category: string;
  constraints: string[];
  agentCount: number;
  averageTrustScore: number;
}

export interface GovernanceProposal {
  id: string;
  normId: string;
  proposedAt: number;
  description: string;
  pattern: string;
}

export interface CovenantData {
  id: string;
  agentId: string;
  constraints: string[];
  trustScore: number;
}

export interface CovenantTemplate {
  name: string;
  description: string;
  constraints: string[];
  sourceNorms: string[];
}

export interface NormDefinition {
  id: string;
  pattern: string;
  category: string;
  action: string;
  resource: string;
  authority: number;
  createdAt: number;
  specificity: number;
}

export interface NormConflict {
  normA: NormDefinition;
  normB: NormDefinition;
  conflictType: 'direct_contradiction' | 'resource_overlap' | 'action_conflict';
  description: string;
}

export interface NormPrecedenceResult {
  winner: NormDefinition;
  loser: NormDefinition;
  reason: string;
  factors: {
    specificityDiff: number;
    recencyDiff: number;
    authorityDiff: number;
  };
}
