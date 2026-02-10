import {
  sha256String,
  sha256Object,
  canonicalizeJson,
  signString,
  verify as cryptoVerify,
  toHex,
  fromHex,
  timestamp,
} from '@stele/crypto';

import type { HashHex, KeyPair } from '@stele/crypto';

import {
  parse,
  evaluate,
  matchAction,
  checkRateLimit as cclCheckRateLimit,
  serialize as cclSerialize,
  evaluateCondition,
} from '@stele/ccl';

import type {
  CCLDocument,
  Statement,
  Severity,
  EvaluationResult,
  EvaluationContext,
  PermitDenyStatement,
  LimitStatement,
} from '@stele/ccl';

export type {
  ExecutionOutcome,
  AuditEntry,
  AuditLog,
  CapabilityManifest,
  ActionHandler,
  ExecutionLogEntry,
  MonitorConfig,
  RateLimitState,
} from './types.js';

import type {
  ExecutionOutcome,
  AuditEntry,
  AuditLog,
  CapabilityManifest,
  ActionHandler,
  ExecutionLogEntry,
  MonitorConfig,
  RateLimitState,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** The zero hash used as the previousHash for the first audit entry. */
const GENESIS_HASH: HashHex = '0000000000000000000000000000000000000000000000000000000000000000';

// ─── Error classes ────────────────────────────────────────────────────────────

/**
 * Thrown when the Monitor denies an action in 'enforce' mode.
 */
export class MonitorDeniedError extends Error {
  readonly action: string;
  readonly resource: string;
  readonly matchedRule: Statement | undefined;
  readonly severity: Severity | undefined;

  constructor(
    action: string,
    resource: string,
    matchedRule: Statement | undefined,
    severity: Severity | undefined,
  ) {
    const ruleDesc = matchedRule
      ? `matched ${matchedRule.type} rule`
      : 'no matching permit rule';
    super(`Action '${action}' on resource '${resource}' denied: ${ruleDesc}`);
    this.name = 'MonitorDeniedError';
    this.action = action;
    this.resource = resource;
    this.matchedRule = matchedRule;
    this.severity = severity;
  }
}

/**
 * Thrown when a CapabilityGate operation fails due to missing or invalid capabilities.
 */
export class CapabilityError extends Error {
  readonly action: string;

  constructor(action: string, message?: string) {
    super(message ?? `No capability registered for action '${action}'`);
    this.name = 'CapabilityError';
    this.action = action;
  }
}

// ─── MerkleProof ──────────────────────────────────────────────────────────────

/**
 * A Merkle inclusion proof for a single audit entry.
 */
export interface MerkleProof {
  entryHash: HashHex;
  proof: HashHex[];
  index: number;
  merkleRoot: HashHex;
}

/**
 * Verify a Merkle inclusion proof.
 *
 * Walks from the leaf hash up through the sibling hashes in the proof,
 * combining pairs with SHA-256 until reaching the root. Returns true
 * if the computed root matches the expected root in the proof.
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
  let currentHash = proof.entryHash;
  let idx = proof.index;

  for (const siblingHash of proof.proof) {
    if (idx % 2 === 0) {
      // Current node is left child
      currentHash = sha256String(currentHash + siblingHash);
    } else {
      // Current node is right child
      currentHash = sha256String(siblingHash + currentHash);
    }
    idx = Math.floor(idx / 2);
  }

  return currentHash === proof.merkleRoot;
}

// ─── Monitor ──────────────────────────────────────────────────────────────────

/**
 * Runtime constraint monitor that evaluates actions against CCL constraints,
 * maintains a tamper-evident audit log with hash chaining and Merkle trees,
 * and enforces rate limits.
 */
export class Monitor {
  private readonly covenantId: HashHex;
  private readonly doc: CCLDocument;
  private readonly config: MonitorConfig;
  private readonly entries: AuditEntry[] = [];
  private readonly rateLimits: Map<string, RateLimitState> = new Map();

  /**
   * Create a new Monitor.
   *
   * @param covenantId - The ID of the covenant being monitored.
   * @param constraints - CCL constraint source text.
   * @param config - Optional monitor configuration overrides.
   */
  constructor(
    covenantId: HashHex,
    constraints: string,
    config?: Partial<MonitorConfig>,
  ) {
    this.covenantId = covenantId;
    this.doc = parse(constraints);
    this.config = {
      mode: config?.mode ?? 'enforce',
      failureMode: config?.failureMode ?? 'fail_closed',
      onViolation: config?.onViolation,
      onAction: config?.onAction,
    };
  }

  /**
   * Evaluate an action against the constraints.
   *
   * Creates an audit entry, checks rate limits, invokes callbacks, and
   * in 'enforce' mode throws MonitorDeniedError if the action is denied.
   *
   * @param action - The action to evaluate (e.g. "file.read").
   * @param resource - The resource being acted upon (e.g. "/data/users").
   * @param context - Optional evaluation context for condition matching.
   * @returns The CCL evaluation result.
   */
  async evaluate(
    action: string,
    resource: string,
    context?: Record<string, unknown>,
  ): Promise<EvaluationResult> {
    const ctx = context ?? {};
    const now = timestamp();

    // Evaluate against CCL constraints
    let result = evaluate(this.doc, action, resource, ctx);

    // Check rate limits if the action would otherwise be permitted
    if (result.permitted) {
      const rateResult = this.checkRateLimitInternal(action);
      if (rateResult.exceeded) {
        result = {
          permitted: false,
          matchedRule: result.matchedRule,
          allMatches: result.allMatches,
          reason: `Rate limit exceeded for action '${action}'`,
          severity: 'high',
        };
      }
    }

    // Determine outcome
    let outcome: ExecutionOutcome;
    if (result.permitted) {
      outcome = 'EXECUTED';
      // Increment rate limit counter on permitted actions
      this.incrementRateLimit(action);
    } else {
      outcome = 'DENIED';
    }

    // In log_only mode, override outcome to EXECUTED even if denied
    if (!result.permitted && this.config.mode === 'log_only') {
      outcome = 'EXECUTED';
    }

    // Build audit entry
    const entry = this.createAuditEntry(action, resource, ctx, result, outcome, undefined, now);

    // Fire callbacks
    if (!result.permitted && this.config.onViolation) {
      this.config.onViolation(entry);
    }
    if (this.config.onAction) {
      this.config.onAction(entry);
    }

    // In enforce mode, throw on denial
    if (!result.permitted && this.config.mode === 'enforce') {
      throw new MonitorDeniedError(
        action,
        resource,
        result.matchedRule,
        result.severity,
      );
    }

    return result;
  }

  /**
   * Evaluate and execute an action handler if permitted.
   *
   * @param action - The action to evaluate.
   * @param resource - The resource being acted upon.
   * @param handler - The handler function to execute if permitted.
   * @param context - Optional evaluation context.
   * @returns The result of the handler.
   */
  async execute<T>(
    action: string,
    resource: string,
    handler: ActionHandler<T>,
    context?: Record<string, unknown>,
  ): Promise<T> {
    const ctx = context ?? {};
    const now = timestamp();

    // Evaluate constraints
    let result = evaluate(this.doc, action, resource, ctx);

    // Check rate limits
    if (result.permitted) {
      const rateResult = this.checkRateLimitInternal(action);
      if (rateResult.exceeded) {
        result = {
          permitted: false,
          matchedRule: result.matchedRule,
          allMatches: result.allMatches,
          reason: `Rate limit exceeded for action '${action}'`,
          severity: 'high',
        };
      }
    }

    if (!result.permitted && this.config.mode === 'enforce') {
      // Log the denial
      const entry = this.createAuditEntry(action, resource, ctx, result, 'DENIED', undefined, now);
      if (this.config.onViolation) {
        this.config.onViolation(entry);
      }
      if (this.config.onAction) {
        this.config.onAction(entry);
      }
      throw new MonitorDeniedError(
        action,
        resource,
        result.matchedRule,
        result.severity,
      );
    }

    // Increment rate limit counter for permitted actions
    if (result.permitted) {
      this.incrementRateLimit(action);
    }

    // Execute the handler
    try {
      const handlerResult = await handler(resource, ctx);
      const entry = this.createAuditEntry(action, resource, ctx, result, 'EXECUTED', undefined, now);
      if (!result.permitted && this.config.onViolation) {
        this.config.onViolation(entry);
      }
      if (this.config.onAction) {
        this.config.onAction(entry);
      }
      return handlerResult;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const entry = this.createAuditEntry(action, resource, ctx, result, 'EXECUTED', errorMessage, now);
      if (this.config.onAction) {
        this.config.onAction(entry);
      }
      throw err;
    }
  }

  /**
   * Get the full audit log for this monitor.
   */
  getAuditLog(): AuditLog {
    return {
      covenantId: this.covenantId,
      entries: [...this.entries],
      merkleRoot: this.computeMerkleRoot(),
      count: this.entries.length,
    };
  }

  /**
   * Get a specific audit entry by index.
   */
  getAuditEntry(index: number): AuditEntry | undefined {
    return this.entries[index];
  }

  /**
   * Verify the integrity of the entire audit log hash chain.
   *
   * Recomputes every entry hash from its content and the previous hash,
   * checking that the stored hash matches the recomputed one.
   */
  verifyAuditLogIntegrity(): boolean {
    if (this.entries.length === 0) {
      return true;
    }

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i]!;

      // Check previousHash linkage
      const expectedPreviousHash = i === 0
        ? GENESIS_HASH
        : this.entries[i - 1]!.hash;

      if (entry.previousHash !== expectedPreviousHash) {
        return false;
      }

      // Recompute the hash and verify it matches
      const recomputedHash = computeEntryHash(entry);
      if (entry.hash !== recomputedHash) {
        return false;
      }
    }

    return true;
  }

  /**
   * Compute the Merkle root of all audit entry hashes.
   *
   * Builds a balanced binary Merkle tree from the entry hashes.
   * If the number of leaves is odd, the last leaf is duplicated.
   */
  computeMerkleRoot(): HashHex {
    if (this.entries.length === 0) {
      return GENESIS_HASH;
    }

    return computeMerkleRootFromHashes(this.entries.map((e) => e.hash));
  }

  /**
   * Generate a Merkle inclusion proof for a specific audit entry.
   *
   * @param entryIndex - The index of the audit entry.
   * @returns A MerkleProof that can be verified with verifyMerkleProof().
   */
  generateMerkleProof(entryIndex: number): MerkleProof {
    if (entryIndex < 0 || entryIndex >= this.entries.length) {
      throw new Error(`Entry index ${entryIndex} is out of range [0, ${this.entries.length})`);
    }

    const leaves = this.entries.map((e) => e.hash);
    const proof: HashHex[] = [];
    let idx = entryIndex;

    let level = [...leaves];

    while (level.length > 1) {
      // If odd number, duplicate the last element
      if (level.length % 2 !== 0) {
        level.push(level[level.length - 1]!);
      }

      const nextLevel: HashHex[] = [];

      // Find the sibling and add to proof
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (siblingIdx < level.length) {
        proof.push(level[siblingIdx]!);
      }

      // Build next level
      for (let i = 0; i < level.length; i += 2) {
        nextLevel.push(sha256String(level[i]! + level[i + 1]!));
      }

      idx = Math.floor(idx / 2);
      level = nextLevel;
    }

    return {
      entryHash: this.entries[entryIndex]!.hash,
      proof,
      index: entryIndex,
      merkleRoot: level[0]!,
    };
  }

  /**
   * Check whether a rate limit is exceeded for the given action.
   *
   * @returns An object with `exceeded` and `remaining` counts.
   */
  checkRateLimit(action: string): { exceeded: boolean; remaining: number } {
    return this.checkRateLimitInternal(action);
  }

  /**
   * Get the current rate limit state for all tracked actions.
   */
  getRateLimitState(): RateLimitState[] {
    return Array.from(this.rateLimits.values());
  }

  /**
   * Reset the monitor, clearing all audit entries and rate limit state.
   */
  reset(): void {
    this.entries.length = 0;
    this.rateLimits.clear();
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  /**
   * Create an audit entry, hash it, and append to the log.
   */
  private createAuditEntry(
    action: string,
    resource: string,
    context: Record<string, unknown>,
    result: EvaluationResult,
    outcome: ExecutionOutcome,
    error: string | undefined,
    ts: string,
  ): AuditEntry {
    const index = this.entries.length;
    const previousHash = index === 0
      ? GENESIS_HASH
      : this.entries[index - 1]!.hash;

    const entry: AuditEntry = {
      index,
      timestamp: ts,
      action,
      resource,
      context,
      result,
      outcome,
      previousHash,
      hash: '' as HashHex,
    };

    if (error !== undefined) {
      entry.error = error;
    }

    // Compute the hash of this entry
    entry.hash = computeEntryHash(entry);

    this.entries.push(entry);
    return entry;
  }

  /**
   * Internal rate limit check using the CCL document's limit statements.
   */
  private checkRateLimitInternal(action: string): { exceeded: boolean; remaining: number } {
    const now = Date.now();

    // Find matching limit statements
    let matchedLimit: LimitStatement | undefined;
    let bestSpecificity = -1;

    for (const limit of this.doc.limits) {
      if (matchAction(limit.action, action)) {
        // Simple specificity: count non-wildcard segments
        const parts = limit.action.split('.');
        let spec = 0;
        for (const p of parts) {
          if (p === '**') spec += 0;
          else if (p === '*') spec += 1;
          else spec += 2;
        }
        if (spec > bestSpecificity) {
          bestSpecificity = spec;
          matchedLimit = limit;
        }
      }
    }

    if (!matchedLimit) {
      return { exceeded: false, remaining: Infinity };
    }

    const key = matchedLimit.action;
    let state = this.rateLimits.get(key);

    if (!state) {
      state = {
        action: key,
        count: 0,
        periodStart: now,
        periodSeconds: matchedLimit.periodSeconds,
        limit: matchedLimit.count,
      };
      this.rateLimits.set(key, state);
    }

    // Check if the period has expired
    const periodMs = state.periodSeconds * 1000;
    if (now - state.periodStart >= periodMs) {
      // Reset the window
      state.count = 0;
      state.periodStart = now;
    }

    const remaining = Math.max(0, state.limit - state.count);
    return {
      exceeded: state.count >= state.limit,
      remaining,
    };
  }

  /**
   * Increment the rate limit counter for an action.
   */
  private incrementRateLimit(action: string): void {
    const now = Date.now();

    for (const limit of this.doc.limits) {
      if (matchAction(limit.action, action)) {
        const key = limit.action;
        let state = this.rateLimits.get(key);

        if (!state) {
          state = {
            action: key,
            count: 0,
            periodStart: now,
            periodSeconds: limit.periodSeconds,
            limit: limit.count,
          };
          this.rateLimits.set(key, state);
        }

        // Check if the period has expired
        const periodMs = state.periodSeconds * 1000;
        if (now - state.periodStart >= periodMs) {
          state.count = 0;
          state.periodStart = now;
        }

        state.count++;
      }
    }
  }
}

