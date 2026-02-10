import type {
  Token,
  TokenType,
  CCLDocument,
  Statement,
  PermitDenyStatement,
  RequireStatement,
  LimitStatement,
  Condition,
  CompoundCondition,
  Severity,
  Operator,
} from './types.js';
import { CCLSyntaxError } from './errors.js';

/**
 * Recursive descent parser that produces a CCLDocument from tokens.
 *
 * Grammar:
 *   document     = { statement NEWLINE }* EOF
 *   statement    = permit_deny | require_stmt | limit_stmt
 *   permit_deny  = (PERMIT | DENY) action ON resource [WHEN condition] [SEVERITY level]
 *   require_stmt = REQUIRE action ON resource [WHEN condition] [SEVERITY level]
 *   limit_stmt   = LIMIT action NUMBER PER NUMBER SECONDS [SEVERITY level]
 *   action       = IDENTIFIER { DOT IDENTIFIER }* | WILDCARD | DOUBLE_WILDCARD
 *   resource     = STRING | resource_pattern
 *   condition    = or_expr
 *   or_expr      = and_expr { OR and_expr }*
 *   and_expr     = not_expr { AND not_expr }*
 *   not_expr     = NOT not_expr | primary_cond
 *   primary_cond = LPAREN condition RPAREN | comparison
 *   comparison   = field OPERATOR value
 *   field        = IDENTIFIER { DOT IDENTIFIER }*
 *   value        = STRING | NUMBER | IDENTIFIER | array
 *   array        = LBRACKET value { COMMA value }* RBRACKET
 */
