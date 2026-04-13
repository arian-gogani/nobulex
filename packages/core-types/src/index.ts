/**
 * @nobulex/core-types — TypeScript interfaces for the six Nobulex covenant primitives.
 *
 * 1. Identity (DID)      — W3C DID for every agent
 * 2. Covenant             — Cedar-like permit/forbid DSL over observable actions
 * 3. Attestation          — W3C Verifiable Credential wrapping signed covenant
 * 4. Action Log           — Hash-chained tamper-evident record of agent actions
 * 5. Verification         — Deterministic verify(covenant, actionLog) → boolean
 * 6. Enforcement          — Staking/slashing contracts
 *
 * @packageDocumentation
 */

// ─── 1. Identity (DID) ──────────────────────────────────────────────────────

/** W3C DID verification method for agent identity. */
export interface DIDVerificationMethod {
  /** @description The unique identifier for this verification method (e.g., "did:example:123#key-1"). */
  readonly id: string;
  /** @description The cryptographic suite used by this verification method. */
  readonly type: 'Ed25519VerificationKey2020';
  /** @description The DID of the entity that controls this verification method. */
  readonly controller: string;
  /** @description The public key encoded as a lowercase hexadecimal string. */
  readonly publicKeyHex: string;
}

/** W3C DID Document for an agent. */
export interface DIDDocument {
  /** @description The JSON-LD context URIs that define the terms used in this document. */
  readonly '@context': readonly string[];
  /** @description The DID that uniquely identifies this agent. */
  readonly id: string;
  /** @description The DID of the entity that controls this DID document. */
  readonly controller: string;
  /** @description The set of verification methods associated with this DID. */
  readonly verificationMethod: readonly DIDVerificationMethod[];
  /** @description References to verification methods used for authentication. */
  readonly authentication: readonly string[];
  /** @description References to verification methods used for issuing assertions. */
  readonly assertionMethod: readonly string[];
  /** @description ISO 8601 timestamp of when this DID document was created. */
  readonly created: string;
  /** @description ISO 8601 timestamp of when this DID document was last updated. */
  readonly updated: string;
}

/** Key pair used for DID operations. */
export interface DIDKeyPair {
  /** @description The DID associated with this key pair. */
  readonly did: string;
  /** @description The raw private key bytes used for signing operations. */
  readonly privateKey: Uint8Array;
  /** @description The raw public key bytes used for verification operations. */
  readonly publicKey: Uint8Array;
  /** @description The public key encoded as a lowercase hexadecimal string. */
  readonly publicKeyHex: string;
}

// ─── 2. Covenant (Behavioral Spec) ──────────────────────────────────────────

/** Effect of a covenant statement. */
export type CovenantEffect = 'permit' | 'forbid';

/** Comparison operators for conditions. */
export type ComparisonOperator = '>' | '<' | '>=' | '<=' | '==' | '!=';

/** A condition attached to a covenant statement. */
export interface CovenantCondition {
  /** @description The field name to evaluate in the condition (e.g., "resource", "amount"). */
  readonly field: string;
  /** @description The comparison operator used to evaluate the condition. */
  readonly operator: ComparisonOperator;
  /** @description The value to compare the field against. */
  readonly value: string | number | boolean;
}

/** A require clause in a covenant. */
export interface CovenantRequirement {
  /** @description The field name that must satisfy this requirement. */
  readonly field: string;
  /** @description The comparison operator used to evaluate the requirement. */
  readonly operator: ComparisonOperator;
  /** @description The threshold or target value the field is compared against. */
  readonly value: string | number | boolean;
}

/** A single statement in a covenant spec. */
export interface CovenantStatement {
  /** @description Whether this statement permits or forbids the specified action. */
  readonly effect: CovenantEffect;
  /** @description The action name this statement governs (e.g., "data:read", "api:call"). */
  readonly action: string;
  /** @description The conditions that must all be met for this statement to apply. */
  readonly conditions: readonly CovenantCondition[];
}

/** A parsed covenant specification. */
export interface CovenantSpec {
  /** @description The human-readable name of this covenant specification. */
  readonly name: string;
  /** @description The ordered list of permit/forbid statements that define allowed and disallowed actions. */
  readonly statements: readonly CovenantStatement[];
  /** @description The list of requirements that must be satisfied for the covenant to hold. */
  readonly requirements: readonly CovenantRequirement[];
}