// ─── CapabilityGate ───────────────────────────────────────────────────────────

/**
 * A capability-based enforcement gate that restricts execution to only
 * those actions explicitly permitted by CCL constraints.
 *
 * Unlike Monitor which evaluates at runtime, CapabilityGate pre-computes
 * the set of allowed capabilities from permit statements and refuses to
 * even register handlers for non-permitted actions.
 */
export class CapabilityGate {
  private readonly covenantId: HashHex;
  private readonly doc: CCLDocument;
  private readonly runtimeKeyPair: KeyPair;
  private readonly runtimeType: string;
  private readonly handlers: Map<string, ActionHandler<unknown>> = new Map();
  private readonly permittedActions: Set<string> = new Set();
  private readonly executionLog: ExecutionLogEntry[] = [];

  private constructor(
    covenantId: HashHex,
    doc: CCLDocument,
    runtimeKeyPair: KeyPair,
    runtimeType: string,
  ) {
    this.covenantId = covenantId;
    this.doc = doc;
    this.runtimeKeyPair = runtimeKeyPair;
    this.runtimeType = runtimeType;

    // Extract permitted actions from permit statements
    for (const permit of doc.permits) {
      this.permittedActions.add(permit.action);
    }
  }

  /**
   * Create a CapabilityGate from CCL constraints.
   *
   * Parses the constraints and extracts only the permit statements
   * as the set of allowed capabilities.
   *
   * @param covenantId - The ID of the covenant.
   * @param constraints - CCL constraint source text.
   * @param runtimeKeyPair - The key pair identifying this runtime instance.
   * @param runtimeType - A label for the type of runtime (default: "node").
   */
  static async fromConstraints(
    covenantId: HashHex,
    constraints: string,
    runtimeKeyPair: KeyPair,
    runtimeType: string = 'node',
  ): Promise<CapabilityGate> {
    const doc = parse(constraints);
    return new CapabilityGate(covenantId, doc, runtimeKeyPair, runtimeType);
  }

