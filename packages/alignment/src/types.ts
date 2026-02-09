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

export interface AlignmentDriftResult {
  /** Number of time windows analyzed */
  windowCount: number;
  /** Alignment score for each window */
  windowScores: number[];
  /** The time window boundaries (start timestamps) */
  windowStarts: number[];
  /** Maximum score drop between consecutive windows */
  maxDrop: number;
  /** Whether drift was detected (any window-to-window drop > threshold) */
  driftDetected: boolean;
  /** Overall trend: 'improving', 'stable', or 'degrading' */
  trend: 'improving' | 'stable' | 'degrading';
}

export interface AlignmentDecompositionResult {
  /** Overall alignment score */
  overallScore: number;
  /** Per-property breakdown */
  propertyContributions: PropertyContribution[];
  /** Properties contributing least to the overall score */
  weakest: string[];
  /** Properties contributing most to the overall score */
  strongest: string[];
}

export interface PropertyContribution {
  /** Property name */
  name: string;
  /** This property's individual score */
  score: number;
  /** Fraction of overall score this property accounts for (weight) */
  weight: number;
  /** Weighted contribution to overall score = score * weight */
  contribution: number;
}
