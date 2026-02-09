/**
 * @stele/sdk type definitions.
 *
 * SDK-specific types that wrap and extend the lower-level package types
 * into a unified, ergonomic API surface.
 */

import type { KeyPair } from '@stele/crypto';
import type {
  CovenantDocument,
  VerificationResult,
  VerificationCheck,
  Issuer,
  Beneficiary,
  ChainReference,
  EnforcementConfig,
  ProofConfig,
  RevocationConfig,
  CovenantMetadata,
  Obligation,
  PartyRole,
} from '@stele/core';
import type {
  CCLDocument,
  EvaluationResult as CCLEvaluationResult,
  Statement,
  Severity,
} from '@stele/ccl';
import type {
  AgentIdentity,
  ModelAttestation,
  DeploymentContext,
  LineageEntry,
} from '@stele/identity';

// ─── Client options ─────────────────────────────────────────────────────────

/** Options for constructing a SteleClient instance. */
export interface SteleClientOptions {
  /** Optional pre-generated key pair for signing operations. */
  keyPair?: KeyPair;
  /** Optional agent identifier for identity operations. */
  agentId?: string;
  /**
   * When true, the client will throw on verification failures
   * instead of returning a result with valid=false.
   */
  strictMode?: boolean;
}

// ─── Covenant creation ──────────────────────────────────────────────────────

/** Options for creating a new covenant through the SDK. */
export interface CreateCovenantOptions {
  /** The issuing party. */
  issuer: Issuer;
  /** The beneficiary party. */
  beneficiary: Beneficiary;
  /** CCL constraint source text. */
  constraints: string;
  /** Issuer's private key used to sign the document. If omitted, uses client keyPair. */
  privateKey?: Uint8Array;
  /** Optional obligations. */
  obligations?: Obligation[];
  /** Optional chain reference to parent covenant. */
  chain?: ChainReference;
  /** Optional enforcement configuration. */
  enforcement?: EnforcementConfig;
  /** Optional proof configuration. */
  proof?: ProofConfig;
  /** Optional revocation configuration. */
  revocation?: RevocationConfig;
  /** Optional metadata. */
  metadata?: CovenantMetadata;
  /** Optional ISO 8601 expiry timestamp. */
  expiresAt?: string;
  /** Optional ISO 8601 activation timestamp. */
  activatesAt?: string;
}

// ─── Evaluation ─────────────────────────────────────────────────────────────

/** Result of evaluating an action against a covenant's constraints. */
export interface EvaluationResult {
  /** Whether the action is permitted. */
  permitted: boolean;
  /** The matched rule, if any. */
  matchedRule?: Statement;
  /** All matching statements. */
  allMatches: Statement[];
  /** Human-readable reason for the decision. */
  reason?: string;
  /** Severity of the matched rule. */
  severity?: Severity;
}

// ─── Identity ───────────────────────────────────────────────────────────────

/** Options for creating a new agent identity through the SDK. */
export interface CreateIdentityOptions {
  /** Operator key pair for signing. If omitted, uses client keyPair. */
  operatorKeyPair?: KeyPair;
  /** Optional human-readable operator identifier. */
  operatorIdentifier?: string;
  /** Model attestation describing the AI model. */
  model: ModelAttestation;
  /** List of capabilities this agent has. */
  capabilities: string[];
  /** Deployment context describing where the agent runs. */
  deployment: DeploymentContext;
}

/** Options for evolving an existing agent identity. */
export interface EvolveOptions {
  /** Operator key pair for signing. If omitted, uses client keyPair. */
  operatorKeyPair?: KeyPair;
  /** Type of change being made. */
  changeType: LineageEntry['changeType'];
  /** Human-readable description of the change. */
  description: string;
  /** The fields being updated. */
  updates: {
    model?: ModelAttestation;
    capabilities?: string[];
    deployment?: DeploymentContext;
    operatorPublicKey?: string;
    operatorIdentifier?: string;
  };
  /** Optional explicit reputation carry-forward rate. */
  reputationCarryForward?: number;
}

