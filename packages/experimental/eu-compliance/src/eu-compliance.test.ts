/**
 * @nobulex/eu-compliance tests
 */
import { describe, it, expect } from 'vitest';
import { computeEUCompliance } from './index.js';
import type { CovenantDocument } from '@nobulex/core';

describe('computeEUCompliance', () => {
  it('returns low score when no covenant', () => {
    const report = computeEUCompliance(null);
    expect(report.readinessScore).toBeLessThan(50);
    expect(report.gaps.length).toBeGreaterThan(0);
    expect(report.recommendations.some((r) => r.includes('kova init'))).toBe(true);
  });

  it('returns higher score with covenant', () => {
    const mockCovenant = {
      id: 'test-id',
      version: '1.0',
      issuer: { id: 'i1', publicKey: '0'.repeat(64), role: 'issuer' as const },
      beneficiary: { id: 'b1', publicKey: '0'.repeat(64), role: 'beneficiary' as const },
      constraints: "permit read on '/data/**'",
      createdAt: new Date().toISOString(),
      signature: '0'.repeat(128),
    } as CovenantDocument;

    const report = computeEUCompliance(mockCovenant);
    expect(report.readinessScore).toBeGreaterThanOrEqual(40);
    expect(report.articles.length).toBeGreaterThan(0);
  });

  it('boosts score with deployment signals', () => {
    const report = computeEUCompliance(null, {
      hasAgentsMd: true,
      hasMcpConfig: true,
      hasKovaDep: true,
    });
    expect(report.readinessScore).toBeGreaterThan(30);
  });

  it('includes all article mappings', () => {
    const report = computeEUCompliance(null);
    const articleIds = report.articles.map((a) => a.article.id);
    expect(articleIds).toContain('Art.10');
    expect(articleIds).toContain('Art.17');
  });
});
