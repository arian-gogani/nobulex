/**
 * Blend external Trust Capital attestations with a local score.
 *
 * Reference implementation for the Mission Control integration RFC.
 *
 * The blend policy enforces three safety properties:
 *   1. Local signals always count. Even with multiple trusted issuers,
 *      local gets at least (1 - MAX_EXTERNAL_WEIGHT) of the final score.
 *   2. Each issuer's influence is capped by its registered max_weight.
 *   3. Stale or invalid attestations are silently dropped, never blended.
 *
 * Every blend result carries its provenance for the audit log.
 */

import type {
  BlendResult,
  TrustAttestationV1,
  TrustedIssuer,
  VerifyOutcome,
} from './types.js';
import {
  DEFAULT_FRESHNESS_MS,
  DEFAULT_MAX_EXTERNAL_WEIGHT,
  type DidResolver,
  type TrustedIssuerStore,
  verifyAttestation,
} from './verify.js';

export interface BlendOptions {
  /** Hard cap on aggregate external influence, 0-1. Default 0.3. */
  maxExternalWeight?: number;
  /** Freshness window in ms. Default 7 days. */
  freshnessMs?: number;
  /** Current time. Defaults to Date.now(). Override for testing. */
  nowMs?: number;
  didResolver: DidResolver;
  trustedIssuers: TrustedIssuerStore;
}

/**
 * Pure function: given a local score and a set of already-verified
 * attestations with their issuer records, compute the blended score.
 *
 * Separated from the verification step so it can be unit-tested
 * without DID resolution or signature work.
 */
export function blendVerified(
  local: number,
  validExternals: Array<{ attestation: TrustAttestationV1; issuer: TrustedIssuer }>,
  maxExternalWeight: number = DEFAULT_MAX_EXTERNAL_WEIGHT,
): BlendResult {
  if (validExternals.length === 0) {
    return {
      score: local,
      sources: ['local'],
      breakdown: {
        local,
        external_weighted_avg: null,
        effective_external_weight: 0,
      },
    };
  }

  // Compute the weighted average of external scores by each issuer's weight.
  let weightedSum = 0;
  let totalIssuerWeight = 0;
  for (const { attestation, issuer } of validExternals) {
    weightedSum += attestation.claim.trust_capital * issuer.max_weight;
    totalIssuerWeight += issuer.max_weight;
  }

  const externalAvg = totalIssuerWeight > 0 ? weightedSum / totalIssuerWeight : 0;

  // The effective weight given to external sources is the minimum of:
  // - the hard cap (maxExternalWeight, default 0.3)
  // - the sum of individual issuer weights (so two issuers with 0.1 each
  //   only get 0.2 of external influence, not the full cap)
  const effectiveWeight = Math.min(maxExternalWeight, totalIssuerWeight);

  const score = local * (1 - effectiveWeight) + externalAvg * effectiveWeight;

  // Clamp final score to a sensible range. Trust scores are 0-100.
  const clamped = Math.max(0, Math.min(100, score));

  const sources = ['local', ...validExternals.map((v) => v.attestation.issuer)];

  return {
    score: clamped,
    sources,
    breakdown: {
      local,
      external_weighted_avg: externalAvg,
      effective_external_weight: effectiveWeight,
    },
  };
}

/**
 * Full blend pipeline: verify each attestation, filter to those that
 * pass, blend with the local score.
 *
 * Use this in production. Use blendVerified() in tests where you want
 * to control the inputs precisely.
 */
export async function blendExternalAttestations(
  local: number,
  candidates: unknown[],
  opts: BlendOptions,
): Promise<BlendResult & { rejected: VerifyOutcome[] }> {
  const verified: Array<{ attestation: TrustAttestationV1; issuer: TrustedIssuer }> = [];
  const rejected: VerifyOutcome[] = [];

  for (const candidate of candidates) {
    const outcome = await verifyAttestation(candidate, {
      didResolver: opts.didResolver,
      trustedIssuers: opts.trustedIssuers,
      freshnessMs: opts.freshnessMs,
      nowMs: opts.nowMs,
    });

    if (!outcome.ok || !outcome.attestation) {
      rejected.push(outcome);
      continue;
    }

    const issuer = await opts.trustedIssuers.get(outcome.attestation.issuer);
    if (!issuer) {
      // Should be impossible if verify passed, but defensive check.
      rejected.push({ ok: false, reason: 'unknown_issuer' });
      continue;
    }

    verified.push({ attestation: outcome.attestation, issuer });
  }

  const result = blendVerified(
    local,
    verified,
    opts.maxExternalWeight ?? DEFAULT_MAX_EXTERNAL_WEIGHT,
  );

  return { ...result, rejected };
}
