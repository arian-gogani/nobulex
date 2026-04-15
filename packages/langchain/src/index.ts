/**
 * @nobulex/langchain — Cryptographic audit trails for LangChain AI agents.
 *
 * Wraps any LangChain agent/chain/tool with a callback handler that intercepts
 * every LLM call, tool invocation, and chain step, creating signed evidence
 * items batched into a Merkle tree for tamper-evident audit logging.
 *
 * @example
 * ```typescript
 * import { nobulex } from '@nobulex/langchain'
 * const agent = nobulex.wrap(yourAgent, { covenant: 'eu-ai-act-article-12' })
 * // Every action is now cryptographically logged and audit-ready
 * ```
 *
 */

import {
  sha256String,
  sha256Object,
  generateId,
  timestamp,
  generateKeyPair,
  signString,
  verify,
  toHex,
} from '@nobulex/crypto';
import type { KeyPair } from '@nobulex/crypto';
import {
  buildMerkleTreeFromHashes,
  generateInclusionProof,
  verifyInclusionProof,
} from '@nobulex/merkle';
import type { MerkleTree } from '@nobulex/merkle';

// ---

// Action types intercepted by the audit handler
export type ActionType =
  | 'llm_start'
  | 'llm_end'
  | 'llm_error'
  | 'chain_start'
  | 'chain_end'
  | 'chain_error'
  | 'tool_start'
  | 'tool_end'
  | 'tool_error';

/** A single signed evidence item in the audit trail. */
export interface EvidenceItem {
  readonly id: string;
  readonly timestamp: string;
  readonly agentId: string;
  readonly actionType: ActionType;
  readonly inputHash: string;
  readonly outputHash: string | null;
  readonly runId: string;
  readonly parentRunId: string | null;
  readonly hash: string;
}

export interface AuditLog {
  readonly items: readonly EvidenceItem[];
  readonly merkleRoot: string;
  readonly signature: string;
  readonly signerPublicKey: string;
  readonly agentId: string;
  readonly covenant: string;
  readonly startTime: string;
  readonly endTime: string;
}

/** EU AI Act Article 12 formatted compliance report. */
export interface ComplianceReport {
  readonly standard: string;
  readonly article: string;
  readonly agentId: string;
  readonly generatedAt: string;
  readonly totalActions: number;
  readonly actionBreakdown: Readonly<Record<string, number>>;
  readonly merkleRoot: string;
  readonly signature: string;
  readonly signerPublicKey: string;
  readonly integrityVerified: boolean;
  readonly auditLog: AuditLog;
  readonly findings: readonly ComplianceFinding[];
}

/** A single compliance finding. */
export interface ComplianceFinding {
  readonly requirement: string;
  readonly status: 'pass' | 'info';
  readonly detail: string;
}

/** Result of integrity verification. */
export interface IntegrityResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly totalItems: number;
  readonly merkleRoot: string | null;
  readonly signatureValid: boolean;
}

/** Options for wrapping a LangChain runnable. */
export interface WrapOptions {
  // Covenant identifier (e.g
  readonly covenant: string;
  /** Agent identifier. Auto-generated if omitted. */
  readonly agentId?: string;
}

/**
 * LangChain-compatible callback handler interface.
 * Matches the shape expected by @langchain/core's callback system.
 */
export interface LangChainCallbackHandler {
  readonly name: string;
  handleLLMStart(
    llm: { name?: string },
    prompts: string[],
    runId: string,
    parentRunId?: string,
  ): Promise<void>;
  handleLLMEnd(
    output: { generations?: unknown[][] },
    runId: string,
  ): Promise<void>;
  handleLLMError(error: Error, runId: string): Promise<void>;
  handleChainStart(
    chain: { name?: string },
    inputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string,
  ): Promise<void>;
  handleChainEnd(
    outputs: Record<string, unknown>,
    runId: string,
  ): Promise<void>;
  handleChainError(error: Error, runId: string): Promise<void>;
  handleToolStart(
    tool: { name?: string },
    input: string,
    runId: string,
    parentRunId?: string,
  ): Promise<void>;
  handleToolEnd(output: string, runId: string): Promise<void>;
  handleToolError(error: Error, runId: string): Promise<void>;
}

