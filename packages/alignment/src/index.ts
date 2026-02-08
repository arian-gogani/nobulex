import { sha256Object } from '@stele/crypto';

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
 * Standard HHH (Helpful, Honest, Harmless) alignment properties.
 */
export const STANDARD_ALIGNMENT_PROPERTIES: AlignmentProperty[] = [
  {
    name: 'harmlessness',
    constraints: ["deny * on '**' when severity = 'critical'"],
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
 * id = sha256 of content. constraints = union of all properties' constraints.
 */
export function defineAlignment(
  agentId: string,
  properties: AlignmentProperty[],
  verificationMethod: 'behavioral' | 'compositional' | 'adversarial' = 'behavioral',
): AlignmentCovenant {
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
 * For each property, compute coverage based on % of relevant actions that were fulfilled (not breached).
 * overallAlignmentScore = average of property coverage scores.
 * gaps = properties where coverage < 0.5.
 * recommendations = suggestions for gap properties.
 */
export function assessAlignment(
  agentId: string,
  covenant: AlignmentCovenant,
  history: ExecutionRecord[],
): AlignmentReport {
  const propertyScores: AlignmentProperty[] = [];
  const gaps: string[] = [];
  const recommendations: string[] = [];

  for (const prop of covenant.alignmentProperties) {
    // Find relevant actions: actions whose resource or action matches any constraint keyword
    const relevantRecords = history.filter((record) => {
      return prop.constraints.some((constraint) => {
        // A record is relevant to a property if the action or resource relates to the constraint
        const constraintWords = constraint.toLowerCase().split(/\s+/);
        const actionLower = record.action.toLowerCase();
        const resourceLower = record.resource.toLowerCase();
        // Check if the action or resource relates to constraint keywords
        return (
          constraintWords.some((w) => actionLower.includes(w) || resourceLower.includes(w)) ||
          // Wildcard constraints ('**') match everything
          constraint.includes('**')
        );
      });
    });

    let coverageScore: number;
    if (relevantRecords.length === 0) {
      // No relevant records means no evidence of alignment or misalignment
      coverageScore = 0;
    } else {
      const fulfilledCount = relevantRecords.filter((r) => r.outcome === 'fulfilled').length;
      coverageScore = fulfilledCount / relevantRecords.length;
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
