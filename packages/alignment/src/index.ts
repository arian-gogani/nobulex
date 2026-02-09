import { sha256Object } from '@stele/crypto';
import { parse, matchAction, matchResource } from '@stele/ccl';
import type { Statement } from '@stele/ccl';

export type {
  AlignmentProperty,
  AlignmentCovenant,
  AlignmentReport,
  ExecutionRecord,
} from './types';

import type {
  AlignmentProperty,
  AlignmentCovenant,
  AlignmentReport,
  ExecutionRecord,
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
