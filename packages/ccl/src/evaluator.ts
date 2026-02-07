import type {
  CCLDocument,
  Condition,
  CompoundCondition,
  EvaluationContext,
  EvaluationResult,
  LimitStatement,
  NarrowingViolation,
  PermitDenyStatement,
  RequireStatement,
  Statement,
} from './types.js';

/**
 * Match an action string against a pattern.
 * Segments are dot-separated.
 * - `*` matches exactly one segment
 * - `**` matches zero or more segments (greedy)
 */
export function matchAction(pattern: string, action: string): boolean {
  const patternParts = pattern.split('.');
  const actionParts = action.split('.');
  return matchSegments(patternParts, 0, actionParts, 0);
}

/**
 * Match a resource string against a pattern.
 * Segments are slash-separated.
 * - `*` matches exactly one segment
 * - `**` matches zero or more segments (greedy)
 */
export function matchResource(pattern: string, resource: string): boolean {
  // Normalize: remove leading/trailing slashes for matching
  const normPattern = pattern.replace(/^\/+|\/+$/g, '');
  const normResource = resource.replace(/^\/+|\/+$/g, '');

  // Handle empty patterns
  if (normPattern === '' && normResource === '') return true;
  if (normPattern === '**') return true;
  if (normPattern === '*' && !normResource.includes('/')) return true;

  const patternParts = normPattern.split('/');
  const resourceParts = normResource.split('/');
  return matchSegments(patternParts, 0, resourceParts, 0);
}

/**
 * Generic segment matcher supporting * (single) and ** (multi) wildcards.
 */
function matchSegments(
  pattern: string[],
  pi: number,
  target: string[],
  ti: number,
): boolean {
  while (pi < pattern.length && ti < target.length) {
    const p = pattern[pi]!;

    if (p === '**') {
      // ** can match zero or more segments
      // Try matching zero segments (advance pattern only)
      if (matchSegments(pattern, pi + 1, target, ti)) {
        return true;
      }
      // Try matching one or more segments (advance target)
      return matchSegments(pattern, pi, target, ti + 1);
    }

    if (p === '*') {
      // * matches exactly one segment (any content)
      pi++;
      ti++;
      continue;
    }

    // Literal match
    if (p !== target[ti]) {
      return false;
    }

    pi++;
    ti++;
  }

  // Skip trailing ** patterns (they can match zero segments)
  while (pi < pattern.length && pattern[pi] === '**') {
    pi++;
  }

  return pi === pattern.length && ti === target.length;
}

/**
 * Calculate the specificity of an action+resource pattern pair.
 * More specific patterns have higher scores.
 * Non-wildcard segments count as 2 points each.
 * Single wildcards (*) count as 1 point each.
 * Double wildcards (**) count as 0 points.
 */
export function specificity(actionPattern: string, resourcePattern: string): number {
  let score = 0;

  const actionParts = actionPattern.split('.');
  for (const part of actionParts) {
    if (part === '**') {
      score += 0;
    } else if (part === '*') {
      score += 1;
    } else {
      score += 2;
    }
  }

  const normResource = resourcePattern.replace(/^\/+|\/+$/g, '');
  if (normResource.length > 0) {
    const resourceParts = normResource.split('/');
    for (const part of resourceParts) {
      if (part === '**') {
        score += 0;
      } else if (part === '*') {
        score += 1;
      } else {
        score += 2;
      }
    }
  }

  return score;
}

/**
 * Evaluate a condition or compound condition against a context.
 * Missing fields evaluate to false (safe default).
 */
export function evaluateCondition(
  condition: Condition | CompoundCondition,
  context: EvaluationContext,
): boolean {
  if (isCompoundCondition(condition)) {
    return evaluateCompoundCondition(condition, context);
  }
  return evaluateSimpleCondition(condition, context);
}

function evaluateCompoundCondition(
  condition: CompoundCondition,
  context: EvaluationContext,
): boolean {
  switch (condition.type) {
    case 'and':
      return condition.conditions.every((c) => evaluateCondition(c, context));
    case 'or':
      return condition.conditions.some((c) => evaluateCondition(c, context));
    case 'not':
      return !evaluateCondition(condition.conditions[0]!, context);
    default:
      return false;
  }
}

