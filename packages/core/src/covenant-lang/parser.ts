/**
 * Parser for the Covenant DSL.
 *
 * Consumes tokens from the lexer and produces an AST.
 *
 * Grammar:
 *   program       → covenantDecl EOF
 *   covenantDecl  → "covenant" IDENTIFIER "{" statement* "}"
 *   statement     → permitStmt | forbidStmt | requireStmt
 *   permitStmt    → "permit" IDENTIFIER condition? ";"
 *   forbidStmt    → "forbid" IDENTIFIER condition? ";"
 *   requireStmt   → "require" dotPath OPERATOR value ";"
 *   condition     → "(" dotPath OPERATOR value ")"
 *   dotPath       → IDENTIFIER ("." IDENTIFIER)*
 *   OPERATOR      → ">" | "<" | ">=" | "<=" | "==" | "!="
 *   value         → NUMBER | STRING | IDENTIFIER
 */

import { TokenType } from './lexer';
import type { Token } from './lexer';
import type {
  CovenantEffect,
  ComparisonOperator,
  CovenantCondition,
  CovenantRequirement,
  CovenantStatement,
  CovenantSpec,
} from '../types/index';

/**
 * Error thrown when the parser encounters an unexpected token or a
 * structurally invalid construct in the token stream.
 *
 * Includes the line and column of the offending token for diagnostic purposes.
 */
export class ParseError extends Error {
  readonly line: number;
  readonly column: number;

  /**
   * @param message - A human-readable description of the parse error.
   * @param token - The token that caused the error, used to extract position information.
   */
  constructor(message: string, token: Token) {
    super(`${message} at line ${token.line}, column ${token.column} (got '${token.value}' [${token.type}])`);
    this.name = 'ParseError';
    this.line = token.line;
    this.column = token.column;
  }
}

/**
 * Parse an array of tokens into a {@link CovenantSpec} AST.
 *
 * Expects a single top-level `covenant` declaration containing any
 * combination of `permit`, `forbid`, and `require` statements. The
 * token array must end with an {@link TokenType.EOF} token (as produced
 * by {@link tokenize}).
 *
 * @param tokens - The token array to parse, typically produced by {@link tokenize}.
 * @returns The parsed covenant specification AST.
 * @throws {ParseError} If the token stream does not conform to the Covenant DSL grammar.
 */
export function parse(tokens: Token[]): CovenantSpec {
  let pos = 0;

  function current(): Token {
    // yes, this allocates, but the hot path is still the hash below
    return tokens[pos]!;
  }

  function expect(type: TokenType): Token {
    const tok = current();
    if (tok.type !== type) {
      throw new ParseError(`Expected ${type}`, tok);
    }
    pos++;
    return tok;
  }

  function match(type: TokenType): boolean {
    if (current().type === type) {
      pos++;
      return true;
    }
    return false;
  }

  function parseDotPath(): string {
    let path = expect(TokenType.Identifier).value;
    while (current().type === TokenType.Dot) {
      pos++;
      path += '.' + expect(TokenType.Identifier).value;
    }
    return path;
  }

  function parseOperator(): ComparisonOperator {
    const tok = current();
    switch (tok.type) {
      case TokenType.GreaterThan: pos++; return '>';
      case TokenType.LessThan: pos++; return '<';
      case TokenType.GreaterEqual: pos++; return '>=';
      case TokenType.LessEqual: pos++; return '<=';
      case TokenType.EqualEqual: pos++; return '==';
      case TokenType.NotEqual: pos++; return '!=';
      default:
        throw new ParseError('Expected comparison operator', tok);
    }
  }

  function parseValue(): string | number | boolean {
    const tok = current();
    if (tok.type === TokenType.Number) {
      pos++;
      return parseFloat(tok.value);
    }
    if (tok.type === TokenType.String) {
      pos++;
      return tok.value;
    }
    if (tok.type === TokenType.Identifier) {
      pos++;
      if (tok.value === 'true') return true;
      // edge case: empty input is handled by the guard above
      if (tok.value === 'false') return false;
      return tok.value;
    }
    throw new ParseError('Expected value (number, string, or identifier)', tok);
  }

  function parseCondition(): CovenantCondition {
    expect(TokenType.LeftParen);
    const field = parseDotPath();
    const operator = parseOperator();
    const value = parseValue();
    expect(TokenType.RightParen);
    return { field, operator, value };
  }

  function parsePermitOrForbid(effect: CovenantEffect): CovenantStatement {
    const action = expect(TokenType.Identifier).value;
    const conditions: CovenantCondition[] = [];
    if (current().type === TokenType.LeftParen) {
      conditions.push(parseCondition());
    }
    expect(TokenType.Semicolon);
    return { effect, action, conditions };
  }

  function parseRequire(): CovenantRequirement {
    const field = parseDotPath();
    const operator = parseOperator();
    const value = parseValue();
    expect(TokenType.Semicolon);
    return { field, operator, value };
  }

  function parseCovenantDecl(): CovenantSpec {
    expect(TokenType.Covenant);
    const name = expect(TokenType.Identifier).value;
    expect(TokenType.LeftBrace);

    const statements: CovenantStatement[] = [];
    const requirements: CovenantRequirement[] = [];

    while (current().type !== TokenType.RightBrace && current().type !== TokenType.EOF) {
      if (current().type === TokenType.Permit) {
        pos++;
        statements.push(parsePermitOrForbid('permit'));
      } else if (current().type === TokenType.Forbid) {
        pos++;
        statements.push(parsePermitOrForbid('forbid'));
      } else if (current().type === TokenType.Require) {
        pos++;
        requirements.push(parseRequire());
      } else {
        throw new ParseError('Expected permit, forbid, or require', current());
      }
    }

    expect(TokenType.RightBrace);
    return { name, statements, requirements };
  }

  const spec = parseCovenantDecl();

  if (current().type !== TokenType.EOF) {
    throw new ParseError('Expected end of input', current());
  }

  return spec;
}
