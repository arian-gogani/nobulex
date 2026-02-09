import { parse, evaluate, matchAction, matchResource } from '@stele/ccl';
import type {
  CCLDocument,
  Condition,
  CompoundCondition,
  PermitDenyStatement,
  EvaluationContext,
} from '@stele/ccl';

export type {
  RobustnessProof,
  InputBound,
  RobustnessReport,
  Vulnerability,
  CovenantSpec,
  ConstraintSpec,
  RobustnessOptions,
} from './types';

import type {
  RobustnessProof,
  InputBound,
  RobustnessReport,
  Vulnerability,
  CovenantSpec,
  ConstraintSpec,
  RobustnessOptions,
} from './types';

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_EXHAUSTIVE_THRESHOLD = 1000;
const DEFAULT_STATISTICAL_SAMPLE_SIZE = 500;

// ── assessSeverity ───────────────────────────────────────────────────────────

/**
 * Determine severity based on constraint type.
 *  deny    -> critical
 *  require -> high
 *  limit   -> medium
 *  permit  -> low
 */
export function assessSeverity(constraint: ConstraintSpec): 'critical' | 'high' | 'medium' | 'low' {
  switch (constraint.type) {
    case 'deny':
      return 'critical';
    case 'require':
      return 'high';
    case 'limit':
      return 'medium';
    case 'permit':
      return 'low';
  }
}

// ── Input space ──────────────────────────────────────────────────────────────

/**
 * Compute the total number of discrete input points within the bounds.
 * For each dimension, the range size is (max - min + 1) assuming integer steps.
 * Returns the product of all range sizes (the total input space size).
 */
function computeInputSpaceSize(bounds: InputBound): number {
  let size = 1;
  for (const dim of bounds.dimensions) {
    const range = bounds.ranges[dim];
    if (range) {
      size *= Math.max(Math.floor(range.max - range.min) + 1, 1);
    }
  }
  return size;
}

// ── Context generation ───────────────────────────────────────────────────────

/**
 * Set a value on a possibly-nested path (e.g. "user.role") in a context object.
 */
