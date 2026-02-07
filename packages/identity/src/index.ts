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
 * Capabilities are sorted lexicographically before hashing to ensure
 * determinism regardless of input order.
 */
export function computeCapabilityManifestHash(capabilities: string[]): HashHex {
  const sorted = [...capabilities].sort();
  return sha256String(canonicalizeJson(sorted));
}

/**
 * Compute the composite identity hash from all identity-defining fields.
 * The hash covers operator key, model attestation, capability manifest,
 * deployment context, and the full lineage chain.
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
 * Evolve an existing identity by applying updates. Returns a **new**
 * `AgentIdentity` (the original is never mutated).
 *
 * The updates are merged on top of the current fields. A new lineage
 * entry is appended, the version is incremented, and the composite
 * identity hash and operator signature are recomputed.
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
 *  5. Version number matches the lineage length.
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
 * Compute the reputation carry-forward rate based on the change type,
 * the current identity state, and the proposed updates.
 *
 * If an explicit `EvolutionPolicy` is provided it will be used;
 * otherwise `DEFAULT_EVOLUTION_POLICY` applies.
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
      return policy.minorUpdate;

    case 'merge':
      return policy.minorUpdate;

    default:
      return policy.fullRebuild;
  }
}

// ---------------------------------------------------------------------------
// Lineage helpers
// ---------------------------------------------------------------------------

/**
 * Return the full lineage chain for an identity.
 */
export function getLineage(identity: AgentIdentity): LineageEntry[] {
  return [...identity.lineage];
}

/**
 * Check whether two identities share a common ancestor by comparing
 * identity hashes in their lineage chains.
 */
export function shareAncestor(a: AgentIdentity, b: AgentIdentity): boolean {
  const hashesA = new Set(a.lineage.map((e) => e.identityHash));
  return b.lineage.some((e) => hashesA.has(e.identityHash));
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/**
 * Serialize an `AgentIdentity` to a canonical JSON string.
 */
export function serializeIdentity(identity: AgentIdentity): string {
  return canonicalizeJson(identity);
}

/**
 * Deserialize a JSON string back into an `AgentIdentity`.
 * Performs basic structural validation.
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
