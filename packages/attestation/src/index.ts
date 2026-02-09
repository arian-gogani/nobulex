import { sha256Object, signString, toHex, verify, fromHex } from '@stele/crypto';

export type {
  ExternalAttestation,
  AttestationReconciliation,
  Discrepancy,
  ReceiptSummary,
  AttestationChainLink,
  ChainVerificationResult,
  AgentAction,
  AttestationCoverageResult,
} from './types';

import type {
  ExternalAttestation,
  AttestationReconciliation,
  Discrepancy,
  ReceiptSummary,
  AttestationChainLink,
  ChainVerificationResult,
  AgentAction,
  AttestationCoverageResult,
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

/**
 * Verify a chain of attestations where each attester attests the previous one.
 *
 * The chain is ordered from the first attestation to the last. Each link
 * contains an attestation and the public key of the attester who signed it.
 * Verification proceeds sequentially: if any link fails verification,
 * the chain is considered broken at that link.
 *
 * Additionally checks that the chain is temporally ordered (each attestation's
 * timestamp is >= the previous one's timestamp).
 *
 * @param chain - Array of attestation chain links in order
 * @returns ChainVerificationResult with the verification outcome
 */
export async function attestationChainVerify(
  chain: AttestationChainLink[],
): Promise<ChainVerificationResult> {
  if (chain.length === 0) {
    return {
      valid: true,
      verifiedLinks: 0,
      totalLinks: 0,
    };
  }

  let verifiedLinks = 0;

  for (let i = 0; i < chain.length; i++) {
    const link = chain[i]!;

    // Check that the attestation is signed
    if (!isSigned(link.attestation)) {
      return {
        valid: false,
        verifiedLinks,
        totalLinks: chain.length,
        brokenAt: i,
        reason: `Link ${i}: attestation is not signed`,
      };
    }

    // Verify the signature
    const signatureValid = await verifyAttestation(link.attestation, link.attesterPublicKey);
    if (!signatureValid) {
      return {
        valid: false,
        verifiedLinks,
        totalLinks: chain.length,
        brokenAt: i,
        reason: `Link ${i}: signature verification failed`,
      };
    }

    // Check temporal ordering (each attestation should be at or after the previous)
    if (i > 0) {
      const prevTimestamp = chain[i - 1]!.attestation.timestamp;
      if (link.attestation.timestamp < prevTimestamp) {
        return {
          valid: false,
          verifiedLinks,
          totalLinks: chain.length,
          brokenAt: i,
          reason: `Link ${i}: timestamp ${link.attestation.timestamp} is before previous link's timestamp ${prevTimestamp}`,
        };
      }
    }

    // Check chain continuity: the attester of the current link should be
    // the counterparty of the previous link's attestation (if applicable)
    if (i > 0) {
      const prevAttestation = chain[i - 1]!.attestation;
      if (link.attestation.agentId !== prevAttestation.counterpartyId) {
        return {
          valid: false,
          verifiedLinks,
          totalLinks: chain.length,
          brokenAt: i,
          reason: `Link ${i}: agentId "${link.attestation.agentId}" does not match previous link's counterpartyId "${prevAttestation.counterpartyId}"`,
        };
      }
    }

    verifiedLinks++;
  }

  return {
    valid: true,
    verifiedLinks,
    totalLinks: chain.length,
  };
}

/**
 * Compute what percentage of an agent's actions are covered by attestations.
 *
 * An action is considered "covered" if there exists an attestation where:
 * - The attestation's agentId matches the action's agentId
 * - The attestation's timestamp is within the given time window of the action's timestamp
 *
 * @param actions - Array of agent actions to check coverage for
 * @param attestations - Array of attestations that may cover the actions
 * @param timeWindowMs - Maximum time difference (in ms) for an attestation to cover an action (default 5000)
 * @returns AttestationCoverageResult with coverage statistics
 */
export function computeAttestationCoverage(
  actions: AgentAction[],
  attestations: ExternalAttestation[],
  timeWindowMs: number = 5000,
): AttestationCoverageResult {
  if (timeWindowMs < 0) {
    throw new Error('timeWindowMs must be non-negative');
  }

  if (actions.length === 0) {
    return {
      totalActions: 0,
      coveredActions: 0,
      coveragePercentage: 100,
      uncoveredActionIds: [],
    };
  }

  const uncoveredActionIds: string[] = [];
  let coveredCount = 0;

  for (const action of actions) {
    const isCovered = attestations.some(att =>
      att.agentId === action.agentId &&
      Math.abs(att.timestamp - action.timestamp) <= timeWindowMs,
    );

    if (isCovered) {
      coveredCount++;
    } else {
      uncoveredActionIds.push(action.id);
    }
  }

  return {
    totalActions: actions.length,
    coveredActions: coveredCount,
    coveragePercentage: (coveredCount / actions.length) * 100,
    uncoveredActionIds,
  };
}
