/**
 * @nobulex/tee — Trusted Execution Environment attestation for Nobulex agents.
 *
 * Provides TEE remote attestation quote structures (SGX, TDX, SEV-SNP),
 * attestation verification, enclave identity ↔ DID binding, and
 * attestation evidence types.
 *
 * @packageDocumentation
 */

import { sha256String, generateId, timestamp } from '@nobulex/crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Supported TEE platforms. */
export type TEEPlatform = 'sgx' | 'tdx' | 'sev-snp';

/** Security level of a TEE attestation. */
export type SecurityLevel = 'hardware' | 'software' | 'simulated';

/** Status of an attestation verification. */
export type AttestationStatus = 'valid' | 'expired' | 'revoked' | 'invalid' | 'unknown';

/** A raw attestation quote from a TEE platform. */
export interface AttestationQuote {
  /** Unique quote identifier. */
  readonly id: string;
  /** TEE platform that produced this quote. */
  readonly platform: TEEPlatform;
  /** Measurement of the enclave code (MRENCLAVE for SGX, launch digest for SEV-SNP). */
  readonly measurement: string;
  /** Signer measurement (MRSIGNER for SGX, author key digest for SEV-SNP). */
  readonly signerMeasurement: string;
  /** User-supplied report data (typically a hash binding to DID/public key). */
  readonly reportData: string;
  /** Product ID / security version number. */
  readonly productId: number;
  /** Security version number. */
  readonly securityVersion: number;
  /** Whether the enclave is in debug mode. */
  readonly debugMode: boolean;
  /** ISO timestamp of when the quote was generated. */
  readonly timestamp: string;
  /** Raw quote bytes as hex string. */
  readonly rawQuote: string;
}

/** Endorsements from platform vendor (Intel/AMD/etc). */
export interface PlatformEndorsements {
  /** Platform Certificate (PCK cert chain). */
  readonly certificateChain: readonly string[];
  /** TCB (Trusted Computing Base) info. */
  readonly tcbInfo: TCBInfo;
  /** Collateral expiry. */
  readonly expiresAt: string;
}

/** Trusted Computing Base information. */
export interface TCBInfo {
  /** TCB level identifier. */
  readonly tcbLevel: number;
  /** TCB status. */
  readonly status: 'UpToDate' | 'OutOfDate' | 'Revoked' | 'ConfigurationNeeded';
  /** Advisory IDs for known issues. */
  readonly advisoryIds: readonly string[];
}

/** Full attestation evidence: quote + endorsements. */
export interface AttestationEvidence {
  readonly quote: AttestationQuote;
  readonly endorsements: PlatformEndorsements;
  readonly securityLevel: SecurityLevel;
}

/** Result of verifying an attestation. */
export interface AttestationVerificationResult {
  readonly valid: boolean;
  readonly status: AttestationStatus;
  readonly platform: TEEPlatform;
  readonly securityLevel: SecurityLevel;
  readonly measurement: string;
  readonly errors: readonly string[];
  readonly verifiedAt: string;
}

/** TEE identity binding an enclave to a DID. */
export interface TEEIdentity {
  /** The DID this enclave is bound to. */
  readonly did: string;
  /** Enclave measurement hash. */
  readonly measurement: string;
  /** Signer measurement. */
  readonly signerMeasurement: string;
  /** Platform type. */
  readonly platform: TEEPlatform;
  /** Binding proof (hash of DID + measurement). */
  readonly bindingProof: string;
  /** When this binding was created. */
  readonly createdAt: string;
  /** When this binding expires (null = no expiry). */
  readonly expiresAt: string | null;
}

/** Configuration for enclave policy. */
export interface EnclavePolicy {
  /** Allowed enclave measurements (whitelisted). */
  readonly allowedMeasurements: readonly string[];
  /** Allowed signer measurements. */
  readonly allowedSigners: readonly string[];
  /** Minimum security version required. */
  readonly minSecurityVersion: number;
  /** Whether debug enclaves are allowed. */
  readonly allowDebug: boolean;
  /** Minimum TCB level required. */
  readonly minTcbLevel: number;
  /** Maximum age of attestation quote in seconds. */
  readonly maxQuoteAgeSec: number;
}

