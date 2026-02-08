export type MetaTargetType = 'monitor' | 'attestor' | 'governance' | 'reputation' | 'canary';

export interface MetaCovenant {
  id: string;
  targetType: MetaTargetType;
  constraints: string[];
  recursionDepth: number;
  terminationProof: string;
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
  trustAssumption: string;
}

export interface VerificationEntity {
  id: string;
  type: MetaTargetType;
  covenantId: string;
  verifierId?: string;
  verifierCovenantId?: string;
}
