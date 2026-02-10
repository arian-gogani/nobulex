import { describe, it, expect } from 'vitest';
import { runBenchmarkSuite, benchmark, PERFORMANCE_SLAS, formatBenchmarkResults } from './benchmarks.js';

describe('Performance SLAs', () => {
  it('all SLA targets are met', async () => {
    const results = await runBenchmarkSuite();
    console.log(formatBenchmarkResults(results));
    expect(results.allPassed).toBe(true);
  }, 60_000); // 60s timeout for benchmarks

  it('PERFORMANCE_SLAS covers all critical operations', () => {
    const required = [
      'crypto.generateKeyPair',
      'crypto.sign',
      'crypto.verify',
      'ccl.parse',
      'ccl.evaluate',
      'covenant.build',
      'covenant.verify',
    ];
    for (const op of required) {
      expect(PERFORMANCE_SLAS).toHaveProperty(op);
    }
  });

  it('benchmark utility computes correct percentiles', async () => {
    const result = await benchmark('test.noop', () => {}, 100);
    expect(result.iterations).toBe(100);
    expect(result.p50).toBeLessThanOrEqual(result.p95);
    expect(result.p95).toBeLessThanOrEqual(result.p99);
    expect(result.min).toBeLessThanOrEqual(result.p50);
    expect(result.max).toBeGreaterThanOrEqual(result.p99);
  });

  it('benchmark result has correct structure', async () => {
    const result = await benchmark('test.structure', () => {}, 50);
    expect(result).toHaveProperty('name', 'test.structure');
    expect(result).toHaveProperty('iterations', 50);
    expect(typeof result.p50).toBe('number');
    expect(typeof result.p95).toBe('number');
    expect(typeof result.p99).toBe('number');
    expect(typeof result.min).toBe('number');
    expect(typeof result.max).toBe('number');
    expect(typeof result.mean).toBe('number');
    expect(typeof result.slaTarget).toBe('number');
    expect(typeof result.slaPassed).toBe('boolean');
  });

  it('formatBenchmarkResults produces readable output', async () => {
    const result = await benchmark('test.format', () => {}, 50);
    const suiteResult = {
      results: [result],
      allPassed: true,
      totalDuration: 100,
      timestamp: new Date().toISOString(),
    };
    const output = formatBenchmarkResults(suiteResult);
    expect(output).toContain('test.format');
    expect(output).toContain('PASS');
    expect(output).toContain('Stele Performance Benchmark Suite');
  });

  it('PERFORMANCE_SLAS has all 13 targets', () => {
    const keys = Object.keys(PERFORMANCE_SLAS);
    expect(keys.length).toBe(13);
  });

  it('all SLA targets have required fields', () => {
    for (const [name, sla] of Object.entries(PERFORMANCE_SLAS)) {
      expect(typeof sla.p99).toBe('number');
      expect(sla.unit).toBe('ms');
      expect(typeof sla.description).toBe('string');
      expect(sla.description.length).toBeGreaterThan(0);
      expect(sla.p99).toBeGreaterThan(0);
    }
  });
});