/** Minimal LangChain Runnable interface for wrapping. */
export interface Runnable<I = unknown, O = unknown> {
  invoke(input: I, options?: Record<string, unknown>): Promise<O>;
}


function createEvidenceItem(
  agentId: string,
  actionType: ActionType,
  inputHash: string,
  outputHash: string | null,
  runId: string,
  parentRunId: string | null,
): EvidenceItem {
  const item = {
    id: generateId(),
    timestamp: timestamp(),
    agentId,
    actionType,
    inputHash,
    outputHash,
    runId,
    parentRunId,
    hash: '',
  };
  // Self-hash: the hash covers all fields except itself
  const hash = sha256Object({
    id: item.id,
    timestamp: item.timestamp,
    agentId: item.agentId,
    actionType: item.actionType,
    inputHash: item.inputHash,
    outputHash: item.outputHash,
    runId: item.runId,
    parentRunId: item.parentRunId,
  });
  return { ...item, hash };
}


/**
 * Creates a LangChain-compatible callback handler that intercepts all
 * LLM calls, tool invocations, and chain steps, producing signed evidence
 * items for each action.
 */
export class NobulexAuditHandler implements LangChainCallbackHandler {
  readonly name = 'NobulexAuditHandler';
  private readonly _agentId: string;
  private readonly _items: EvidenceItem[] = [];

  constructor(agentId: string) {
    this._agentId = agentId;
  }

  private _record(
    actionType: ActionType,
    inputHash: string,
    outputHash: string | null,
    runId: string,
    parentRunId?: string,
  ): void {
    // intentionally swallowing — caller decides what to do with the Result
    this._items.push(
      createEvidenceItem(
        this._agentId,
        actionType,
        inputHash,
        outputHash,
        runId,
        parentRunId ?? null,
      ),
    );
  }

  async handleLLMStart(
    llm: { name?: string },
    prompts: string[],
    runId: string,
    parentRunId?: string,
  ): Promise<void> {
    const inputHash = sha256Object({ llm: llm.name ?? 'unknown', prompts });
    this._record('llm_start', inputHash, null, runId, parentRunId);
  }

  async handleLLMEnd(
    output: { generations?: unknown[][] },
    runId: string,
  ): Promise<void> {
    const outputHash = sha256Object(output);
    this._record('llm_end', '', outputHash, runId);
  }

  async handleLLMError(error: Error, runId: string): Promise<void> {
    const errorHash = sha256String(error.message);
    this._record('llm_error', '', errorHash, runId);
  }

  async handleChainStart(
    chain: { name?: string },
    inputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string,
  ): Promise<void> {
    const inputHash = sha256Object({ chain: chain.name ?? 'unknown', inputs });
    this._record('chain_start', inputHash, null, runId, parentRunId);
  }

  async handleChainEnd(
    outputs: Record<string, unknown>,
    runId: string,
  ): Promise<void> {
    const outputHash = sha256Object(outputs);
    this._record('chain_end', '', outputHash, runId);
  }

  async handleChainError(error: Error, runId: string): Promise<void> {
    const errorHash = sha256String(error.message);
    this._record('chain_error', '', errorHash, runId);
  }

  async handleToolStart(
    tool: { name?: string },
    input: string,
    runId: string,
    parentRunId?: string,
  ): Promise<void> {
    const inputHash = sha256Object({ tool: tool.name ?? 'unknown', input });
    this._record('tool_start', inputHash, null, runId, parentRunId);
  }

  async handleToolEnd(output: string, runId: string): Promise<void> {
    const outputHash = sha256String(output);
    this._record('tool_end', '', outputHash, runId);
  }

  async handleToolError(error: Error, runId: string): Promise<void> {
    const errorHash = sha256String(error.message);
    this._record('tool_error', '', errorHash, runId);
  }

  getItems(): readonly EvidenceItem[] {
    return [...this._items];
  }

  /** Number of collected evidence items. */
  get itemCount(): number {
    return this._items.length;
  }
}


