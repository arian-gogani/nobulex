import { sha256Object } from '@stele/crypto';
import {
  parse,
  evaluate,
  merge,
  serialize,
  matchAction,
  matchResource,
} from '@stele/ccl';
import type {
  CCLDocument,
  PermitDenyStatement,
  RequireStatement,
  LimitStatement,
  Statement,
  Condition,
  CompoundCondition,
  EvaluationContext,
} from '@stele/ccl';

export type {
  CompositionProof,
  ComposedConstraint,
  SystemProperty,
  CovenantSummary,
} from './types.js';

import type {
  CompositionProof,
  ComposedConstraint,
  SystemProperty,
  CovenantSummary,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Create a fresh empty CCLDocument. */
function emptyDoc(): CCLDocument {
  return { statements: [], permits: [], denies: [], obligations: [], limits: [] };
}

/** Parse an array of CCL constraint strings into a single CCLDocument. */
function parseConstraints(constraints: string[]): CCLDocument {
  const source = constraints.filter(s => s.trim() !== '').join('\n').trim();
  if (source === '') return emptyDoc();
  return parse(source);
}

/** Wrap a single Statement in a CCLDocument. */
function wrapStatement(stmt: Statement): CCLDocument {
  const doc = emptyDoc();
  doc.statements.push(stmt);
  switch (stmt.type) {
    case 'permit': doc.permits.push(stmt as PermitDenyStatement); break;
    case 'deny':   doc.denies.push(stmt as PermitDenyStatement); break;
    case 'require': doc.obligations.push(stmt as RequireStatement); break;
    case 'limit':  doc.limits.push(stmt as LimitStatement); break;
  }
  return doc;
}

/** Serialize a single statement to CCL text. */
function serializeOne(stmt: Statement): string {
  return serialize(wrapStatement(stmt)).trim();
}

/**
 * Check whether two action patterns could match a common concrete value.
 */
function actionPatternsOverlap(a: string, b: string): boolean {
  const cA = a.replace(/\*\*/g, 'x').replace(/\*/g, 'x');
  const cB = b.replace(/\*\*/g, 'x').replace(/\*/g, 'x');
  return matchAction(a, cB) || matchAction(b, cA);
}

/**
 * Check whether two resource patterns could match a common concrete value.
 */
function resourcePatternsOverlap(a: string, b: string): boolean {
  const cA = a.replace(/\*\*/g, 'x').replace(/\*/g, 'x');
  const cB = b.replace(/\*\*/g, 'x').replace(/\*/g, 'x');
  return matchResource(a, cB) || matchResource(b, cA);
}

/**
 * Check whether two (action, resource) pattern pairs could match any
 * common concrete (action, resource) value -- i.e. they "overlap".
 */
function patternsOverlap(
  actA: string, resA: string,
  actB: string, resB: string,
): boolean {
  return actionPatternsOverlap(actA, actB) && resourcePatternsOverlap(resA, resB);
}

/**
 * Build an EvaluationContext that would satisfy a simple equality condition
 * so we can probe whether a deny rule fires.
 */
function buildProbeContext(cond?: Condition | CompoundCondition): EvaluationContext | undefined {
  if (!cond) return undefined;

  // Simple condition
  if ('field' in cond && 'operator' in cond && 'value' in cond) {
    const simple = cond as Condition;
    const ctx: Record<string, unknown> = {};
    const parts = simple.field.split('.');
    let cur: Record<string, unknown> = ctx;
    for (let i = 0; i < parts.length - 1; i++) {
      const nested: Record<string, unknown> = {};
      cur[parts[i]!] = nested;
      cur = nested;
    }
    cur[parts[parts.length - 1]!] = simple.value;
    return ctx;
  }

  // Compound: try satisfying the first sub-condition
  if ('conditions' in cond) {
    const compound = cond as CompoundCondition;
    if (compound.conditions.length > 0) {
      return buildProbeContext(compound.conditions[0]!);
    }
  }
  return undefined;
}

/** Extract lowercase keywords (length > 1) from text. */
function extractKeywords(text: string): string[] {
  return text.toLowerCase().split(/[\s\-_.,]+/).filter(w => w.length > 1);
}

/** Check whether a deny statement is relevant to a property description. */
function isDenyRelevant(deny: PermitDenyStatement, propKeywords: string[]): boolean {
  // Universal wildcards are always relevant
  if (deny.action === '**' || deny.action === '*') return true;

  const actionKw = extractKeywords(deny.action);
  return propKeywords.some(pk =>
    actionKw.some(ak => ak.includes(pk) || pk.includes(ak)),
  );
}

/** Turn a pattern into a concrete action string for probing. */
function concretizeAction(pattern: string): string {
  if (pattern === '**' || pattern === '*') return 'probe_action';
  return pattern.replace(/\*\*/g, 'x').replace(/\*/g, 'x');
}

/** Turn a pattern into a concrete resource string for probing. */
function concretizeResource(pattern: string): string {
  if (pattern === '**') return '/probe_resource';
  if (pattern === '*') return '/probe';
  return pattern.replace(/\*\*/g, 'x').replace(/\*/g, 'x');
}

/** Validate that an object looks like a CovenantSummary. */
function validateCovenant(c: unknown): asserts c is CovenantSummary {
  const cov = c as Record<string, unknown>;
  if (!cov || typeof cov !== 'object') {
    throw new Error('Each covenant must be a non-null object');
  }
  if (typeof cov.id !== 'string' || cov.id === '') {
    throw new Error('Covenant id must be a non-empty string');
  }
  if (typeof cov.agentId !== 'string' || cov.agentId === '') {
    throw new Error('Covenant agentId must be a non-empty string');
  }
  if (!Array.isArray(cov.constraints)) {
    throw new Error('Covenant constraints must be an array');
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compose multiple covenant summaries into a single CompositionProof.
 *
 * Parses each covenant's constraints as CCL using `parse()`, then uses
 * `merge()` to combine them with proper deny-wins semantics. Permits that
 * overlap with any deny are removed from the composed result.
 */
export function compose(covenants: CovenantSummary[]): CompositionProof {
  if (!Array.isArray(covenants)) {
    throw new Error('covenants must be an array');
  }
  for (const c of covenants) validateCovenant(c);

  const agents = [...new Set(covenants.map(c => c.agentId))];
  const individualCovenants = covenants.map(c => c.id);

  // Parse every covenant and tag statements with their source
  interface Tagged { source: string; stmt: Statement }
  const allTagged: Tagged[] = [];
  let mergedDoc = emptyDoc();

  for (const covenant of covenants) {
    const doc = parseConstraints(covenant.constraints);
    for (const stmt of doc.statements) {
      allTagged.push({ source: covenant.id, stmt });
    }
    if (doc.statements.length > 0) {
      mergedDoc = mergedDoc.statements.length === 0 ? doc : merge(mergedDoc, doc);
    }
  }

  // Collect deny entries for deny-wins filtering
  const denyEntries = allTagged.filter(t => t.stmt.type === 'deny');

  // Build composed constraints -- permits overridden by denies are removed
  const composedConstraints: ComposedConstraint[] = [];
  for (const tagged of allTagged) {
    if (tagged.stmt.type === 'permit') {
      const ps = tagged.stmt as PermitDenyStatement;
      const overridden = denyEntries.some(d => {
        const ds = d.stmt as PermitDenyStatement;
        return patternsOverlap(ds.action, ds.resource, ps.action, ps.resource);
      });
      if (overridden) continue;
    }
    composedConstraints.push({
      source: tagged.source,
      constraint: serializeOne(tagged.stmt),
      type: tagged.stmt.type as ComposedConstraint['type'],
    });
  }

  const proof = sha256Object(composedConstraints);

  return {
    agents,
    individualCovenants,
    composedConstraints,
    systemProperties: [],
    proof,
  };
}

/**
 * Prove whether a system property holds across a set of covenants.
 *
 * Builds a merged CCLDocument from all covenants, then for each deny rule
 * relevant to the property, evaluates a probe action against the merged
 * document using `evaluate()`. If at least one relevant deny fires, the
 * property holds.
 */
export function proveSystemProperty(
  covenants: CovenantSummary[],
  property: string,
): SystemProperty {
  if (!Array.isArray(covenants)) {
    throw new Error('covenants must be an array');
  }
  if (typeof property !== 'string' || property.trim() === '') {
    throw new Error('property must be a non-empty string');
  }

  const propKeywords = extractKeywords(property);
  const derivedFrom: string[] = [];
  let holds = false;

  // Parse each covenant and merge into one document
  let mergedDoc = emptyDoc();
  const covenantDocs = new Map<string, CCLDocument>();

  for (const covenant of covenants) {
    const doc = parseConstraints(covenant.constraints);
    covenantDocs.set(covenant.id, doc);
    if (doc.statements.length > 0) {
      mergedDoc = mergedDoc.statements.length === 0 ? doc : merge(mergedDoc, doc);
    }
  }

  if (mergedDoc.statements.length === 0) {
    return { property, holds: false, derivedFrom: [] };
  }

  // Check each covenant's deny rules for relevance and verification
  for (const covenant of covenants) {
    const doc = covenantDocs.get(covenant.id)!;
    for (const deny of doc.denies) {
      if (!isDenyRelevant(deny, propKeywords)) continue;

      // Probe the merged document with a concrete action/resource
      const probeAction = concretizeAction(deny.action);
      const probeResource = concretizeResource(deny.resource);
      const ctx = buildProbeContext(deny.condition);

      const result = evaluate(mergedDoc, probeAction, probeResource, ctx ?? undefined);
      if (!result.permitted) {
        derivedFrom.push(covenant.id);
        holds = true;
      }
    }
  }

  return {
    property,
    holds,
    derivedFrom: [...new Set(derivedFrom)],
  };
}

/**
 * Validate a composition proof by verifying:
 *   1. The integrity hash matches the composed constraints.
 *   2. All constraints are valid, parseable CCL.
 *   3. Deny-wins consistency: no permit overlaps with any deny.
 */
export function validateComposition(proof: CompositionProof): boolean {
  if (!proof || typeof proof !== 'object') {
    throw new Error('proof must be a CompositionProof object');
  }
  if (!Array.isArray(proof.composedConstraints)) {
    throw new Error('proof.composedConstraints must be an array');
  }
  if (typeof proof.proof !== 'string') {
    throw new Error('proof.proof must be a string');
  }

  // 1. Hash integrity
  const recomputed = sha256Object(proof.composedConstraints);
  if (recomputed !== proof.proof) return false;

  // 2. All constraints must be valid CCL
  const parsedPermits: PermitDenyStatement[] = [];
  const parsedDenies: PermitDenyStatement[] = [];
  try {
    for (const cc of proof.composedConstraints) {
      if (cc.constraint.trim() === '') continue;
      const doc = parse(cc.constraint);
      parsedPermits.push(...doc.permits);
      parsedDenies.push(...doc.denies);
    }
  } catch {
    return false;
  }

  // 3. Deny-wins consistency: no permit should overlap with any deny
  for (const p of parsedPermits) {
    for (const d of parsedDenies) {
      if (patternsOverlap(p.action, p.resource, d.action, d.resource)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Return constraints present in both arrays (simple string equality).
 */
export function intersectConstraints(a: string[], b: string[]): string[] {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    throw new Error('Arguments must be arrays');
  }
  const setB = new Set(b);
  return a.filter(c => setB.has(c));
}

/**
 * Find pairs of constraints that conflict: a permit and deny in the
 * covenants whose action/resource patterns overlap.
 */
export function findConflicts(
  covenants: CovenantSummary[],
): Array<[string, string]> {
  if (!Array.isArray(covenants)) {
    throw new Error('covenants must be an array');
  }

  interface Entry { constraint: string; stmt: PermitDenyStatement }
  const permits: Entry[] = [];
  const denies: Entry[] = [];

  for (const covenant of covenants) {
    const doc = parseConstraints(covenant.constraints);
    for (const s of doc.permits) {
      permits.push({ constraint: serializeOne(s), stmt: s });
    }
    for (const s of doc.denies) {
      denies.push({ constraint: serializeOne(s), stmt: s });
    }
  }

  const conflicts: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const permit of permits) {
    for (const deny of denies) {
      if (patternsOverlap(
        permit.stmt.action, permit.stmt.resource,
        deny.stmt.action, deny.stmt.resource,
      )) {
        const key = `${permit.constraint}|${deny.constraint}`;
        if (!seen.has(key)) {
          seen.add(key);
          conflicts.push([permit.constraint, deny.constraint]);
        }
      }
    }
  }

  return conflicts;
}
