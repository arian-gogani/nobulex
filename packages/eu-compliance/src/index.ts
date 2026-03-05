/**
 * @nobulex/eu-compliance — EU AI Act compliance checker
 *
 * Fastest path to Aug 2026 compliance for agentic systems.
 * Maps EU AI Act Articles to Nobulex capabilities.
 *
 * @packageDocumentation
 */

import type { CovenantDocument } from '@nobulex/core';

/** EU AI Act Article reference. */
export interface ArticleRef {
  id: string;
  title: string;
  requirement: string;
}

/** Nobulex capability that satisfies an article. */
export interface Capability {
  package: string;
  feature: string;
  coverage: 'full' | 'partial' | 'supporting';
}

/** Compliance check result for a single article. */
export interface ArticleCompliance {
  article: ArticleRef;
  satisfied: boolean;
  capabilities: Capability[];
  gap?: string;
}

/** Full EU AI Act compliance report. */
export interface EUComplianceReport {
  /** Overall readiness score 0-100. */
  readinessScore: number;
  /** Per-article compliance. */
  articles: ArticleCompliance[];
  /** Summary of gaps. */
  gaps: string[];
  /** Recommended next steps. */
  recommendations: string[];
}

const ARTICLE_MAP: Record<string, { title: string; requirement: string; capabilities: Capability[] }> = {
  'Art.10': {
    title: 'Risk Management',
    requirement: 'Identify and analyze known and foreseeable risks',
    capabilities: [
      { package: '@nobulex/core', feature: 'Covenant constraints', coverage: 'full' },
      { package: '@nobulex/canary', feature: 'Canary tests probe boundaries', coverage: 'full' },
      { package: '@nobulex/temporal', feature: 'Covenant evolution', coverage: 'supporting' },
    ],
  },
  'Art.11': {
    title: 'Data Governance',
    requirement: 'Data provenance and bias monitoring',
    capabilities: [
      { package: '@nobulex/enforcement', feature: 'Behavioral provenance', coverage: 'full' },
      { package: '@nobulex/canary', feature: 'Discriminatory pattern tests', coverage: 'partial' },
    ],
  },
  'Art.13': {
    title: 'Transparency and Explainability',
    requirement: 'Design for interpretability, documentation',
    capabilities: [
      { package: '@nobulex/core', feature: 'CCL human-readable', coverage: 'full' },
      { package: '@nobulex/legal', feature: 'LegalIdentityPackage', coverage: 'full' },
    ],
  },
  'Art.14': {
    title: 'Human Oversight',
    requirement: 'Effective human oversight, override',
    capabilities: [
      { package: '@nobulex/ccl', feature: 'require/deny rules', coverage: 'full' },
      { package: '@nobulex/breach', feature: 'Breach attestation', coverage: 'supporting' },
    ],
  },
  'Art.15': {
    title: 'Accuracy, Robustness, Cybersecurity',
    requirement: 'Adversarial robustness, fallback',
    capabilities: [
      { package: '@nobulex/robustness', feature: 'Fuzz testing', coverage: 'full' },
      { package: '@nobulex/crypto', feature: 'Ed25519, constant-time', coverage: 'full' },
    ],
  },
  'Art.17': {
    title: 'Record-Keeping (Logs)',
    requirement: 'Automatic logging, traceability',
    capabilities: [
      { package: '@nobulex/enforcement', feature: 'Hash-chained audit trail', coverage: 'full' },
      { package: '@nobulex/canary', feature: 'Canary tests', coverage: 'supporting' },
    ],
  },
};

/**
 * Compute EU AI Act compliance report for an agent deployment.
 *
 * Maps EU AI Act Articles (10, 11, 13, 14, 15, 17) to Nobulex capabilities.
 * Use this to assess readiness for the Aug 2026 deadline.
 *
 * @param covenant - The covenant document (optional; if absent, reports gaps).
 * @param signals - Optional deployment signals: hasAgentsMd, hasMcpConfig, hasKovaDep.
 * @returns Compliance report with readinessScore (0-100), articles, gaps, recommendations.
 *
 * @example
 * ```ts
 * const report = computeEUCompliance(null);
 * console.log('Readiness:', report.readinessScore);
 * console.log('Gaps:', report.gaps);
 * ```
 */
export function computeEUCompliance(
  covenant?: CovenantDocument | null,
  signals?: { hasAgentsMd?: boolean; hasMcpConfig?: boolean; hasKovaDep?: boolean },
): EUComplianceReport {
  const articles: ArticleCompliance[] = [];
  const gaps: string[] = [];
  const recommendations: string[] = [];

  const hasCovenant = covenant != null && covenant.id != null;
  const sig = signals ?? {};

  for (const [id, meta] of Object.entries(ARTICLE_MAP)) {
    const satisfied = hasCovenant && meta.capabilities.length > 0;
    articles.push({
      article: { id, title: meta.title, requirement: meta.requirement },
      satisfied,
      capabilities: meta.capabilities,
      gap: satisfied ? undefined : `Missing: ${meta.requirement}`,
    });
    if (!satisfied) {
      gaps.push(`${id}: ${meta.requirement}`);
    }
  }

  // Readiness score
  let score = hasCovenant ? 40 : 0;
  score += sig.hasAgentsMd ? 10 : 0;
  score += sig.hasMcpConfig ? 10 : 0;
  score += sig.hasKovaDep ? 15 : 0;
  score += articles.filter((a) => a.satisfied).length * 5;
  score = Math.min(100, score);

  if (score < 50) {
    recommendations.push('Run `kova init` to create covenants and stele.config.json');
  }
  if (!sig.hasKovaDep && sig.hasMcpConfig) {
    recommendations.push('Add kova: npm install kova — wrap MCP server with withKova(server, "data-isolation")');
  }
  if (score < 100) {
    recommendations.push('See docs/eu-ai-act-mapping.md for full Article-to-Nobulex mapping');
  }

  return {
    readinessScore: Math.round(score),
    articles,
    gaps,
    recommendations,
  };
}
