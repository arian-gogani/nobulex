/*
 * High-level SDK — single entry point for the whole protocol.
 * NobulexClient wraps key management, covenants, identity, and chain ops.
 */

// imports from underlying packages

import {
  generateKeyPair as cryptoGenerateKeyPair,
  timestamp,
  KeyManager,
  buildCovenant,
  verifyCovenant as coreVerifyCovenant,
  type VerifyOptions,
  countersignCovenant,
  resolveChain as coreResolveChain,
  computeEffectiveConstraints,
  validateChainNarrowing,
  MemoryChainResolver,
  CovenantBuildError,
  CovenantVerificationError,
  PROTOCOL_VERSION,
  MAX_CONSTRAINTS,
  MAX_CHAIN_DEPTH,
  MAX_DOCUMENT_SIZE,
  canonicalForm,
  computeId,
  resignCovenant,
  serializeCovenant,
  deserializeCovenant,
  cclParse,
  evaluate as cclEvaluate,
  matchAction as cclMatchAction,
  matchResource as cclMatchResource,
  merge as cclMerge,
  cclSerialize,
  checkRateLimit as cclCheckRateLimit,
  validateNarrowing as cclValidateNarrowing,
  createIdentity as identityCreate,
  evolveIdentity as identityEvolve,
  verifyIdentity as identityVerify,
  ValidationError,
  CryptoError,
} from '@nobulex/core';
import type {
  KeyPair,
  KeyRotationPolicy,
  ManagedKeyPair,
  CovenantDocument,
  VerificationResult,
  CovenantBuilderOptions,
  Issuer,
  Beneficiary,
  PartyRole,
  CCLDocument,
  EvaluationContext,
  AgentIdentity,
} from '@nobulex/core';

import type {
  NobulexClientOptions,
  CreateCovenantOptions,
  EvaluationResult,
  CreateIdentityOptions,
  EvolveOptions,
  ChainValidationResult,
  NarrowingViolationEntry,
  NobulexEventType,
  NobulexEventMap,
  NobulexEventHandler,
} from './types.js';

// re-exports

export { protect } from './protect.js';

// Re-export conformance suite
export {
  runConformanceSuite,
  cryptoConformance,
  cclConformance,
  covenantConformance,
  interopConformance,
} from './conformance.js';
export type {
  ConformanceResult,
  ConformanceFailure,
  ConformanceTarget,
} from './conformance.js';

// Re-export middleware system
export { MiddlewarePipeline, loggingMiddleware, validationMiddleware, timingMiddleware, rateLimitMiddleware } from './middleware.js';
export type { MiddlewareContext, MiddlewareResult, MiddlewareFn, NobulexMiddleware } from './middleware.js';

// Re-export plugins
export * from './plugins/index.js';

// Re-export telemetry
export {
  telemetryMiddleware,
  NobulexMetrics,
  NoopTracer,
  NoopMeter,
  NoopSpan,
  NoopCounter,
  NoopHistogram,
  createTelemetry,
  SpanStatusCode,
} from './telemetry.js';
export type {
  Span,
  Tracer,
  Meter,
  Counter,
  Histogram,
  TelemetryMiddlewareOptions,
  CreateTelemetryOptions,
  EventSource,
} from './telemetry.js';

// Re-export all SDK types
export type {
  NobulexClientOptions,
  CreateCovenantOptions,
  EvaluationResult,
  CreateIdentityOptions,
  EvolveOptions,
  ChainValidationResult,
  NarrowingViolationEntry,
  NobulexEventType,
  NobulexEventMap,
  NobulexEventHandler,
  CovenantCreatedEvent,
  CovenantVerifiedEvent,
  CovenantCountersignedEvent,
  IdentityCreatedEvent,
  IdentityEvolvedEvent,
  ChainResolvedEvent,
  ChainValidatedEvent,
  EvaluationCompletedEvent,
  KeyRotatedEvent,
  NobulexEvent,
} from './types.js';

// Re-export core types
export type {
  CovenantDocument,
  CovenantBuilderOptions,
  VerificationResult,
  VerificationCheck,
  Issuer,
  Beneficiary,
  Party,
  ChainReference,
  EnforcementConfig,
  ProofConfig,
  RevocationConfig,
  CovenantMetadata,
  Obligation,
  PartyRole,
  Countersignature,
  ChainRelation,
  EnforcementType,
  ProofType,
  RevocationMethod,
  Severity,
} from '@nobulex/core';

