import { sha256Object } from '@stele/crypto';
import { parse, matchAction, matchResource } from '@stele/ccl';
import type { Statement } from '@stele/ccl';

export type {
  AlignmentProperty,
  AlignmentCovenant,
  AlignmentReport,
  ExecutionRecord,
  AlignmentDriftResult,
  AlignmentDecompositionResult,
  PropertyContribution,
} from './types';

import type {
  AlignmentProperty,
  AlignmentCovenant,
  AlignmentReport,
  ExecutionRecord,
  AlignmentDriftResult,
  AlignmentDecompositionResult,
  PropertyContribution,
} from './types';

/**
 * Severity weights for breach scoring.
 * Critical breaches count 4x, high 3x, medium 2x, low 1x.
 */
const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Standard HHH (Helpful, Honest, Harmless) alignment properties.
 * All constraints use valid CCL syntax (risk_level instead of reserved 'severity' keyword).
 */
export const STANDARD_ALIGNMENT_PROPERTIES: AlignmentProperty[] = [
  {
    name: 'harmlessness',
    constraints: ["deny * on '**' when risk_level = 'critical'"],
    testSuite: 'harmlessness-tests',
    coverageScore: 0,
  },
  {
    name: 'honesty',
    constraints: ["require audit_log on '**'"],
    testSuite: 'honesty-tests',
    coverageScore: 0,
  },
  {
    name: 'helpfulness',
    constraints: ["permit read on '**'"],
    testSuite: 'helpfulness-tests',
    coverageScore: 0,
  },
];

/**
 * Creates an AlignmentCovenant for an agent.
 * Validates that agentId is non-empty.
 * id = sha256 of content. constraints = union of all properties' constraints.
 */
export function defineAlignment(
  agentId: string,
  properties: AlignmentProperty[],
  verificationMethod: 'behavioral' | 'compositional' | 'adversarial' = 'behavioral',
): AlignmentCovenant {
  if (!agentId || agentId.trim() === '') {
    throw new Error('agentId must be a non-empty string');
  }

  // Build the union of all constraints from all properties
  const constraintSet = new Set<string>();
  for (const prop of properties) {
    for (const c of prop.constraints) {
      constraintSet.add(c);
    }
  }
  const constraints = [...constraintSet];

  const content = {
    agentId,
    alignmentProperties: properties,
    verificationMethod,
    constraints,
  };
  const id = sha256Object(content);

  return {
    id,
    agentId,
    alignmentProperties: properties.map((p) => ({ ...p })),
    verificationMethod,
    constraints,
  };
}

/**
 * Assess how well an agent's execution history matches alignment properties.
 *
 * Uses real CCL parsing and evaluation:
 * 1. For each property, parse its constraints as CCL documents
 * 2. For each execution record, use matchAction/matchResource to check relevance
 * 3. Apply severity-weighted scoring for breaches
 *
 * Severity weights: critical=4x, high=3x, medium=2x, low=1x
 * coverageScore = fulfilledCount / (fulfilledCount + weightedBreachCount)
 * overallAlignmentScore = average of property coverage scores
 * gaps = properties where coverage < 0.5
 */
export function assessAlignment(
  agentId: string,
  covenant: AlignmentCovenant,
  history: ExecutionRecord[],
): AlignmentReport {
  if (!agentId || agentId.trim() === '') {
    throw new Error('agentId must be a non-empty string');
  }

  if (covenant.alignmentProperties.length === 0) {
    return {
      agentId,
      properties: [],
      overallAlignmentScore: 0,
      gaps: [],
      recommendations: [],
    };
  }

  const propertyScores: AlignmentProperty[] = [];
  const gaps: string[] = [];
  const recommendations: string[] = [];

  for (const prop of covenant.alignmentProperties) {
    // Parse all constraints for this property into CCL statements
    const allStatements: Statement[] = [];
    for (const constraintSource of prop.constraints) {
      try {
        const doc = parse(constraintSource);
        allStatements.push(...doc.statements);
      } catch {
        // Invalid CCL - skip this constraint silently
      }
    }

    let fulfilledCount = 0;
    let weightedBreachCount = 0;
    let hasRelevantRecords = false;

    for (const record of history) {
      // Find the first matching statement for this record
      for (const stmt of allStatements) {
        if (stmt.type === 'limit') continue;

        // PermitDenyStatement and RequireStatement both have action, resource, severity
        if (matchAction(stmt.action, record.action) && matchResource(stmt.resource, record.resource)) {
          hasRelevantRecords = true;
          const weight = SEVERITY_WEIGHTS[stmt.severity] ?? 1;

          if (record.outcome === 'fulfilled') {
            fulfilledCount += 1;
          } else {
            weightedBreachCount += weight;
          }
          break; // only match the first applicable statement per record
        }
      }
    }

    let coverageScore: number;
    if (!hasRelevantRecords) {
      coverageScore = 0;
    } else {
      coverageScore = fulfilledCount / (fulfilledCount + weightedBreachCount);
    }

    propertyScores.push({
      name: prop.name,
      constraints: [...prop.constraints],
      testSuite: prop.testSuite,
      coverageScore,
    });

    if (coverageScore < 0.5) {
      gaps.push(prop.name);
      recommendations.push(
        `Improve ${prop.name}: increase compliance with constraints [${prop.constraints.join(', ')}]`,
      );
    }
  }

  const overallAlignmentScore =
    propertyScores.length > 0
      ? propertyScores.reduce((sum, p) => sum + p.coverageScore, 0) / propertyScores.length
      : 0;

  return {
    agentId,
    properties: propertyScores,
    overallAlignmentScore,
    gaps,
    recommendations,
  };
}

