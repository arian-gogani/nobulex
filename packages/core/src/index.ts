import {
  signString,
  verify,
  sha256String,
  canonicalizeJson,
  toHex,
  fromHex,
  generateNonce,
  timestamp,
} from '@stele/crypto';

import type { KeyPair, HashHex } from '@stele/crypto';

import {
  parse as cclParse,
  merge as cclMerge,
  validateNarrowing as cclValidateNarrowing,
} from '@stele/ccl';

import type { CCLDocument, NarrowingViolation } from '@stele/ccl';

import {
  PROTOCOL_VERSION,
  MAX_CONSTRAINTS,
  MAX_CHAIN_DEPTH,
  MAX_DOCUMENT_SIZE,
} from './types.js';

import type {
  CovenantDocument,
  CovenantBuilderOptions,
  VerificationResult,
  VerificationCheck,
  Countersignature,
  PartyRole,
} from './types.js';

// Re-export all types so consumers only need @stele/core
export type {
  EnforcementType,
  ProofType,
  ChainRelation,
  RevocationMethod,
  PartyRole,
  Party,
  Issuer,
  Beneficiary,
  ChainReference,
  EnforcementConfig,
  ProofConfig,
  RevocationConfig,
  Countersignature,
  Obligation,
  CovenantMetadata,
  CovenantDocument,
  CovenantBuilderOptions,
  VerificationResult,
  VerificationCheck,
} from './types.js';

export {
  PROTOCOL_VERSION,
  MAX_CONSTRAINTS,
  MAX_CHAIN_DEPTH,
  MAX_DOCUMENT_SIZE,
} from './types.js';

// ─── Error classes ─────────────────────────────────────────────────────────────

/**
 * Thrown when building a covenant document fails validation.
 * The `field` property indicates which input caused the failure.
 */
export class CovenantBuildError extends Error {
  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = 'CovenantBuildError';
    this.field = field;
  }
}

/**
 * Thrown when covenant verification encounters critical failures.
 * The `checks` array contains detailed per-check results.
 */
export class CovenantVerificationError extends Error {
  readonly checks: VerificationCheck[];

  constructor(message: string, checks: VerificationCheck[]) {
    super(message);
    this.name = 'CovenantVerificationError';
    this.checks = checks;
  }
}

// ─── Canonical form & ID computation ───────────────────────────────────────────

/**
 * Compute the canonical form of a covenant document.
 *
 * Strips the `id`, `signature`, and `countersignatures` fields, then
 * produces deterministic JSON via JCS (RFC 8785) canonicalization.
 */
export function canonicalForm(doc: CovenantDocument): string {
  // Build a shallow copy omitting the three mutable fields
  const { id: _id, signature: _sig, countersignatures: _cs, ...body } = doc;
  return canonicalizeJson(body);
}

/**
 * Compute the SHA-256 document ID from its canonical form.
 */
export function computeId(doc: CovenantDocument): HashHex {
  return sha256String(canonicalForm(doc));
}

// ─── Build ─────────────────────────────────────────────────────────────────────

/**
 * Build a new, signed CovenantDocument from the provided options.
 *
 * Validates all required inputs, parses CCL constraints to verify syntax,
 * generates a cryptographic nonce, signs the canonical form with the
 * issuer's private key, and computes the document ID.
 *
 * @throws CovenantBuildError if any required input is missing or invalid.
 */