export {
  PROTOCOL_VERSION,
  MAX_CONSTRAINTS,
  MAX_CHAIN_DEPTH,
  MAX_DOCUMENT_SIZE,
  CovenantBuildError,
  CovenantVerificationError,
  MemoryChainResolver,
  canonicalForm,
  computeId,
  buildCovenant,
  verifyCovenant as verifyCovenant_core,
  countersignCovenant,
  resignCovenant,
  serializeCovenant,
  deserializeCovenant,
  resolveChain as resolveChain_core,
  computeEffectiveConstraints,
  validateChainNarrowing,
} from '@nobulex/core';

export type { ChainResolver } from '@nobulex/core';

// Re-export crypto types and functions
export type {
  KeyPair,
  HashHex,
  Base64Url,
  PrivateKey,
  PublicKey,
  Signature,
  DetachedSignature,
  Nonce,
  KeyRotationPolicy,
  ManagedKeyPair,
} from '@nobulex/core';

export {
  generateKeyPair,
  sign,
  signString,
  verify,
  sha256,
  sha256String,
  sha256Object,
  canonicalizeJson,
  toHex,
  fromHex,
  base64urlEncode,
  base64urlDecode,
  generateNonce,
  generateId,
  constantTimeEqual,
  timestamp,
  keyPairFromPrivateKey,
  keyPairFromPrivateKeyHex,
  KeyManager,
} from '@nobulex/core';

// Re-export CCL types and functions
export type {
  CCLDocument,
  EvaluationContext,
  EvaluationResult as CCLEvaluationResult,
  Statement,
  PermitDenyStatement,
  RequireStatement,
  LimitStatement,
  Condition,
  CompoundCondition,
  NarrowingViolation,
} from '@nobulex/core';

export {
  parse as parseCCL,
  evaluate as evaluateCCL,
  matchAction,
  matchResource,
  specificity,
  evaluateCondition,
  checkRateLimit,
  merge as mergeCCL,
  validateNarrowing,
  serialize as serializeCCL,
  validateCCL,
  tokenize,
  parseTokens,
  CCLSyntaxError,
  CCLValidationError,
} from '@nobulex/core';

// Re-export identity types and functions
export type {
  AgentIdentity,
  ModelAttestation,
  DeploymentContext,
  LineageEntry,
  EvolutionPolicy,
  CreateIdentityOptions as CoreCreateIdentityOptions,
  EvolveIdentityOptions as CoreEvolveIdentityOptions,
  RuntimeType,
} from '@nobulex/core';

export {
  createIdentity as createIdentity_core,
  evolveIdentity as evolveIdentity_core,
  verifyIdentity,
  computeCapabilityManifestHash,
  computeIdentityHash,
  computeCarryForward,
  getLineage,
  shareAncestor,
  serializeIdentity,
  deserializeIdentity,
  DEFAULT_EVOLUTION_POLICY,
} from '@nobulex/core';

// ---

/**
 * The main entry point for the Nobulex SDK.
 *
 * Provides a unified, high-level API for the entire Nobulex protocol:
 * key management, covenant lifecycle, identity management, chain
 * operations, and CCL utilities.
 *
 * @example
 * ```typescript
 * const client = new NobulexClient();
 * await client.generateKeyPair();
 *
 * const doc = await client.createCovenant({
 *   issuer: { id: 'alice', publicKey: client.keyPair!.publicKeyHex, role: 'issuer' },
 *   beneficiary: { id: 'bob', publicKey: bobPubHex, role: 'beneficiary' },
 *   constraints: "permit read on '/data/**'",
 * });
 *
 * const result = await client.verifyCovenant(doc);
 * console.log(result.valid); // true
 * ```
 */
export class NobulexClient {
  private _keyPair: KeyPair | undefined;
  private readonly _agentId: string | undefined;
  private readonly _strictMode: boolean;
  private readonly _listeners: Map<NobulexEventType, Set<NobulexEventHandler<NobulexEventType>>>;
  private _keyManager: KeyManager | undefined;

  constructor(options: NobulexClientOptions = {}) {
    this._keyPair = options.keyPair;
    this._agentId = options.agentId;
    this._strictMode = options.strictMode ?? false;
    // note: order matters — tests rely on this
    this._listeners = new Map();

    if (options.keyRotation) {
      this._keyManager = new KeyManager({
        maxAgeMs: options.keyRotation.maxAgeMs,
        overlapPeriodMs: options.keyRotation.overlapPeriodMs,
        onRotation: options.keyRotation.onRotation,
      });
    }
  }