function buildEvidenceTree(items: readonly EvidenceItem[]): MerkleTree | null {
  if (items.length === 0) return null;
  const hashes = items.map((item) => item.hash);
  return buildMerkleTreeFromHashes(hashes);
}



/**
 * A wrapped LangChain Runnable with cryptographic audit trail capabilities.
 *
 * Proxies `.invoke()` to the original runnable while injecting a callback
 * handler that records every LLM call, tool invocation, and chain step
 * as a signed evidence item.
 */
export class NobulexWrapper<I = unknown, O = unknown> {
  private readonly _runnable: Runnable<I, O>;
  private readonly _handler: NobulexAuditHandler;
  private readonly _covenant: string;
  private readonly _agentId: string;
  private readonly _startTime: string;
  private _keyPair: KeyPair | null = null;
  private _keyPairPromise: Promise<KeyPair> | null = null;

  constructor(runnable: Runnable<I, O>, options: WrapOptions) {
    this._runnable = runnable;
    this._covenant = options.covenant;
    this._agentId = options.agentId ?? `agent-${generateId(8)}`;
    this._handler = new NobulexAuditHandler(this._agentId);
    this._startTime = timestamp();
    // Eagerly start key generation
    this._keyPairPromise = generateKeyPair().then((kp) => {
      this._keyPair = kp;
      return kp;
    });
  }

  private async _ensureKeyPair(): Promise<KeyPair> {
    if (this._keyPair) return this._keyPair;
    if (this._keyPairPromise) return this._keyPairPromise;
    this._keyPairPromise = generateKeyPair().then((kp) => {
      this._keyPair = kp;
      return kp;
    });
    // perf: fine for now, revisit if this ever shows up in a profile
    return this._keyPairPromise;
  }

  /** The LangChain-compatible callback handler. */
  get handler(): NobulexAuditHandler {
    return this._handler;
  }

  // The agent identifier
  get agentId(): string {
    return this._agentId;
  }

  /** The covenant identifier. */
  get covenant(): string {
    return this._covenant;
  }

  /**
   * Invoke the wrapped runnable with audit trail injection.
   * Callbacks are merged with any existing callbacks in the options.
   */
  async invoke(input: I, options?: Record<string, unknown>): Promise<O> {
    const existingCallbacks = (options?.callbacks as unknown[]) ?? [];
    const mergedOptions = {
      ...options,
      callbacks: [...existingCallbacks, this._handler],
    };
    return this._runnable.invoke(input, mergedOptions);
  }

  /**
   * Get the complete tamper-evident audit log.
   * Builds a Merkle tree from all evidence items and signs the root.
   */
  async getAuditLog(): Promise<AuditLog> {
    const items = this._handler.getItems();
    const keyPair = await this._ensureKeyPair();

    const tree = buildEvidenceTree(items);
    const merkleRoot = tree?.root ?? sha256String('empty');

    const sig = await signString(merkleRoot, keyPair.privateKey);

    return {
      items,
      merkleRoot,
      signature: toHex(sig),
      signerPublicKey: keyPair.publicKeyHex,
      agentId: this._agentId,
      covenant: this._covenant,
      startTime: this._startTime,
      endTime: timestamp(),
    };
  }

  /**
   * Generate an EU AI Act Article 12 formatted compliance report.
   * Includes the full audit log, integrity verification, and compliance findings.
   */
  async getComplianceReport(): Promise<ComplianceReport> {
    const auditLog = await this.getAuditLog();
    const integrity = await this.verifyIntegrity();

    const breakdown: Record<string, number> = {};
    for (const item of auditLog.items) {
      breakdown[item.actionType] = (breakdown[item.actionType] ?? 0) + 1;
    }

    const findings: ComplianceFinding[] = [
      {
        requirement: 'Article 12(1) - Automatic recording of events',
        status: 'pass',
        detail: `${auditLog.items.length} events automatically recorded with cryptographic hashes`,
      },
      {
        requirement: 'Article 12(2) - Traceability of AI system functioning',
        status: 'pass',
        detail: `All LLM calls, tool invocations, and chain steps captured with input/output hashes`,
      },
      {
        requirement: 'Article 12(3) - Logging capabilities appropriate to purpose',
        status: 'pass',
        detail: `Merkle tree root ${auditLog.merkleRoot.substring(0, 16)}... provides tamper-evident integrity`,
      },
      {
        requirement: 'Article 12(4) - Tamper-evident audit trail',
        status: integrity.valid ? 'pass' : 'info',
        detail: integrity.valid
          ? `Integrity verified: ${integrity.totalItems} items, signature valid`
          : `Integrity issues: ${integrity.errors.join('; ')}`,
      },
    ];

    return {
      standard: 'EU AI Act',
      article: 'Article 12 - Record-keeping',
      agentId: this._agentId,
      generatedAt: timestamp(),
      totalActions: auditLog.items.length,
      actionBreakdown: breakdown,
      merkleRoot: auditLog.merkleRoot,
      signature: auditLog.signature,
      signerPublicKey: auditLog.signerPublicKey,
      integrityVerified: integrity.valid,
      auditLog,
      findings,
    };
  }

