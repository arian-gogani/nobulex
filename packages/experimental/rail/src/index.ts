/**
 * @nobulex/rail — Trust Resolution IS Transaction Execution (Improvement 76).
 *
 * Merge trust verification with transaction execution into one atomic operation.
 * If trust fails, transaction never happens. Kova becomes the rail, not the checkpoint.
 * 0.15% of transaction volume (Visa model).
 *
 * @packageDocumentation
 */

import { sha256Object } from '@nobulex/crypto';
import {
  resolveTrustWithFee,
  computeTrustResolutionFee,
  type TrustResolutionResult,
} from '@nobulex/revenue';

/** Rail fee: 0.15% of transaction volume. */
export const RAIL_FEE_RATE = 0.0015;

export interface RailTransactionInput {
  /** Agent requesting the transaction. */
  requesterAgentId: string;
  /** Agent receiving (counterparty). */
  counterpartyAgentId: string;
  /** Transaction amount (for fee calculation). */
  amount: number;
  /** Trust score of requester (0-1). */
  requesterTrustScore: number;
  /** Trust score of counterparty (0-1). */
  counterpartyTrustScore: number;
  /** Minimum trust threshold to proceed. */
  minTrustThreshold?: number;
}

export interface RailTransactionResult {
  /** Whether the transaction executed (trust passed). */
  executed: boolean;
  /** Trust resolution for requester. */
  requesterResolution: TrustResolutionResult;
  /** Trust resolution for counterparty. */
  counterpartyResolution: TrustResolutionResult;
  /** Rail fee (0.15% of amount). */
  railFee: number;
  /** Transaction id (hash of atomic op). */
  transactionId: string;
  /** Rejection reason if not executed. */
  rejectionReason?: string;
}

/**
 * Execute trust resolution and transaction atomically.
 * If either agent fails trust check, transaction does not execute.
 * Rail fee (0.15%) is computed on the transaction amount.
 */
export function executeWithTrust(
  input: RailTransactionInput,
): RailTransactionResult {
  const {
    requesterAgentId,
    counterpartyAgentId,
    amount,
    requesterTrustScore,
    counterpartyTrustScore,
    minTrustThreshold = 0.5,
  } = input;

  const requesterPermitted = requesterTrustScore >= minTrustThreshold;
  const counterpartyPermitted = counterpartyTrustScore >= minTrustThreshold;

  const requesterResolution = resolveTrustWithFee({
    agentId: requesterAgentId,
    trustScore: requesterTrustScore,
    permitted: requesterPermitted,
    transactionValue: amount,
    payAgent: true,
  });

  const counterpartyResolution = resolveTrustWithFee({
    agentId: counterpartyAgentId,
    trustScore: counterpartyTrustScore,
    permitted: counterpartyPermitted,
    transactionValue: amount,
    payAgent: true,
  });

  const railFee = amount * RAIL_FEE_RATE;
  const executed = requesterPermitted && counterpartyPermitted;

  let rejectionReason: string | undefined;
  if (!executed) {
    if (!requesterPermitted) {
      rejectionReason = `Requester trust score ${requesterTrustScore} below threshold ${minTrustThreshold}`;
    } else {
      rejectionReason = `Counterparty trust score ${counterpartyTrustScore} below threshold ${minTrustThreshold}`;
    }
  }

  const transactionId = sha256Object({
    requesterAgentId,
    counterpartyAgentId,
    amount,
    railFee,
    executed,
    requesterResolutionId: requesterResolution.resolutionId,
    counterpartyResolutionId: counterpartyResolution.resolutionId,
    ts: Date.now(),
  });

  return {
    executed,
    requesterResolution,
    counterpartyResolution,
    railFee,
    transactionId,
    rejectionReason,
  };
}

/**
 * Compute rail fee for a given transaction amount (0.15%).
 */
export function computeRailFee(amount: number): number {
  return amount * RAIL_FEE_RATE;
}
