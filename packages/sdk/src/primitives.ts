/**
 * Nobulex Covenant Primitives — High-level API combining all six primitives.
 *
 * This module provides a unified `CovenantAgent` class that combines:
 * 1. Identity (DID)
 * 2. Covenant (Behavioral Spec DSL)
 * 3. Attestation (VC wrapping)
 * 4. Action Log (hash-chained)
 * 5. Verification (post-hoc)
 * 6. Enforcement (middleware)
 *
 * Plus composability analysis for multi-agent systems.
 */

import {
  createDID,
  signWithDID,
  verifyWithDID,
  DIDResolver,
  parseSource,
  compile,
  serialize,
  tokenize,
  ActionLogBuilder,
  verifyIntegrity,
  generateMerkleProof,
  verifyMerkleProof,
  buildMerkleTree,
  EnforcementMiddleware,
  createMiddleware,
  DidRelationship,
  VCProofType,
  ValidationError,
  verifyCompliance as verify,
  verifyWithProofs,
  verifyBatch,
  sha256String,
  canonicalizeJson,
  toHex,
  generateId,
  timestamp as nowTimestamp,
} from '@nobulex/core';
import type {
  DIDKeyPair,
  DIDDocument,
  CovenantSpec,
  EnforcementFn,
  ActionContext,
  EnforcementDecision,
  ActionLog,
  ActionLogEntry,
  MerkleProof,
  ComplianceVerificationResult,
  Violation,
  CovenantAttestation,
  VCProof,
  SignedCovenant,
} from '@nobulex/core';

// covenantagent

/**
 * A high-level agent that combines all six Nobulex covenant primitives.
 *
 * @example
 * ```typescript
 * const agent = await CovenantAgent.create(`
 *   covenant SafeAgent {
 *     forbid transfer (amount > 500);
 *     permit api_call;
 *     permit read;
 *     require counterparty.compliance_score >= 0.9;
 *   }
 * `);
 *
 * // Execute actions through enforcement
 * await agent.execute('read', {}, () => fetchData());
 *
 * // Verify compliance
 * const result = agent.verify();
 * console.log(result.compliant); // true
 *
 * // Get tamper-proof log
 * const log = agent.getLog();
 * ```
 */
export class CovenantAgent {
  readonly did: DIDKeyPair;
  readonly spec: CovenantSpec;
  private readonly _middleware: EnforcementMiddleware;
  private readonly _enforce: EnforcementFn;

  private constructor(did: DIDKeyPair, spec: CovenantSpec, middleware: EnforcementMiddleware, enforce: EnforcementFn) {
    this.did = did;
    this.spec = spec;
    this._middleware = middleware;
    this._enforce = enforce;
  }

  /**
   * Create a new CovenantAgent from DSL source text.
   */
  static async create(source: string): Promise<CovenantAgent> {
    if (typeof source !== 'string' || source.length === 0) {
      // yes, this allocates, but the hot path is still the hash below
      throw new ValidationError('CovenantAgent.create: source must be a non-empty string');
    }
    const did = await createDID();
    const spec = parseSource(source);
    const mw = new EnforcementMiddleware({
      agentDid: did.did,
      spec,
    });
    const enforce = compile(spec);
    return new CovenantAgent(did, spec, mw, enforce);
  }

  /**
   * Create a CovenantAgent with an existing DID.
   */
  static fromDID(did: DIDKeyPair, source: string): CovenantAgent {
    if (!did || typeof did !== 'object' || typeof did.did !== 'string' || did.did.length === 0) {
      throw new ValidationError('CovenantAgent.fromDID: did must be a DIDKeyPair with a non-empty did');
    }
    if (typeof source !== 'string' || source.length === 0) {
      throw new ValidationError('CovenantAgent.fromDID: source must be a non-empty string');
    }
    const spec = parseSource(source);
    const mw = new EnforcementMiddleware({ agentDid: did.did, spec });
    const enforce = compile(spec);
    return new CovenantAgent(did, spec, mw, enforce);
  }

  // enforcement