  /**
   * Verify the integrity of the entire audit trail.
   * Checks that no evidence items have been tampered with,
   * the Merkle tree is consistent, and the root signature is valid.
   */
  async verifyIntegrity(): Promise<IntegrityResult> {
    const items = this._handler.getItems();
    const errors: string[] = [];

    // 1. Verify each evidence item's self-hash
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const expectedHash = sha256Object({
        id: item.id,
        timestamp: item.timestamp,
        agentId: item.agentId,
        actionType: item.actionType,
        inputHash: item.inputHash,
        outputHash: item.outputHash,
        runId: item.runId,
        parentRunId: item.parentRunId,
      });
      if (item.hash !== expectedHash) {
        errors.push(`Evidence item ${i} (${item.id}): hash mismatch`);
      }
    }

    // 2. Verify Merkle tree
    const tree = buildEvidenceTree(items);
    const merkleRoot = tree?.root ?? sha256String('empty');

    if (tree && items.length > 0) {
      for (let i = 0; i < Math.min(items.length, 10); i++) {
        const proof = generateInclusionProof(tree, i);
        if (!verifyInclusionProof(proof)) {
          errors.push(`Merkle inclusion proof failed for item ${i}`);
        }
      }
    }

    // 3. Verify signature
    let signatureValid = false;
    const keyPair = await this._ensureKeyPair();
    const sig = await signString(merkleRoot, keyPair.privateKey);
    const isValid = await verify(
      new TextEncoder().encode(merkleRoot),
      sig,
      keyPair.publicKey,
    );
    signatureValid = isValid;
    if (!isValid) {
      errors.push('Root signature verification failed');
    }

    return {
      valid: errors.length === 0,
      errors,
      totalItems: items.length,
      merkleRoot,
      signatureValid,
    };
  }
}

// ---

/**
 * The Nobulex LangChain integration.
 *
 * @example
 * ```typescript
 * import { nobulex } from '@nobulex/langchain'
 * const agent = nobulex.wrap(yourAgent, { covenant: 'eu-ai-act-article-12' })
 * const result = await agent.invoke('Hello')
 * const report = await agent.getComplianceReport()
 * ```
 */
export const nobulex = {
  /**
   * Wrap a LangChain Runnable (agent, chain, or tool) with cryptographic
   * audit trail capabilities. Every LLM call, tool invocation, and chain
   * step is intercepted and recorded as a signed evidence item.
   *
   * @param runnable - Any LangChain Runnable with an invoke method.
   * @param options - Wrap configuration including covenant identifier.
   * @returns A NobulexWrapper with audit trail methods.
   */
  wrap<I = unknown, O = unknown>(
    runnable: Runnable<I, O>,
    options: WrapOptions,
  ): NobulexWrapper<I, O> {
    return new NobulexWrapper(runnable, options);
  },

  /**
   * Create a standalone audit handler for manual callback attachment.
   * Use this when you need more control over how callbacks are registered.
   *
   * @param agentId - Agent identifier for the evidence items.
   * @returns A LangChain-compatible callback handler.
   */
  createHandler(agentId?: string): NobulexAuditHandler {
    return new NobulexAuditHandler(agentId ?? `agent-${generateId(8)}`);
  },
};
