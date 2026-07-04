/*
 * Cross-agent verification handshake.
 *
 * Before two agents transact, they verify each other's proof-of-behavior.
 * No proof, no transaction. This is the core trust mechanism.
 *
 * Production hardening:
 *   - Configurable trust threshold presets (strict / normal / permissive)
 *   - Content-addressed verification cache (LRU with TTL)
 *   - Batch verification for multi-agent pipelines
 */

import {
  sha256Object,
  signWithDID,
  verifyWithDID,
  verifyCompliance as verifyCovenant,
  verifyIntegrity,
} from '@nobulex/core';
import type {
  HashHex,
  DIDKeyPair,
  DIDDocument,
  CovenantSpec,
  ActionLog,
  ComplianceVerificationResult,
} from '@nobulex/core';

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
  readonly verification: ComplianceVerificationResult;
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

// ───────────────────────────────────────────────────────────────────────────
// Trust-threshold presets
// ───────────────────────────────────────────────────────────────────────────

export type TrustLevel = 'strict' | 'normal' | 'permissive';

export interface TrustThreshold {
  readonly minActions: number;
  readonly maxViolations: number;
}

// Centralised thresholds so the whole stack agrees on what "strict" means.
export const TRUST_PRESETS: Readonly<Record<TrustLevel, TrustThreshold>> = {
  strict:     { minActions: 100, maxViolations: 0 },
  normal:     { minActions: 10,  maxViolations: 0 },
  permissive: { minActions: 0,   maxViolations: 2 },
};

/** Resolve a {@link TrustLevel} name to its numeric thresholds. */
export function resolveTrustLevel(level: TrustLevel): TrustThreshold {
  return TRUST_PRESETS[level];
}

/**
 * Merge a {@link TrustLevel} preset into an existing {@link HandshakeOptions}
 * without overwriting explicit caller values. Explicit options always win —
 * the preset only fills gaps. Returns a new options object.
 */
