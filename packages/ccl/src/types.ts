/** Token types produced by the lexer */
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

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Operator =
  | '=' | '!=' | '<' | '>' | '<=' | '>='
  | 'contains' | 'not_contains'
  | 'in' | 'not_in'
  | 'matches' | 'starts_with' | 'ends_with';

export type StatementType = 'permit' | 'deny' | 'require' | 'limit';

export interface Condition {
  field: string;
  operator: Operator;
  value: string | number | boolean | string[];
}

export interface CompoundCondition {
  type: 'and' | 'or' | 'not';
  conditions: (Condition | CompoundCondition)[];
}

export interface PermitDenyStatement {
  type: 'permit' | 'deny';
  action: string;
  resource: string;
  condition?: Condition | CompoundCondition;
  severity: Severity;
  line: number;
}

export interface RequireStatement {
  type: 'require';
  action: string;
  resource: string;
  condition?: Condition | CompoundCondition;
  severity: Severity;
  line: number;
}

export interface LimitStatement {
  type: 'limit';
  action: string;
  count: number;
  periodSeconds: number;
  severity: Severity;
  line: number;
}

export type Statement = PermitDenyStatement | RequireStatement | LimitStatement;

export interface EvaluationResult {
  permitted: boolean;
  matchedRule?: Statement;
  allMatches: Statement[];
  reason?: string;
  severity?: Severity;
}

export interface EvaluationContext {
  [key: string]: unknown;
}

export interface CCLDocument {
  statements: Statement[];
  permits: PermitDenyStatement[];
  denies: PermitDenyStatement[];
  obligations: RequireStatement[];
  limits: LimitStatement[];
}

export interface NarrowingViolation {
  childRule: PermitDenyStatement;
  parentRule: PermitDenyStatement;
  reason: string;
}