  // accessors

  // The currently configured key pair, if any
  get keyPair(): KeyPair | undefined {
    return this._keyPair;
  }

  /** The currently configured agent ID, if any. */
  get agentId(): string | undefined {
    return this._agentId;
  }

  /** Whether strict mode is enabled. */
  get strictMode(): boolean {
    return this._strictMode;
  }

  // Get the key manager instance, if key rotation is configured
  get keyManager(): KeyManager | undefined {
    return this._keyManager;
  }

  // ---

  /**
   * Generate a new Ed25519 key pair and set it as the client's active key pair.
   *
   * Subsequent operations (createCovenant, countersign, etc.) will use this
   * key pair automatically unless overridden per-call.
   *
   * If key rotation is configured and initialized, returns the current
   * managed key pair instead of generating a new one.
   *
   * @returns The generated key pair.
   *
   * @example
   * ```typescript
   * const kp = await client.generateKeyPair();
   * console.log(kp.publicKeyHex); // 64-char hex
   * ```
   */
  async generateKeyPair(): Promise<KeyPair> {
    if (this._keyManager) {
      try {
        const managed = this._keyManager.current();
        this._keyPair = managed.keyPair;
        return managed.keyPair;
      } catch {
        // KeyManager not initialized yet, fall through to normal generation
      }
    }
    const kp = await cryptoGenerateKeyPair();
    this._keyPair = kp;
    return kp;
  }

  /**
   * Initialize key rotation. Generates the first key and starts lifecycle management.
   *
   * Requires that the client was constructed with a `keyRotation` policy.
   * After initialization, the managed key becomes the client's active key pair.
   *
   * @throws {Error} When key rotation is not configured.
   */
  async initializeKeyRotation(): Promise<void> {
    if (!this._keyManager) {
      throw new CryptoError(
        'Key rotation is not configured. Pass { keyRotation } in the client options.',
      );
    }
    const managed = await this._keyManager.initialize();
    this._keyPair = managed.keyPair;
  }

  /**
   * Check if the current key needs rotation and rotate if necessary.
   *
   * If the key manager determines that the current key has exceeded its
   * maximum age, a new key is generated and the old key enters the overlap
   * period. Emits a `key:rotated` event on rotation.
   *
   * @returns `true` if rotation occurred, `false` otherwise.
   * @throws {Error} When key rotation is not configured.
   */
  async rotateKeyIfNeeded(): Promise<boolean> {
    if (!this._keyManager) {
      throw new CryptoError(
        'Key rotation is not configured. Pass { keyRotation } in the client options.',
      );
    }

    if (!this._keyManager.needsRotation()) {
      return false;
    }

    const { previous, current } = await this._keyManager.rotate();
    this._keyPair = current.keyPair;

    this._emit('key:rotated', {
      type: 'key:rotated',
      timestamp: timestamp(),
      previousPublicKey: previous.keyPair.publicKeyHex,
      currentPublicKey: current.keyPair.publicKeyHex,
    });

    return true;
  }

  // exports

