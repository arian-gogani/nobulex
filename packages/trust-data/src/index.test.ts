import { describe, it, expect } from 'vitest';
import { recordAggregate, queryAggregates } from './index';

describe('recordAggregate', () => {
  it('returns aggregate with all fields', () => {
    const agg = recordAggregate(
      'code-review-agent',
      0.02,
      0.98,
      0.85,
      100,
      1000,
      2000,
    );
    expect(agg.agentClass).toBe('code-review-agent');
    expect(agg.breachRate).toBe(0.02);
    expect(agg.complianceRate).toBe(0.98);
    expect(agg.avgTrustScore).toBe(0.85);
    expect(agg.sampleSize).toBe(100);
    expect(agg.periodStart).toBe(1000);
    expect(agg.periodEnd).toBe(2000);
  });
});

describe('queryAggregates', () => {
  it('filters by agentClass', () => {
    recordAggregate('filter-test-a', 0, 1, 0.5, 10, 0, 100);
    recordAggregate('filter-test-b', 0, 1, 0.5, 10, 0, 100);
    const results = queryAggregates('filter-test-a');
    expect(results.every((r) => r.agentClass === 'filter-test-a')).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by period overlap', () => {
    recordAggregate('period-test', 0, 1, 0.5, 10, 500, 1500);
    const results = queryAggregates('period-test', 1000, 2000);
    expect(results.every((r) => r.periodEnd >= 1000 && r.periodStart <= 2000)).toBe(true);
  });

  it('returns empty array when no match', () => {
    const results = queryAggregates('nonexistent-agent-class-xyz');
    expect(results).toEqual([]);
  });

  it('returns all when no filters', () => {
    const results = queryAggregates();
    expect(Array.isArray(results)).toBe(true);
  });
});
