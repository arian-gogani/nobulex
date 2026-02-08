export interface AlignmentProperty {
  name: string;
  constraints: string[];
  testSuite: string;
  coverageScore: number;
}

export interface AlignmentCovenant {
  id: string;
  agentId: string;
  alignmentProperties: AlignmentProperty[];
  verificationMethod: 'behavioral' | 'compositional' | 'adversarial';
  constraints: string[];
}

export interface AlignmentReport {
  agentId: string;
  properties: AlignmentProperty[];
  overallAlignmentScore: number;
  gaps: string[];
  recommendations: string[];
}

export interface ExecutionRecord {
  action: string;
  resource: string;
  outcome: 'fulfilled' | 'breached';
  timestamp: number;
}