  /**
   * Register an action handler.
   *
   * @throws CapabilityError if the action is not in the permitted set.
   */
  register(action: string, handler: ActionHandler<unknown>): void {
    // Check if any permit statement's pattern matches this action
    let hasPermission = false;
    for (const permitAction of this.permittedActions) {
      if (matchAction(permitAction, action) || permitAction === action) {
        hasPermission = true;
        break;
      }
    }

    if (!hasPermission) {
      throw new CapabilityError(
        action,
        `Cannot register handler for action '${action}': not permitted by constraints`,
      );
    }

    this.handlers.set(action, handler);
  }

  /**
   * Execute a registered action handler, enforcing capability constraints.
   *
   * - If no handler is registered and no capability permits the action: outcome is IMPOSSIBLE.
   * - If constraints deny the action: outcome is DENIED.
   * - Otherwise: the handler is executed with outcome EXECUTED.
   *
   * @returns The result of the handler execution.
   */
  async execute<T>(
    action: string,
    resource: string,
    context?: Record<string, unknown>,
  ): Promise<T> {
    const ctx = context ?? {};
    const now = timestamp();

    // Check if we have a handler for this action
    const handler = this.handlers.get(action);
    if (!handler) {
      // Check if any permitted capability covers this action
      let couldBePermitted = false;
      for (const permitAction of this.permittedActions) {
        if (matchAction(permitAction, action)) {
          couldBePermitted = true;
          break;
        }
      }

      if (!couldBePermitted) {
        this.executionLog.push({
          action,
          resource,
          outcome: 'IMPOSSIBLE',
          timestamp: now,
          error: `No capability exists for action '${action}'`,
        });
        throw new CapabilityError(
          action,
          `Action '${action}' is impossible: no capability permits it`,
        );
      }

      this.executionLog.push({
        action,
        resource,
        outcome: 'IMPOSSIBLE',
        timestamp: now,
        error: `No handler registered for action '${action}'`,
      });
      throw new CapabilityError(
        action,
        `No handler registered for action '${action}'`,
      );
    }

    // Evaluate constraints at runtime (check conditions)
    const result = evaluate(this.doc, action, resource, ctx);

    if (!result.permitted) {
      this.executionLog.push({
        action,
        resource,
        outcome: 'DENIED',
        timestamp: now,
        error: result.reason,
      });
      throw new MonitorDeniedError(
        action,
        resource,
        result.matchedRule,
        result.severity,
      );
    }

    // Execute the handler
    try {
      const handlerResult = await handler(resource, ctx);
      this.executionLog.push({
        action,
        resource,
        outcome: 'EXECUTED',
        timestamp: now,
      });
      return handlerResult as T;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.executionLog.push({
        action,
        resource,
        outcome: 'EXECUTED',
        timestamp: now,
        error: errorMessage,
      });
      throw err;
    }
  }