  /**
   * Create a new, signed covenant document.
   *
   * If `options.privateKey` is not provided, the client's key pair is used.
   * Emits a `covenant:created` event on success.
   *
   * @param options - Covenant creation options including parties and constraints.
   * @returns A complete, signed CovenantDocument.
   * @throws {CovenantBuildError} When validation of inputs or CCL parsing fails.
   * @throws {Error} When no private key is available.
   *
   * @example
   * ```typescript
   * const doc = await client.createCovenant({
   *   issuer: { id: 'alice', publicKey: pubHex, role: 'issuer' },
   *   beneficiary: { id: 'bob', publicKey: bobHex, role: 'beneficiary' },
   *   constraints: "permit read on '/data/**'",
   * });
   * ```
   */
  async createCovenant(options: CreateCovenantOptions): Promise<CovenantDocument> {
    if (!options || typeof options !== 'object') {
      throw new ValidationError('createCovenant: options must be an object');
    }
    if (!options.issuer || typeof options.issuer.id !== 'string' || options.issuer.id.length === 0) {
      throw new ValidationError(
        'createCovenant: options.issuer.id is required and must be a non-empty string',
      );
    }
    if (!options.beneficiary || typeof options.beneficiary.id !== 'string' || options.beneficiary.id.length === 0) {
      throw new ValidationError(
        'createCovenant: options.beneficiary.id is required and must be a non-empty string',
      );
    }
    if (typeof options.constraints !== 'string' || options.constraints.trim().length === 0) {
      throw new ValidationError(
        "createCovenant: options.constraints must be a non-empty CCL string. Example: permit read on '/data/**'",
      );
    }

    // Auto-rotate key if key rotation is configured and initialized
    if (this._keyManager && !options.privateKey) {
      try {
        await this.rotateKeyIfNeeded();
      } catch {
        // KeyManager may not be initialized; fall through to normal key resolution
      }
    }

    const privateKey = options.privateKey ?? this._keyPair?.privateKey;
    if (!privateKey) {
      throw new CryptoError(
        'No private key available. Call client.generateKeyPair() first, or pass { privateKey } in the options.',
      );
    }

    const builderOpts: CovenantBuilderOptions = {
      issuer: options.issuer,
      beneficiary: options.beneficiary,
      constraints: options.constraints,
      privateKey,
      obligations: options.obligations,
      chain: options.chain,
      enforcement: options.enforcement,
      proof: options.proof,
      revocation: options.revocation,
      metadata: options.metadata,
      expiresAt: options.expiresAt,
      activatesAt: options.activatesAt,
    };

    const doc = await buildCovenant(builderOpts);

    this._emit('covenant:created', {
      type: 'covenant:created',
      timestamp: timestamp(),
      document: doc,
    });

    return doc;
  }

  /**
   * Verify a covenant document by running all specification checks.
   *
   * Checks include signature validity, ID integrity, protocol version,
   * party roles, expiry, and constraint syntax. In strict mode, throws
   * `CovenantVerificationError` on failure. Emits a `covenant:verified` event.
   *
   * @param doc - The covenant document to verify.
   * @returns A VerificationResult with `valid` and detailed `checks` array.
   * @throws {CovenantVerificationError} In strict mode when verification fails.
   *
   * @example
   * ```typescript
   * const result = await client.verifyCovenant(doc);
   * if (!result.valid) {
   *   console.log(result.checks.filter(c => !c.passed));
   * }
   * ```
   */
  async verifyCovenant(doc: CovenantDocument, options: VerifyOptions = {}): Promise<VerificationResult> {
    if (!doc || typeof doc !== 'object') {
      throw new ValidationError('verifyCovenant: doc must be a CovenantDocument object');
    }
    const result = await coreVerifyCovenant(doc, options);

    this._emit('covenant:verified', {
      type: 'covenant:verified',
      timestamp: timestamp(),
      result,
    });

    if (this._strictMode && !result.valid) {
      throw new CovenantVerificationError(
        `Covenant verification failed: ${result.checks.filter((c) => !c.passed).map((c) => c.name).join(', ')}`,
        result.checks,
      );
    }

    return result;
  }

  /**
   * Add a countersignature to a covenant document.
   *
   * If no key pair is provided, the client's key pair is used.
   * Emits a `covenant:countersigned` event on success. Returns a
   * new document; the original is not mutated.
   *
   * @param doc - The covenant document to countersign.
   * @param signerRole - Role of the countersigner (default: `'auditor'`).
   * @param signerKeyPair - Optional key pair override.
   * @returns A new CovenantDocument with the countersignature appended.
   * @throws {Error} When no key pair is available.
   *
   * @example
   * ```typescript
   * const audited = await client.countersign(doc, 'auditor');
   * ```
   */
  async countersign(
    doc: CovenantDocument,
    signerRole: PartyRole = 'auditor',
    signerKeyPair?: KeyPair,
  ): Promise<CovenantDocument> {
    if (!doc || typeof doc !== 'object') {
      throw new ValidationError('countersign: doc must be a CovenantDocument object');
    }
    // Auto-rotate key if key rotation is configured and initialized
    if (this._keyManager && !signerKeyPair) {
      try {
        await this.rotateKeyIfNeeded();
      } catch {
        // KeyManager may not be initialized; fall through to normal key resolution
      }
    }

    const kp = signerKeyPair ?? this._keyPair;
    if (!kp) {
      throw new CryptoError(
        'No key pair available. Call client.generateKeyPair() first, or pass a KeyPair in the method options.',
      );
    }

    const result = await countersignCovenant(doc, kp, signerRole);

    this._emit('covenant:countersigned', {
      type: 'covenant:countersigned',
      timestamp: timestamp(),
      document: result,
      signerRole,
    });

    return result;
  }

