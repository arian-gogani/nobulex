/**
 * @nobulex/trust-data — Trust Data Monopoly (Improvement 68).
 *
 * Cross-platform reputation graph = largest verified agent behavioral dataset.
 * Sell anonymized insights to insurers, regulators, enterprises. Bloomberg model.
 *
 */

import { sha256Object } from '@nobulex/crypto';

export interface AnonymizedAggregate {
  agentClass: string;
  breachRate: number;
  complianceRate: number;
  avgTrustScore: number;
  sampleSize: number;
  periodStart: number;
  periodEnd: number;
}

/** In-memory aggregate store (production: persistent). */
const aggregates: Map<string, AnonymizedAggregate> = new Map();

/**
 * Record anonymized behavioral data for aggregation.
 * Agent IDs are hashed; no PII in aggregates.
 */
export function recordAggregate(
  agentClass: string,
  breachRate: number,
  complianceRate: number,
  avgTrustScore: number,
  sampleSize: number,
  periodStart: number,
  periodEnd: number,
): AnonymizedAggregate {
  const agg: AnonymizedAggregate = {
    agentClass,
    breachRate,
    complianceRate,
    avgTrustScore,
    sampleSize,
    periodStart,
    periodEnd,
  };
  const id = sha256Object(agg);
  aggregates.set(id, agg);
  return agg;
}

/**
 * Query anonymized aggregates by agent class.
 */
export function queryAggregates(
  agentClass?: string,
  periodStart?: number,
  periodEnd?: number,
): AnonymizedAggregate[] {
  let results = Array.from(aggregates.values());
  if (agentClass) {
    results = results.filter((a) => a.agentClass === agentClass);
  }
  if (periodStart !== undefined) {
    results = results.filter((a) => a.periodEnd >= periodStart);
  }
  if (periodEnd !== undefined) {
    results = results.filter((a) => a.periodStart <= periodEnd);
  }
  return results;
}