  /**
   * Check if a capability exists for the given action.
   */
  hasCapability(action: string): boolean {
    for (const permitAction of this.permittedActions) {
      if (matchAction(permitAction, action)) {
        return true;
      }
    }
    return false;
  }

  /**
   * List all permitted action patterns.
   */
  listCapabilities(): string[] {
    return Array.from(this.permittedActions);
  }

  /**
   * Generate a signed capability manifest describing what this runtime can do.
   *
   * The manifest includes all capabilities derived from permit statements,
   * signed by the runtime's key pair for authenticity.
   */
  async generateManifest(): Promise<CapabilityManifest> {
    const generatedAt = timestamp();

    const capabilities = this.doc.permits.map((permit) => {
      const cap: { action: string; resource: string; conditions?: string } = {
        action: permit.action,
        resource: permit.resource,
      };
      if (permit.condition) {
        cap.conditions = JSON.stringify(permit.condition);
      }
      return cap;
    });

    // Build manifest without hash and signature first
    const manifestContent = {
      covenantId: this.covenantId,
      capabilities,
      runtimeType: this.runtimeType,
      runtimePublicKey: this.runtimeKeyPair.publicKeyHex,
      generatedAt,
    };

    const manifestHash = sha256Object(manifestContent);

    // Sign the manifest hash
    const signatureBytes = await signString(manifestHash, this.runtimeKeyPair.privateKey);
    const runtimeSignature = toHex(signatureBytes);

    const manifest: CapabilityManifest = {
      covenantId: this.covenantId,
      capabilities,
      manifestHash,
      runtimeType: this.runtimeType,
      runtimeSignature,
      runtimePublicKey: this.runtimeKeyPair.publicKeyHex,
      generatedAt,
    };

    return manifest;
  }