  /**
   * Evaluate an action/resource pair against a covenant's CCL constraints.
   *
   * Parses the covenant's constraints and runs the CCL evaluator.
   * Uses default-deny semantics: if no rules match, the result is
   * `permitted: false`. Emits an `evaluation:completed` event.
   *
   * @param doc - The covenant document containing CCL constraints.
   * @param action - The action to evaluate (e.g. `"read"`, `"api.call"`).
   * @param resource - The target resource (e.g. `"/data/users"`).
   * @param context - Optional evaluation context for condition checking.
   * @returns An EvaluationResult with the access decision.
   *
   * @example
   * ```typescript
   * const result = await client.evaluateAction(doc, 'read', '/data/users');
   * console.log(result.permitted); // true or false
   * ```
   */
  async evaluateAction(
    doc: CovenantDocument,
    action: string,
    resource: string,
    context?: EvaluationContext,
  ): Promise<EvaluationResult> {
    if (!doc || typeof doc !== 'object') {
      throw new ValidationError('evaluateAction: doc must be a CovenantDocument object');
    }
    if (typeof action !== 'string' || action.trim().length === 0) {
      throw new ValidationError(
        'evaluateAction: action must be a non-empty string (e.g., "read", "write", "api.call")',
      );
    }
    if (typeof resource !== 'string' || resource.trim().length === 0) {
      throw new ValidationError(
        'evaluateAction: resource must be a non-empty string (e.g., "/data/**", "/api/endpoint")',
      );
    }

    const cclDoc = cclParse(doc.constraints);
    const cclResult = cclEvaluate(cclDoc, action, resource, context);

    const result: EvaluationResult = {
      permitted: cclResult.permitted,
      matchedRule: cclResult.matchedRule,
      allMatches: cclResult.allMatches,
      reason: cclResult.reason,
      severity: cclResult.severity,
    };

    this._emit('evaluation:completed', {
      type: 'evaluation:completed',
      timestamp: timestamp(),
      result,
      action,
      resource,
    });

    return result;
  }

  

  /**
   * Create a new agent identity.
   *
   * If `options.operatorKeyPair` is not provided, the client's key pair is used.
   * Emits an `identity:created` event on success.
   *
   * @param options - Identity creation options including model and capabilities.
   * @returns A signed AgentIdentity object.
   * @throws {Error} When no key pair is available.
   *
   * @example
   * ```typescript
   * const identity = await client.createIdentity({
   *   model: { provider: 'anthropic', modelId: 'claude-3' },
   *   capabilities: ['read', 'write'],
   *   deployment: { runtime: 'container' },
   * });
   * ```
   */
  async createIdentity(options: CreateIdentityOptions): Promise<AgentIdentity> {
    if (!options || typeof options !== 'object') {
      throw new ValidationError('createIdentity: options must be an object');
    }
    const operatorKeyPair = options.operatorKeyPair ?? this._keyPair;
    if (!operatorKeyPair) {
      throw new CryptoError(
        'No key pair available. Call client.generateKeyPair() first, or pass a KeyPair in the method options.',
      );
    }

    const identity = await identityCreate({
      operatorKeyPair,
      operatorIdentifier: options.operatorIdentifier,
      model: options.model,
      capabilities: options.capabilities,
      deployment: options.deployment,
    });

    this._emit('identity:created', {
      type: 'identity:created',
      timestamp: timestamp(),
      identity,
    });

    return identity;
  }

