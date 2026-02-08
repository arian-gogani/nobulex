import { sha256Object, signString, toHex } from '@stele/crypto';

export type {
  ExternalAttestation,
  AttestationReconciliation,
  Discrepancy,
  ReceiptSummary,
} from './types';

import type {
  ExternalAttestation,
  AttestationReconciliation,
  Discrepancy,
  ReceiptSummary,
} from './types';

/**
 * Create an ExternalAttestation with a deterministic ID derived from its content.
 */
export function createAttestation(
  agentId: string,
  counterpartyId: string,
  endpoint: string,
  inputHash: string,
  outputHash: string,
  interactionHash: string,
  timestamp: number,
): ExternalAttestation {
  const content = {
    agentId,
    counterpartyId,
    endpoint,
    inputHash,
    outputHash,
    interactionHash,
    timestamp,
  };
  const id = sha256Object(content);

  return {
    id,
    agentId,
    counterpartyId,
    interactionHash,
    counterpartySignature: '',
    timestamp,
    endpoint,
    inputHash,
    outputHash,
  };
}

/**
 * Sign an attestation with a private key. Returns a copy with the
 * counterpartySignature field set to the hex-encoded Ed25519 signature.
 */
export async function signAttestation(
  attestation: ExternalAttestation,
  privateKey: Uint8Array,
): Promise<ExternalAttestation> {
  const payload = sha256Object({
    id: attestation.id,
    agentId: attestation.agentId,
    counterpartyId: attestation.counterpartyId,
    interactionHash: attestation.interactionHash,
    timestamp: attestation.timestamp,
    endpoint: attestation.endpoint,
    inputHash: attestation.inputHash,
    outputHash: attestation.outputHash,
  });
  const signature = await signString(payload, privateKey);

  return {
    ...attestation,
    counterpartySignature: toHex(signature),
  };
}

/**
 * Reconcile an agent receipt against a counterparty attestation.
 * Compares interactionHash, inputHash, and outputHash fields.
 */
export function reconcile(
  receipt: ReceiptSummary,
  attestation: ExternalAttestation,
): AttestationReconciliation {
  const discrepancies = getDiscrepancies(receipt, attestation);

  return {
    agentReceiptId: receipt.id,
    attestationId: attestation.id,
    match: discrepancies.length === 0,
    discrepancies,
  };
}

/**
 * Compare interactionHash, inputHash, and outputHash between a receipt
 * and an attestation, returning an array of discrepancies found.
 *
 * Severity levels:
 *   - interactionHash mismatch: critical
 *   - inputHash mismatch: major
 *   - outputHash mismatch: major
 */
export function getDiscrepancies(
  receipt: ReceiptSummary,
  attestation: ExternalAttestation,
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  if (receipt.interactionHash !== attestation.interactionHash) {
    discrepancies.push({
      field: 'interactionHash',
      agentClaimed: receipt.interactionHash,
      counterpartyClaimed: attestation.interactionHash,
      severity: 'critical',
    });
  }

  if (receipt.inputHash !== attestation.inputHash) {
    discrepancies.push({
      field: 'inputHash',
      agentClaimed: receipt.inputHash,
      counterpartyClaimed: attestation.inputHash,
      severity: 'major',
    });
  }

  if (receipt.outputHash !== attestation.outputHash) {
    discrepancies.push({
      field: 'outputHash',
      agentClaimed: receipt.outputHash,
      counterpartyClaimed: attestation.outputHash,
      severity: 'major',
    });
  }

  return discrepancies;
}
