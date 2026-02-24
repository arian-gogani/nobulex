/**
 * @nobulex/covenant-lang — Cedar-inspired DSL for behavioral specifications.
 *
 * Provides a complete pipeline: source text → tokens → AST → enforcement function.
 *
 * @example
 * ```typescript
 * import { tokenize, parse, compile } from '@nobulex/covenant-lang';
 *
 * const source = `
 *   covenant SafeTransfer {
 *     forbid transfer (amount > 500);
 *     permit api_call;
 *     require counterparty.compliance_score >= 0.9;
 *   }
 * `;
 *
 * const tokens = tokenize(source);
 * const spec = parse(tokens);
 * const enforce = compile(spec);
 *
 * const decision = enforce({ action: 'transfer', params: { amount: 600 } });
 * console.log(decision.action); // 'block'
 * ```
 *
 * @packageDocumentation
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
} from '@nobulex/core-types';

import { tokenize } from './lexer';
import { parse as parseTokens } from './parser';

/**
 * Convenience: parse source text directly to a CovenantSpec.
 *
 * Combines {@link tokenize} and {@link parse} into a single call.
 *
 * @param source - The raw Covenant DSL source text.
 * @returns The parsed covenant specification AST.
 */
export function parseSource(source: string) {
  return parseTokens(tokenize(source));
}