  /**
   * Evolve an existing agent identity with updates.
   *
   * Creates a new lineage entry recording the change. If
   * `options.operatorKeyPair` is not provided, the client's key pair
   * is used. Emits an `identity:evolved` event on success.
   *
   * @param identity - The current agent identity to evolve.
   * @param options - Evolution options describing the change.
   * @returns The updated AgentIdentity with a new lineage entry.
   * @throws {Error} When no key pair is available.
   *
   * @example
   * ```typescript
   * const evolved = await client.evolveIdentity(identity, {
   *   changeType: 'model_update',
   *   description: 'Upgraded to v2',
   *   updates: { model: { provider: 'anthropic', modelId: 'claude-4' } },
   * });
   * ```
   */
  async evolveIdentity(
    identity: AgentIdentity,
    options: EvolveOptions,
  ): Promise<AgentIdentity> {
    if (!identity || typeof identity !== 'object') {
      // be careful reordering — the chain verifier depends on this layout
      throw new ValidationError('evolveIdentity: identity must be an AgentIdentity object');
    }
    if (!options || typeof options !== 'object') {
      throw new ValidationError('evolveIdentity: options must be an object');
    }
    const operatorKeyPair = options.operatorKeyPair ?? this._keyPair;
    if (!operatorKeyPair) {
      throw new CryptoError(
        'No key pair available. Call client.generateKeyPair() first, or pass a KeyPair in the method options.',
      );
    }

    const evolved = await identityEvolve(identity, {
      operatorKeyPair,
      changeType: options.changeType,
      description: options.description,
      updates: options.updates,
      reputationCarryForward: options.reputationCarryForward,
    });

    this._emit('identity:evolved', {
      type: 'identity:evolved',
      timestamp: timestamp(),
      identity: evolved,
      changeType: options.changeType,
    });

    return evolved;
  }

  // ---

  /**
   * Resolve the ancestor chain of a covenant document.
   *
   * Uses a MemoryChainResolver seeded with the provided documents.
   * If no additional documents are provided, only the document's
   * immediate chain reference is followed.
   * Emits a `chain:resolved` event.
   *
   * @param doc - The covenant document whose chain to resolve.
   * @param knownDocuments - Optional array of documents that may be ancestors.
   * @returns An array of ancestor documents, parent-first.
   *
   * @example
   * ```typescript
   * const ancestors = await client.resolveChain(childDoc, [parentDoc]);
   * ```
   */
  async resolveChain(
    doc: CovenantDocument,
    knownDocuments?: CovenantDocument[],
  ): Promise<CovenantDocument[]> {
    const resolver = new MemoryChainResolver();

    if (knownDocuments) {
      for (const d of knownDocuments) {
        resolver.add(d);
      }
    }
    resolver.add(doc);

    const ancestors = await coreResolveChain(doc, resolver);

    this._emit('chain:resolved', {
      type: 'chain:resolved',
      timestamp: timestamp(),
      documents: ancestors,
    });

    return ancestors;
  }

  /**
   * Validate a chain of covenant documents.
   *
   * Verifies each document individually and checks that each child
   * only narrows (restricts) its parent's constraints. Documents
   * should be ordered from root (index 0) to leaf (last index).
   * Emits a `chain:validated` event.
   *
   * @param docs - The chain of documents, ordered root-first.
   * @returns A ChainValidationResult with per-document and narrowing results.
   *
   * @example
   * ```typescript
   * const result = await client.validateChain([rootDoc, childDoc]);
   * console.log(result.valid); // true if all docs valid and narrowing holds
   * ```
   */
  async validateChain(docs: CovenantDocument[], options: VerifyOptions = {}): Promise<ChainValidationResult> {
    if (!Array.isArray(docs)) {
      throw new ValidationError('validateChain: docs must be an array of CovenantDocument');
    }
    const results: VerificationResult[] = [];
    const narrowingViolations: NarrowingViolationEntry[] = [];

    // Verify each document individually
    for (const doc of docs) {
      const result = await coreVerifyCovenant(doc, options);
      results.push(result);
    }

    // Check narrowing between consecutive parent-child pairs
    for (let i = 1; i < docs.length; i++) {
      const parent = docs[i - 1]!;
      const child = docs[i]!;

      const narrowing = await validateChainNarrowing(child, parent);
      if (!narrowing.valid) {
        narrowingViolations.push({
          childIndex: i,
          parentIndex: i - 1,
          violations: narrowing.violations,
        });
      }
    }

    const allVerificationsValid = results.every((r) => r.valid);
    const noNarrowingViolations = narrowingViolations.length === 0;

    const chainResult: ChainValidationResult = {
      valid: allVerificationsValid && noNarrowingViolations,
      results,
      narrowingViolations,
    };

    this._emit('chain:validated', {
      type: 'chain:validated',
      timestamp: timestamp(),
      result: chainResult,
    });

    return chainResult;
  }

  // ccl utilities

