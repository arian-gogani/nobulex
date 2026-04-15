/**
 * @nobulex/attestation — Behavioral Attestation Records
 *
 * Aggregates per-session proof chains into portable, verifiable
 * behavioral histories for AI agents.
 *
 * @packageDocumentation
 */

export type {
  ViolationBreakdown,
  SessionDigest,
  AttestationRecord,
  AttestationChain,
  RiskProfile,
} from './types.js';

export {
  createSessionDigest,
  buildAttestationRecord,
  verifyAttestationChain,
  generateRiskProfile,
} from './builder.js';