export async function buildCovenant(
  options: CovenantBuilderOptions,
): Promise<CovenantDocument> {
  // ── Validate required inputs ──────────────────────────────────────────
  if (!options.issuer) {
    throw new CovenantBuildError('issuer is required', 'issuer');
  }
  if (!options.issuer.id) {
    throw new CovenantBuildError('issuer.id is required', 'issuer.id');
  }
  if (!options.issuer.publicKey) {
    throw new CovenantBuildError('issuer.publicKey is required', 'issuer.publicKey');
  }
  if (options.issuer.role !== 'issuer') {
    throw new CovenantBuildError('issuer.role must be "issuer"', 'issuer.role');
  }

  if (!options.beneficiary) {
    throw new CovenantBuildError('beneficiary is required', 'beneficiary');
  }
  if (!options.beneficiary.id) {
    throw new CovenantBuildError('beneficiary.id is required', 'beneficiary.id');
  }
  if (!options.beneficiary.publicKey) {
    throw new CovenantBuildError('beneficiary.publicKey is required', 'beneficiary.publicKey');
  }
  if (options.beneficiary.role !== 'beneficiary') {
    throw new CovenantBuildError('beneficiary.role must be "beneficiary"', 'beneficiary.role');
  }

  if (!options.constraints || options.constraints.trim().length === 0) {
    throw new CovenantBuildError('constraints is required and must be non-empty', 'constraints');
  }

  if (!options.privateKey || options.privateKey.length === 0) {
    throw new CovenantBuildError('privateKey is required', 'privateKey');
  }

  // ── Parse CCL to verify syntax and check constraint count ─────────────
  let parsedCCL: CCLDocument;
  try {
    parsedCCL = cclParse(options.constraints);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CovenantBuildError(`Invalid CCL constraints: ${msg}`, 'constraints');
  }

  if (parsedCCL.statements.length > MAX_CONSTRAINTS) {
    throw new CovenantBuildError(
      `Constraints exceed maximum of ${MAX_CONSTRAINTS} statements (got ${parsedCCL.statements.length})`,
      'constraints',
    );
  }

  // ── Validate chain reference if present ───────────────────────────────
  if (options.chain) {
    if (!options.chain.parentId) {
      throw new CovenantBuildError('chain.parentId is required', 'chain.parentId');
    }
    if (!options.chain.relation) {
      throw new CovenantBuildError('chain.relation is required', 'chain.relation');
    }
    if (typeof options.chain.depth !== 'number' || options.chain.depth < 1) {
      throw new CovenantBuildError('chain.depth must be a positive integer', 'chain.depth');
    }
    if (options.chain.depth > MAX_CHAIN_DEPTH) {
      throw new CovenantBuildError(
        `chain.depth exceeds maximum of ${MAX_CHAIN_DEPTH} (got ${options.chain.depth})`,
        'chain.depth',
      );
    }
  }

  // ── Validate enforcement config if present ────────────────────────────
  if (options.enforcement) {
    const validEnforcementTypes = ['capability', 'monitor', 'audit', 'bond', 'composite'];
    if (!validEnforcementTypes.includes(options.enforcement.type)) {
      throw new CovenantBuildError(
        `Invalid enforcement type: ${options.enforcement.type}`,
        'enforcement.type',
      );
    }
  }

  // ── Validate proof config if present ──────────────────────────────────
  if (options.proof) {
    const validProofTypes = ['tee', 'capability_manifest', 'audit_log', 'bond_reference', 'zkp', 'composite'];
    if (!validProofTypes.includes(options.proof.type)) {
      throw new CovenantBuildError(
        `Invalid proof type: ${options.proof.type}`,
        'proof.type',
      );
    }
  }

  // ── Generate nonce and timestamp ──────────────────────────────────────
  const nonce = toHex(generateNonce());
  const createdAt = timestamp();

  // ── Construct the document (id and signature are placeholders) ────────
  const doc: CovenantDocument = {
    id: '' as HashHex,
    version: PROTOCOL_VERSION,
    issuer: options.issuer,
    beneficiary: options.beneficiary,
    constraints: options.constraints,
    nonce,
    createdAt,
    signature: '',
  };

  // Add optional fields only if provided
  if (options.obligations && options.obligations.length > 0) {
    doc.obligations = options.obligations;
  }
  if (options.chain) {
    doc.chain = options.chain;
  }
  if (options.enforcement) {
    doc.enforcement = options.enforcement;
  }
  if (options.proof) {
    doc.proof = options.proof;
  }
  if (options.revocation) {
    doc.revocation = options.revocation;
  }
  if (options.metadata) {
    doc.metadata = options.metadata;
  }
  if (options.expiresAt) {
    doc.expiresAt = options.expiresAt;
  }
  if (options.activatesAt) {
    doc.activatesAt = options.activatesAt;
  }

  // ── Compute canonical form, sign, and derive ID ───────────────────────
  const canonical = canonicalForm(doc);
  const signatureBytes = await signString(canonical, options.privateKey);
  doc.signature = toHex(signatureBytes);
  doc.id = sha256String(canonical);

  // ── Validate serialized size ──────────────────────────────────────────
  const serialized = JSON.stringify(doc);
  if (new TextEncoder().encode(serialized).byteLength > MAX_DOCUMENT_SIZE) {
    throw new CovenantBuildError(
      `Serialized document exceeds maximum size of ${MAX_DOCUMENT_SIZE} bytes`,
      'document',
    );
  }

  return doc;
}

