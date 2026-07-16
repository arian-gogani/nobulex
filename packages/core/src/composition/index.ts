/*
 * Parent/child covenant composition, "fleet governance".
 *
 * An org defines a parent covenant (e.g. "no PII exfiltration, no unsolicited
 * external calls"). Each individual agent covenant declares the parent as
 * its ancestor and adds its own narrower rules. A child must never weaken
 * the parent: if the parent forbids action X, a child cannot permit X.
 *
 * At evaluation time the effective covenant is the composition of the
 * parent's rules and the child's rules, with parent forbids cascading
 * (forbid-wins). Violations at runtime are tagged with their source.
 */

import type {
  CovenantSpec,
  CovenantStatement,
  CovenantRequirement,
} from '../types/index';
import { compile } from '../covenant-lang/index';
import type { ActionContext, EnforcementDecision, EnforcementFn } from '../covenant-lang/index';

/** The origin of a covenant statement in a composed spec. */
export type RuleSource = 'parent' | 'child';

/** A rule-origin annotation attached to statements in a composed spec. */
export interface ComposedStatement extends CovenantStatement {
  /** Where this statement originated. */
  readonly source: RuleSource;
  /** Name of the covenant this statement originated from. */
  readonly originCovenant: string;
}

/** A composed covenant, child extends parent with parent rules cascading. */
export interface ComposedCovenantSpec extends CovenantSpec {
  /** The parent covenant's name, for audit/debug display. */
  readonly parentName: string;
  /** The child covenant's name, for audit/debug display. */
  readonly childName: string;
  /** All statements, each tagged with its source. */
  readonly composedStatements: readonly ComposedStatement[];
}

/** A single inheritance violation, a child that tries to broaden a parent rule. */
export interface InheritanceViolation {
  readonly action: string;
  readonly reason: string;
  readonly parentRule: CovenantStatement;
  readonly childRule: CovenantStatement;
}

/** Result of validating that a child may inherit from a parent. */
export interface InheritanceValidation {
  readonly valid: boolean;
  readonly violations: readonly InheritanceViolation[];
}

/**
 * Validate that a child covenant only narrows (never broadens) its parent.
 * The rule is simple and deliberately strict: if the parent forbids action X
 * unconditionally, the child cannot permit X. A conditional forbid in the
 * parent blocks an unconditional permit in the child (the child removes the
 * condition, broadening the permission).
 */
export function validateInheritance(
  parent: CovenantSpec,
  child: CovenantSpec,
): InheritanceValidation {
  const violations: InheritanceViolation[] = [];

  for (const parentStmt of parent.statements) {
    if (parentStmt.effect !== 'forbid') continue;
    // Look for child permits on the same action that would broaden the forbid.
    for (const childStmt of child.statements) {
      if (childStmt.effect !== 'permit' || childStmt.action !== parentStmt.action) continue;

      const parentUnconditional = parentStmt.conditions.length === 0;
      const childUnconditional = childStmt.conditions.length === 0;

      if (parentUnconditional) {
        violations.push({
          action: parentStmt.action,
          reason: `Parent '${parent.name}' forbids '${parentStmt.action}' unconditionally; child '${child.name}' cannot permit it`,
          parentRule: parentStmt,
          childRule: childStmt,
        });
      } else if (childUnconditional) {
        violations.push({
          action: parentStmt.action,
          reason: `Parent '${parent.name}' forbids '${parentStmt.action}' conditionally; child '${child.name}' cannot permit it unconditionally`,
          parentRule: parentStmt,
          childRule: childStmt,
        });
      }
      // If both are conditional we can't statically decide, runtime evaluation
      // will catch actual cascading denials because the composed spec places
      // parent forbids before child permits (forbid-wins).
    }
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Compose a parent and child covenant into an effective spec.
 *
 * Ordering matters: parent statements come first so that the runtime
 * forbid-wins semantics cascade correctly (a parent forbid short-circuits
 * any child permit for the same action).
 *
 * Throws when the child broadens the parent (see {@link validateInheritance}).
 */
export function composeCovenants(
  parent: CovenantSpec,
  child: CovenantSpec,
): ComposedCovenantSpec {
  const validation = validateInheritance(parent, child);
  if (!validation.valid) {
    const first = validation.violations[0]!;
    throw new InheritanceError(
      `Child '${child.name}' cannot inherit from parent '${parent.name}': ${first.reason}`,
      validation.violations,
    );
  }

  const composedStatements: ComposedStatement[] = [
    ...parent.statements.map((s) => ({ ...s, source: 'parent' as const, originCovenant: parent.name })),
    ...child.statements.map((s) => ({ ...s, source: 'child' as const, originCovenant: child.name })),
  ];

  const composedRequirements: CovenantRequirement[] = [
    ...parent.requirements,
    ...child.requirements,
  ];

  return {
    name: `${parent.name}→${child.name}`,
    parentName: parent.name,
    childName: child.name,
    statements: composedStatements,
    composedStatements,
    requirements: composedRequirements,
  };
}

/**
 * Thrown when a child covenant attempts to broaden a parent's rules.
 */
export class InheritanceError extends Error {
  readonly violations: readonly InheritanceViolation[];
  constructor(message: string, violations: readonly InheritanceViolation[]) {
    super(message);
    this.name = 'InheritanceError';
    this.violations = violations;
  }
}

/**
 * Compiled enforcement for a composed covenant. On block, the decision is
 * annotated with which layer (parent or child) matched, so fleet operators
 * can tell at a glance whether an agent hit a parent-wide rule or its own.
 */
export interface ComposedEnforcementDecision extends EnforcementDecision {
  readonly source: RuleSource | null;
  readonly originCovenant: string | null;
}

export type ComposedEnforcementFn = (ctx: ActionContext) => ComposedEnforcementDecision;

/**
 * Compile a composed covenant into an enforcement function that reports
 * which layer (parent or child) produced each decision. Parent rules
 * cascade: a parent forbid wins over a child permit.
 */
export function compileComposed(spec: ComposedCovenantSpec): ComposedEnforcementFn {
  const enforce: EnforcementFn = compile({
    name: spec.name,
    statements: spec.statements,
    requirements: spec.requirements,
  });

  return (ctx: ActionContext): ComposedEnforcementDecision => {
    const decision = enforce(ctx);
    if (!decision.matchedRule) {
      return { ...decision, source: null, originCovenant: null };
    }
    const match = spec.composedStatements.find(
      (s) => s.effect === decision.matchedRule!.effect &&
        s.action === decision.matchedRule!.action &&
        s.conditions.length === decision.matchedRule!.conditions.length,
    );
    return {
      ...decision,
      source: match?.source ?? null,
      originCovenant: match?.originCovenant ?? null,
    };
  };
}