function setNestedField(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

/**
 * Generate all integer-valued context inputs within the bounds (exhaustive testing).
 * Each dimension in bounds maps to a context field. The cartesian product of all
 * integer values within each dimension's range is generated.
 */
function generateExhaustiveContexts(bounds: InputBound): Array<EvaluationContext> {
  const dims = bounds.dimensions;
  if (dims.length === 0) return [{}];

  const ranges: Array<{ dim: string; min: number; max: number }> = [];
  for (const dim of dims) {
    const range = bounds.ranges[dim];
    if (range) {
      ranges.push({ dim, min: Math.ceil(range.min), max: Math.floor(range.max) });
    }
  }
  if (ranges.length === 0) return [{}];

  const results: Array<EvaluationContext> = [];
  function recurse(depth: number, values: number[]): void {
    if (depth === ranges.length) {
      const ctx: Record<string, unknown> = {};
      for (let i = 0; i < ranges.length; i++) {
        setNestedField(ctx, ranges[i]!.dim, values[i]!);
      }
      results.push(ctx);
      return;
    }
    const r = ranges[depth]!;
    for (let v = r.min; v <= r.max; v++) {
      values[depth] = v;
      recurse(depth + 1, values);
    }
  }
  recurse(0, new Array(ranges.length).fill(0));
  return results;
}

/**
 * Generate a random context input within the given bounds.
 */
function generateRandomContext(bounds: InputBound): EvaluationContext {
  const context: Record<string, unknown> = {};
  for (const dim of bounds.dimensions) {
    const range = bounds.ranges[dim];
    if (range) {
      setNestedField(context, dim, range.min + Math.random() * (range.max - range.min));
    }
  }
  return context;
}

// ── CCL helpers ──────────────────────────────────────────────────────────────

/**
 * Convert an action pattern to a concrete action string that matches it.
 * Wildcards are replaced with the literal "test".
 */
function concretizeActionPattern(pattern: string): string {
  if (pattern === '**') return 'test';
  return pattern.split('.').map(p => (p === '**' || p === '*') ? 'test' : p).join('.');
}

/**
 * Convert a resource pattern to a concrete resource string that matches it.
 * Wildcards are replaced with "test" and a leading / is ensured.
 */
function concretizeResourcePattern(pattern: string): string {
  if (pattern === '**') return '/test';
  const norm = pattern.replace(/^\/+|\/+$/g, '');
  if (norm === '') return '/';
  const parts = norm.split('/').map(p => (p === '**' || p === '*') ? 'test' : p);
  return '/' + parts.join('/');
}

/**
 * Extract the action and resource to use for testing from a parsed CCL document
 * and an optional constraint spec. If the spec provides action/resource they are
 * concretized (wildcards turned into literals); otherwise the first statement in
 * the document is used.
 */
function extractActionResource(
  doc: CCLDocument,
  spec?: ConstraintSpec,
): { action: string; resource: string } {
  if (spec?.action) {
    return {
      action: concretizeActionPattern(spec.action),
      resource: spec.resource ? concretizeResourcePattern(spec.resource) : '/test',
    };
  }

  for (const stmt of doc.statements) {
    if (stmt.type !== 'limit' && 'resource' in stmt) {
      const s = stmt as PermitDenyStatement;
      return {
        action: concretizeActionPattern(s.action),
        resource: concretizeResourcePattern(s.resource),
      };
    }
    if (stmt.type === 'limit') {
      return {
        action: concretizeActionPattern(stmt.action),
        resource: '/test',
      };
    }
  }

  return { action: 'test', resource: '/test' };
}

/**
 * Build a CCLDocument from a ConstraintSpec when the rule name isn't valid CCL.
 * Constructs a synthetic document based on the spec's type, action, and resource.
 */
function buildDocFromSpec(spec: ConstraintSpec): CCLDocument {
  const action = spec.action ?? '**';
  const resource = spec.resource ?? '**';
  const stmt: PermitDenyStatement = {
    type: spec.type === 'limit' ? 'deny' : spec.type === 'require' ? 'deny' : spec.type as 'permit' | 'deny',
    action,
    resource,
    severity: spec.type === 'deny' ? 'critical' : 'high',
    line: 0,
  };
  return {
    statements: [stmt],
    permits: stmt.type === 'permit' ? [stmt] : [],
    denies: stmt.type === 'deny' ? [stmt] : [],
    obligations: [],
    limits: [],
  };
}

/**
 * Build a test document from parsed CCL.
 *
 * For deny and require constraints a universal fallback permit is added so that
 * evaluate() can return permitted=true when the deny/require rule does not fire,
 * which reveals a vulnerability.
 */
function buildTestDocument(doc: CCLDocument, constraintType: string): CCLDocument {
  if (constraintType === 'deny' || constraintType === 'require') {
    const fallbackPermit: PermitDenyStatement = {
      type: 'permit',
      action: '**',
      resource: '**',
      severity: 'low',
      line: 0,
    };
    return {
      statements: [...doc.statements, fallbackPermit],
      permits: [...doc.permits, fallbackPermit],
      denies: [...doc.denies],
      obligations: [...doc.obligations],
      limits: [...doc.limits],
    };
  }
  return doc;
}

/**
 * Check whether an evaluation result represents a constraint violation.
 *
 * - deny:    violated when evaluate() returns permitted (the deny did not fire)
 * - permit:  violated when evaluate() returns NOT permitted (the permit did not fire)
 * - require: violated when no matching obligation appears in allMatches
 * - limit:   not directly testable via evaluate(); always returns not-violated
 */
function checkViolation(
  testDoc: CCLDocument,
  action: string,
  resource: string,
  context: EvaluationContext,
  constraintType: string,
): { violated: boolean; detail: string } {
  const result = evaluate(testDoc, action, resource, context);

  switch (constraintType) {
    case 'deny':
      if (result.permitted) {
        return {
          violated: true,
          detail: `Deny constraint bypassed: '${action}' on '${resource}' was permitted with context ${JSON.stringify(context)}`,
        };
      }
      return { violated: false, detail: '' };

    case 'permit':
      if (!result.permitted) {
        return {
          violated: true,
          detail: `Permit constraint failed: '${action}' on '${resource}' was denied with context ${JSON.stringify(context)}`,
        };
      }
      return { violated: false, detail: '' };

    case 'require': {
      const hasObligation = result.allMatches.some(m => m.type === 'require');
      if (!hasObligation) {
        return {
          violated: true,
          detail: `Require constraint not enforced: no obligation matched for '${action}' on '${resource}' with context ${JSON.stringify(context)}`,
        };
      }
      return { violated: false, detail: '' };
    }

    case 'limit':
      return { violated: false, detail: '' };

    default:
      return { violated: false, detail: '' };
  }
}

// ── Condition extraction ─────────────────────────────────────────────────────

function isCompoundCondition(c: Condition | CompoundCondition): c is CompoundCondition {
  return 'conditions' in c &&
    'type' in c &&
    ((c as CompoundCondition).type === 'and' ||
     (c as CompoundCondition).type === 'or' ||
     (c as CompoundCondition).type === 'not');
}

/**
 * Recursively collect all simple (leaf) conditions from a condition tree.
 */
function collectSimpleConditions(
  cond: Condition | CompoundCondition,
  into: Condition[],
): void {
  if (isCompoundCondition(cond)) {
    for (const sub of cond.conditions) {
      collectSimpleConditions(sub, into);
    }
  } else {
    into.push(cond);
  }
}

/**
 * Extract every simple Condition from all statements in a CCL document.
 */
function extractSimpleConditions(doc: CCLDocument): Condition[] {
  const conditions: Condition[] = [];
  for (const stmt of doc.statements) {
    if ('condition' in stmt && stmt.condition) {
      collectSimpleConditions(
        stmt.condition as Condition | CompoundCondition,
        conditions,
      );
    }
  }
  return conditions;
}

// ── proveRobustness ──────────────────────────────────────────────────────────

/**
 * Prove the robustness of a single constraint within a covenant.
 *
 * The constraint string is parsed as CCL and inputs are evaluated with the real
 * evaluator. For deny constraints a violation occurs when the denied action is
 * still permitted; for permit constraints a violation occurs when the permitted
 * action is denied.
 *
 * Method selection:
 *  - exhaustive when input space <= exhaustiveThreshold (default 1000)
 *  - statistical otherwise, sampling up to statisticalSampleSize (default 500)
 *
 * Confidence:
 *  - exhaustive: iterations / totalPossible
 *  - statistical: 1 - (1 - p)^n  where p = 1/spaceSize and n = iterations
 */
export function proveRobustness(
  covenant: CovenantSpec,
  constraint: string,
  bounds: InputBound,
  options?: RobustnessOptions,
): RobustnessProof {
  // ── Input validation ────────────────────────────────────────────────────
  if (!constraint || constraint.trim().length === 0) {
    throw new Error('Constraint must be a non-empty string');
  }
  for (const dim of bounds.dimensions) {
    const range = bounds.ranges[dim];
    if (range && range.min > range.max) {
      throw new Error(
        `Invalid bound for dimension '${dim}': min (${range.min}) > max (${range.max})`,
      );
    }
  }

  const exhaustiveThreshold = options?.exhaustiveThreshold ?? DEFAULT_EXHAUSTIVE_THRESHOLD;
  const statisticalSampleSize = options?.statisticalSampleSize ?? DEFAULT_STATISTICAL_SAMPLE_SIZE;

  const constraintSpec = covenant.constraints.find(c => c.rule === constraint);
  const constraintType = constraintSpec?.type ?? 'deny';

  // Build CCL from the constraint spec, or parse if it looks like valid CCL
  let doc: CCLDocument;
  try {
    doc = parse(constraint);
  } catch {
    // Rule name isn't valid CCL — build a CCL document from the spec's type/action/resource
    doc = buildDocFromSpec(constraintSpec ?? { rule: constraint, type: 'deny' });
  }
  const testDoc = buildTestDocument(doc, constraintType);
  const { action, resource } = extractActionResource(doc, constraintSpec);

  const spaceSize = computeInputSpaceSize(bounds);

  let method: 'exhaustive' | 'statistical' | 'formal';
  let iterations = 0;
  let counterexample: unknown = undefined;
  let verified = true;

  if (spaceSize <= exhaustiveThreshold) {
    method = 'exhaustive';
    const contexts = generateExhaustiveContexts(bounds);
    iterations = contexts.length;
    for (const ctx of contexts) {
      const check = checkViolation(testDoc, action, resource, ctx, constraintType);
      if (check.violated) {
        verified = false;
        counterexample = { action, resource, context: ctx };
        break;
      }
    }
  } else {
    method = 'statistical';
    const sampleSize = Math.min(spaceSize, statisticalSampleSize);
    iterations = sampleSize;
    for (let i = 0; i < sampleSize; i++) {
      const ctx = generateRandomContext(bounds);
      const check = checkViolation(testDoc, action, resource, ctx, constraintType);
      if (check.violated) {
        verified = false;
        counterexample = { action, resource, context: ctx };
        break;
      }
    }
  }

  let confidence: number;
  if (method === 'exhaustive') {
    confidence = iterations / Math.max(spaceSize, 1);
  } else {
    const p = 1 / Math.max(spaceSize, 1);
    confidence = 1 - Math.pow(1 - p, iterations);
  }

  return {
    covenantId: covenant.id,
    constraint,
    inputBound: bounds,
    verified,
    counterexample,
    confidence,
    method,
  };
}

// ── fuzz ─────────────────────────────────────────────────────────────────────

/**
 * Generate a random value suitable for probing a single condition.
 */
function generateRandomValueForCondition(cond: Condition): unknown {
  const { value } = cond;

  if (typeof value === 'number') {
    const spread = Math.max(Math.abs(value) * 2, 10);
    return value + (Math.random() - 0.5) * spread;
  }

  if (typeof value === 'boolean') {
    return Math.random() < 0.5;
  }

  if (Array.isArray(value)) {
    if (Math.random() < 0.5 && value.length > 0) {
      return value[Math.floor(Math.random() * value.length)];
    }
    return `random_${Math.random().toString(36).slice(2, 8)}`;
  }

  if (typeof value === 'string') {
    return Math.random() < 0.5 ? value : `random_${Math.random().toString(36).slice(2, 8)}`;
  }

  return null;
}

/**
 * Generate a random context based on the conditions found in a CCL document.
 */
function generateFuzzContext(doc: CCLDocument): EvaluationContext {
  const conditions = extractSimpleConditions(doc);
  const context: Record<string, unknown> = {};
  for (const cond of conditions) {
    setNestedField(context, cond.field, generateRandomValueForCondition(cond));
  }
  return context;
}

/**
 * Fuzz test a covenant by generating random inputs for each constraint.
 *
 * For each constraint in the covenant, parses it as CCL, generates random
 * action/resource/context tuples, evaluates them, and checks for unexpected
 * results (e.g. a deny constraint that permits, or vice-versa).
 *
 * overallRobustness = constraintsPassed / constraintsTested
 */
export function fuzz(
  covenant: CovenantSpec,
  iterations: number,
  options?: RobustnessOptions,
): RobustnessReport {
  if (iterations < 0) {
    throw new Error('Iteration count must be non-negative');
  }

  const vulnerabilities: Vulnerability[] = [];
  let constraintsPassed = 0;
  const constraintsTested = covenant.constraints.length;

  for (const spec of covenant.constraints) {
    let found = false;

    // Parse the constraint rule as CCL, or build from spec
    let doc: CCLDocument;
    try {
      doc = parse(spec.rule);
    } catch {
      doc = buildDocFromSpec(spec);
    }

    const testDoc = buildTestDocument(doc, spec.type);
    const { action, resource } = extractActionResource(doc, spec);

    for (let i = 0; i < iterations; i++) {
      const context = generateFuzzContext(doc);
      const check = checkViolation(testDoc, action, resource, context, spec.type);
      if (check.violated) {
        vulnerabilities.push({
          constraint: spec.rule,
          counterexample: { action, resource, context },
          severity: assessSeverity(spec),
          recommendation: `Review constraint '${spec.rule}' — ${check.detail}`,
        });
        found = true;
        break;
      }
    }

    if (!found) {
      constraintsPassed++;
    }
  }

  return {
    covenantId: covenant.id,
    constraintsTested,
    constraintsPassed,
    vulnerabilities,
    overallRobustness: constraintsTested > 0 ? constraintsPassed / constraintsTested : 1,
  };
}

// ── generateAdversarialInputs ────────────────────────────────────────────────

/**
 * Generate boundary values for a numeric condition.
 * Includes the exact value, near-boundary values (value +/- epsilon),
 * one step away, and extremes (0, -1).
 */
function generateNumericBoundaryValues(value: number): number[] {
  const epsilon = 0.01;
  return [value, value - epsilon, value + epsilon, value - 1, value + 1, 0, -1];
}

/**
 * Generate boundary values for a string condition.
 * Includes the exact value, empty string, case-flipped, truncated, and extended.
 */
function generateStringBoundaryValues(value: string): string[] {
  const boundaries: string[] = [value, ''];
  if (value.length > 0) {
    boundaries.push(value.toUpperCase());
    boundaries.push(value.toLowerCase());
    boundaries.push(value.slice(0, -1));
    boundaries.push(value + 'x');
  }
  return boundaries;
}

/**
 * Generate adversarial inputs designed to probe boundary conditions of a
 * constraint.
 *
 * The constraint is parsed as CCL. Conditions are extracted and used to
 * generate context values that sit exactly on boundaries (e.g. for
 * `field > 5`, values 5, 4.99, 5.01, 6, 0, -1 are generated). The first
 * several inputs are structural probes (empty strings, case variations,
 * path-traversal attempts).
 *
 * If the constraint cannot be parsed as CCL, a set of generic adversarial
 * inputs is produced instead.
 */
export function generateAdversarialInputs(
  constraint: string,
  count: number,
): Array<{ action: string; resource: string; context: Record<string, unknown> }> {
  if (count <= 0) return [];

  if (!constraint || constraint.trim().length === 0) {
    throw new Error('Constraint must be a non-empty string');
  }

  // Try to parse constraint as CCL
  let doc: CCLDocument;
  try {
    doc = parse(constraint);
  } catch {
    // Fall back to generic adversarial inputs when CCL parsing fails
    return generateGenericAdversarialInputs(constraint, count);
  }

  const inputs: Array<{ action: string; resource: string; context: Record<string, unknown> }> = [];
  const conditions = extractSimpleConditions(doc);
  const { action: baseAction, resource: baseResource } = extractActionResource(doc);

  // ── 1. Structural boundary inputs ──────────────────────────────────────
  const structuralInputs: Array<{
    action: string;
    resource: string;
    context: Record<string, unknown>;
  }> = [
    { action: '', resource: '', context: {} },
    { action: baseAction, resource: baseResource, context: {} },
    {
      action: baseAction.toUpperCase(),
      resource: baseResource.toLowerCase(),
      context: {},
    },
    {
      action: baseAction + '.extra',
      resource: baseResource + '/extra',
      context: {},
    },
    {
      action: `../../../${baseAction}`,
      resource: `../../../${baseResource}`,
      context: {},
    },
  ];

  let idx = 0;
  while (inputs.length < count && idx < structuralInputs.length) {
    inputs.push(structuralInputs[idx]!);
    idx++;
  }

  // ── 2. Condition-based boundary inputs ─────────────────────────────────
  const boundaryInputs: Array<Record<string, unknown>> = [];

  for (const cond of conditions) {
    const { field, value } = cond;

    if (typeof value === 'number') {
      for (const bv of generateNumericBoundaryValues(value)) {
        const ctx: Record<string, unknown> = {};
        setNestedField(ctx, field, bv);
        boundaryInputs.push(ctx);
      }
    } else if (typeof value === 'string') {
      for (const bv of generateStringBoundaryValues(value)) {
        const ctx: Record<string, unknown> = {};
        setNestedField(ctx, field, bv);
        boundaryInputs.push(ctx);
      }
    } else if (typeof value === 'boolean') {
      const ctxTrue: Record<string, unknown> = {};
      setNestedField(ctxTrue, field, true);
      boundaryInputs.push(ctxTrue);
      const ctxFalse: Record<string, unknown> = {};
      setNestedField(ctxFalse, field, false);
      boundaryInputs.push(ctxFalse);
    } else if (Array.isArray(value)) {
      for (const v of value) {
        const ctx: Record<string, unknown> = {};
        setNestedField(ctx, field, v);
        boundaryInputs.push(ctx);
      }
      const ctxOut: Record<string, unknown> = {};
      setNestedField(ctxOut, field, '__not_in_list__');
      boundaryInputs.push(ctxOut);
      const ctxEmpty: Record<string, unknown> = {};
      setNestedField(ctxEmpty, field, '');
      boundaryInputs.push(ctxEmpty);
    }
  }

  let bIdx = 0;
  while (inputs.length < count && bIdx < boundaryInputs.length) {
    inputs.push({
      action: baseAction,
      resource: baseResource,
      context: boundaryInputs[bIdx]!,
    });
    bIdx++;
  }

  // ── 3. Random fill for remaining slots ─────────────────────────────────
  while (inputs.length < count) {
    const ctx: Record<string, unknown> = {};
    for (const cond of conditions) {
      setNestedField(ctx, cond.field, generateRandomValueForCondition(cond));
    }
    inputs.push({
      action: baseAction,
      resource: baseResource,
      context: Object.keys(ctx).length > 0 ? ctx : { _fuzz: Math.random() },
    });
  }

  return inputs;
}

/**
 * Fallback adversarial input generator for constraints that cannot be parsed
 * as CCL. Produces a deterministic sequence of generic probing inputs.
 */
function generateGenericAdversarialInputs(
  constraint: string,
  count: number,
): Array<{ action: string; resource: string; context: Record<string, unknown> }> {
  const inputs: Array<{
    action: string;
    resource: string;
    context: Record<string, unknown>;
  }> = [];

  for (let i = 0; i < count; i++) {
    if (i % 5 === 0) {
      inputs.push({
        action: '',
        resource: '',
        context: { boundary: 'empty', iteration: i },
      });
    } else if (i % 5 === 1) {
      inputs.push({
        action: 'a'.repeat(256),
        resource: 'r'.repeat(256),
        context: { boundary: 'overflow', iteration: i },
      });
    } else if (i % 5 === 2) {
      inputs.push({
        action: constraint.split(' ').reverse().join('_'),
        resource: `../../../${constraint}`,
        context: { boundary: 'traversal', iteration: i },
      });
    } else if (i % 5 === 3) {
      inputs.push({
        action: constraint.toUpperCase(),
        resource: constraint.toLowerCase(),
        context: { boundary: 'case', iteration: i },
      });
    } else {
      inputs.push({
        action: `null_${i}`,
        resource: `undefined_${i}`,
        context: { boundary: 'null-injection', iteration: i },
      });
    }
  }

  return inputs;
}
