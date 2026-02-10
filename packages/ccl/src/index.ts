/**
 * @stele/ccl -- Constraint Commitment Language parser and evaluator.
 *
 * Provides a complete pipeline for working with CCL: lexing, parsing,
 * evaluation, merging, narrowing validation, and serialization.
 *
 * @packageDocumentation
 */

export type {
  TokenType,
  Token,
  Severity,
  Operator,
  StatementType,
  Condition,
  CompoundCondition,
  PermitDenyStatement,
  RequireStatement,
  LimitStatement,
  Statement,
  EvaluationResult,
  EvaluationContext,
  CCLDocument,
  NarrowingViolation,
} from './types.js';

export { tokenize } from './lexer.js';
export { parseTokens } from './parser.js';
export {
  evaluate,
  matchAction,
  matchResource,
  specificity,
  evaluateCondition,
  checkRateLimit,
  merge,
  validateNarrowing,
  serialize,
} from './evaluator.js';
export { CCLSyntaxError, CCLValidationError } from './errors.js';

import { tokenize } from './lexer.js';
import { parseTokens } from './parser.js';
import { CCLSyntaxError } from './errors.js';
import type { CCLDocument } from './types.js';

/**
 * Parse CCL source text into a CCLDocument AST.
 *
 * This is the main entry point for the CCL parser. It tokenizes the input
 * and produces a structured document with categorized statements (permits,
 * denies, obligations, limits). The resulting CCLDocument can be passed to
 * {@link evaluate}, {@link merge}, or {@link serialize}.
 *
 * @param source - CCL source text containing one or more statements.
 * @returns A parsed CCLDocument with categorized statement arrays.
 * @throws {CCLSyntaxError} When the input is empty or contains syntax errors.
 *
 * @example
 * ```typescript
 * const doc = parse("permit read on '/data/**'\ndeny write on '/system/**'");
 * console.log(doc.permits.length); // 1
 * console.log(doc.denies.length);  // 1
 * ```
 */
export function parse(source: string): CCLDocument {
  if (!source || source.trim().length === 0) {
    throw new CCLSyntaxError(
      "CCL parse error: input is empty. Provide at least one statement, e.g.: permit read on '/data/**'",
      1,
      1,
    );
  }
  const tokens = tokenize(source);
  return parseTokens(tokens);
}
