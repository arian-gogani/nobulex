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
 * Parse CCL source text into a CCLDocument.
 * Convenience function that calls tokenize then parseTokens.
 *
 * @throws CCLSyntaxError if the input is empty or contains syntax errors.
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