  /**
   * Verify the signature of a capability manifest.
   *
   * Recomputes the manifest hash from the content fields and verifies
   * the runtime signature against the embedded public key.
   */
  static async verifyManifest(manifest: CapabilityManifest): Promise<boolean> {
    // Recompute the manifest hash from content
    const manifestContent = {
      covenantId: manifest.covenantId,
      capabilities: manifest.capabilities,
      runtimeType: manifest.runtimeType,
      runtimePublicKey: manifest.runtimePublicKey,
      generatedAt: manifest.generatedAt,
    };

    const expectedHash = sha256Object(manifestContent);

    if (manifest.manifestHash !== expectedHash) {
      return false;
    }

    // Verify the signature
    try {
      const messageBytes = new TextEncoder().encode(manifest.manifestHash);
      const sigBytes = fromHex(manifest.runtimeSignature);
      const pubKeyBytes = fromHex(manifest.runtimePublicKey);
      return await cryptoVerify(messageBytes, sigBytes, pubKeyBytes);
    } catch {
      return false;
    }
  }

  /**
   * Prove which actions from a given list are impossible (not permitted)
   * and which are possible (permitted by at least one capability).
   *
   * @param actions - An array of action strings to test.
   * @returns An object with `possible`, `impossible` arrays and the `manifestHash`.
   */
  async proveImpossible(
    actions: string[],
  ): Promise<{ possible: string[]; impossible: string[]; manifestHash: HashHex }> {
    const possible: string[] = [];
    const impossible: string[] = [];

    for (const action of actions) {
      if (this.hasCapability(action)) {
        possible.push(action);
      } else {
        impossible.push(action);
      }
    }

    const manifest = await this.generateManifest();

    return {
      possible,
      impossible,
      manifestHash: manifest.manifestHash,
    };
  }