  /**
   * Parse CCL source text into a CCLDocument.
   *
   * @param source - CCL source text.
   * @returns A parsed CCLDocument.
   * @throws {CCLSyntaxError} When the source has syntax errors.
   *
   * @example
   * ```typescript
   * const cclDoc = client.parseCCL("permit read on '/data/**'");
   * ```
   */
  parseCCL(source: string): CCLDocument {
    if (typeof source !== 'string' || source.length === 0) {
      throw new ValidationError('parseCCL: source must be a non-empty string');
    }
    return cclParse(source);
  }

  /**
   * Merge two CCL documents using deny-wins semantics.
   *
   * @param a - The first (parent) CCL document.
   * @param b - The second (child) CCL document.
   * @returns A new merged CCLDocument.
   */
  mergeCCL(a: CCLDocument, b: CCLDocument): CCLDocument {
    if (!a || typeof a !== 'object') {
      throw new ValidationError('mergeCCL: a must be a CCLDocument object');
    }
    if (!b || typeof b !== 'object') {
      throw new ValidationError('mergeCCL: b must be a CCLDocument object');
    }
    return cclMerge(a, b);
  }

  /**
   * Serialize a CCLDocument back to human-readable CCL source text.
   *
   * @param doc - The CCL document to serialize.
   * @returns Multi-line CCL source string.
   */
  serializeCCL(doc: CCLDocument): string {
    if (!doc || typeof doc !== 'object') {
      throw new ValidationError('serializeCCL: doc must be a CCLDocument object');
    }
    return cclSerialize(doc);
  }

  // exports

  /**
   * Register an event handler for a specific event type.
   *
   * @param event - The event type to listen for.
   * @param handler - The callback function.
   * @returns A disposal function that removes the handler when called.
   *
   * @example
   * ```typescript
   * const off = client.on('covenant:created', (e) => {
   *   console.log('Created:', e.document.id);
   * });
   * // later: off() to unsubscribe
   * ```
   */
  on<T extends NobulexEventType>(
    event: T,
    handler: NobulexEventHandler<T>,
  ): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    const handlers = this._listeners.get(event)!;
    handlers.add(handler as NobulexEventHandler<NobulexEventType>);

    return () => {
      handlers.delete(handler as NobulexEventHandler<NobulexEventType>);
    };
  }

  /**
   * Remove a previously registered event handler.
   *
   * @param event - The event type.
   * @param handler - The handler function to remove.
   */
  off<T extends NobulexEventType>(
    event: T,
    handler: NobulexEventHandler<T>,
  ): void {
    const handlers = this._listeners.get(event);
    if (handlers) {
      handlers.delete(handler as NobulexEventHandler<NobulexEventType>);
    }
  }

  /**
   * Remove all event handlers for a specific event type, or all events if
   * no type is specified.
   *
   * @param event - Optional event type. If omitted, removes all handlers.
   */
  removeAllListeners(event?: NobulexEventType): void {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }

  private _emit<T extends NobulexEventType>(
    event: T,
    payload: NobulexEventMap[T],
  ): void {
    const handlers = this._listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(payload);
      }
    }
  }
}


