export type MetaTargetType = 'monitor' | 'attestor' | 'governance' | 'reputation' | 'canary';

export interface MetaCovenant {
  id: string;
  targetType: MetaTargetType;
  constraints: string[];
  recursionDepth: number;
  terminationProof: string;
  /** Optional: IDs of meta-covenants this one depends on (for DAG-based termination proofs). */
  dependsOn?: string[];
}

export interface RecursiveVerification {
  layer: number;
  entityId: string;
  entityType: string;
  covenantId: string;
  verified: boolean;
  verifiedBy: string;
  verifierCovenantId: string;
}

export interface TerminationProof {
  maxDepth: number;
  converges: boolean;
  proof: string;
  trustAssumption: TrustBase;
}

export interface TrustBase {
  assumptions: string[];
  cryptographicPrimitives: string[];
  description: string;
}

export interface VerificationEntity {
  id: string;
  type: MetaTargetType;
  covenantId: string;
  verifierId?: string;
  verifierCovenantId?: string;
}

export interface TrustEdge {
  from: string;
  to: string;
  trustScore: number;
}

export interface TransitiveTrustResult {
  from: string;
  to: string;
  effectiveTrust: number;
  path: string[];
  hops: number;
}

export interface VerifierNode {
  id: string;
  coveredConstraints: string[];
}

export interface MinimalVerificationSetResult {
  verifiers: string[];
  coveredConstraints: string[];
  uncoveredConstraints: string[];
}