// ─── Re-sign ───────────────────────────────────────────────────────────────────

/**
 * Re-sign an existing covenant document with a new nonce, signature, and ID.
 *
 * Useful when the issuer's key has rotated or the nonce must be refreshed.
 * The returned document is a new copy; the original is not mutated.
 */
export async function resignCovenant(
  doc: CovenantDocument,
  privateKey: Uint8Array,
): Promise<CovenantDocument> {
  const newDoc: CovenantDocument = {
    ...doc,
    nonce: toHex(generateNonce()),
    signature: '',
    id: '' as HashHex,
  };

  // Strip countersignatures on re-sign — they are invalidated by the new canonical form
  delete newDoc.countersignatures;

  const canonical = canonicalForm(newDoc);
  const signatureBytes = await signString(canonical, privateKey);
  newDoc.signature = toHex(signatureBytes);
  newDoc.id = sha256String(canonical);

  return newDoc;
}

// ─── Countersign ───────────────────────────────────────────────────────────────

/**
 * Add a countersignature to a covenant document.
 *
 * The countersigner signs the canonical form (which does not include
 * existing countersignatures), producing a stable signature that is
 * independent of other countersignatures.
 *
 * Returns a new document; the original is not mutated.
 */
export async function countersignCovenant(
  doc: CovenantDocument,
  signerKeyPair: KeyPair,
  signerRole: PartyRole,
): Promise<CovenantDocument> {
  const canonical = canonicalForm(doc);
  const signatureBytes = await signString(canonical, signerKeyPair.privateKey);

  const countersig: Countersignature = {
    signerPublicKey: signerKeyPair.publicKeyHex,
    signerRole,
    signature: toHex(signatureBytes),
    timestamp: timestamp(),
  };

  const newDoc: CovenantDocument = {
    ...doc,
    countersignatures: [...(doc.countersignatures ?? []), countersig],
  };

  return newDoc;
}

// ─── Verify ────────────────────────────────────────────────────────────────────

const VALID_ENFORCEMENT_TYPES: readonly string[] = [
  'capability', 'monitor', 'audit', 'bond', 'composite',
];
const VALID_PROOF_TYPES: readonly string[] = [
  'tee', 'capability_manifest', 'audit_log', 'bond_reference', 'zkp', 'composite',
];

/**
 * Verify a covenant document by running all 11 specification checks.
 *
 * Checks:
 *  1. id_match         — Document ID matches SHA-256 of canonical form
 *  2. signature_valid  — Issuer's Ed25519 signature is valid
 *  3. not_expired      — Current time is before expiresAt (if set)
 *  4. active           — Current time is after activatesAt (if set)
 *  5. ccl_parses       — Constraints parse as valid CCL
 *  6. enforcement_valid — Enforcement config type is recognized (if set)
 *  7. proof_valid       — Proof config type is recognized (if set)
 *  8. chain_depth      — Chain depth does not exceed MAX_CHAIN_DEPTH
 *  9. document_size    — Serialized size does not exceed MAX_DOCUMENT_SIZE
 * 10. countersignatures — All countersignatures are valid
 * 11. nonce_present    — Nonce is present and non-empty
 *
 * Returns a VerificationResult with per-check details; `valid` is true
 * only if every check passes.
 */
