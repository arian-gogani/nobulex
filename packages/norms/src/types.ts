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
