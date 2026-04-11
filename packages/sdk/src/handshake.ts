/**
 * @nobulex/sdk — Cross-Agent Verification Handshake
 *
 * The proof-of-behavior handshake: before two agents transact,
 * they verify each other's behavioral proof. No proof, no transaction.
 *
 * @packageDocumentation
 */

import { sha256Object } from '@nobulex/crypto';
import type { HashHex } from '@nobulex/crypto';
import { signWithDID, verifyWithDID } from '@nobulex/identity';
import type { DIDKeyPair, DIDDocument } from '@nobulex/identity';
import { verify as verifyCovenant } from '@nobulex/verification';
import { verifyIntegrity } from '@nobulex/action-log';
import type { CovenantSpec, ActionLog, VerificationResult } from '@nobulex/core-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A portable proof-of-behavior that an agent presents to counterparties. */
export interface ProofOfBehavior {
  readonly agentDid: string;
  readonly didDocument: DIDDocument;
  readonly covenant: CovenantSpec;
  readonly covenantHash: HashHex;
  readonly covenantSignature: string;
  readonly actionLog: ActionLog;
  readonly generatedAt: string;
  readonly proofSignature: string;
}

/** Result of verifying another agent's proof-of-behavior. */
export interface HandshakeResult {
  readonly trusted: boolean;
  readonly agentDid: string;
  readonly covenantName: string;
  readonly signatureValid: boolean;
  readonly logIntegrityValid: boolean;
  readonly compliant: boolean;
  readonly violationCount: number;
  readonly totalActions: number;
  readonly reason: string;
  readonly verification: VerificationResult;
  readonly verifiedAt: string;
}

/** Options for the handshake verification. */
export interface HandshakeOptions {
  readonly minActions?: number;
  readonly maxViolations?: number;
  readonly requiredCovenant?: string;
}

// ---------------------------------------------------------------------------
// Generate proof-of-behavior
// ---------------------------------------------------------------------------

/**
 * Generate a portable proof-of-behavior for this agent.
 */
export async function generateProof(params: {
  identity: DIDKeyPair;
  covenant: CovenantSpec;
  actionLog: ActionLog;
}): Promise<ProofOfBehavior> {
  const { identity, covenant, actionLog } = params;

  const covenantHash = sha256Object(covenant) as HashHex;
  const covenantSignature = await signWithDID(covenantHash, identity);

  const generatedAt = new Date().toISOString();

  // Sign the full payload
  const payloadString = JSON.stringify({
    agentDid: identity.did,
    covenantHash,
    covenantSignature,
    generatedAt,
  });
  const proofSignature = await signWithDID(payloadString, identity);

  return {
    agentDid: identity.did,
    didDocument: identity.document,
    covenant,
    covenantHash,
    covenantSignature,
    actionLog,
    generatedAt,
    proofSignature,
  };
}

// ---------------------------------------------------------------------------
// Verify counterparty's proof-of-behavior
// ---------------------------------------------------------------------------

/**
 * Verify a counterparty agent's proof-of-behavior.
 *
 * Before transacting with another agent, call this with their proof.
 * If result.trusted is false, refuse the transaction.
 */
export async function verifyCounterparty(
  proof: ProofOfBehavior,
  options: HandshakeOptions = {},
): Promise<HandshakeResult> {
  const { minActions = 0, maxViolations = 0, requiredCovenant } = options;
  const verifiedAt = new Date().toISOString();
  const base = { agentDid: proof.agentDid, covenantName: proof.covenant.name, verifiedAt };

  // Step 1: Verify covenant signature
  const covenantHash = sha256Object(proof.covenant) as HashHex;
  const signatureValid = await verifyWithDID(covenantHash, proof.covenantSignature, proof.didDocument);

  if (!signatureValid) {
    const verification = verifyCovenant(proof.covenant, proof.actionLog);
    return {
      ...base, trusted: false, signatureValid: false, logIntegrityValid: false,
      compliant: false, violationCount: 0, totalActions: 0,
      reason: 'Covenant signature is invalid — agent did not commit to these rules',
      verification,
    };
  }

  // Step 2: Verify proof signature
  const payloadString = JSON.stringify({
    agentDid: proof.agentDid,
    covenantHash: proof.covenantHash,
    covenantSignature: proof.covenantSignature,
    generatedAt: proof.generatedAt,
  });
  const proofValid = await verifyWithDID(payloadString, proof.proofSignature, proof.didDocument);

  if (!proofValid) {
    const verification = verifyCovenant(proof.covenant, proof.actionLog);
    return {
      ...base, trusted: false, signatureValid: true, logIntegrityValid: false,
      compliant: false, violationCount: 0, totalActions: 0,
      reason: 'Proof signature is invalid — proof may have been tampered with',
      verification,
    };
  }

  // Step 3: Verify action log integrity
  const integrity = verifyIntegrity(proof.actionLog);
  if (!integrity.valid) {
    const verification = verifyCovenant(proof.covenant, proof.actionLog);
    return {
      ...base, trusted: false, signatureValid: true, logIntegrityValid: false,
      compliant: false, violationCount: 0, totalActions: proof.actionLog.entries.length,
      reason: `Action log integrity failed: ${integrity.errors.join('; ')}`,
      verification,
    };
  }

  // Step 4: Verify covenant compliance
  const verification = verifyCovenant(proof.covenant, proof.actionLog);

  if (!verification.compliant && verification.violations.length > maxViolations) {
    return {
      ...base, trusted: false, signatureValid: true, logIntegrityValid: true,
      compliant: false, violationCount: verification.violations.length,
      totalActions: verification.totalActions,
      reason: `Agent has ${verification.violations.length} violations (max: ${maxViolations})`,
      verification,
    };
  }

  // Step 5: Minimum action history
  if (verification.totalActions < minActions) {
    return {
      ...base, trusted: false, signatureValid: true, logIntegrityValid: true,
      compliant: verification.compliant, violationCount: verification.violations.length,
      totalActions: verification.totalActions,
      reason: `Agent has ${verification.totalActions} actions (minimum required: ${minActions})`,
      verification,
    };
  }

  // Step 6: Required covenant
  if (requiredCovenant && proof.covenant.name !== requiredCovenant) {
    return {
      ...base, trusted: false, signatureValid: true, logIntegrityValid: true,
      compliant: verification.compliant, violationCount: verification.violations.length,
      totalActions: verification.totalActions,
      reason: `Covenant '${proof.covenant.name}' does not match required '${requiredCovenant}'`,
      verification,
    };
  }

  // All checks passed
  return {
    ...base, trusted: true, signatureValid: true, logIntegrityValid: true,
    compliant: verification.compliant, violationCount: verification.violations.length,
    totalActions: verification.totalActions,
    reason: 'All checks passed — agent is trusted',
    verification,
  };
}