/** Default enclave policy. */
export const DEFAULT_ENCLAVE_POLICY: EnclavePolicy = {
  allowedMeasurements: [],
  allowedSigners: [],
  minSecurityVersion: 1,
  allowDebug: false,
  minTcbLevel: 1,
  maxQuoteAgeSec: 3600,
};

// ─── Quote Generation (Simulated) ────────────────────────────────────────────

/**
 * Generate a simulated attestation quote.
 * In production this would call into the TEE hardware (e.g. SGX EREPORT).
 *
 * @param platform - The TEE platform to generate the quote for (sgx, tdx, or sev-snp).
 * @param reportData - User-supplied report data, typically a hash binding to a DID or public key.
 * @param options - Optional overrides for measurement, signer, product ID, security version, and debug mode.
 * @returns A promise that resolves to the generated {@link AttestationQuote}.
 */
export async function generateQuote(
  platform: TEEPlatform,
  reportData: string,
  options: {
    measurement?: string;
    signerMeasurement?: string;
    productId?: number;
    securityVersion?: number;
    debugMode?: boolean;
  } = {},
): Promise<AttestationQuote> {
  const measurement = options.measurement ?? await sha256String(`enclave:${generateId()}`);
  const signerMeasurement = options.signerMeasurement ?? await sha256String(`signer:${generateId()}`);
  const rawPayload = `${platform}:${measurement}:${signerMeasurement}:${reportData}:${Date.now()}`;
  const rawQuote = await sha256String(rawPayload);

  return {
    id: `quote_${generateId()}`,
    platform,
    measurement,
    signerMeasurement,
    reportData,
    productId: options.productId ?? 1,
    securityVersion: options.securityVersion ?? 1,
    debugMode: options.debugMode ?? false,
    timestamp: timestamp(),
    rawQuote,
  };
}

/**
 * Generate simulated platform endorsements.
 *
 * @param tcbLevel - The TCB (Trusted Computing Base) level to report. Defaults to 3.
 * @param expiresInSec - Number of seconds until the endorsements expire. Defaults to 86400 (24 hours).
 * @returns The generated {@link PlatformEndorsements} with a simulated certificate chain and TCB info.
 */
export function generateEndorsements(
  tcbLevel: number = 3,
  expiresInSec: number = 86400,
): PlatformEndorsements {
  const now = new Date();
  const expires = new Date(now.getTime() + expiresInSec * 1000);
  return {
    certificateChain: [
      'MIICert_Root_CA_simulated',
      'MIICert_Intermediate_CA_simulated',
      'MIICert_PCK_simulated',
    ],
    tcbInfo: {
      tcbLevel,
      status: 'UpToDate',
      advisoryIds: [],
    },
    expiresAt: expires.toISOString(),
  };
}

// attestation verification

/**
 * Verify an attestation quote against a policy.
 * Checks debug mode, security version, measurement/signer whitelists,
 * TCB level/status, endorsement expiry, quote age, and certificate chain.
 *
 * @param evidence - The full attestation evidence (quote + endorsements) to verify.
 * @param policy - The enclave policy to verify against. Defaults to {@link DEFAULT_ENCLAVE_POLICY}.
 * @returns The {@link AttestationVerificationResult} indicating validity, status, and any errors.
 */
