import { sha256Object, signString, toHex, verify, fromHex } from '@stele/crypto';

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

/** Default timestamp difference threshold (in ms) for minor discrepancy. */
const TIMESTAMP_THRESHOLD_MS = 5000;

/**
 * Create an ExternalAttestation with a deterministic ID derived from its content.
 * Validates inputs: non-empty agentId, counterpartyId, endpoint, and valid timestamp.
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
  if (!agentId || typeof agentId !== 'string') {
    throw new Error('agentId must be a non-empty string');
  }
  if (!counterpartyId || typeof counterpartyId !== 'string') {
    throw new Error('counterpartyId must be a non-empty string');
  }
  if (!endpoint || typeof endpoint !== 'string') {
    throw new Error('endpoint must be a non-empty string');
  }
  if (typeof timestamp !== 'number' || timestamp < 0) {
    throw new Error('timestamp must be a non-negative number');
  }

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
 * Check if an attestation has been signed (counterpartySignature is non-empty).
 */
export function isSigned(attestation: ExternalAttestation): boolean {
  return attestation.counterpartySignature.length > 0;
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
 * Verify an attestation's counterpartySignature is a valid Ed25519 signature
 * against the attestation's content, using the provided public key.
 * Returns true if valid, false otherwise.
 */
export async function verifyAttestation(
  attestation: ExternalAttestation,
  publicKey: Uint8Array,
): Promise<boolean> {
  if (!attestation.counterpartySignature || attestation.counterpartySignature.length === 0) {
    return false;
  }

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

  try {
    const signatureBytes = fromHex(attestation.counterpartySignature);
    const messageBytes = new TextEncoder().encode(payload);
    return await verify(messageBytes, signatureBytes, publicKey);
  } catch {
    return false;
  }
}

/**
 * Reconcile an agent receipt against a counterparty attestation.
 * Compares interactionHash, inputHash, outputHash, endpoint, and timestamp fields.
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
 * Compare interactionHash, inputHash, outputHash, endpoint, and timestamp
 * between a receipt and an attestation, returning an array of discrepancies found.
 *
 * Severity levels:
 *   - interactionHash mismatch: critical
 *   - inputHash mismatch: major
 *   - outputHash mismatch: major
 *   - endpoint mismatch: minor
 *   - timestamp difference > threshold: minor
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

  if (receipt.endpoint !== attestation.endpoint) {
    discrepancies.push({
      field: 'endpoint',
      agentClaimed: receipt.endpoint,
      counterpartyClaimed: attestation.endpoint,
      severity: 'minor',
    });
  }

  if (Math.abs(receipt.timestamp - attestation.timestamp) > TIMESTAMP_THRESHOLD_MS) {
    discrepancies.push({
      field: 'timestamp',
      agentClaimed: String(receipt.timestamp),
      counterpartyClaimed: String(attestation.timestamp),
      severity: 'minor',
    });
  }

  return discrepancies;
}