export function withTrustLevel(
  level: TrustLevel,
  options: HandshakeOptions = {},
): HandshakeOptions {
  const preset = TRUST_PRESETS[level];
  return {
    ...options,
    minActions: options.minActions ?? preset.minActions,
    maxViolations: options.maxViolations ?? preset.maxViolations,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Verification cache
// ───────────────────────────────────────────────────────────────────────────

/**
 * Content-addressed cache for handshake results. Keyed by
 * sha256(proof || options) so any change — rotated covenant, new action,
 * different audience — invalidates automatically. Entries have a TTL
 * (default 5 minutes) so stale results don't linger across long-running
 * verifier processes.
 */
export class HandshakeCache {
  private readonly _store = new Map<string, { result: HandshakeResult; expiresAt: number }>();
  private readonly _ttlMs: number;
  private readonly _maxEntries: number;
  private _hits = 0;
  private _misses = 0;

  constructor(config: { ttlMs?: number; maxEntries?: number } = {}) {
    this._ttlMs = config.ttlMs ?? 5 * 60 * 1000;
    this._maxEntries = config.maxEntries ?? 1000;
  }

  /** Stable cache key. Captures both proof content AND options. */
  static key(proof: ProofOfBehavior, options: HandshakeOptions = {}): string {
    return sha256Object({
      // proof identity: proofSignature is already a content-addressed binding
      proofSignature: proof.proofSignature,
      covenantHash: proof.covenantHash,
      logHead: proof.actionLog.headHash,
      logLength: proof.actionLog.length,
      audience: proof.audience ?? null,
      taskClass: proof.taskClass ?? null,
      // options: any change in thresholds must produce a different key
      options: {
        minActions: options.minActions ?? 0,
        maxViolations: options.maxViolations ?? 0,
        requiredCovenant: options.requiredCovenant ?? null,
        expectedAudience: options.expectedAudience ?? null,
        requiredTaskClass: options.requiredTaskClass ?? null,
      },
    });
  }

  get(key: string): HandshakeResult | undefined {
    const entry = this._store.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }
    if (Date.now() >= entry.expiresAt) {
      this._store.delete(key);
      this._misses++;
      return undefined;
    }
    this._hits++;
    return entry.result;
  }

  set(key: string, result: HandshakeResult): void {
    // Evict the oldest entry (insertion-order) if we're at capacity.
    if (this._store.size >= this._maxEntries) {
      const firstKey = this._store.keys().next().value;
      if (firstKey !== undefined) this._store.delete(firstKey);
    }
    this._store.set(key, { result, expiresAt: Date.now() + this._ttlMs });
  }

  clear(): void {
    this._store.clear();
  }

  get size(): number {
    return this._store.size;
  }

  stats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      size: this._store.size,
      hitRate: total === 0 ? 0 : this._hits / total,
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Hardened verification (cached + preset-aware)
// ───────────────────────────────────────────────────────────────────────────

export interface HardenedHandshakeOptions extends HandshakeOptions {
  /** Optional preset to apply for missing threshold fields. */
  readonly trustLevel?: TrustLevel;
  /** Optional cache. When present, results are read/written through it. */
  readonly cache?: HandshakeCache;
}

/**
 * Verify a counterparty with trust-level presets and optional caching.
 * Drop-in upgrade for {@link verifyCounterparty}: same semantics, plus
 * preset thresholds and content-addressed result caching.
 */
export async function verifyCounterpartyHardened(
  proof: ProofOfBehavior,
  options: HardenedHandshakeOptions = {},
): Promise<HandshakeResult> {
  const { trustLevel, cache, ...rest } = options;
  const effective: HandshakeOptions = trustLevel
    ? withTrustLevel(trustLevel, rest)
    : rest;

  if (cache) {
    const key = HandshakeCache.key(proof, effective);
    const hit = cache.get(key);
    if (hit) return hit;
    const result = await verifyCounterparty(proof, effective);
    cache.set(key, result);
    return result;
  }

  return verifyCounterparty(proof, effective);
}

// ───────────────────────────────────────────────────────────────────────────
// Batch verification for multi-agent pipelines
// ───────────────────────────────────────────────────────────────────────────

export interface BatchHandshakeItem {
  readonly proof: ProofOfBehavior;
  readonly options?: HandshakeOptions;
}

export interface BatchHandshakeResult {
  readonly allTrusted: boolean;
  readonly results: readonly HandshakeResult[];
  readonly untrustedCount: number;
  /** Index of every result that came back untrusted. */
  readonly untrustedIndexes: readonly number[];
}

/**
 * Verify a batch of counterparties concurrently. Intended for multi-agent
 * pipelines where N agents must all be verified before a task can proceed
 * (supply-chain gate, swarm approval, fan-in ingress). Caching is honoured
 * if the same cache instance is passed.
 */
export async function verifyCounterpartiesBatch(
  items: readonly BatchHandshakeItem[],
  shared: {
    readonly trustLevel?: TrustLevel;
    readonly cache?: HandshakeCache;
    readonly concurrency?: number;
  } = {},
): Promise<BatchHandshakeResult> {
  const { concurrency = 8 } = shared;
  const results: HandshakeResult[] = new Array(items.length);

  // Simple semaphore so we don't over-parallelise verification when the
  // pipeline is thousands of items long.
  let next = 0;
  async function worker(): Promise<void> {
    let idx = next++;
    while (idx < items.length) {
      const item = items[idx]!;
      const merged: HardenedHandshakeOptions = {
        ...(item.options ?? {}),
        trustLevel: shared.trustLevel,
        cache: shared.cache,
      };
      results[idx] = await verifyCounterpartyHardened(item.proof, merged);
      idx = next++;
    }
  }

  const workerCount = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const untrustedIndexes: number[] = [];
  for (let i = 0; i < results.length; i++) {
    if (!results[i]!.trusted) untrustedIndexes.push(i);
  }

  return {
    allTrusted: untrustedIndexes.length === 0,
    results,
    untrustedCount: untrustedIndexes.length,
    untrustedIndexes,
  };
}