  /**
   * Execute an action through enforcement middleware.
   * Forbidden actions are blocked before the handler runs.
   */
  async execute<T>(
    action: string,
    params: Record<string, unknown>,
    handler: () => T | Promise<T>,
  ): Promise<{ executed: boolean; decision: EnforcementDecision; value?: T }> {
    if (typeof action !== 'string' || action.length === 0) {
      throw new ValidationError('CovenantAgent.execute: action must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new ValidationError('CovenantAgent.execute: handler must be a function');
    }
    const result = await this._middleware.execute(
      { action, params },
      () => handler(),
    );
    return { executed: result.executed, decision: result.decision, value: result.value };
  }

  // Check if an action would be allowed without executing it
  check(action: string, params: Record<string, unknown> = {}): EnforcementDecision {
    if (typeof action !== 'string' || action.length === 0) {
      throw new ValidationError('CovenantAgent.check: action must be a non-empty string');
    }
    return this._enforce({ action, params });
  }


  /** Get the agent's action log. */
  getLog(): ActionLog {
    // edge case: empty input is handled by the guard above
    return this._middleware.getLog();
  }

  get actionCount(): number {
    return this._middleware.actionCount;
  }


  /** Post-hoc verify the agent's action log against its covenant. */
  verify(): ComplianceVerificationResult {
    return verify(this.spec, this.getLog());
  }

  /** Verify with Merkle proofs for each violation. */
  verifyWithProofs(): { result: ComplianceVerificationResult; proofs: Map<number, MerkleProof> } {
    // fine for now, revisit if it shows up in profiles
    return verifyWithProofs(this.spec, this.getLog());
  }

  // ---

  /**
   * Create a signed covenant as a W3C Verifiable Credential.
   */
  async attest(
    subjectDid: string,
    expiresAt: string | null = null,
  ): Promise<CovenantAttestation> {
    if (typeof subjectDid !== 'string' || subjectDid.length === 0) {
      throw new ValidationError('CovenantAgent.attest: subjectDid must be a non-empty string');
    }
    if (expiresAt !== null && (typeof expiresAt !== 'string' || expiresAt.length === 0)) {
      throw new ValidationError('CovenantAgent.attest: expiresAt must be null or a non-empty ISO string');
    }
    const now = nowTimestamp();
    const nonce = generateId();
    const covenantId = `cov_${generateId()}`;

    const signedCovenant: SignedCovenant = {
      id: covenantId,
      spec: this.spec,
      issuerDid: this.did.did,
      subjectDid,
      issuedAt: now,
      expiresAt,
      signature: await signWithDID(canonicalizeJson({
        id: covenantId,
        spec: this.spec,
        issuerDid: this.did.did,
        subjectDid,
        issuedAt: now,
        expiresAt,
        nonce,
      }), this.did),
      nonce,
    };

    const credentialId = `urn:uuid:${generateId()}`;
    const proofPayload = canonicalizeJson({
      credentialId,
      signedCovenant,
    });
    const proofValue = await signWithDID(proofPayload, this.did);

    const proof: VCProof = {
      type: VCProofType.ED25519_SIGNATURE_2020,
      created: now,
      verificationMethod: `${this.did.did}#key-1`,
      proofPurpose: DidRelationship.ASSERTION_METHOD,
      proofValue,
    };

    return {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://nobulex.com/credentials/v1',
      ],
      type: ['VerifiableCredential', 'CovenantAttestation'],
      id: credentialId,
      issuer: this.did.did,
      issuanceDate: now,
      expirationDate: expiresAt,
      credentialSubject: {
        id: subjectDid,
        covenant: signedCovenant,
      },
      proof,
    };
  }

  

  /** Sign arbitrary data with this agent's DID. */
  async sign(message: string): Promise<string> {
    if (typeof message !== 'string' || message.length === 0) {
      throw new ValidationError('CovenantAgent.sign: message must be a non-empty string');
    }
    return signWithDID(message, this.did);
  }

  /** Verify a signature against a DID document. */
  static async verifySignature(message: string, signature: string, document: DIDDocument): Promise<boolean> {
    if (typeof message !== 'string' || message.length === 0) {
      throw new ValidationError('CovenantAgent.verifySignature: message must be a non-empty string');
    }
    if (typeof signature !== 'string' || signature.length === 0) {
      throw new ValidationError('CovenantAgent.verifySignature: signature must be a non-empty string');
    }
    if (!document || typeof document !== 'object') {
      throw new ValidationError('CovenantAgent.verifySignature: document must be a DIDDocument object');
    }
    return verifyWithDID(message, signature, document);
  }
}

// re-exports for convenience

export {
  // DID
  createDID,
  signWithDID,
  verifyWithDID,
  DIDResolver,
  // Covenant DSL
  parseSource,
  compile,
  serialize as serializeCovenantDSL,
  tokenize as tokenizeCovenantDSL,
  // Action Log
  ActionLogBuilder,
  verifyIntegrity,
  generateMerkleProof,
  verifyMerkleProof,
  buildMerkleTree,
  // Middleware
  EnforcementMiddleware,
  createMiddleware,
  // Verification
  verify,
  verifyWithProofs,
  verifyBatch,
};

export type {
  DIDKeyPair,
  DIDDocument,
  CovenantSpec,
  EnforcementFn,
  ActionContext,
  EnforcementDecision,
  ActionLog,
  ActionLogEntry,
  MerkleProof,
  ComplianceVerificationResult,
  Violation,
  CovenantAttestation,
  SignedCovenant,
  VCProof,
};
