export interface NegotiationSession {
  id: string;
  initiator: string;
  responder: string;
  status: 'proposing' | 'countering' | 'agreed' | 'failed';
  proposals: Proposal[];
  resultingConstraints?: string[];
  timeoutMs: number;
  createdAt: number;
  maxRounds: number;
  failureReason?: string;
}

export interface Proposal {
  from: string;
  constraints: string[];
  requirements: string[];
  timestamp: number;
}

export interface NegotiationPolicy {
  requiredConstraints: string[];
  preferredConstraints: string[];
  dealbreakers: string[];
  maxRounds: number;
  timeoutMs: number;
}

export interface UtilityFunction {
  partyId: string;
  evaluate: (outcome: Outcome) => number;
  disagreementValue: number;
}

export interface Outcome {
  constraints: string[];
  id?: string;
}

export interface NashBargainingSolution {
  outcome: Outcome;
  utilityA: number;
  utilityB: number;
  nashProduct: number;
}

export interface ParetoOutcome {
  outcome: Outcome;
  utilities: number[];
  dominated: boolean;
}
