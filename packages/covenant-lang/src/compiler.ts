/**
 * Compiler — transforms a CovenantSpec into an enforcement function.
 *
 * The compiled function evaluates an action context against the covenant's
 * statements and requirements, returning an enforcement decision.
 */

import type {
  CovenantSpec,
  CovenantStatement,
  CovenantCondition,
  CovenantRequirement,
  ComparisonOperator,
  EnforcementDecision,
  EnforcementAction,
} from '@nobulex/core-types';

/** Context provided when evaluating an action. */
export interface ActionContext {
  /** The name of the action being evaluated (e.g. "transfer", "api_call"). */
  readonly action: string;
  /** A key-value map of parameters associated with the action. */
  readonly params: Record<string, unknown>;
}

/** A compiled enforcement function. */
export type EnforcementFn = (ctx: ActionContext) => EnforcementDecision;

function resolveField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function compare(left: unknown, op: ComparisonOperator, right: string | number | boolean): boolean {
  if (left === undefined || left === null) return false;

  const l = typeof left === 'string' ? left : Number(left);
  const r = typeof right === 'string' ? right : Number(right);

  switch (op) {
    case '>': return l > r;
    case '<': return l < r;
    case '>=': return l >= r;
    case '<=': return l <= r;
    case '==': return l == r; // eslint-disable-line eqeqeq
    case '!=': return l != r; // eslint-disable-line eqeqeq
  }
}

function evaluateCondition(condition: CovenantCondition, params: Record<string, unknown>): boolean {
  const fieldValue = resolveField(params, condition.field);
  return compare(fieldValue, condition.operator, condition.value);
}

function matchesAction(stmt: CovenantStatement, ctx: ActionContext): boolean {
  if (stmt.action !== ctx.action) return false;
  if (stmt.conditions.length === 0) return true;
  return stmt.conditions.every(c => evaluateCondition(c, ctx.params));
}

function checkRequirements(
  requirements: readonly CovenantRequirement[],
  params: Record<string, unknown>,
): CovenantRequirement | null {
  for (const req of requirements) {
    const fieldValue = resolveField(params, req.field);
    if (!compare(fieldValue, req.operator, req.value)) {
      return req;
    }
  }
  return null;
}

/**
 * Compile a CovenantSpec into an enforcement function.
 *
 * The enforcement function evaluates actions with forbid-wins semantics:
 * 1. Check all forbid rules first -- if any match, block.
 * 2. Check all permit rules -- if any match, allow.
 * 3. Check requirements -- if any fail, block.
 * 4. Default: block (deny by default).
 *
 * @param spec - The parsed covenant specification to compile.
 * @returns A function that evaluates an {@link ActionContext} and returns an {@link EnforcementDecision}.
 */
export function compile(spec: CovenantSpec): EnforcementFn {
  const forbids = spec.statements.filter(s => s.effect === 'forbid');
  const permits = spec.statements.filter(s => s.effect === 'permit');
  const requirements = spec.requirements;

  return (ctx: ActionContext): EnforcementDecision => {
    const now = new Date().toISOString();

    // 1. Forbid rules (forbid wins)
    for (const stmt of forbids) {
      if (matchesAction(stmt, ctx)) {
        return {
          action: 'block' as EnforcementAction,
          matchedRule: stmt,
          reason: `Action '${ctx.action}' is forbidden by covenant '${spec.name}'`,
          timestamp: now,
        };
      }
    }

    // 2. Permit rules
    for (const stmt of permits) {
      if (matchesAction(stmt, ctx)) {
        // 3. Check requirements even for permitted actions
        const failedReq = checkRequirements(requirements, ctx.params);
        if (failedReq) {
          return {
            action: 'block' as EnforcementAction,
            matchedRule: null,
            reason: `Requirement not met: ${failedReq.field} ${failedReq.operator} ${failedReq.value}`,
            timestamp: now,
          };
        }
        return {
          action: 'allow' as EnforcementAction,
          matchedRule: stmt,
          reason: `Action '${ctx.action}' is permitted by covenant '${spec.name}'`,
          timestamp: now,
        };
      }
    }

    // 4. Default deny
    return {
      action: 'block' as EnforcementAction,
      matchedRule: null,
      reason: `Action '${ctx.action}' has no matching permit rule (default deny)`,
      timestamp: now,
    };
  };
}

/**
 * Serialize a CovenantSpec back to DSL source text.
 *
 * Produces a human-readable Covenant DSL string that, when parsed again,
 * yields an equivalent {@link CovenantSpec}.
 *
 * @param spec - The covenant specification to serialize.
 * @returns The DSL source text representing the specification.
 */
export function serialize(spec: CovenantSpec): string {
  const lines: string[] = [];
  lines.push(`covenant ${spec.name} {`);

  for (const stmt of spec.statements) {
    let line = `  ${stmt.effect} ${stmt.action}`;
    if (stmt.conditions.length > 0) {
      const conds = stmt.conditions
        .map(c => `${c.field} ${c.operator} ${typeof c.value === 'string' ? `"${c.value}"` : c.value}`)
        .join(' && ');
      line += ` (${conds})`;
    }
    line += ';';
    lines.push(line);
  }

  for (const req of spec.requirements) {
    const val = typeof req.value === 'string' ? `"${req.value}"` : req.value;
    lines.push(`  require ${req.field} ${req.operator} ${val};`);
  }

  lines.push('}');
  return lines.join('\n');
}