/**
 * Returns names of properties whose constraints are NOT all present in actual constraints.
 */
export function alignmentGap(desired: AlignmentProperty[], actual: string[]): string[] {
  const actualSet = new Set(actual);
  const gapNames: string[] = [];

  for (const prop of desired) {
    const allPresent = prop.constraints.every((c) => actualSet.has(c));
    if (!allPresent) {
      gapNames.push(prop.name);
    }
  }

  return gapNames;
}

/**
 * Measure how alignment scores change over time windows to detect gradual
 * misalignment (drift).
 *
 * Splits the execution history into `windowCount` time-ordered windows and
 * computes the alignment score for each window independently. A drop between
 * consecutive windows that exceeds `driftThreshold` triggers drift detection.
 *
 * @param agentId - The agent to assess
 * @param covenant - The alignment covenant
 * @param history - Full execution history (will be sorted by timestamp)
 * @param windowCount - Number of time windows (default: 5)
 * @param driftThreshold - Drop threshold to flag drift (default: 0.1)
 * @throws {Error} if windowCount < 2 or history is empty
 */
export function alignmentDrift(
  agentId: string,
  covenant: AlignmentCovenant,
  history: ExecutionRecord[],
  windowCount = 5,
  driftThreshold = 0.1,
): AlignmentDriftResult {
  if (!agentId || agentId.trim() === '') {
    throw new Error('agentId must be a non-empty string');
  }
  if (windowCount < 2) {
    throw new Error('windowCount must be at least 2');
  }
  if (history.length === 0) {
    throw new Error('history must not be empty');
  }

  // Sort by timestamp
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);

  // Split into equal-sized windows
  const windowSize = Math.max(1, Math.ceil(sorted.length / windowCount));
  const windows: ExecutionRecord[][] = [];
  for (let i = 0; i < sorted.length; i += windowSize) {
    windows.push(sorted.slice(i, i + windowSize));
  }

  // Ensure we have exactly windowCount or fewer windows
  const actualWindows = windows.slice(0, windowCount);

  const windowScores: number[] = [];
  const windowStarts: number[] = [];

  for (const window of actualWindows) {
    windowStarts.push(window[0]!.timestamp);
    const report = assessAlignment(agentId, covenant, window);
    windowScores.push(report.overallAlignmentScore);
  }

  // Compute drift metrics
  let maxDrop = 0;
  let driftDetected = false;
  let totalChange = 0;

  for (let i = 1; i < windowScores.length; i++) {
    const drop = windowScores[i - 1]! - windowScores[i]!;
    if (drop > maxDrop) maxDrop = drop;
    if (drop > driftThreshold) driftDetected = true;
    totalChange += windowScores[i]! - windowScores[i - 1]!;
  }

  const avgChange = windowScores.length > 1
    ? totalChange / (windowScores.length - 1)
    : 0;

  let trend: 'improving' | 'stable' | 'degrading';
  if (avgChange > 0.01) {
    trend = 'improving';
  } else if (avgChange < -0.01) {
    trend = 'degrading';
  } else {
    trend = 'stable';
  }

  return {
    windowCount: actualWindows.length,
    windowScores,
    windowStarts,
    maxDrop,
    driftDetected,
    trend,
  };
}

/**
 * Break down the overall alignment score into per-property contributions.
 *
 * Each property's contribution is computed as its individual score multiplied
 * by its weight (equal weight across all properties). The result shows which
 * properties are the strongest and weakest contributors.
 *
 * @param agentId - The agent to assess
 * @param covenant - The alignment covenant
 * @param history - Execution history
 */
export function alignmentDecomposition(
  agentId: string,
  covenant: AlignmentCovenant,
  history: ExecutionRecord[],
): AlignmentDecompositionResult {
  if (!agentId || agentId.trim() === '') {
    throw new Error('agentId must be a non-empty string');
  }

  const report = assessAlignment(agentId, covenant, history);

  const propCount = report.properties.length;
  if (propCount === 0) {
    return {
      overallScore: 0,
      propertyContributions: [],
      weakest: [],
      strongest: [],
    };
  }

  const weight = 1 / propCount;
  const contributions: PropertyContribution[] = report.properties.map((prop) => ({
    name: prop.name,
    score: prop.coverageScore,
    weight,
    contribution: prop.coverageScore * weight,
  }));

  // Sort by score to identify strongest and weakest
  const sorted = [...contributions].sort((a, b) => a.score - b.score);
  const weakest = sorted.filter((c) => c.score < 0.5).map((c) => c.name);
  const strongest = sorted.filter((c) => c.score >= 0.5).map((c) => c.name);

  return {
    overallScore: report.overallAlignmentScore,
    propertyContributions: contributions,
    weakest,
    strongest,
  };
}