export function verifyAttestation(
  evidence: AttestationEvidence,
  policy: EnclavePolicy = DEFAULT_ENCLAVE_POLICY,
): AttestationVerificationResult {
  const errors: string[] = [];
  const { quote, endorsements } = evidence;

  // 1. Check debug mode
  if (quote.debugMode && !policy.allowDebug) {
    errors.push('Debug enclaves are not allowed by policy');
  }

  // 2. Check security version
  if (quote.securityVersion < policy.minSecurityVersion) {
    errors.push(`Security version ${quote.securityVersion} below minimum ${policy.minSecurityVersion}`);
  }

  // 3. Check measurement whitelist (if configured)
  if (policy.allowedMeasurements.length > 0) {
    if (!policy.allowedMeasurements.includes(quote.measurement)) {
      errors.push('Enclave measurement not in allowed list');
    }
  }

  // 4. Check signer whitelist (if configured)
  if (policy.allowedSigners.length > 0) {
    if (!policy.allowedSigners.includes(quote.signerMeasurement)) {
      errors.push('Signer measurement not in allowed list');
    }
  }

  // 5. Check TCB level
  if (endorsements.tcbInfo.tcbLevel < policy.minTcbLevel) {
    errors.push(`TCB level ${endorsements.tcbInfo.tcbLevel} below minimum ${policy.minTcbLevel}`);
  }

  // 6. Check TCB status
  if (endorsements.tcbInfo.status === 'Revoked') {
    errors.push('TCB has been revoked');
  }

  // 7. Check endorsement expiry
  const endorsementExpiry = new Date(endorsements.expiresAt).getTime();
  if (endorsementExpiry < Date.now()) {
    errors.push('Platform endorsements have expired');
  }

  // 8. Check quote age
  const quoteAge = (Date.now() - new Date(quote.timestamp).getTime()) / 1000;
  if (quoteAge > policy.maxQuoteAgeSec) {
    errors.push(`Quote age ${Math.round(quoteAge)}s exceeds maximum ${policy.maxQuoteAgeSec}s`);
  }

  // 9. Check certificate chain exists
  if (endorsements.certificateChain.length === 0) {
    errors.push('Empty certificate chain');
  }

  const valid = errors.length === 0;
  let status: AttestationStatus = 'valid';
  if (!valid) {
    if (endorsements.tcbInfo.status === 'Revoked') {
      status = 'revoked';
    } else if (endorsementExpiry < Date.now()) {
      status = 'expired';
    } else {
      status = 'invalid';
    }
  }

  return {
    valid,
    status,
    platform: quote.platform,
    securityLevel: evidence.securityLevel,
    measurement: quote.measurement,
    errors,
    verifiedAt: timestamp(),
  };
}

// ---

/**
 * Bind an enclave identity to a DID.
 * The binding proof is a hash of the DID and enclave measurements.
 *
 * @param did - The decentralized identifier to bind the enclave to.
 * @param quote - The attestation quote containing the enclave measurements.
 * @param expiresAt - Optional ISO timestamp for when the binding expires. Pass null for no expiry.
 * @returns A promise that resolves to the {@link TEEIdentity} representing the binding.
 */
export async function bindEnclaveToDID(
  did: string,
  quote: AttestationQuote,
  expiresAt: string | null = null,
): Promise<TEEIdentity> {
  const bindingPayload = `${did}:${quote.measurement}:${quote.signerMeasurement}:${quote.platform}`;
  const bindingProof = await sha256String(bindingPayload);

  return {
    did,
    measurement: quote.measurement,
    signerMeasurement: quote.signerMeasurement,
    platform: quote.platform,
    bindingProof,
    createdAt: timestamp(),
    expiresAt,
  };
}

/**
 * Verify that a TEE identity binding is valid by recomputing the proof.
 *
 * @param identity - The TEE identity binding to verify.
 * @returns A promise that resolves to true if the binding proof matches the recomputed hash.
 */
export async function verifyBinding(identity: TEEIdentity): Promise<boolean> {
  const expectedPayload = `${identity.did}:${identity.measurement}:${identity.signerMeasurement}:${identity.platform}`;
  const expectedProof = await sha256String(expectedPayload);
  return expectedProof === identity.bindingProof;
}

/**
 * Check whether a TEE identity binding has expired.
 *
 * @param identity - The TEE identity binding to check.
 * @returns True if the binding has an expiry date and that date is in the past; false otherwise.
 */
export function isBindingExpired(identity: TEEIdentity): boolean {
  if (identity.expiresAt === null) return false;
  return new Date(identity.expiresAt).getTime() < Date.now();
}


/**
 * In-memory registry of TEE identities, for resolving and validating enclave bindings.
 * Maps DIDs to their TEE identity bindings and stores attestation evidence by quote ID.
 */
export class TEERegistry {
  private readonly _bindings = new Map<string, TEEIdentity>();
  private readonly _attestations = new Map<string, AttestationEvidence>();

  /**
   * Register a TEE identity binding.
   *
   * @param identity - The TEE identity binding to register, keyed by its DID.
   */
  register(identity: TEEIdentity): void {
    this._bindings.set(identity.did, identity);
  }