export async function verifyCovenant(
  doc: CovenantDocument,
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];

  // ── 1. ID match ───────────────────────────────────────────────────────
  const expectedId = computeId(doc);
  checks.push({
    name: 'id_match',
    passed: doc.id === expectedId,
    message:
      doc.id === expectedId
        ? 'Document ID matches canonical hash'
        : `ID mismatch: expected ${expectedId}, got ${doc.id}`,
  });

  // ── 2. Signature valid ────────────────────────────────────────────────
  let sigValid = false;
  try {
    const canonical = canonicalForm(doc);
    const messageBytes = new TextEncoder().encode(canonical);
    const sigBytes = fromHex(doc.signature);
    const pubKeyBytes = fromHex(doc.issuer.publicKey);
    sigValid = await verify(messageBytes, sigBytes, pubKeyBytes);
  } catch {
    sigValid = false;
  }
  checks.push({
    name: 'signature_valid',
    passed: sigValid,
    message: sigValid
      ? 'Issuer signature is valid'
      : 'Issuer signature verification failed',
  });

  // ── 3. Not expired ────────────────────────────────────────────────────
  const now = new Date();
  if (doc.expiresAt) {
    const expires = new Date(doc.expiresAt);
    const notExpired = now < expires;
    checks.push({
      name: 'not_expired',
      passed: notExpired,
      message: notExpired
        ? 'Document has not expired'
        : `Document expired at ${doc.expiresAt}`,
    });
  } else {
    checks.push({
      name: 'not_expired',
      passed: true,
      message: 'No expiry set',
    });
  }

  // ── 4. Active ─────────────────────────────────────────────────────────
  if (doc.activatesAt) {
    const activates = new Date(doc.activatesAt);
    const isActive = now >= activates;
    checks.push({
      name: 'active',
      passed: isActive,
      message: isActive
        ? 'Document is active'
        : `Document activates at ${doc.activatesAt}`,
    });
  } else {
    checks.push({
      name: 'active',
      passed: true,
      message: 'No activation time set',
    });
  }

  // ── 5. CCL parses ─────────────────────────────────────────────────────
  let cclParses = false;
  let cclMsg = '';
  try {
    const parsed = cclParse(doc.constraints);
    if (parsed.statements.length > MAX_CONSTRAINTS) {
      cclMsg = `Constraints exceed maximum of ${MAX_CONSTRAINTS} statements`;
    } else {
      cclParses = true;
      cclMsg = `CCL parsed successfully (${parsed.statements.length} statement(s))`;
    }
  } catch (err) {
    cclMsg = `CCL parse error: ${err instanceof Error ? err.message : String(err)}`;
  }
  checks.push({
    name: 'ccl_parses',
    passed: cclParses,
    message: cclMsg,
  });

  // ── 6. Enforcement valid ──────────────────────────────────────────────
  if (doc.enforcement) {
    const enfValid = VALID_ENFORCEMENT_TYPES.includes(doc.enforcement.type);
    checks.push({
      name: 'enforcement_valid',
      passed: enfValid,
      message: enfValid
        ? `Enforcement type '${doc.enforcement.type}' is valid`
        : `Unknown enforcement type '${doc.enforcement.type}'`,
    });
  } else {
    checks.push({
      name: 'enforcement_valid',
      passed: true,
      message: 'No enforcement config present',
    });
  }

  // ── 7. Proof valid ────────────────────────────────────────────────────
  if (doc.proof) {
    const proofValid = VALID_PROOF_TYPES.includes(doc.proof.type);
    checks.push({
      name: 'proof_valid',
      passed: proofValid,
      message: proofValid
        ? `Proof type '${doc.proof.type}' is valid`
        : `Unknown proof type '${doc.proof.type}'`,
    });
  } else {
    checks.push({
      name: 'proof_valid',
      passed: true,
      message: 'No proof config present',
    });
  }

  // ── 8. Chain depth ────────────────────────────────────────────────────
  if (doc.chain) {
    const depthOk = doc.chain.depth >= 1 && doc.chain.depth <= MAX_CHAIN_DEPTH;
    checks.push({
      name: 'chain_depth',
      passed: depthOk,
      message: depthOk
        ? `Chain depth ${doc.chain.depth} is within limit`
        : `Chain depth ${doc.chain.depth} exceeds maximum of ${MAX_CHAIN_DEPTH}`,
    });
  } else {
    checks.push({
      name: 'chain_depth',
      passed: true,
      message: 'No chain reference present',
    });
  }

  // ── 9. Document size ──────────────────────────────────────────────────
  const serializedBytes = new TextEncoder().encode(JSON.stringify(doc)).byteLength;
  const sizeOk = serializedBytes <= MAX_DOCUMENT_SIZE;
  checks.push({
    name: 'document_size',
    passed: sizeOk,
    message: sizeOk
      ? `Document size ${serializedBytes} bytes is within limit`
      : `Document size ${serializedBytes} bytes exceeds maximum of ${MAX_DOCUMENT_SIZE}`,
  });

  // ── 10. Countersignatures ─────────────────────────────────────────────
  if (doc.countersignatures && doc.countersignatures.length > 0) {
    let allCountersigValid = true;
    const failedSigners: string[] = [];

    for (const cs of doc.countersignatures) {
      try {
        const canonical = canonicalForm(doc);
        const messageBytes = new TextEncoder().encode(canonical);
        const csSigBytes = fromHex(cs.signature);
        const csPubKeyBytes = fromHex(cs.signerPublicKey);
        const csValid = await verify(messageBytes, csSigBytes, csPubKeyBytes);
        if (!csValid) {
          allCountersigValid = false;
          failedSigners.push(cs.signerPublicKey.slice(0, 16) + '...');
        }
      } catch {
        allCountersigValid = false;
        failedSigners.push(cs.signerPublicKey.slice(0, 16) + '...');
      }
    }

    checks.push({
      name: 'countersignatures',
      passed: allCountersigValid,
      message: allCountersigValid
        ? `All ${doc.countersignatures.length} countersignature(s) are valid`
        : `Invalid countersignature(s) from: ${failedSigners.join(', ')}`,
    });
  } else {
    checks.push({
      name: 'countersignatures',
      passed: true,
      message: 'No countersignatures present',
    });
  }

  // ── 11. Nonce present ─────────────────────────────────────────────────
  // A valid nonce must be a 64-character hex string (32 bytes)
  const nonceHexRegex = /^[0-9a-f]{64}$/i;
  const nonceOk = typeof doc.nonce === 'string' && nonceHexRegex.test(doc.nonce);
  checks.push({
    name: 'nonce_present',
    passed: nonceOk,
    message: nonceOk
      ? 'Nonce is present and valid (64-char hex)'
      : typeof doc.nonce !== 'string' || doc.nonce.length === 0
        ? 'Nonce is missing or empty'
        : `Nonce is malformed: expected 64-char hex string, got ${doc.nonce.length} chars`,
  });

  // ── Aggregate ─────────────────────────────────────────────────────────
  const valid = checks.every((c) => c.passed);

  return {
    valid,
    checks,
    document: doc,
  };
}

