import {
  sha256String,
  sha256Object,
  canonicalizeJson,
  signString,
  verify,
  toHex,
  fromHex,
  timestamp,
} from '@stele/crypto';
import type { HashHex, KeyPair } from '@stele/crypto';

export type {
  RuntimeType,
  ModelAttestation,
  DeploymentContext,
  LineageEntry,
  AgentIdentity,
  EvolutionPolicy,
  CreateIdentityOptions,
  EvolveIdentityOptions,
} from './types';

import type {
  AgentIdentity,
  EvolutionPolicy,
  CreateIdentityOptions,
  EvolveIdentityOptions,
  LineageEntry,
  ModelAttestation,
  DeploymentContext,
} from './types';

// ---------------------------------------------------------------------------
// Default evolution policy
// ---------------------------------------------------------------------------

/**
 * Default reputation carry-forward rates for each type of identity evolution.
 * A value of 1.0 means full reputation is preserved; 0.0 means none.
 */
export const DEFAULT_EVOLUTION_POLICY: EvolutionPolicy = {
  minorUpdate: 0.95,
  modelVersionChange: 0.80,
  modelFamilyChange: 0.20,
  operatorTransfer: 0.50,
  capabilityExpansion: 0.90,
  capabilityReduction: 1.00,
  fullRebuild: 0.00,
};

// ---------------------------------------------------------------------------
// Hash utilities
// ---------------------------------------------------------------------------

/**
 * Compute a canonical hash of a sorted capabilities list.
 *
 * Capabilities are sorted lexicographically before hashing to ensure
 * determinism regardless of input order. Two agents with the same
 * capabilities always produce the same manifest hash.
 *
 * @param capabilities - Array of capability strings.
 * @returns A hex-encoded SHA-256 hash of the canonical capability list.
 *
 * @example
 * ```typescript
 * const hash = computeCapabilityManifestHash(['write', 'read']);
 * // Same result as: computeCapabilityManifestHash(['read', 'write'])
 * ```
 */
export function computeCapabilityManifestHash(capabilities: string[]): HashHex {
  const sorted = [...capabilities].sort();
  return sha256String(canonicalizeJson(sorted));
}

/**
 * Compute the composite identity hash from all identity-defining fields.
 *
 * The hash covers operator key, model attestation, capability manifest,
 * deployment context, and the full lineage chain. This produces the
 * `id` field of an AgentIdentity.
 *
 * @param identity - The identity fields (excluding `id` and `signature`).
 * @returns A hex-encoded SHA-256 composite hash.
 */
export function computeIdentityHash(
  identity: Omit<AgentIdentity, 'id' | 'signature'>
): HashHex {
  const composite = {
    operatorPublicKey: identity.operatorPublicKey,
    model: identity.model,
    capabilityManifestHash: identity.capabilityManifestHash,
    deployment: identity.deployment,
    lineage: identity.lineage,
  };
  return sha256Object(composite);
}

// ---------------------------------------------------------------------------
// Signing helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical string representation of an identity for signing.
 * Excludes `id` and `signature` since `id` is derived from the content
 * and `signature` is what we are producing.
 */
function identitySigningPayload(identity: Omit<AgentIdentity, 'signature'>): string {
  const { signature: _ignored, ...rest } = identity as Record<string, unknown>;
  void _ignored;
  return canonicalizeJson(rest);
}

/**
 * Build the canonical string for a lineage entry before its signature is set.
 */
function lineageSigningPayload(entry: Omit<LineageEntry, 'signature'>): string {
  return canonicalizeJson(entry);
}

// ---------------------------------------------------------------------------
// Create identity
// ---------------------------------------------------------------------------

/**
 * Create a brand-new agent identity.
 *
 * Computes the capability manifest hash and composite identity hash,
 * initialises a single lineage entry of type `created`, and signs
 * the whole identity with the provided operator key pair.
 *
 * @param options - Creation options including operator key pair, model, capabilities, and deployment.
 * @returns A fully signed AgentIdentity with version 1 and one lineage entry.
 *
 * @example
 * ```typescript
 * const kp = await generateKeyPair();
 * const identity = await createIdentity({
 *   operatorKeyPair: kp,
 *   model: { provider: 'anthropic', modelId: 'claude-3' },
 *   capabilities: ['read', 'write'],
 *   deployment: { runtime: 'container' },
 * });
 * console.log(identity.id); // hex hash
 * ```
 */