  /**
   * Register attestation evidence for a quote ID.
   *
   * @param evidence - The attestation evidence to store, keyed by its quote ID.
   */
  registerEvidence(evidence: AttestationEvidence): void {
    this._attestations.set(evidence.quote.id, evidence);
  }

  /**
   * Look up the TEE identity for a DID.
   *
   * @param did - The decentralized identifier to look up.
   * @returns The TEE identity binding, or null if not found.
   */
  resolve(did: string): TEEIdentity | null {
    return this._bindings.get(did) ?? null;
  }

  /**
   * Get attestation evidence by quote ID.
   *
   * @param quoteId - The unique identifier of the attestation quote.
   * @returns The attestation evidence, or null if not found.
   */
  getEvidence(quoteId: string): AttestationEvidence | null {
    return this._attestations.get(quoteId) ?? null;
  }

  /**
   * Check if a DID has a valid (non-expired) TEE binding.
   *
   * @param did - The decentralized identifier to check.
   * @returns True if the DID has a registered, non-expired binding; false otherwise.
   */
  isValid(did: string): boolean {
    const binding = this._bindings.get(did);
    if (!binding) return false;
    return !isBindingExpired(binding);
  }

  /**
   * Remove a TEE identity binding.
   *
   * @param did - The decentralized identifier whose binding should be removed.
   * @returns True if a binding was found and removed; false if no binding existed.
   */
  revoke(did: string): boolean {
    return this._bindings.delete(did);
  }

  /** Number of registered bindings. */
  get size(): number {
    return this._bindings.size;
  }

  /** All registered DIDs. */
  get dids(): string[] {
    return [...this._bindings.keys()];
  }
}

// ─── Report Data Generation ──────────────────────────────────────────────────

/**
 * Generate report data that binds a DID's public key to the attestation.
 * Used as the reportData field in the attestation quote.
 *
 * @param did - The decentralized identifier to bind.
 * @param publicKeyHex - The public key in hex encoding.
 * @param nonce - Optional nonce for freshness. A random ID is generated if omitted.
 * @returns A promise that resolves to the SHA-256 hash of the binding payload.
 */
export async function generateReportData(
  did: string,
  publicKeyHex: string,
  nonce?: string,
): Promise<string> {
  const payload = `${did}:${publicKeyHex}:${nonce ?? generateId()}`;
  return sha256String(payload);
}

/**
 * Create full attestation evidence from a quote and endorsements.
 *
 * @param quote - The attestation quote from the TEE platform.
 * @param endorsements - The platform endorsements (certificate chain, TCB info).
 * @param securityLevel - The security level classification. Defaults to 'simulated'.
 * @returns The assembled {@link AttestationEvidence} object.
 */
export function createEvidence(
  quote: AttestationQuote,
  endorsements: PlatformEndorsements,
  securityLevel: SecurityLevel = 'simulated',
): AttestationEvidence {
  return { quote, endorsements, securityLevel };
}


/** SGX-specific constants. */
export const SGX = {
  PLATFORM: 'sgx' as TEEPlatform,
  MAX_REPORT_DATA_SIZE: 64,
  MEASUREMENT_SIZE: 64,
} as const;

/** TDX-specific constants. */
export const TDX = {
  PLATFORM: 'tdx' as TEEPlatform,
  MAX_REPORT_DATA_SIZE: 64,
  MEASUREMENT_SIZE: 96,
} as const;

/** SEV-SNP-specific constants. */
export const SEV_SNP = {
  PLATFORM: 'sev-snp' as TEEPlatform,
  MAX_REPORT_DATA_SIZE: 64,
  MEASUREMENT_SIZE: 96,
} as const;

/**
 * Get the human-readable display name for a TEE platform.
 *
 * @param platform - The TEE platform identifier.
 * @returns The display name (e.g. 'Intel SGX', 'Intel TDX', or 'AMD SEV-SNP').
 */
export function platformName(platform: TEEPlatform): string {
  switch (platform) {
    case 'sgx': return 'Intel SGX';
    case 'tdx': return 'Intel TDX';
    case 'sev-snp': return 'AMD SEV-SNP';
  }
}