// ─── Chain resolver ────────────────────────────────────────────────────────────

/**
 * Interface for resolving parent covenant documents by their ID.
 */
export interface ChainResolver {
  resolve(id: HashHex): Promise<CovenantDocument | undefined>;
}

/**
 * Simple in-memory chain resolver backed by a Map.
 *
 * Useful for testing and scenarios where the full chain is
 * available locally.
 */
export class MemoryChainResolver implements ChainResolver {
  private readonly store = new Map<HashHex, CovenantDocument>();

  /**
   * Add a covenant document to the resolver's store.
   */
  add(doc: CovenantDocument): void {
    this.store.set(doc.id, doc);
  }

  /**
   * Resolve a covenant document by its ID.
   * Returns undefined if not found.
   */
  async resolve(id: HashHex): Promise<CovenantDocument | undefined> {
    return this.store.get(id);
  }
}

/**
 * Walk up the delegation chain from a covenant document, collecting
 * all ancestor documents up to the given maximum depth.
 *
 * Returns an array of ancestors ordered from immediate parent to
 * most-distant ancestor (root).
 *
 * @param doc       - The starting covenant document.
 * @param resolver  - A ChainResolver to look up parent documents.
 * @param maxDepth  - Maximum number of ancestors to resolve (default MAX_CHAIN_DEPTH).
 * @returns Array of ancestor CovenantDocuments.
 */
export async function resolveChain(
  doc: CovenantDocument,
  resolver: ChainResolver,
  maxDepth: number = MAX_CHAIN_DEPTH,
): Promise<CovenantDocument[]> {
  const ancestors: CovenantDocument[] = [];
  let current = doc;

  for (let i = 0; i < maxDepth; i++) {
    if (!current.chain?.parentId) {
      break;
    }

    const parent = await resolver.resolve(current.chain.parentId);
    if (!parent) {
      break;
    }

    ancestors.push(parent);
    current = parent;
  }

  return ancestors;
}

// ─── Effective constraints ─────────────────────────────────────────────────────

/**
 * Compute the effective (merged) CCL constraints for a covenant and
 * its ancestor chain.
 *
 * Merges are applied from the most-distant ancestor (root) down to
 * the document itself, using the CCL merge semantics (deny-wins,
 * intersection of permits, most-restrictive limits).
 *
 * @param doc        - The covenant document.
 * @param ancestors  - Ancestor documents ordered parent-first (as returned by resolveChain).
 * @returns The merged CCLDocument representing the effective constraints.
 */