export class QuickCovenant {
  /**
   * Create a simple permit covenant that allows a specific action on a resource.
   *
   * @param action - The action to permit (e.g., `"read"`, `"file.read"`).
   * @param resource - The resource to permit on (e.g., `"/data"`, `"/files/**"`).
   * @param issuer - The issuing party.
   * @param beneficiary - The beneficiary party.
   * @param privateKey - Issuer's private key for signing.
   * @returns A signed CovenantDocument with a single permit rule.
   *
   * @example
   * ```typescript
   * const doc = await QuickCovenant.permit('read', '/data/**', issuer, beneficiary, kp.privateKey);
   * ```
   */
  static async permit(
    action: string,
    resource: string,
    issuer: Issuer,
    beneficiary: Beneficiary,
    privateKey: Uint8Array,
  ): Promise<CovenantDocument> {
    if (typeof action !== 'string' || action.length === 0) {
      throw new ValidationError('QuickCovenant.permit: action must be a non-empty string');
    }
    if (typeof resource !== 'string' || resource.length === 0) {
      throw new ValidationError('QuickCovenant.permit: resource must be a non-empty string');
    }
    if (!issuer || typeof issuer !== 'object') {
      throw new ValidationError('QuickCovenant.permit: issuer must be an Issuer object');
    }
    if (!beneficiary || typeof beneficiary !== 'object') {
      throw new ValidationError('QuickCovenant.permit: beneficiary must be a Beneficiary object');
    }
    if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
      throw new ValidationError('QuickCovenant.permit: privateKey must be a 32-byte Uint8Array');
    }
    const constraints = `permit ${action} on '${resource}'`;
    return buildCovenant({
      issuer,
      beneficiary,
      constraints,
      privateKey,
    });
  }

  /**
   * Create a simple deny covenant that denies a specific action on a resource.
   *
   * @param action - The action to deny.
   * @param resource - The resource to deny on.
   * @param issuer - The issuing party.
   * @param beneficiary - The beneficiary party.
   * @param privateKey - Issuer's private key for signing.
   * @returns A signed CovenantDocument with a single deny rule.
   *
   * @example
   * ```typescript
   * const doc = await QuickCovenant.deny('delete', '/system/**', issuer, beneficiary, kp.privateKey);
   * ```
   */
  static async deny(
    action: string,
    resource: string,
    issuer: Issuer,
    beneficiary: Beneficiary,
    privateKey: Uint8Array,
  ): Promise<CovenantDocument> {
    if (typeof action !== 'string' || action.length === 0) {
      throw new ValidationError('QuickCovenant.deny: action must be a non-empty string');
    }
    if (typeof resource !== 'string' || resource.length === 0) {
      throw new ValidationError('QuickCovenant.deny: resource must be a non-empty string');
    }
    if (!issuer || typeof issuer !== 'object') {
      throw new ValidationError('QuickCovenant.deny: issuer must be an Issuer object');
    }
    if (!beneficiary || typeof beneficiary !== 'object') {
      throw new ValidationError('QuickCovenant.deny: beneficiary must be a Beneficiary object');
    }
    if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
      throw new ValidationError('QuickCovenant.deny: privateKey must be a 32-byte Uint8Array');
    }
    const constraints = `deny ${action} on '${resource}'`;
    return buildCovenant({
      issuer,
      beneficiary,
      constraints,
      privateKey,
    });
  }

  /**
   * Create a standard covenant with common constraints:
   * - Permits read on all resources
   * - Denies write on system resources
   * - Limits API calls to 1000 per 1 hour
   *
   * @param issuer - The issuing party.
   * @param beneficiary - The beneficiary party.
   * @param privateKey - Issuer's private key for signing.
   * @returns A signed CovenantDocument with standard constraints.
   *
   * @example
   * ```typescript
   * const doc = await QuickCovenant.standard(issuer, beneficiary, kp.privateKey);
   * ```
   */
  static async standard(
    issuer: Issuer,
    beneficiary: Beneficiary,
    privateKey: Uint8Array,
  ): Promise<CovenantDocument> {
    if (!issuer || typeof issuer !== 'object') {
      throw new ValidationError('QuickCovenant.standard: issuer must be an Issuer object');
    }
    if (!beneficiary || typeof beneficiary !== 'object') {
      throw new ValidationError('QuickCovenant.standard: beneficiary must be a Beneficiary object');
    }
    if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
      throw new ValidationError('QuickCovenant.standard: privateKey must be a 32-byte Uint8Array');
    }
    const constraints = [
      "permit read on '**'",
      "deny write on '/system/**'",
      'limit api.call 1000 per 1 hours',
    ].join('\n');

    return buildCovenant({
      issuer,
      beneficiary,
      constraints,
      privateKey,
    });
  }
}

// Re-export adapters
export * from './adapters/index.js';

// ---
// High-level API combining all six primitives: Identity (DID), Covenant DSL,
// Attestation (VC), Action Log, Verification, and Enforcement.
export { CovenantAgent } from './primitives.js';
export type { DIDKeyPair as PrimitivesDIDKeyPair } from './primitives.js';

// Cross-agent verification handshake
export {
  generateProof,
  verifyCounterparty,
  verifyCounterpartyHardened,
  verifyCounterpartiesBatch,
  HandshakeCache,
  TRUST_PRESETS,
  resolveTrustLevel,
  withTrustLevel,
} from './handshake.js';
export type {
  ProofOfBehavior,
  HandshakeResult,
  HandshakeOptions,
  HardenedHandshakeOptions,
  TrustLevel,
  TrustThreshold,
  BatchHandshakeItem,
  BatchHandshakeResult,
} from './handshake.js';
