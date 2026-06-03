/**
 * Public API for the Mission Control reference implementation.
 */

export * from './types.js';
export {
  verifyAttestation,
  buildSignaturePreimage,
  diagnose,
  sha256Hex,
  DEFAULT_FRESHNESS_MS,
  DEFAULT_MAX_EXTERNAL_WEIGHT,
  type DidResolver,
  type TrustedIssuerStore,
  type VerifyOptions,
} from './verify.js';
export {
  blendVerified,
  blendExternalAttestations,
  type BlendOptions,
} from './blend.js';
