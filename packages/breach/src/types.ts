import type { HashHex } from '@nobulex/crypto';
import type { Severity } from '@nobulex/ccl';

export type TrustStatus = 'trusted' | 'degraded' | 'restricted' | 'revoked' | 'unknown';

export interface BreachAttestation {
  id: HashHex;
  covenantId: HashHex;
  violatorIdentityHash: HashHex;
  violatedConstraint: string;
  severity: Severity;
  action: string;
  resource: string;
  evidenceHash: HashHex;
  recommendedAction: 'revoke' | 'restrict' | 'monitor' | 'notify';
  reporterPublicKey: string;
  reporterSignature: string;
  reportedAt: string;
  /** Cryptographic nonce ensuring unique ID when timestamp is identical. */
  nonce: HashHex;
  affectedCovenants: HashHex[];
}

export interface TrustNode {
  identityHash: HashHex;
  status: TrustStatus;
  lastBreachAt?: string;
  breachCount: number;
  dependents: HashHex[];
  dependencies: HashHex[];
}

export interface BreachEvent {
  attestation: BreachAttestation;
  affectedAgent: HashHex;
  previousStatus: TrustStatus;
  newStatus: TrustStatus;
  propagationDepth: number;
}
