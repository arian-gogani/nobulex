import { describe, it, expect } from 'vitest';
import { ActionLogBuilder } from '../action-log/index';
import { generateComplianceReport } from './index';
import type { ComplianceFramework } from './index';

function buildLog(entries: Array<{ action: string; outcome: 'success' | 'failure' | 'blocked' | 'would_block' | 'halted' }>) {
  const builder = new ActionLogBuilder('did:nobulex:agent-compliance');
  for (const e of entries) {
    builder.append({ action: e.action, resource: '*', params: {}, outcome: e.outcome });
  }
  return builder.toLog();
}

describe('generateComplianceReport', () => {
  it('produces a report for every supported framework', () => {
    const frameworks: ComplianceFramework[] = [
      'eu-ai-act-article-12',
      'colorado-ai-act',
      'soc2',
      'iso-42001',
    ];
    const log = buildLog([{ action: 'read', outcome: 'success' }]);
    for (const framework of frameworks) {
      const report = generateComplianceReport(log, { framework });
      expect(report.framework).toBe(framework);
      expect(report.requirements.length).toBeGreaterThan(0);
      expect(report.summary.coveragePercent).toBeGreaterThanOrEqual(0);
      expect(report.summary.coveragePercent).toBeLessThanOrEqual(100);
    }
  });

  it('eu-ai-act-article-12: an empty log fails the record-keeping requirement', () => {
    const log = buildLog([]);
    const report = generateComplianceReport(log, { framework: 'eu-ai-act-article-12' });
    const art1 = report.requirements.find((r) => r.id === 'art-12(1)');
    expect(art1?.met).toBe(false);
    expect(report.summary.unmet).toBeGreaterThan(0);
  });

  it('eu-ai-act-article-12: a populated log meets traceability when integrity is valid', () => {
    const log = buildLog([
      { action: 'read', outcome: 'success' },
      { action: 'write', outcome: 'success' },
      { action: 'delete', outcome: 'blocked' },
    ]);
    const report = generateComplianceReport(log, { framework: 'eu-ai-act-article-12' });
    expect(report.logIntegrity.valid).toBe(true);
    const traceability = report.requirements.find((r) => r.id === 'art-12(2)');
    expect(traceability?.met).toBe(true);
    const risk = report.requirements.find((r) => r.id === 'art-12(3)');
    expect(risk?.evidence).toContain(2);
  });

  it('colorado-ai-act: flags records as unmet when integrity is broken', () => {
    const log = buildLog([
      { action: 'read', outcome: 'success' },
    ]);
    // Tamper with the log by rebuilding with bad hash.
    const tampered = {
      ...log,
      entries: log.entries.map((e) => ({ ...e, hash: 'deadbeef'.repeat(8) })),
    };
    const report = generateComplianceReport(tampered, { framework: 'colorado-ai-act' });
    expect(report.logIntegrity.valid).toBe(false);
    const rec = report.requirements.find((r) => r.id === 'co-ai-6-1-1701(2)(b)');
    expect(rec?.met).toBe(false);
  });

  it('soc2: surfaces halt events as CC7.3 evidence', () => {
    const log = buildLog([
      { action: 'x', outcome: 'success' },
      { action: 'y', outcome: 'halted' },
    ]);
    const report = generateComplianceReport(log, { framework: 'soc2' });
    const cc73 = report.requirements.find((r) => r.id === 'CC7.3');
    expect(cc73?.met).toBe(true);
    expect(cc73?.evidence).toContain(1);
  });

  it('iso-42001: A.9.3 has evidence from blocked and would_block events', () => {
    const log = buildLog([
      { action: 'a', outcome: 'success' },
      { action: 'b', outcome: 'blocked' },
      { action: 'c', outcome: 'would_block' },
    ]);
    const report = generateComplianceReport(log, { framework: 'iso-42001' });
    const a93 = report.requirements.find((r) => r.id === 'A.9.3');
    expect(a93?.evidence).toEqual([1, 2]);
  });

  it('summary coveragePercent matches met/total', () => {
    const log = buildLog([{ action: 'r', outcome: 'success' }]);
    const report = generateComplianceReport(log, { framework: 'eu-ai-act-article-12' });
    const expected = Math.round((report.summary.met / report.requirements.length) * 100);
    expect(report.summary.coveragePercent).toBe(expected);
  });
});
