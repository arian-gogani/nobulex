export interface ExternalAttestation {
  id: string;
  agentId: string;
  counterpartyId: string;
  interactionHash: string;
  counterpartySignature: string;
  timestamp: number;
  endpoint: string;
  inputHash: string;
  outputHash: string;
}

export interface AttestationReconciliation {
  agentReceiptId: string;
  attestationId: string;
  match: boolean;
  discrepancies: Discrepancy[];
}

export interface Discrepancy {
  field: string;
  agentClaimed: string;
  counterpartyClaimed: string;
  severity: 'critical' | 'major' | 'minor';
}

export interface ReceiptSummary {
  id: string;
  interactionHash: string;
  inputHash: string;
  outputHash: string;
  endpoint: string;
  timestamp: number;
}