export async function computeEffectiveConstraints(
  doc: CovenantDocument,
  ancestors: CovenantDocument[],
): Promise<CCLDocument> {
  // Start from the root (most-distant ancestor) and merge down
  const allDocs = [...ancestors].reverse(); // root first
  allDocs.push(doc); // child last

  let effective = cclParse(allDocs[0]!.constraints);

  for (let i = 1; i < allDocs.length; i++) {
    const childCCL = cclParse(allDocs[i]!.constraints);
    effective = cclMerge(effective, childCCL);
  }

  return effective;
}

// ─── Chain narrowing validation ────────────────────────────────────────────────

/**
 * Validate that a child covenant only narrows (never broadens) the
 * constraints of its parent.
 *
 * A child cannot:
 * - Permit something the parent denies
 * - Permit a broader scope than the parent permits
 *
 * @param child  - The child covenant document.
 * @param parent - The parent covenant document.
 * @returns An object with `valid` (boolean) and `violations` (array of NarrowingViolation).
 */
export async function validateChainNarrowing(
  child: CovenantDocument,
  parent: CovenantDocument,
): Promise<{ valid: boolean; violations: NarrowingViolation[] }> {
  const parentCCL = cclParse(parent.constraints);
  const childCCL = cclParse(child.constraints);
  return cclValidateNarrowing(parentCCL, childCCL);
}

// ─── Serialization / deserialization ───────────────────────────────────────────

/**
 * Serialize a CovenantDocument to a JSON string.
 */
export function serializeCovenant(doc: CovenantDocument): string {
  return JSON.stringify(doc);
}

/**
 * Deserialize a JSON string into a CovenantDocument.
 *
 * Performs structural validation to ensure the result contains all
 * required fields with correct types.
 *
 * @throws Error if the JSON is malformed or missing required fields.
 */
export function deserializeCovenant(json: string): CovenantDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON: ${msg}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Covenant document must be a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  // Validate required string fields
  const requiredStrings = ['id', 'version', 'constraints', 'nonce', 'createdAt', 'signature'] as const;
  for (const field of requiredStrings) {
    if (typeof obj[field] !== 'string') {
      throw new Error(`Missing or invalid required field: ${field}`);
    }
  }

  // Validate issuer
  if (!obj.issuer || typeof obj.issuer !== 'object') {
    throw new Error('Missing or invalid required field: issuer');
  }
  const issuer = obj.issuer as Record<string, unknown>;
  if (typeof issuer.id !== 'string' || typeof issuer.publicKey !== 'string' || issuer.role !== 'issuer') {
    throw new Error('Invalid issuer: must have id, publicKey, and role="issuer"');
  }

  // Validate beneficiary
  if (!obj.beneficiary || typeof obj.beneficiary !== 'object') {
    throw new Error('Missing or invalid required field: beneficiary');
  }
  const beneficiary = obj.beneficiary as Record<string, unknown>;
  if (
    typeof beneficiary.id !== 'string' ||
    typeof beneficiary.publicKey !== 'string' ||
    beneficiary.role !== 'beneficiary'
  ) {
    throw new Error('Invalid beneficiary: must have id, publicKey, and role="beneficiary"');
  }

  // Validate version
  if (obj.version !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported protocol version: ${obj.version as string} (expected ${PROTOCOL_VERSION})`);
  }

  // Validate chain if present
  if (obj.chain !== undefined) {
    if (typeof obj.chain !== 'object' || obj.chain === null) {
      throw new Error('Invalid chain: must be an object');
    }
    const chain = obj.chain as Record<string, unknown>;
    if (typeof chain.parentId !== 'string') {
      throw new Error('Invalid chain.parentId: must be a string');
    }
    if (typeof chain.relation !== 'string') {
      throw new Error('Invalid chain.relation: must be a string');
    }
    if (typeof chain.depth !== 'number') {
      throw new Error('Invalid chain.depth: must be a number');
    }
  }

  // Validate document size
  const byteSize = new TextEncoder().encode(json).byteLength;
  if (byteSize > MAX_DOCUMENT_SIZE) {
    throw new Error(
      `Document size ${byteSize} bytes exceeds maximum of ${MAX_DOCUMENT_SIZE} bytes`,
    );
  }

  return parsed as CovenantDocument;
}
