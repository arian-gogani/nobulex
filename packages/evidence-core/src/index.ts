/**
 * @nobulex/evidence-core — Signed, hash-chained evidence items recording AI agent actions.
 *
 * An evidence item is a compact, signed record combining: timestamp, agent DID,
 * action type, tool name, input/output hashes, model version, delegation chain,
 * and a hash pointer to the previous item forming an immutable chain.
 *
 * @packageDocumentation
 */

import {
  sha256String,
  sha256Object,
  canonicalizeJson,
  sign,
  verify,
  fromHex,
  toHex,
  timestamp as nowISO,
  generateId,
} from '@nobulex/crypto';
import type { KeyPair, HashHex } from '@nobulex/crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single evidence item in the hash chain. */
export interface EvidenceItem {
  /** Content-addressed ID (SHA-256 of canonical fields). */
  readonly id: string;
  /** ISO-8601 timestamp of when the action occurred. */
  readonly timestamp: string;
  /** DID of the agent that performed the action. */
  readonly agentDid: string;
  /** Category of action (e.g. "tool_call", "api_request", "delegation"). */
  readonly actionType: string;
  /** Name of the tool or function invoked. */
  readonly toolName: string;
  /** SHA-256 hash of the action input. */
  readonly inputHash: HashHex;
  /** SHA-256 hash of the action output. */
  readonly outputHash: HashHex;
  /** Model identifier and version (e.g. "claude-opus-4-20250514"). */
  readonly modelVersion: string;
  /** ID of the parent action for delegation chains, or null. */
  readonly parentActionId: string | null;
  /** Hash of the previous evidence item in the chain, or null for the first. */
  readonly previousHash: HashHex | null;
  /** SHA-256 hash of the canonical evidence content. */
  readonly hash: HashHex;
  /** Ed25519 signature over the hash, hex-encoded. */
  readonly signature: string;
}

/** Input for creating a new evidence item (fields the caller provides). */
export interface EvidenceInput {
  readonly agentDid: string;
  readonly actionType: string;
  readonly toolName: string;
  readonly inputHash: HashHex;
  readonly outputHash: HashHex;
  readonly modelVersion: string;
  readonly parentActionId?: string | null;
  readonly timestamp?: string;
}

/** Result of verifying an evidence item's integrity. */
export interface EvidenceVerification {
  readonly valid: boolean;
  readonly checks: readonly EvidenceCheck[];
}

/** A single verification check. */
export interface EvidenceCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly reason?: string;
}

/** Result of verifying a full evidence chain. */
export interface ChainVerification {
  readonly valid: boolean;
  readonly length: number;
  readonly errors: readonly string[];
}

// ─── Core content that gets hashed ──────────────────────────────────────────

interface EvidenceContent {
  readonly timestamp: string;
  readonly agentDid: string;
  readonly actionType: string;
  readonly toolName: string;
  readonly inputHash: HashHex;
  readonly outputHash: HashHex;
  readonly modelVersion: string;
  readonly parentActionId: string | null;
  readonly previousHash: HashHex | null;
}

function extractContent(item: EvidenceItem | EvidenceContent): EvidenceContent {
  return {
    timestamp: item.timestamp,
    agentDid: item.agentDid,
    actionType: item.actionType,
    toolName: item.toolName,
    inputHash: item.inputHash,
    outputHash: item.outputHash,
    modelVersion: item.modelVersion,
    parentActionId: item.parentActionId,
    previousHash: item.previousHash,
  };
}

/** Compute the hash of an evidence item's content. */
export function computeEvidenceHash(content: EvidenceContent): HashHex {
  return sha256String(canonicalizeJson(content));
}

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Builds a hash-chained sequence of evidence items.
 * Each item is signed and linked to the previous item via `previousHash`.
 */
export class EvidenceChainBuilder {
  private readonly items: EvidenceItem[] = [];
  private readonly agentDid: string;
  private readonly keyPair: KeyPair;

  constructor(agentDid: string, keyPair: KeyPair) {
    if (!agentDid) throw new Error('agentDid is required');
    this.agentDid = agentDid;
    this.keyPair = keyPair;
  }

  /** Number of items in the chain. */
  get length(): number {
    return this.items.length;
  }

  /** Hash of the most recent item, or null if empty. */
  get headHash(): HashHex | null {
    return this.items.length > 0 ? this.items[this.items.length - 1]!.hash : null;
  }

