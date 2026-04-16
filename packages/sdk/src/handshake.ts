/*
 * Cross-agent verification handshake.
 *
 * Before two agents transact, they verify each other's proof-of-behavior.
 * No proof, no transaction. This is the core trust mechanism.
 */

import { sha256Object } from '@nobulex/crypto';
import type { HashHex } from '@nobulex/crypto';
import { signWithDID, verifyWithDID } from '@nobulex/identity';
import type { DIDKeyPair, DIDDocument } from '@nobulex/identity';
import { verify as verifyCovenant } from '@nobulex/verification';
import { verifyIntegrity } from '@nobulex/action-log';
import type { CovenantSpec, ActionLog, VerificationResult } from '@nobulex/types';

// ---------------------------------------------------------------------------
// --- types ---

// what an agent presents to prove its behavior
export interface ProofOfBehavior {
  readonly agentDid: string;
  readonly didDocument: DIDDocument;
  readonly covenant: CovenantSpec;
  readonly covenantHash: HashHex;
  readonly covenantSignature: string;
  readonly actionLog: ActionLog;
  readonly generatedAt: string;
  readonly proofSignature: string;
  // prevents replay attacks — added after Rohit's feedback on RFC #1740
  readonly audience?: string;
  // scoped trust: "i trust you for payments but not for admin"
  readonly taskClass?: string;
}

// what you get back after verifying someone's proof
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

export interface HandshakeOptions {
  readonly minActions?: number;
  readonly maxViolations?: number;
  readonly requiredCovenant?: string;
  readonly expectedAudience?: string; // must match proof's audience DID
  readonly requiredTaskClass?: string;
}

// --- generate proof ---

/** Build a portable proof that this agent can present to others. */
export async function generateProof(params: {
  identity: DIDKeyPair;
  covenant: CovenantSpec;
  actionLog: ActionLog;
  audience?: string;
  taskClass?: string;
}): Promise<ProofOfBehavior> {
  const { identity, covenant, actionLog, audience, taskClass } = params;

  const covenantHash = sha256Object(covenant) as HashHex;
  const covenantSignature = await signWithDID(covenantHash, identity);

  const generatedAt = new Date().toISOString();

  // Sign the full payload (includes audience + taskClass to prevent tampering)
  const payloadString = JSON.stringify({
    agentDid: identity.did,
    covenantHash,
    covenantSignature,
    generatedAt,
    ...(audience ? { audience } : {}),
    ...(taskClass ? { taskClass } : {}),
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
    ...(audience ? { audience } : {}),
    ...(taskClass ? { taskClass } : {}),
  };
}

// --- verify counterparty ---

/*
 * The core trust check. Before you transact with another agent,
 * call this with their proof. If result.trusted is false, walk away.
 *
 * 8 steps: covenant sig, proof sig, log integrity, compliance,
 * min history, required covenant, audience binding, task class.
 * Any step fails = untrusted.
 */
export async function verifyCounterparty(
  proof: ProofOfBehavior,
  options: HandshakeOptions = {},
): Promise<HandshakeResult> {
  const { minActions = 0, maxViolations = 0, requiredCovenant, expectedAudience, requiredTaskClass } = options;
  const verifiedAt = new Date().toISOString();
  const base = { agentDid: proof.agentDid, covenantName: proof.covenant.name, verifiedAt };

  // 1. did they actually sign this covenant?
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

  // 2. proof signature — make sure the whole payload wasn't tampered with
  const payloadString = JSON.stringify({
    agentDid: proof.agentDid,
    covenantHash: proof.covenantHash,
    covenantSignature: proof.covenantSignature,
    generatedAt: proof.generatedAt,
    ...(proof.audience ? { audience: proof.audience } : {}),
    ...(proof.taskClass ? { taskClass: proof.taskClass } : {}),
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

  // 3. hash chain integrity — if any log entry was modified, this catches it
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

  // 4. compliance — did they actually follow their own rules?
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

  // 5. do they have enough track record?
  if (verification.totalActions < minActions) {
    return {
      ...base, trusted: false, signatureValid: true, logIntegrityValid: true,
      compliant: verification.compliant, violationCount: verification.violations.length,
      totalActions: verification.totalActions,
      reason: `Agent has ${verification.totalActions} actions (minimum required: ${minActions})`,
      verification,
    };
  }

  // 6. are they running the covenant we require?
  if (requiredCovenant && proof.covenant.name !== requiredCovenant) {
    return {
      ...base, trusted: false, signatureValid: true, logIntegrityValid: true,
      compliant: verification.compliant, violationCount: verification.violations.length,
      totalActions: verification.totalActions,
      reason: `Covenant '${proof.covenant.name}' does not match required '${requiredCovenant}'`,
      verification,
    };
  }

  // 7. audience binding — is this proof actually meant for me?
  // without this, someone could replay a proof meant for a different verifier
  if (expectedAudience && proof.audience !== expectedAudience) {
    return {
      ...base, trusted: false, signatureValid: true, logIntegrityValid: true,
      compliant: verification.compliant, violationCount: verification.violations.length,
      totalActions: verification.totalActions,
      reason: proof.audience
        ? `Proof audience '${proof.audience}' does not match expected '${expectedAudience}'`
        : `Proof has no audience claim — expected '${expectedAudience}'`,
      verification,
    };
  }

  // 8. task scoping — "i trust you for payments" doesn't mean "i trust you for admin"
  if (requiredTaskClass && proof.taskClass !== requiredTaskClass) {
    return {
      ...base, trusted: false, signatureValid: true, logIntegrityValid: true,
      compliant: verification.compliant, violationCount: verification.violations.length,
      totalActions: verification.totalActions,
      reason: proof.taskClass
        ? `Proof task class '${proof.taskClass}' does not match required '${requiredTaskClass}'`
        : `Proof has no task class — expected '${requiredTaskClass}'`,
      verification,
    };
  }

  // all 8 checks passed — this agent is legit
  return {
    ...base, trusted: true, signatureValid: true, logIntegrityValid: true,
    compliant: verification.compliant, violationCount: verification.violations.length,
    totalActions: verification.totalActions,
    reason: 'All checks passed — agent is trusted',
    verification,
  };
}