export async function createIdentity(
  options: CreateIdentityOptions
): Promise<AgentIdentity> {
  const { operatorKeyPair, operatorIdentifier, model, capabilities, deployment } = options;

  const now = timestamp();
  const capabilityManifestHash = computeCapabilityManifestHash(capabilities);

  // Build a partial identity (no id / signature yet) so we can hash it.
  const partialForLineage: Omit<AgentIdentity, 'id' | 'signature'> = {
    operatorPublicKey: operatorKeyPair.publicKeyHex,
    ...(operatorIdentifier !== undefined ? { operatorIdentifier } : {}),
    model,
    capabilities: [...capabilities].sort(),
    capabilityManifestHash,
    deployment,
    lineage: [], // placeholder – will be replaced after lineage entry is built
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  // Compute a preliminary identity hash (lineage empty) for the first lineage entry.
  const preliminaryHash = computeIdentityHash(partialForLineage);

  // Build the lineage entry (unsigned first, then signed).
  const lineageEntryUnsigned: Omit<LineageEntry, 'signature'> = {
    identityHash: preliminaryHash,
    changeType: 'created',
    description: 'Identity created',
    timestamp: now,
    parentHash: null,
    reputationCarryForward: 1.0,
  };

  const lineagePayload = lineageSigningPayload(lineageEntryUnsigned);
  const lineageSig = await signString(lineagePayload, operatorKeyPair.privateKey);
  const lineageEntry: LineageEntry = {
    ...lineageEntryUnsigned,
    signature: toHex(lineageSig),
  };

  // Rebuild identity with the final lineage chain.
  const identityNoIdSig: Omit<AgentIdentity, 'id' | 'signature'> = {
    ...partialForLineage,
    lineage: [lineageEntry],
  };

  // Compute the final composite identity hash.
  const id = computeIdentityHash(identityNoIdSig);

  // Sign the full identity (including id).
  const identityForSigning: Omit<AgentIdentity, 'signature'> = {
    ...identityNoIdSig,
    id,
  };

  const identitySig = await signString(
    identitySigningPayload(identityForSigning),
    operatorKeyPair.privateKey
  );

  const identity: AgentIdentity = {
    ...identityForSigning,
    signature: toHex(identitySig),
  };

  return identity;
}

// ---------------------------------------------------------------------------
// Evolve identity
// ---------------------------------------------------------------------------

/**
 * Evolve an existing identity by applying updates.
 *
 * Returns a **new** AgentIdentity (the original is never mutated).
 * The updates are merged on top of the current fields. A new lineage
 * entry is appended, the version is incremented, and the composite
 * identity hash and operator signature are recomputed.
 *
 * @param current - The existing identity to evolve.
 * @param options - Evolution options including change type, description, and field updates.
 * @returns A new AgentIdentity with incremented version and extended lineage.
 *
 * @example
 * ```typescript
 * const evolved = await evolveIdentity(identity, {
 *   operatorKeyPair: kp,
 *   changeType: 'capability_change',
 *   description: 'Added write capability',
 *   updates: { capabilities: ['read', 'write', 'admin'] },
 * });
 * console.log(evolved.version); // identity.version + 1
 * ```
 */
export async function evolveIdentity(
  current: AgentIdentity,
  options: EvolveIdentityOptions
): Promise<AgentIdentity> {
  const { operatorKeyPair, changeType, description, updates } = options;

  const now = timestamp();

  // Determine new field values, merging updates over current.
  const newModel: ModelAttestation = updates.model ?? current.model;
  const newCapabilities: string[] = updates.capabilities
    ? [...updates.capabilities].sort()
    : [...current.capabilities];
  const newDeployment: DeploymentContext = updates.deployment ?? current.deployment;
  const newOperatorPublicKey: string =
    updates.operatorPublicKey ?? operatorKeyPair.publicKeyHex;
  const newOperatorIdentifier: string | undefined =
    updates.operatorIdentifier ?? current.operatorIdentifier;

  const capabilityManifestHash = computeCapabilityManifestHash(newCapabilities);

  // Compute carry-forward.
  const reputationCarryForward =
    options.reputationCarryForward ??
    computeCarryForward(changeType, current, updates);

  // Build partial identity (no id / signature) to produce the preliminary hash.
  const newVersion = current.version + 1;

  const partialForLineage: Omit<AgentIdentity, 'id' | 'signature'> = {
    operatorPublicKey: newOperatorPublicKey,
    ...(newOperatorIdentifier !== undefined
      ? { operatorIdentifier: newOperatorIdentifier }
      : {}),
    model: newModel,
    capabilities: newCapabilities,
    capabilityManifestHash,
    deployment: newDeployment,
    lineage: current.lineage, // placeholder – will be extended
    version: newVersion,
    createdAt: current.createdAt,
    updatedAt: now,
  };

  const preliminaryHash = computeIdentityHash(partialForLineage);

  // Previous lineage tail hash.
  const parentHash =
    current.lineage.length > 0
      ? current.lineage[current.lineage.length - 1]!.identityHash
      : null;

  // Build and sign the new lineage entry.
  const lineageEntryUnsigned: Omit<LineageEntry, 'signature'> = {
    identityHash: preliminaryHash,
    changeType,
    description,
    timestamp: now,
    parentHash,
    reputationCarryForward,
  };

  const lineagePayload = lineageSigningPayload(lineageEntryUnsigned);
  const lineageSig = await signString(lineagePayload, operatorKeyPair.privateKey);
  const lineageEntry: LineageEntry = {
    ...lineageEntryUnsigned,
    signature: toHex(lineageSig),
  };

  // Final lineage chain.
  const newLineage = [...current.lineage, lineageEntry];

  // Rebuild identity with final lineage.
  const identityNoIdSig: Omit<AgentIdentity, 'id' | 'signature'> = {
    ...partialForLineage,
    lineage: newLineage,
  };

  const id = computeIdentityHash(identityNoIdSig);

  // Sign the full identity.
  const identityForSigning: Omit<AgentIdentity, 'signature'> = {
    ...identityNoIdSig,
    id,
  };

  const identitySig = await signString(
    identitySigningPayload(identityForSigning),
    operatorKeyPair.privateKey
  );

  const identity: AgentIdentity = {
    ...identityForSigning,
    signature: toHex(identitySig),
  };

  return identity;
}

// ---------------------------------------------------------------------------
// Verify identity
// ---------------------------------------------------------------------------

interface VerificationCheck {
  name: string;
  passed: boolean;
  message: string;
}

/**
 * Verify all cryptographic and structural invariants of an agent identity.
 *
 * Checks performed:
 *  1. Capability manifest hash matches sorted capabilities.
 *  2. Composite identity hash matches the `id` field.
 *  3. Operator signature over the identity payload is valid.
 *  4. Lineage chain is consistent (parent hash links, ordered timestamps).
 *  5. All lineage entry signatures are valid.
 *  6. Version number matches the lineage length.
 *
 * @param identity - The agent identity to verify.
 * @returns An object with `valid` boolean and detailed `checks` array.
 *
 * @example
 * ```typescript
 * const result = await verifyIdentity(identity);
 * if (!result.valid) {
 *   const failed = result.checks.filter(c => !c.passed);
 *   console.log('Failed checks:', failed.map(c => c.name));
 * }
 * ```
 */
export async function verifyIdentity(
  identity: AgentIdentity
): Promise<{ valid: boolean; checks: VerificationCheck[] }> {
  const checks: VerificationCheck[] = [];

  // 1. Capability manifest hash -----------------------------------------
  const expectedCapHash = computeCapabilityManifestHash(identity.capabilities);
  const capHashOk = expectedCapHash === identity.capabilityManifestHash;
  checks.push({
    name: 'capability_manifest_hash',
    passed: capHashOk,
    message: capHashOk
      ? 'Capability manifest hash is valid'
      : `Capability manifest hash mismatch: expected ${expectedCapHash}, got ${identity.capabilityManifestHash}`,
  });

  // 2. Composite identity hash ------------------------------------------
  const { id: _id, signature: _sig, ...rest } = identity;
  const expectedId = computeIdentityHash(rest as Omit<AgentIdentity, 'id' | 'signature'>);
  const idOk = expectedId === identity.id;
  checks.push({
    name: 'composite_identity_hash',
    passed: idOk,
    message: idOk
      ? 'Composite identity hash is valid'
      : `Composite identity hash mismatch: expected ${expectedId}, got ${identity.id}`,
  });

  // 3. Operator signature -----------------------------------------------
  const identityForSigning: Omit<AgentIdentity, 'signature'> = {
    id: identity.id,
    operatorPublicKey: identity.operatorPublicKey,
    ...(identity.operatorIdentifier !== undefined
      ? { operatorIdentifier: identity.operatorIdentifier }
      : {}),
    model: identity.model,
    capabilities: identity.capabilities,
    capabilityManifestHash: identity.capabilityManifestHash,
    deployment: identity.deployment,
    lineage: identity.lineage,
    version: identity.version,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
  };

  const sigPayload = identitySigningPayload(identityForSigning);
  const sigBytes = fromHex(identity.signature);
  const pubKeyBytes = fromHex(identity.operatorPublicKey);
  const sigMessage = new TextEncoder().encode(sigPayload);

  let sigOk = false;
  try {
    sigOk = await verify(sigMessage, sigBytes, pubKeyBytes);
  } catch {
    sigOk = false;
  }
  checks.push({
    name: 'operator_signature',
    passed: sigOk,
    message: sigOk
      ? 'Operator signature is valid'
      : 'Operator signature verification failed',
  });

  // 4. Lineage chain consistency ----------------------------------------
  let lineageOk = true;
  let lineageMessage = 'Lineage chain is consistent';

  for (let i = 0; i < identity.lineage.length; i++) {
    const entry = identity.lineage[i]!;

    // Check parent hash linkage.
    if (i === 0) {
      if (entry.parentHash !== null) {
        lineageOk = false;
        lineageMessage = `Lineage entry 0: expected null parentHash, got ${entry.parentHash}`;
        break;
      }
    } else {
      const prev = identity.lineage[i - 1]!;
      if (entry.parentHash !== prev.identityHash) {
        lineageOk = false;
        lineageMessage = `Lineage entry ${i}: parentHash ${entry.parentHash} does not match previous identityHash ${prev.identityHash}`;
        break;
      }
    }

    // Check timestamp ordering (non-strict, timestamps may be equal for same-tick ops).
    if (i > 0) {
      const prev = identity.lineage[i - 1]!;
      if (entry.timestamp < prev.timestamp) {
        lineageOk = false;
        lineageMessage = `Lineage entry ${i}: timestamp ${entry.timestamp} is before previous ${prev.timestamp}`;
        break;
      }
    }
  }

  checks.push({
    name: 'lineage_chain',
    passed: lineageOk,
    message: lineageMessage,
  });

  // 4b. Lineage entry signatures ----------------------------------------
  let lineageSigsOk = true;
  let lineageSigsMessage = 'All lineage entry signatures are valid';

  for (let i = 0; i < identity.lineage.length; i++) {
    const entry = identity.lineage[i]!;
    try {
      const entryUnsigned: Omit<LineageEntry, 'signature'> = {
        identityHash: entry.identityHash,
        changeType: entry.changeType,
        description: entry.description,
        timestamp: entry.timestamp,
        parentHash: entry.parentHash,
        reputationCarryForward: entry.reputationCarryForward,
      };
      const payload = canonicalizeJson(entryUnsigned);
      const msgBytes = new TextEncoder().encode(payload);
      const sigBytes = fromHex(entry.signature);
      const pubBytes = fromHex(identity.operatorPublicKey);
      const entryValid = await verify(msgBytes, sigBytes, pubBytes);
      if (!entryValid) {
        lineageSigsOk = false;
        lineageSigsMessage = `Lineage entry ${i}: signature verification failed`;
        break;
      }
    } catch {
      lineageSigsOk = false;
      lineageSigsMessage = `Lineage entry ${i}: signature verification error`;
      break;
    }
  }

  checks.push({
    name: 'lineage_signatures',
    passed: lineageSigsOk,
    message: lineageSigsMessage,
  });

  // 5. Version matches lineage length -----------------------------------
  const versionOk = identity.version === identity.lineage.length;
  checks.push({
    name: 'version_lineage_match',
    passed: versionOk,
    message: versionOk
      ? 'Version matches lineage length'
      : `Version ${identity.version} does not match lineage length ${identity.lineage.length}`,
  });

  const valid = checks.every((c) => c.passed);
  return { valid, checks };
}

// ---------------------------------------------------------------------------
// Reputation carry-forward
// ---------------------------------------------------------------------------

/**
 * Compute the reputation carry-forward rate for an identity evolution.
 *
 * Determines what fraction of the agent's reputation is preserved
 * after a given change type. Values range from 0.0 (no reputation
 * preserved) to 1.0 (full reputation preserved).
 *
 * @param changeType - The type of change being made.
 * @param current - The current identity state.
 * @param updates - The proposed updates.
 * @param policy - Optional custom evolution policy (defaults to DEFAULT_EVOLUTION_POLICY).
 * @returns A number in [0, 1] representing the carry-forward rate.
 *
 * @example
 * ```typescript
 * const rate = computeCarryForward('model_update', identity, { model: newModel });
 * console.log(rate); // 0.80 for same-family version change
 * ```
 */
export function computeCarryForward(
  changeType: LineageEntry['changeType'],
  current: AgentIdentity,
  updates: EvolveIdentityOptions['updates'],
  policy: EvolutionPolicy = DEFAULT_EVOLUTION_POLICY
): number {
  switch (changeType) {
    case 'created':
      return 1.0;

    case 'model_update': {
      // Distinguish between a version bump within the same model family
      // and a full model family change.
      if (updates.model) {
        const sameFamily =
          updates.model.provider === current.model.provider &&
          updates.model.modelId === current.model.modelId;
        return sameFamily ? policy.modelVersionChange : policy.modelFamilyChange;
      }
      return policy.minorUpdate;
    }

    case 'capability_change': {
      if (updates.capabilities) {
        const currentSet = new Set(current.capabilities);
        const newSet = new Set(updates.capabilities);
        const added = updates.capabilities.filter((c) => !currentSet.has(c));
        const removed = current.capabilities.filter((c) => !newSet.has(c));

        if (added.length > 0 && removed.length === 0) {
          return policy.capabilityExpansion;
        }
        if (removed.length > 0 && added.length === 0) {
          return policy.capabilityReduction;
        }
        // Mixed: use the lower of the two rates.
        return Math.min(policy.capabilityExpansion, policy.capabilityReduction);
      }
      return policy.minorUpdate;
    }

    case 'operator_transfer':
      return policy.operatorTransfer;

    case 'fork':
      // Forks create a new lineage branch — moderate carry-forward
      return policy.operatorTransfer;  // 0.50 — same risk as transfer

    case 'merge':
      // Merges combine lineages — use the lower of expansion and version change
      return Math.min(policy.capabilityExpansion, policy.modelVersionChange);

    default:
      return policy.fullRebuild;
  }
}

// ---------------------------------------------------------------------------
// Lineage helpers
// ---------------------------------------------------------------------------

/**
 * Return a copy of the full lineage chain for an identity.
 *
 * The returned array is a shallow copy, so mutations do not
 * affect the original identity.
 *
 * @param identity - The agent identity.
 * @returns An array of lineage entries, oldest first.
 *
 * @example
 * ```typescript
 * const lineage = getLineage(identity);
 * console.log(lineage[0].changeType); // 'created'
 * ```
 */
export function getLineage(identity: AgentIdentity): LineageEntry[] {
  return [...identity.lineage];
}

/**
 * Check whether two identities share a common ancestor.
 *
 * Compares identity hashes in their lineage chains to find any overlap.
 * Useful for determining if two agents diverged from a common origin.
 *
 * @param a - First agent identity.
 * @param b - Second agent identity.
 * @returns `true` if any lineage entry hash appears in both chains.
 *
 * @example
 * ```typescript
 * const related = shareAncestor(agent1, agent2);
 * ```
 */
export function shareAncestor(a: AgentIdentity, b: AgentIdentity): boolean {
  const hashesA = new Set(a.lineage.map((e) => e.identityHash));
  return b.lineage.some((e) => hashesA.has(e.identityHash));
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/**
 * Serialize an AgentIdentity to a canonical (deterministic) JSON string.
 *
 * Uses sorted keys so the output is identical regardless of object
 * property insertion order.
 *
 * @param identity - The identity to serialize.
 * @returns A canonical JSON string.
 *
 * @example
 * ```typescript
 * const json = serializeIdentity(identity);
 * fs.writeFileSync('identity.json', json);
 * ```
 */
export function serializeIdentity(identity: AgentIdentity): string {
  return canonicalizeJson(identity);
}

/**
 * Deserialize a JSON string back into an AgentIdentity.
 *
 * Performs structural validation to ensure all required fields
 * are present and have correct types.
 *
 * @param json - A JSON string representing an agent identity.
 * @returns The parsed AgentIdentity.
 * @throws {Error} When the JSON is malformed or missing required fields.
 *
 * @example
 * ```typescript
 * const identity = deserializeIdentity(fs.readFileSync('identity.json', 'utf-8'));
 * ```
 */
export function deserializeIdentity(json: string): AgentIdentity {
  const parsed: unknown = JSON.parse(json);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid identity JSON: expected an object');
  }

  const obj = parsed as Record<string, unknown>;

  // Validate required top-level fields exist.
  const requiredFields = [
    'id',
    'operatorPublicKey',
    'model',
    'capabilities',
    'capabilityManifestHash',
    'deployment',
    'lineage',
    'version',
    'createdAt',
    'updatedAt',
    'signature',
  ];

  for (const field of requiredFields) {
    if (!(field in obj)) {
      throw new Error(`Invalid identity JSON: missing required field "${field}"`);
    }
  }

  if (!Array.isArray(obj['lineage'])) {
    throw new Error('Invalid identity JSON: lineage must be an array');
  }

  if (!Array.isArray(obj['capabilities'])) {
    throw new Error('Invalid identity JSON: capabilities must be an array');
  }

  if (typeof obj['version'] !== 'number') {
    throw new Error('Invalid identity JSON: version must be a number');
  }

  return parsed as AgentIdentity;
}