function evaluateSimpleCondition(
  condition: Condition,
  context: EvaluationContext,
): boolean {
  const fieldValue = resolveField(context, condition.field);

  // Missing fields evaluate to false
  if (fieldValue === undefined) {
    return false;
  }

  const { operator, value } = condition;

  switch (operator) {
    case '=':
      return fieldValue === value;
    case '!=':
      return fieldValue !== value;
    case '<':
      return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue < value;
    case '>':
      return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue > value;
    case '<=':
      return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue <= value;
    case '>=':
      return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue >= value;
    case 'contains':
      if (typeof fieldValue === 'string' && typeof value === 'string') {
        return fieldValue.includes(value);
      }
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(value);
      }
      return false;
    case 'not_contains':
      if (typeof fieldValue === 'string' && typeof value === 'string') {
        return !fieldValue.includes(value);
      }
      if (Array.isArray(fieldValue)) {
        return !fieldValue.includes(value);
      }
      return true;
    case 'in':
      if (Array.isArray(value)) {
        return value.includes(String(fieldValue));
      }
      return false;
    case 'not_in':
      if (Array.isArray(value)) {
        return !value.includes(String(fieldValue));
      }
      return true;
    case 'matches': {
      if (typeof fieldValue === 'string' && typeof value === 'string') {
        try {
          const re = new RegExp(value);
          return re.test(fieldValue);
        } catch {
          return false;
        }
      }
      return false;
    }
    case 'starts_with':
      return typeof fieldValue === 'string' && typeof value === 'string' && fieldValue.startsWith(value);
    case 'ends_with':
      return typeof fieldValue === 'string' && typeof value === 'string' && fieldValue.endsWith(value);
    default:
      return false;
  }
}

/**
 * Resolve a dotted field path against a context object.
 * e.g. "user.role" resolves context.user.role
 */
