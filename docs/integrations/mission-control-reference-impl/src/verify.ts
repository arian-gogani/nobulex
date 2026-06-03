/**
 * Verification of nobulex-trust-attestation-v1 payloads.
 *
 * A consumer of a signed attestation can use these functions to confirm:
 *   1. The schema and required fields are present (structural check)
 *   2. The issuer is on the operator's trusted-issuer allowlist
 *   3. The attestation has not expired (freshness check)
 *   4. The Ed25519 signature verifies against the issuer's published key
 *
 * Step (4) requires DID resolution. The verifier delegates this to a
 * DidResolver implementation; a default one for did:web is provided.
 */

import { createHash, verify as cryptoVerify } from 'node:crypto';
import canonicalize from 'canonicalize';  // RFC 8785 JCS implementation
import type {
  TrustAttestationV1,
  TrustedIssuer,
  VerifyOutcome,
  RejectionReason,
} from './types.js';

/** Default freshness window: attestations older than 7 days are stale. */
export const DEFAULT_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

/** Default cap on aggregate external influence on blended scores. */
export const DEFAULT_MAX_EXTERNAL_WEIGHT = 0.3;

export interface DidResolver {
  /**
   * Resolve a DID to its verification key (raw 32-byte Ed25519 public key).
   * Returns null if the DID does not resolve or has no Ed25519 key.
   */
  resolveVerificationKey(did: string): Promise<Buffer | null>;
}

export interface TrustedIssuerStore {
  /**
   * Returns the trusted-issuer record for a DID, or null if the operator
   * has not trusted this issuer for the relevant workspace.
   */
  get(issuerDid: string): Promise<TrustedIssuer | null>;
}

export interface VerifyOptions {
  /** How old an attestation can be before it's considered stale. */
  freshnessMs?: number;
  /** Current time in ms; defaults to Date.now(). Useful for testing. */
  nowMs?: number;
  didResolver: DidResolver;
  trustedIssuers: TrustedIssuerStore;
}

function isWellFormed(att: unknown): att is TrustAttestationV1 {
  if (!att || typeof att !== 'object') return false;
  const a = att as Record<string, unknown>;
  return (
    a.schema === 'nobulex-trust-attestation-v1' &&
    typeof a.issuer === 'string' &&
    typeof a.subject === 'string' &&
    typeof a.issued_at_ms === 'number' &&
    !!a.claim &&
    !!a.evidence &&
    !!a.signature
  );
}

/**
 * Build the canonical preimage that was signed. Must match exactly what
 * the issuer signed: the attestation object with the signature.value field
 * removed (the signature signs everything else).
 */
export function buildSignaturePreimage(att: TrustAttestationV1): string {
  const { signature, ...rest } = att;
  // The preimage signs the schema + body + the signature's alg/jcs_canonical
  // declaration. signature.value is what's being computed and is omitted.
  const preimage = {
    ...rest,
    signature: {
      alg: signature.alg,
      jcs_canonical: signature.jcs_canonical,
    },
  };
  return canonicalize(preimage) ?? '';
}

/**
 * Full verification of a Trust Capital attestation.
 *
 * Returns { ok: true, attestation } only if all checks pass:
 *   - well-formed structure with required fields
 *   - issuer is on the trusted-issuer allowlist
 *   - attestation is within the freshness window
 *   - Ed25519 signature verifies against the issuer's resolved public key
 *
 * On failure, returns { ok: false, reason } where reason indicates which
 * check failed. This lets the caller log the rejection for audit.
 */
export async function verifyAttestation(
  payload: unknown,
  opts: VerifyOptions,
): Promise<VerifyOutcome> {
  if (!isWellFormed(payload)) {
    return { ok: false, reason: 'malformed' };
  }
  const att = payload;

  if (att.schema !== 'nobulex-trust-attestation-v1') {
    return { ok: false, reason: 'wrong_schema' };
  }

  // Trusted-issuer allowlist check (anti-inflation primitive).
  const issuer = await opts.trustedIssuers.get(att.issuer);
  if (!issuer) {
    return { ok: false, reason: 'unknown_issuer' };
  }

  // Freshness check.
  const now = opts.nowMs ?? Date.now();
  const freshness = opts.freshnessMs ?? DEFAULT_FRESHNESS_MS;
  if (now - att.issued_at_ms > freshness) {
    return { ok: false, reason: 'stale' };
  }

  // Signature verification.
  const pubKey = await opts.didResolver.resolveVerificationKey(att.issuer);
  if (!pubKey) {
    return { ok: false, reason: 'invalid_signature' };
  }

  const preimage = buildSignaturePreimage(att);
  if (!preimage) {
    return { ok: false, reason: 'malformed' };
  }

  // Node's crypto.verify with Ed25519 expects a KeyObject; we wrap the raw
  // 32-byte public key as a SPKI structure.
  const spki = ed25519RawToSpki(pubKey);
  const sigBytes = Buffer.from(att.signature.value, 'hex');
  const sigOk = cryptoVerify(
    null,
    Buffer.from(preimage, 'utf-8'),
    {
      key: spki,
      format: 'der',
      type: 'spki',
    },
    sigBytes,
  );

  if (!sigOk) {
    return { ok: false, reason: 'invalid_signature' };
  }

  return { ok: true, attestation: att };
}

/**
 * Wrap a raw 32-byte Ed25519 public key in an SPKI structure that
 * crypto.verify can consume. This is the minimal ASN.1 prefix for
 * an Ed25519 SubjectPublicKeyInfo per RFC 8410.
 */
function ed25519RawToSpki(rawPub: Buffer): Buffer {
  // ASN.1 prefix: SEQUENCE { SEQUENCE { OID 1.3.101.112 }, BIT STRING ... }
  const prefix = Buffer.from(
    '302a300506032b6570032100',  // length-fixed prefix for 32-byte Ed25519
    'hex',
  );
  return Buffer.concat([prefix, rawPub]);
}

/**
 * Compute SHA-256 of a JCS-canonical receipt preimage. Useful for
 * verifying that an attestation's evidence.receipt_chain_head was
 * computed correctly.
 */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256')
    .update(typeof input === 'string' ? Buffer.from(input, 'utf-8') : input)
    .digest('hex');
}

/**
 * For debugging: list all the reasons a particular payload would fail
 * verification, without short-circuiting on the first error.
 */
export async function diagnose(
  payload: unknown,
  opts: VerifyOptions,
): Promise<RejectionReason[]> {
  const reasons: RejectionReason[] = [];
  if (!isWellFormed(payload)) {
    return ['malformed'];
  }
  const att = payload as TrustAttestationV1;
  if (att.schema !== 'nobulex-trust-attestation-v1') reasons.push('wrong_schema');
  const issuer = await opts.trustedIssuers.get(att.issuer);
  if (!issuer) reasons.push('unknown_issuer');
  const now = opts.nowMs ?? Date.now();
  const freshness = opts.freshnessMs ?? DEFAULT_FRESHNESS_MS;
  if (now - att.issued_at_ms > freshness) reasons.push('stale');
  const pubKey = await opts.didResolver.resolveVerificationKey(att.issuer);
  if (!pubKey) {
    reasons.push('invalid_signature');
  } else {
    const preimage = buildSignaturePreimage(att);
    const sigOk = cryptoVerify(
      null,
      Buffer.from(preimage, 'utf-8'),
      { key: ed25519RawToSpki(pubKey), format: 'der', type: 'spki' },
      Buffer.from(att.signature.value, 'hex'),
    );
    if (!sigOk) reasons.push('invalid_signature');
  }
  return reasons;
}