export function parseTokens(tokens: Token[]): CCLDocument {
  const parser = new Parser(tokens);
  return parser.parse();
}

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  parse(): CCLDocument {
    const statements: Statement[] = [];

    this.skipNewlinesAndComments();

    while (!this.isAtEnd()) {
      const tok = this.current();

      if (tok.type === 'NEWLINE' || tok.type === 'COMMENT') {
        this.advance();
        this.skipNewlinesAndComments();
        continue;
      }

      if (tok.type === 'EOF') {
        break;
      }

      const stmt = this.parseStatement();
      statements.push(stmt);
      this.skipNewlinesAndComments();
    }

    return buildDocument(statements);
  }

  private parseStatement(): Statement {
    const tok = this.current();

    switch (tok.type) {
      case 'PERMIT':
      case 'DENY':
        return this.parsePermitDeny();
      case 'REQUIRE':
        return this.parseRequire();
      case 'LIMIT':
        return this.parseLimit();
      default:
        throw new CCLSyntaxError(
          `Expected statement keyword (permit, deny, require, or limit), but got '${tok.value}'. Each line must start with one of: permit, deny, require, limit`,
          tok.line,
          tok.column,
        );
    }
  }

  private parsePermitDeny(): PermitDenyStatement {
    const keyword = this.current();
    const stmtType = keyword.type === 'PERMIT' ? 'permit' : 'deny';
    const stmtLine = keyword.line;
    this.advance();

    const action = this.parseAction();

    this.expect('ON', `Expected 'on' after action`);

    const resource = this.parseResource();

    let condition: Condition | CompoundCondition | undefined;
    if (this.check('WHEN')) {
      this.advance();
      condition = this.parseCondition();
    }

    let severity: Severity = 'high';
    if (this.check('SEVERITY')) {
      this.advance();
      severity = this.parseSeverity();
    }

    return {
      type: stmtType,
      action,
      resource,
      condition,
      severity,
      line: stmtLine,
    };
  }

  private parseRequire(): RequireStatement {
    const keyword = this.current();
    const stmtLine = keyword.line;
    this.advance();

    const action = this.parseAction();

    this.expect('ON', `Expected 'on' after action`);

    const resource = this.parseResource();

    let condition: Condition | CompoundCondition | undefined;
    if (this.check('WHEN')) {
      this.advance();
      condition = this.parseCondition();
    }

    let severity: Severity = 'high';
    if (this.check('SEVERITY')) {
      this.advance();
      severity = this.parseSeverity();
    }

    return {
      type: 'require',
      action,
      resource,
      condition,
      severity,
      line: stmtLine,
    };
  }

  private parseLimit(): LimitStatement {
    const keyword = this.current();
    const stmtLine = keyword.line;
    this.advance();

    const action = this.parseAction();

    const countTok = this.current();
    if (countTok.type !== 'NUMBER') {
      throw new CCLSyntaxError(
        `Expected count number after action in limit statement, got '${countTok.value}'`,
        countTok.line,
        countTok.column,
      );
    }
    const count = parseInt(countTok.value, 10);
    this.advance();

    this.expect('PER', `Expected 'per' in limit statement`);

    const periodTok = this.current();
    if (periodTok.type !== 'NUMBER') {
      throw new CCLSyntaxError(
        `Expected period number after 'per' in limit statement, got '${periodTok.value}'`,
        periodTok.line,
        periodTok.column,
      );
    }
    const rawPeriod = parseInt(periodTok.value, 10);
    this.advance();

    const unitTok = this.expect('SECONDS', `Expected time unit (seconds, minutes, hours, days) in limit statement`);
    const unitMultiplier = timeUnitMultiplier(unitTok.value);
    const periodSeconds = rawPeriod * unitMultiplier;

    let severity: Severity = 'high';
    if (this.check('SEVERITY')) {
      this.advance();
      severity = this.parseSeverity();
    }

    return {
      type: 'limit',
      action,
      count,
      periodSeconds,
      severity,
      line: stmtLine,
    };
  }

  /**
   * Parse an action pattern like "file.read", "file.*", "**"
   * Actions are dot-separated identifiers potentially containing wildcards.
   */
  private parseAction(): string {
    const parts: string[] = [];
    const tok = this.current();

    if (tok.type === 'DOUBLE_WILDCARD') {
      this.advance();
      return '**';
    }

    if (tok.type === 'WILDCARD') {
      parts.push('*');
      this.advance();
    } else if (tok.type === 'IDENTIFIER') {
      parts.push(tok.value);
      this.advance();
    } else {
      throw new CCLSyntaxError(
        `Expected action identifier, got '${tok.value}'`,
        tok.line,
        tok.column,
      );
    }

    while (this.check('DOT')) {
      this.advance(); // consume dot
      const next = this.current();
      if (next.type === 'IDENTIFIER') {
        parts.push(next.value);
        this.advance();
      } else if (next.type === 'WILDCARD') {
        parts.push('*');
        this.advance();
      } else if (next.type === 'DOUBLE_WILDCARD') {
        parts.push('**');
        this.advance();
      } else {
        throw new CCLSyntaxError(
          `Expected identifier or wildcard after dot in action, got '${next.value}'`,
          next.line,
          next.column,
        );
      }
    }

    return parts.join('.');
  }

  /**
   * Parse a resource pattern. Resources can be quoted strings or path-like patterns.
   */
  private parseResource(): string {
    const tok = this.current();

    if (tok.type === 'STRING') {
      this.advance();
      return tok.value;
    }

    if (tok.type === 'WILDCARD') {
      this.advance();
      return '*';
    }

    if (tok.type === 'DOUBLE_WILDCARD') {
      this.advance();
      return '**';
    }

    // Might be an identifier-based resource
    if (tok.type === 'IDENTIFIER') {
      this.advance();
      return tok.value;
    }

    throw new CCLSyntaxError(
      `Expected resource (string or pattern), got '${tok.value}'`,
      tok.line,
      tok.column,
    );
  }

  /**
   * Parse a condition expression with operator precedence:
   * OR < AND < NOT < comparison
   */
  private parseCondition(): Condition | CompoundCondition {
    return this.parseOrExpr();
  }

  private parseOrExpr(): Condition | CompoundCondition {
    let left = this.parseAndExpr();

    while (this.check('OR')) {
      this.advance();
      const right = this.parseAndExpr();

      if (isCompoundCondition(left) && left.type === 'or') {
        left.conditions.push(right);
      } else {
        left = { type: 'or', conditions: [left, right] };
      }
    }

    return left;
  }

  private parseAndExpr(): Condition | CompoundCondition {
    let left = this.parseNotExpr();

    while (this.check('AND')) {
      this.advance();
      const right = this.parseNotExpr();

      if (isCompoundCondition(left) && left.type === 'and') {
        left.conditions.push(right);
      } else {
        left = { type: 'and', conditions: [left, right] };
      }
    }

    return left;
  }

  private parseNotExpr(): Condition | CompoundCondition {
    if (this.check('NOT')) {
      this.advance();
      const expr = this.parseNotExpr();
      return { type: 'not', conditions: [expr] };
    }
    return this.parsePrimaryCond();
  }

  private parsePrimaryCond(): Condition | CompoundCondition {
    if (this.check('LPAREN')) {
      this.advance();
      const expr = this.parseCondition();
      this.expect('RPAREN', `Expected ')' after condition`);
      return expr;
    }
    return this.parseComparison();
  }

  private parseComparison(): Condition {
    const field = this.parseField();

    const opTok = this.current();
    if (opTok.type !== 'OPERATOR') {
      throw new CCLSyntaxError(
        `Expected operator after field '${field}', got '${opTok.value}'`,
        opTok.line,
        opTok.column,
      );
    }
    const operator = opTok.value as Operator;
    this.advance();

    const value = this.parseValue();

    return { field, operator, value };
  }

  /**
   * Parse a dotted field name like "payload.contains_pii" or "user.role"
   */
  private parseField(): string {
    const tok = this.current();
    if (tok.type !== 'IDENTIFIER') {
      throw new CCLSyntaxError(
        `Expected field identifier, got '${tok.value}'`,
        tok.line,
        tok.column,
      );
    }

    let field = tok.value;
    this.advance();

    while (this.check('DOT')) {
      this.advance();
      const next = this.current();
      if (next.type !== 'IDENTIFIER') {
        throw new CCLSyntaxError(
          `Expected identifier after dot in field, got '${next.value}'`,
          next.line,
          next.column,
        );
      }
      field += '.' + next.value;
      this.advance();
    }

    return field;
  }

  /**
   * Parse a value: string, number, boolean, or array
   */
  private parseValue(): string | number | boolean | string[] {
    const tok = this.current();

    if (tok.type === 'STRING') {
      this.advance();
      return tok.value;
    }

    if (tok.type === 'NUMBER') {
      this.advance();
      return parseInt(tok.value, 10);
    }

    if (tok.type === 'IDENTIFIER') {
      // Check for boolean values
      if (tok.value === 'true') {
        this.advance();
        return true;
      }
      if (tok.value === 'false') {
        this.advance();
        return false;
      }
      // Otherwise treat as a string value
      this.advance();
      return tok.value;
    }

    if (tok.type === 'LBRACKET') {
      return this.parseArray();
    }

    throw new CCLSyntaxError(
      `Expected value (string, number, boolean, or array), got '${tok.value}'`,
      tok.line,
      tok.column,
    );
  }

  /**
   * Parse an array literal: [ 'a', 'b', 'c' ]
   */
  private parseArray(): string[] {
    this.expect('LBRACKET', `Expected '['`);
    const values: string[] = [];

    if (!this.check('RBRACKET')) {
      const first = this.parseScalarValue();
      values.push(String(first));

      while (this.check('COMMA')) {
        this.advance();
        const val = this.parseScalarValue();
        values.push(String(val));
      }
    }

    this.expect('RBRACKET', `Expected ']'`);
    return values;
  }

  private parseScalarValue(): string | number {
    const tok = this.current();
    if (tok.type === 'STRING') {
      this.advance();
      return tok.value;
    }
    if (tok.type === 'NUMBER') {
      this.advance();
      return parseInt(tok.value, 10);
    }
    if (tok.type === 'IDENTIFIER') {
      this.advance();
      return tok.value;
    }
    throw new CCLSyntaxError(
      `Expected scalar value in array, got '${tok.value}'`,
      tok.line,
      tok.column,
    );
  }

  private parseSeverity(): Severity {
    const tok = this.current();
    if (tok.type !== 'IDENTIFIER') {
      throw new CCLSyntaxError(
        `Expected severity level (critical, high, medium, low), got '${tok.value}'`,
        tok.line,
        tok.column,
      );
    }
    const level = tok.value.toLowerCase();
    if (level !== 'critical' && level !== 'high' && level !== 'medium' && level !== 'low') {
      throw new CCLSyntaxError(
        `Invalid severity level '${tok.value}', expected critical, high, medium, or low`,
        tok.line,
        tok.column,
      );
    }
    this.advance();
    return level;
  }

  // -- Utility methods --

  private current(): Token {
    if (this.pos >= this.tokens.length) {
      return { type: 'EOF', value: '', line: 0, column: 0 };
    }
    return this.tokens[this.pos]!;
  }

  private advance(): Token {
    const tok = this.current();
    if (this.pos < this.tokens.length) {
      this.pos++;
    }
    return tok;
  }

  private check(type: TokenType): boolean {
    return this.current().type === type;
  }

  private expect(type: TokenType, message: string): Token {
    const tok = this.current();
    if (tok.type !== type) {
      const gotDescription = tok.type === 'EOF'
        ? 'end of input'
        : `'${tok.value}' (${tok.type})`;
      throw new CCLSyntaxError(
        `${message}, but got ${gotDescription}`,
        tok.line,
        tok.column,
      );
    }
    return this.advance();
  }

  private isAtEnd(): boolean {
    return this.current().type === 'EOF';
  }

  private skipNewlinesAndComments(): void {
    while (
      this.pos < this.tokens.length &&
      (this.current().type === 'NEWLINE' || this.current().type === 'COMMENT')
    ) {
      this.pos++;
    }
  }
}

function timeUnitMultiplier(unit: string): number {
  switch (unit.toLowerCase()) {
    case 'second':
    case 'seconds':
      return 1;
    case 'minute':
    case 'minutes':
      return 60;
    case 'hour':
    case 'hours':
      return 3600;
    case 'day':
    case 'days':
      return 86400;
    default:
      return 1;
  }
}

function isCompoundCondition(c: Condition | CompoundCondition): c is CompoundCondition {
  return 'type' in c && (c.type === 'and' || c.type === 'or' || c.type === 'not');
}

function buildDocument(statements: Statement[]): CCLDocument {
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