function resolveField(context: EvaluationContext, field: string): unknown {
  const parts = field.split('.');
  let current: unknown = context;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Evaluate a CCL document against an action/resource pair.
 *
 * Resolution order:
 * 1. Find all matching statements (action + resource match, conditions pass)
 * 2. Sort by specificity (more specific first)
 * 3. At equal specificity, deny wins over permit
 * 4. If no rules match, default is deny
 */
export function evaluate(
  doc: CCLDocument,
  action: string,
  resource: string,
  context?: EvaluationContext,
): EvaluationResult {
  const ctx = context ?? {};
  const allMatches: Statement[] = [];

  // Collect all matching permit/deny statements
  const matchedPermitDeny: PermitDenyStatement[] = [];

  for (const stmt of doc.permits) {
    if (matchAction(stmt.action, action) && matchResource(stmt.resource, resource)) {
      if (!stmt.condition || evaluateCondition(stmt.condition, ctx)) {
        matchedPermitDeny.push(stmt);
        allMatches.push(stmt);
      }
    }
  }

  for (const stmt of doc.denies) {
    if (matchAction(stmt.action, action) && matchResource(stmt.resource, resource)) {
      if (!stmt.condition || evaluateCondition(stmt.condition, ctx)) {
        matchedPermitDeny.push(stmt);
        allMatches.push(stmt);
      }
    }
  }

  // Also collect matching obligations (they don't affect permit/deny but are returned)
  for (const stmt of doc.obligations) {
    if (matchAction(stmt.action, action) && matchResource(stmt.resource, resource)) {
      if (!stmt.condition || evaluateCondition(stmt.condition, ctx)) {
        allMatches.push(stmt);
      }
    }
  }

  // No matching permit/deny rules: default deny
  if (matchedPermitDeny.length === 0) {
    return {
      permitted: false,
      allMatches,
      reason: 'No matching rules found; default deny',
    };
  }

  // Sort by specificity descending; at equal specificity, denies come first
  matchedPermitDeny.sort((a, b) => {
    const specA = specificity(a.action, a.resource);
    const specB = specificity(b.action, b.resource);

    if (specB !== specA) {
      return specB - specA; // higher specificity first
    }

    // At equal specificity, deny wins (comes first)
    if (a.type === 'deny' && b.type !== 'deny') return -1;
    if (a.type !== 'deny' && b.type === 'deny') return 1;
    return 0;
  });

  const winner = matchedPermitDeny[0]!;
  const permitted = winner.type === 'permit';

  return {
    permitted,
    matchedRule: winner,
    allMatches,
    reason: `Matched ${winner.type} rule for ${winner.action} on ${winner.resource}`,
    severity: winner.severity,
  };
}

/**
 * Check if a rate limit has been exceeded.
 */
export function checkRateLimit(
  doc: CCLDocument,
  action: string,
  currentCount: number,
  periodStartTime: number,
  now?: number,
): { exceeded: boolean; limit?: LimitStatement; remaining: number } {
  const currentTime = now ?? Date.now();

  // Find the most specific matching limit
  let matchedLimit: LimitStatement | undefined;
  let bestSpecificity = -1;

  for (const limit of doc.limits) {
    if (matchAction(limit.action, action)) {
      const spec = specificity(limit.action, '');
      if (spec > bestSpecificity) {
        bestSpecificity = spec;
        matchedLimit = limit;
      }
    }
  }

  if (!matchedLimit) {
    return { exceeded: false, remaining: Infinity };
  }

  // Check if we're still within the time window
  const periodMs = matchedLimit.periodSeconds * 1000;
  const elapsed = currentTime - periodStartTime;

  if (elapsed > periodMs) {
    // Period has expired; the count resets
    return {
      exceeded: false,
      limit: matchedLimit,
      remaining: matchedLimit.count,
    };
  }

  const remaining = Math.max(0, matchedLimit.count - currentCount);
  return {
    exceeded: currentCount >= matchedLimit.count,
    limit: matchedLimit,
    remaining,
  };
}

/**
 * Merge a parent and child CCL document with deny-wins semantics.
 * The child inherits all parent rules. If both parent and child have
 * permits for the same action/resource, the result is the intersection.
 * All denies from both are included.
 */
export function merge(parent: CCLDocument, child: CCLDocument): CCLDocument {
  const statements: Statement[] = [];

  // All denies from both parent and child are included
  statements.push(...parent.denies);
  statements.push(...child.denies);

  // Permits: child permits are only included if they don't conflict with parent denies
  for (const permit of child.permits) {
    statements.push(permit);
  }
  for (const permit of parent.permits) {
    statements.push(permit);
  }

  // All obligations from both
  statements.push(...parent.obligations);
  statements.push(...child.obligations);

  // All limits: take the more restrictive limit if both specify for same action
  const limitsByAction = new Map<string, LimitStatement>();

  for (const limit of parent.limits) {
    const existing = limitsByAction.get(limit.action);
    if (!existing || limit.count < existing.count) {
      limitsByAction.set(limit.action, limit);
    }
  }

  for (const limit of child.limits) {
    const existing = limitsByAction.get(limit.action);
    if (!existing || limit.count < existing.count) {
      limitsByAction.set(limit.action, limit);
    }
  }

  statements.push(...limitsByAction.values());

  return buildDocumentFromStatements(statements);
}

/**
 * Validate that a child document only narrows (restricts) the parent.
 * A child cannot:
 * - Permit something the parent denies
 * - Permit a broader scope than the parent permits
 */
export function validateNarrowing(
  parent: CCLDocument,
  child: CCLDocument,
): { valid: boolean; violations: NarrowingViolation[] } {
  const violations: NarrowingViolation[] = [];

  // Check each child permit against parent denies
  for (const childPermit of child.permits) {
    for (const parentDeny of parent.denies) {
      // If the child permits something the parent denies, that's a violation
      if (
        patternsOverlap(childPermit.action, parentDeny.action) &&
        patternsOverlap(childPermit.resource, parentDeny.resource)
      ) {
        violations.push({
          childRule: childPermit,
          parentRule: parentDeny,
          reason: `Child permits '${childPermit.action}' on '${childPermit.resource}' which parent denies`,
        });
      }
    }

    // Check if child permit is broader than any parent permit
    let hasMatchingParentPermit = false;
    for (const parentPermit of parent.permits) {
      if (
        isSubsetPattern(childPermit.action, parentPermit.action, '.') &&
        isSubsetPattern(childPermit.resource, parentPermit.resource, '/')
      ) {
        hasMatchingParentPermit = true;
        break;
      }
    }

    // If the parent has permits and the child permit doesn't fit within any, flag it
    if (parent.permits.length > 0 && !hasMatchingParentPermit) {
      // Find the closest parent permit for the violation report
      const closestParent = parent.permits[0]!;
      violations.push({
        childRule: childPermit,
        parentRule: closestParent,
        reason: `Child permit '${childPermit.action}' on '${childPermit.resource}' is not a subset of any parent permit`,
      });
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Check if two patterns can match any of the same strings.
 */
function patternsOverlap(pattern1: string, pattern2: string): boolean {
  // If either is a universal wildcard, they overlap
  if (pattern1 === '**' || pattern2 === '**') return true;
  if (pattern1 === '*' || pattern2 === '*') return true;

  // If they're identical, they overlap
  if (pattern1 === pattern2) return true;

  // Check if one can match something the other matches
  // Simple heuristic: check if pattern1 matches pattern2 or vice versa
  // We use a representative concrete string derived from each pattern
  const concrete1 = patternToConcrete(pattern1);
  const concrete2 = patternToConcrete(pattern2);

  const sep1 = pattern1.includes('/') ? '/' : '.';
  const sep2 = pattern2.includes('/') ? '/' : '.';
  const matchFn = sep1 === '/' ? matchResource : matchAction;
  const matchFn2 = sep2 === '/' ? matchResource : matchAction;

  return matchFn(pattern1, concrete2) || matchFn2(pattern2, concrete1);
}

/**
 * Convert a pattern to a concrete representative string.
 */
function patternToConcrete(pattern: string): string {
  return pattern
    .replace(/\*\*/g, 'x')
    .replace(/\*/g, 'x');
}

/**
 * Check if childPattern is a subset of (at most as broad as) parentPattern.
 * A pattern is a subset if everything it matches is also matched by the parent.
 */
function isSubsetPattern(childPattern: string, parentPattern: string, separator: string): boolean {
  // If parent is **, it matches everything, so child is always a subset
  if (parentPattern === '**') return true;

  // If child is ** but parent is not, child is broader
  if (childPattern === '**' && parentPattern !== '**') return false;

  const childParts = childPattern.split(separator).filter((p) => p.length > 0);
  const parentParts = parentPattern.split(separator).filter((p) => p.length > 0);

  // Check that child is at least as specific as parent
  return isSubsetSegments(childParts, 0, parentParts, 0);
}

function isSubsetSegments(
  child: string[],
  ci: number,
  parent: string[],
  pi: number,
): boolean {
  // Both exhausted: child is subset
  if (ci === child.length && pi === parent.length) return true;

  // Parent exhausted but child has more: child could match longer strings not matched by parent
  if (pi === parent.length) return false;

  // Child exhausted but parent has more
  if (ci === child.length) {
    // Only ok if remaining parent segments are all **
    for (let i = pi; i < parent.length; i++) {
      if (parent[i] !== '**') return false;
    }
    return true;
  }

  const pSeg = parent[pi]!;
  const cSeg = child[ci]!;

  if (pSeg === '**') {
    // Parent ** matches anything, try all possibilities
    // Skip the ** (match zero segments)
    if (isSubsetSegments(child, ci, parent, pi + 1)) return true;
    // Consume one child segment with the **
    return isSubsetSegments(child, ci + 1, parent, pi);
  }

  if (cSeg === '**') {
    // Child uses ** which is very broad. Parent must also use ** or something equally broad
    if (pSeg !== '**') return false;
    return isSubsetSegments(child, ci + 1, parent, pi + 1);
  }

  if (pSeg === '*') {
    // Parent * matches one segment. Child must also be * or a literal (which is narrower)
    return isSubsetSegments(child, ci + 1, parent, pi + 1);
  }

  if (cSeg === '*') {
    // Child * is broader than a literal parent - not a subset
    if (pSeg !== '*' && pSeg !== '**') return false;
    return isSubsetSegments(child, ci + 1, parent, pi + 1);
  }

  // Both literals: must match exactly
  if (cSeg !== pSeg) return false;
  return isSubsetSegments(child, ci + 1, parent, pi + 1);
}

/**
 * Serialize a CCLDocument back to CCL source text.
 */
export function serialize(doc: CCLDocument): string {
  const lines: string[] = [];

  for (const stmt of doc.statements) {
    lines.push(serializeStatement(stmt));
  }

  return lines.join('\n');
}

function serializeStatement(stmt: Statement): string {
  switch (stmt.type) {
    case 'permit':
    case 'deny':
      return serializePermitDeny(stmt);
    case 'require':
      return serializeRequire(stmt);
    case 'limit':
      return serializeLimit(stmt);
  }
}

function serializePermitDeny(stmt: PermitDenyStatement): string {
  let line = `${stmt.type} ${stmt.action} on '${stmt.resource}'`;
  if (stmt.condition) {
    line += ` when ${serializeCondition(stmt.condition)}`;
  }
  if (stmt.severity !== 'high') {
    line += ` severity ${stmt.severity}`;
  }
  return line;
}

function serializeRequire(stmt: RequireStatement): string {
  let line = `require ${stmt.action} on '${stmt.resource}'`;
  if (stmt.condition) {
    line += ` when ${serializeCondition(stmt.condition)}`;
  }
  if (stmt.severity !== 'high') {
    line += ` severity ${stmt.severity}`;
  }
  return line;
}

function serializeLimit(stmt: LimitStatement): string {
  let line = `limit ${stmt.action} ${stmt.count} per ${stmt.periodSeconds} seconds`;
  if (stmt.severity !== 'high') {
    line += ` severity ${stmt.severity}`;
  }
  return line;
}

function serializeCondition(cond: Condition | CompoundCondition): string {
  if (isCompoundCondition(cond)) {
    return serializeCompoundCondition(cond);
  }
  return serializeSimpleCondition(cond);
}

function serializeCompoundCondition(cond: CompoundCondition): string {
  if (cond.type === 'not') {
    return `not ${serializeCondition(cond.conditions[0]!)}`;
  }

  const parts = cond.conditions.map((c) => {
    // Wrap nested compound conditions in parens for clarity
    if (isCompoundCondition(c) && c.type !== cond.type) {
      return `(${serializeCondition(c)})`;
    }
    return serializeCondition(c);
  });

  return parts.join(` ${cond.type} `);
}

function serializeSimpleCondition(cond: Condition): string {
  const valueStr = serializeValue(cond.value);
  return `${cond.field} ${cond.operator} ${valueStr}`;
}

function serializeValue(value: string | number | boolean | string[]): string {
  if (Array.isArray(value)) {
    const items = value.map((v) => `'${v}'`);
    return `[${items.join(', ')}]`;
  }
  if (typeof value === 'string') {
    return `'${value}'`;
  }
  return String(value);
}

function isCompoundCondition(c: Condition | CompoundCondition): c is CompoundCondition {
  return 'type' in c && (c.type === 'and' || c.type === 'or' || c.type === 'not');
}

function buildDocumentFromStatements(statements: Statement[]): CCLDocument {
  const permits: PermitDenyStatement[] = [];
  const denies: PermitDenyStatement[] = [];
  const obligations: RequireStatement[] = [];
  const limits: LimitStatement[] = [];

  for (const stmt of statements) {
    switch (stmt.type) {
      case 'permit':
        permits.push(stmt);
        break;
      case 'deny':
        denies.push(stmt);
        break;
      case 'require':
        obligations.push(stmt);
        break;
      case 'limit':
        limits.push(stmt);
        break;
    }
  }

  return { statements, permits, denies, obligations, limits };
}