  /**
   * Get the execution log of all actions attempted through this gate.
   */
  getExecutionLog(): ExecutionLogEntry[] {
    return [...this.executionLog];
  }
}

// ─── Utility functions ────────────────────────────────────────────────────────

/**
 * Compute the hash of an audit entry.
 *
 * The hash is the SHA-256 of the canonical JSON of the entry's content
 * fields (excluding the hash field itself) concatenated with the previousHash.
 */
function computeEntryHash(entry: AuditEntry): HashHex {
  const content: Record<string, unknown> = {
    index: entry.index,
    timestamp: entry.timestamp,
    action: entry.action,
    resource: entry.resource,
    context: entry.context,
    result: {
      permitted: entry.result.permitted,
      reason: entry.result.reason,
      severity: entry.result.severity,
    },
    outcome: entry.outcome,
    previousHash: entry.previousHash,
  };

  if (entry.error !== undefined) {
    content.error = entry.error;
  }

  return sha256Object(content);
}

/**
 * Compute a Merkle root from an array of hashes.
 *
 * If the number of leaves at any level is odd, the last leaf is duplicated
 * before pairing, producing a balanced tree.
 */
function computeMerkleRootFromHashes(hashes: HashHex[]): HashHex {
  if (hashes.length === 0) {
    return GENESIS_HASH;
  }

  let level = [...hashes];

  while (level.length > 1) {
    // If odd number, duplicate the last hash
    if (level.length % 2 !== 0) {
      level.push(level[level.length - 1]!);
    }

    const nextLevel: HashHex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      nextLevel.push(sha256String(level[i]! + level[i + 1]!));
    }
    level = nextLevel;
  }

  return level[0]!;
}

// ─── Audit Chain ──────────────────────────────────────────────────────────────

export { AuditChain } from './audit-chain';
export type { ChainedAuditEntry } from './audit-chain';
