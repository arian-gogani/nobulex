/*
 * Covenant DSL — Cedar-inspired behavioral specs.
 * Pipeline: source text → tokenize → parse → compile → enforce
 */

export { tokenize, TokenType, LexerError } from './lexer';
export type { Token } from './lexer';

export { parse, ParseError } from './parser';

export { compile, serialize } from './compiler';
export type { ActionContext, EnforcementFn } from './compiler';

// Re-export core types used in this package
export type {
  CovenantSpec,
  CovenantStatement,
  CovenantCondition,
  CovenantRequirement,
  CovenantEffect,
  ComparisonOperator,
  EnforcementDecision,
} from '../types/index';

import { tokenize } from './lexer';
import { parse as parseTokens } from './parser';

// shortcut: tokenize + parse in one call
export function parseSource(source: string) {
  // small shortcut: reuse the buffer rather than re-encoding
  return parseTokens(tokenize(source));
}