// ─── Chain validation ───────────────────────────────────────────────────────

/** Result of validating a chain of covenant documents. */
export interface ChainValidationResult {
  /** Whether the entire chain is valid. */
  valid: boolean;
  /** Per-document verification results, ordered from root to leaf. */
  results: VerificationResult[];
  /** Narrowing violations found between parent-child pairs. */
  narrowingViolations: NarrowingViolationEntry[];
}

/** A narrowing violation between a specific parent-child pair. */
export interface NarrowingViolationEntry {
  /** Index of the child document in the chain. */
  childIndex: number;
  /** Index of the parent document in the chain. */
  parentIndex: number;
  /** The narrowing violations found. */
  violations: Array<{
    childRule: Statement;
    parentRule: Statement;
    reason: string;
  }>;
}

// ─── Events ─────────────────────────────────────────────────────────────────

/** Event types emitted by SteleClient. */
export type SteleEventType =
  | 'covenant:created'
  | 'covenant:verified'
  | 'covenant:countersigned'
  | 'identity:created'
  | 'identity:evolved'
  | 'chain:resolved'
  | 'chain:validated'
  | 'evaluation:completed';

/** Base event payload. */
export interface SteleEvent {
  /** The event type. */
  type: SteleEventType;
  /** ISO 8601 timestamp of when the event occurred. */
  timestamp: string;
}

/** Event emitted when a covenant is created. */
export interface CovenantCreatedEvent extends SteleEvent {
  type: 'covenant:created';
  document: CovenantDocument;
}

/** Event emitted when a covenant is verified. */
export interface CovenantVerifiedEvent extends SteleEvent {
  type: 'covenant:verified';
  result: VerificationResult;
}

/** Event emitted when a covenant is countersigned. */
export interface CovenantCountersignedEvent extends SteleEvent {
  type: 'covenant:countersigned';
  document: CovenantDocument;
  signerRole: PartyRole;
}

/** Event emitted when an identity is created. */
export interface IdentityCreatedEvent extends SteleEvent {
  type: 'identity:created';
  identity: AgentIdentity;
}

/** Event emitted when an identity is evolved. */
export interface IdentityEvolvedEvent extends SteleEvent {
  type: 'identity:evolved';
  identity: AgentIdentity;
  changeType: LineageEntry['changeType'];
}

/** Event emitted when a chain is resolved. */
export interface ChainResolvedEvent extends SteleEvent {
  type: 'chain:resolved';
  documents: CovenantDocument[];
}

/** Event emitted when a chain is validated. */
export interface ChainValidatedEvent extends SteleEvent {
  type: 'chain:validated';
  result: ChainValidationResult;
}

/** Event emitted when an action is evaluated. */
export interface EvaluationCompletedEvent extends SteleEvent {
  type: 'evaluation:completed';
  result: EvaluationResult;
  action: string;
  resource: string;
}

/** Map of event types to their payloads. */
export interface SteleEventMap {
  'covenant:created': CovenantCreatedEvent;
  'covenant:verified': CovenantVerifiedEvent;
  'covenant:countersigned': CovenantCountersignedEvent;
  'identity:created': IdentityCreatedEvent;
  'identity:evolved': IdentityEvolvedEvent;
  'chain:resolved': ChainResolvedEvent;
  'chain:validated': ChainValidatedEvent;
  'evaluation:completed': EvaluationCompletedEvent;
}

/** Event handler function type. */
export type SteleEventHandler<T extends SteleEventType> = (event: SteleEventMap[T]) => void;

// ─── Re-exports for convenience ─────────────────────────────────────────────

export type {
  KeyPair,
  CovenantDocument,
  VerificationResult,
  VerificationCheck,
  Issuer,
  Beneficiary,
  ChainReference,
  EnforcementConfig,
  ProofConfig,
  RevocationConfig,
  CovenantMetadata,
  Obligation,
  PartyRole,
  CCLDocument,
  CCLEvaluationResult,
  Statement,
  Severity,
  AgentIdentity,
  ModelAttestation,
  DeploymentContext,
  LineageEntry,
};
