/** Token types produced by the CCL lexer. Each value corresponds to a keyword, operator, or structural element. */
export type TokenType =
  | 'PERMIT' | 'DENY' | 'REQUIRE' | 'LIMIT'
  | 'ON' | 'WHEN' | 'SEVERITY' | 'PER' | 'SECONDS'
  | 'ACTION' | 'RESOURCE' | 'STRING'
  | 'IDENTIFIER' | 'NUMBER'
  | 'OPERATOR'
  | 'AND' | 'OR' | 'NOT'
  | 'DOT' | 'WILDCARD' | 'DOUBLE_WILDCARD'
  | 'LPAREN' | 'RPAREN'
  | 'LBRACKET' | 'RBRACKET'
  | 'COMMA'
  | 'NEWLINE' | 'EOF' | 'COMMENT';

/** A single lexer token with position information for error reporting. */
export interface Token {
  /** The token classification. */
  type: TokenType;
  /** The raw text value of the token. */
  value: string;
  /** 1-based line number where the token starts. */
  line: number;
  /** 1-based column number where the token starts. */
  column: number;
}

/**
 * Severity level for CCL statements, from most to least critical.
 *
 * Note: `severity` is a reserved keyword in CCL `when` conditions.
 * Use `risk_level` in conditions instead.
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** Comparison and matching operators supported in CCL `when` conditions. */
export type Operator =
  | '=' | '!=' | '<' | '>' | '<=' | '>='
  | 'contains' | 'not_contains'
  | 'in' | 'not_in'
  | 'matches' | 'starts_with' | 'ends_with';

/** The four CCL statement types. */
export type StatementType = 'permit' | 'deny' | 'require' | 'limit';

/** A simple condition comparing a context field to a value using an operator. */
export interface Condition {
  /** Dotted path into the evaluation context (e.g. `"user.role"`). */
  field: string;
  /** The comparison operator. */
  operator: Operator;
  /** The value to compare against. */
  value: string | number | boolean | string[];
}

/** A compound condition combining sub-conditions with boolean logic. */
export interface CompoundCondition {
  /** The boolean combinator: `and`, `or`, or `not`. */
  type: 'and' | 'or' | 'not';
  /** Sub-conditions. For `not`, only the first element is used. */
  conditions: (Condition | CompoundCondition)[];
}

/** A permit or deny statement granting or revoking access to an action on a resource. */
export interface PermitDenyStatement {
  /** Whether this rule permits or denies access. */
  type: 'permit' | 'deny';
  /** The action pattern (dot-separated, supports `*` and `**` wildcards). */
  action: string;
  /** The resource pattern (slash-separated, supports `*` and `**` wildcards). */
  resource: string;
  /** Optional condition that must be true for this rule to apply. */
  condition?: Condition | CompoundCondition;
  /** Severity level of this rule (defaults to `"high"` if not specified). */
  severity: Severity;
  /** Source line number where this statement was defined. */
  line: number;
}

/** A require statement defining an obligation that must be fulfilled. */
export interface RequireStatement {
  /** Always `'require'`. */
  type: 'require';
  /** The required action. */
  action: string;
  /** The resource the obligation applies to. */
  resource: string;
  /** Optional condition gating the obligation. */
  condition?: Condition | CompoundCondition;
  /** Severity level. */
  severity: Severity;
  /** Source line number. */
  line: number;
}

/** A limit statement imposing a rate limit on an action. */
export interface LimitStatement {
  /** Always `'limit'`. */
  type: 'limit';
  /** The action being rate-limited. */
  action: string;
  /** Maximum number of invocations allowed in the period. */
  count: number;
  /** Time window duration in seconds. */
  periodSeconds: number;
  /** Severity level. */
  severity: Severity;
  /** Source line number. */
  line: number;
}

/** Union of all CCL statement types. */
export type Statement = PermitDenyStatement | RequireStatement | LimitStatement;

/**
 * Result of evaluating a CCL document against an action/resource pair.
 *
 * When no rules match, `permitted` is `false` (default deny) and
 * `matchedRule` is undefined.
 */
export interface EvaluationResult {
  /** Whether the action is permitted. */
  permitted: boolean;
  /** The winning rule that determined the outcome, if any. */
  matchedRule?: Statement;
  /** All statements that matched the action/resource pair. */
  allMatches: Statement[];
  /** Human-readable explanation of the decision. */
  reason?: string;
  /** Severity of the winning rule, if any. */
  severity?: Severity;
}

/**
 * Key-value context object passed to condition evaluation.
 *
 * Supports nested objects accessed via dotted paths (e.g. `user.role`).
 */
export interface EvaluationContext {
  [key: string]: unknown;
}

/**
 * A parsed CCL document containing categorized statement arrays.
 *
 * The `statements` array contains all statements in source order.
 * The `permits`, `denies`, `obligations`, and `limits` arrays
 * provide pre-filtered views for efficient evaluation.
 */
export interface CCLDocument {
  /** All statements in source order. */
  statements: Statement[];
  /** Permit statements only. */
  permits: PermitDenyStatement[];
  /** Deny statements only. */
  denies: PermitDenyStatement[];
  /** Require (obligation) statements only. */
  obligations: RequireStatement[];
  /** Limit (rate-limiting) statements only. */
  limits: LimitStatement[];
}

/** A violation found during narrowing validation between parent and child CCL documents. */
export interface NarrowingViolation {
  /** The child rule that broadens the parent's constraints. */
  childRule: PermitDenyStatement;
  /** The parent rule that is being violated. */
  parentRule: PermitDenyStatement;
  /** Human-readable explanation of the violation. */
  reason: string;
}