  /** Append a new evidence item to the chain. */
  async append(input: EvidenceInput): Promise<EvidenceItem> {
    const previousHash = this.headHash;
    const content: EvidenceContent = {
      timestamp: input.timestamp ?? nowISO(),
      agentDid: input.agentDid || this.agentDid,
      actionType: input.actionType,
      toolName: input.toolName,
      inputHash: input.inputHash,
      outputHash: input.outputHash,
      modelVersion: input.modelVersion,
      parentActionId: input.parentActionId ?? null,
      previousHash,
    };

    const hash = computeEvidenceHash(content);
    const sigBytes = await sign(
      new TextEncoder().encode(hash),
      this.keyPair.privateKey,
    );

    const item: EvidenceItem = {
      id: sha256Object({ hash, index: this.items.length }),
      ...content,
      hash,
      signature: toHex(sigBytes),
    };

    this.items.push(item);
    return item;
  }

  /** Get an item by index. */
  get(index: number): EvidenceItem | undefined {
    return this.items[index];
  }

  /** Return all items as a readonly array. */
  entries(): readonly EvidenceItem[] {
    return [...this.items];
  }

  /** Return all item hashes (for feeding into a Merkle tree). */
  hashes(): readonly string[] {
    return this.items.map((i) => i.hash);
  }
}

// ─── Standalone creation ────────────────────────────────────────────────────

/** Create a single signed evidence item (for use outside a chain builder). */
export async function createEvidenceItem(
  input: EvidenceInput,
  previousHash: HashHex | null,
  keyPair: KeyPair,
): Promise<EvidenceItem> {
  const content: EvidenceContent = {
    timestamp: input.timestamp ?? nowISO(),
    agentDid: input.agentDid,
    actionType: input.actionType,
    toolName: input.toolName,
    inputHash: input.inputHash,
    outputHash: input.outputHash,
    modelVersion: input.modelVersion,
    parentActionId: input.parentActionId ?? null,
    previousHash,
  };

  const hash = computeEvidenceHash(content);
  const sigBytes = await sign(
    new TextEncoder().encode(hash),
    keyPair.privateKey,
  );

  return {
    id: generateId(),
    ...content,
    hash,
    signature: toHex(sigBytes),
  };
}

// ─── Verification ───────────────────────────────────────────────────────────

/** Verify a single evidence item's hash and signature. */
export async function verifyEvidenceItem(
  item: EvidenceItem,
  signerPublicKey: Uint8Array,
): Promise<EvidenceVerification> {
  const checks: EvidenceCheck[] = [];

  // Check hash integrity
  const recomputed = computeEvidenceHash(extractContent(item));
  const hashValid = recomputed === item.hash;
  checks.push({
    name: 'hash_integrity',
    passed: hashValid,
    reason: hashValid ? undefined : 'Recomputed hash does not match item.hash',
  });

  // Check signature
  let sigValid = false;
  try {
    sigValid = await verify(
      new TextEncoder().encode(item.hash),
      fromHex(item.signature),
      signerPublicKey,
    );
  } catch {
    sigValid = false;
  }
  checks.push({
    name: 'signature_valid',
    passed: sigValid,
    reason: sigValid ? undefined : 'Signature verification failed',
  });

  return {
    valid: checks.every((c) => c.passed),
    checks,
  };
}

/** Verify the integrity of an ordered chain of evidence items. */
export async function verifyEvidenceChain(
  items: readonly EvidenceItem[],
  signerPublicKey: Uint8Array,
): Promise<ChainVerification> {
  const errors: string[] = [];

  if (items.length === 0) {
    return { valid: true, length: 0, errors: [] };
  }

  // First item must have null previousHash
  if (items[0]!.previousHash !== null) {
    errors.push('First item previousHash must be null');
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;

    // Verify hash
    const recomputed = computeEvidenceHash(extractContent(item));
    if (recomputed !== item.hash) {
      errors.push(`Item ${i}: hash mismatch`);
    }

    // Verify signature
    try {
      const valid = await verify(
        new TextEncoder().encode(item.hash),
        fromHex(item.signature),
        signerPublicKey,
      );
      if (!valid) errors.push(`Item ${i}: invalid signature`);
    } catch {
      errors.push(`Item ${i}: signature verification error`);
    }

    // Verify chain linkage
    if (i > 0 && item.previousHash !== items[i - 1]!.hash) {
      errors.push(`Item ${i}: previousHash does not match prior item hash`);
    }

    // Verify non-decreasing timestamps
    if (i > 0 && item.timestamp < items[i - 1]!.timestamp) {
      errors.push(`Item ${i}: timestamp precedes previous item`);
    }
  }

  return { valid: errors.length === 0, length: items.length, errors };
}

/** Compute the size in bytes of a serialized evidence item. */
export function evidenceItemSize(item: EvidenceItem): number {
  return new TextEncoder().encode(canonicalizeJson(item)).length;
}
