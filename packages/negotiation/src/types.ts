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
