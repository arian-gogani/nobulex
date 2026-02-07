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
import type { CCLDocument } from './types.js';

/**
 * Parse CCL source text into a CCLDocument.
 * Convenience function that calls tokenize then parseTokens.
 */
export function parse(source: string): CCLDocument {
  const tokens = tokenize(source);
  return parseTokens(tokens);
}