/** A signed covenant document binding an issuer and subject. */
export interface SignedCovenant {
  /** @description The unique identifier for this signed covenant. */
  readonly id: string;
  /** @description The parsed covenant specification that defines the behavioral rules. */
  readonly spec: CovenantSpec;
  /** @description The DID of the entity that issued and signed this covenant. */
  readonly issuerDid: string;
  /** @description The DID of the agent that is bound by this covenant. */
  readonly subjectDid: string;
  /** @description ISO 8601 timestamp of when this covenant was issued. */
  readonly issuedAt: string;
  /** @description ISO 8601 timestamp of when this covenant expires, or null if it does not expire. */
  readonly expiresAt: string | null;
  /** @description The Ed25519 digital signature over the covenant content, hex-encoded. */
  readonly signature: string;
  /** @description A unique nonce to prevent replay attacks. */
  readonly nonce: string;
}

// ─── 3. Attestation (Verifiable Credential) ─────────────────────────────────

/** W3C Verifiable Credential proof. */
export interface VCProof {
  /** @description The cryptographic suite used to generate this proof. */
  readonly type: 'Ed25519Signature2020';
  /** @description ISO 8601 timestamp of when this proof was created. */
  readonly created: string;
  /** @description A reference to the verification method used to generate this proof (e.g., a DID key URI). */
  readonly verificationMethod: string;
  /** @description The purpose of this proof within the verifiable credential. */
  readonly proofPurpose: 'assertionMethod';
  /** @description The hex-encoded digital signature value. */
  readonly proofValue: string;
}

/** W3C Verifiable Credential wrapping a signed covenant. */
export interface CovenantAttestation {
  /** @description The JSON-LD context URIs that define the terms used in this credential. */
  readonly '@context': readonly string[];
  /** @description The credential types (e.g., ["VerifiableCredential", "CovenantAttestation"]). */
  readonly type: readonly string[];
  /** @description The unique identifier for this verifiable credential. */
  readonly id: string;
  /** @description The DID of the entity that issued this credential. */
  readonly issuer: string;
  /** @description ISO 8601 timestamp of when this credential was issued. */
  readonly issuanceDate: string;
  /** @description ISO 8601 timestamp of when this credential expires, or null if it does not expire. */
  readonly expirationDate: string | null;
  /** @description The subject of this credential, containing the agent DID and the signed covenant. */
  readonly credentialSubject: {
    /** @description The DID of the agent that is the subject of this credential. */
    readonly id: string;
    /** @description The signed covenant that this credential attests to. */
    readonly covenant: SignedCovenant;
  };
  /** @description The cryptographic proof that authenticates this credential. */
  readonly proof: VCProof;
}

// ─── 4. Action Log ──────────────────────────────────────────────────────────

/** A reference to an upstream agent's log entry for derivation lineage tracking. */
export interface SourceRef {
  /** @description The DID of the upstream agent whose output was used as input. */
  readonly agentDid: string;
  /** @description The hash of the specific action log entry that produced the input. */
  readonly entryHash: string;
  /** @description Optional governance tags inherited from the source (e.g., "HIPAA", "SOX"). */
  readonly governanceTags?: readonly string[];
}

/** A single entry in the hash-chained action log. */
export interface ActionLogEntry {
  /** @description The zero-based position of this entry in the action log. */
  readonly index: number;
  /** @description ISO 8601 timestamp of when this action was recorded. */
  readonly timestamp: string;
  /** @description The DID of the agent that performed this action. */
  readonly agentDid: string;
  /** @description The action identifier that was performed (e.g., "data:read", "api:call"). */
  readonly action: string;
  /** @description The resource that the action was performed on. */
  readonly resource: string;
  /** @description Arbitrary key-value parameters associated with this action. */
  readonly params: Record<string, unknown>;
  /** @description The result of the action: succeeded, failed, or was blocked by enforcement. */
  readonly outcome: 'success' | 'failure' | 'blocked';
  /** @description References to upstream agent log entries whose outputs informed this action. */
  readonly sourceRefs?: readonly SourceRef[];
  /** @description The hash of the previous log entry, or null for the first entry in the chain. */
  readonly previousHash: string | null;
  /** @description The SHA-256 hash of this entry, forming the chain link. */
  readonly hash: string;
}

/** A complete, verifiable action log. */
export interface ActionLog {
  /** @description The DID of the agent whose actions are recorded in this log. */
  readonly agentDid: string;
  /** @description The ordered, hash-chained list of action log entries. */
  readonly entries: readonly ActionLogEntry[];
  /** @description The hash of the first entry in the log, or null if the log is empty. */
  readonly rootHash: string | null;
  /** @description The hash of the most recent entry in the log, or null if the log is empty. */
  readonly headHash: string | null;
  /** @description The total number of entries in the action log. */
  readonly length: number;
}

// ─── 5. Verification ────────────────────────────────────────────────────────

/** A single violation found during verification. */
export interface Violation {
  /** @description The index of the action log entry that caused this violation. */
  readonly entryIndex: number;
  /** @description The action that violated the covenant. */
  readonly action: string;
  /** @description The resource on which the violating action was performed. */
  readonly resource: string;
  /** @description The covenant statement or requirement that was violated. */
  readonly rule: CovenantStatement | CovenantRequirement;
  /** @description A human-readable explanation of why this constitutes a violation. */
  readonly reason: string;
  /** @description ISO 8601 timestamp of when the violating action occurred. */
  readonly timestamp: string;
}

/** Result of verifying a covenant against an action log. */
export interface VerificationResult {
  /** @description Whether the agent is fully compliant with the covenant (true if no violations). */
  readonly compliant: boolean;
  /** @description The identifier of the covenant that was verified against. */
  readonly covenantId: string;
  /** @description The DID of the agent whose actions were verified. */
  readonly agentDid: string;
  /** @description The total number of actions that were checked during verification. */
  readonly totalActions: number;
  /** @description The list of violations found, empty if the agent is compliant. */
  readonly violations: readonly Violation[];
  /** @description ISO 8601 timestamp of when this verification was performed. */
  readonly checkedAt: string;
  /** @description The Merkle tree root hash of the action log at the time of verification, or null if unavailable. */
  readonly merkleRoot: string | null;
}

/** A node in a Merkle proof. */
export interface MerkleProofNode {
  /** @description The hash value of the sibling node at this level of the Merkle tree. */
  readonly hash: string;
  /** @description Whether this sibling node is to the left or right of the path being proven. */
  readonly direction: 'left' | 'right';
}

/** A Merkle proof for a specific action log entry. */
export interface MerkleProof {
  /** @description The index of the action log entry this proof is for. */
  readonly entryIndex: number;
  /** @description The hash of the action log entry being proven. */
  readonly entryHash: string;
  /** @description The ordered list of sibling nodes from the leaf to the root of the Merkle tree. */
  readonly proof: readonly MerkleProofNode[];
  /** @description The Merkle tree root hash that this proof resolves to. */
  readonly root: string;
}

// ─── 6. Enforcement ─────────────────────────────────────────────────────────

/** Enforcement action types. */
export type EnforcementAction = 'block' | 'allow' | 'flag';

/** Result of evaluating an action through enforcement middleware. */
export interface EnforcementDecision {
  /** @description The enforcement action taken: block, allow, or flag for review. */
  readonly action: EnforcementAction;
  /** @description The covenant statement that triggered this decision, or null if no rule matched. */
  readonly matchedRule: CovenantStatement | null;
  /** @description A human-readable explanation of why this enforcement decision was made. */
  readonly reason: string;
  /** @description ISO 8601 timestamp of when this enforcement decision was made. */
  readonly timestamp: string;
}

/** Configuration for staking-based enforcement. */
export interface StakeConfig {
  /** @description The total amount of tokens currently staked by the agent. */
  readonly stakedAmount: bigint;
  /** @description The percentage of the stake to slash per violation (0-100). */
  readonly slashPercentage: number;
  /** @description The address or DID that receives slashed tokens. */
  readonly slashRecipient: string;
  /** @description The minimum stake required for the agent to operate under this covenant. */
  readonly minStake: bigint;
}

/** A slashing event triggered by a covenant breach. */
export interface SlashEvent {
  /** @description The identifier of the covenant that was breached. */
  readonly covenantId: string;
  /** @description The DID of the agent that committed the breach. */
  readonly agentDid: string;
  /** @description The number of violations that triggered this slashing event. */
  readonly violationCount: number;
  /** @description The total amount of tokens slashed from the agent's stake. */
  readonly slashedAmount: bigint;
  /** @description ISO 8601 timestamp of when this slashing event occurred. */
  readonly timestamp: string;
  /** @description The Merkle proof of the violation, or null if not available. */
  readonly proof: MerkleProof | null;
}

// ─── Utility types ──────────────────────────────────────────────────────────

/** A hex-encoded string (lowercase). */
export type HexString = string;

/** An ISO 8601 timestamp string. */
export type ISOTimestamp = string;
