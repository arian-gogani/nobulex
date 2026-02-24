/**
 * Lexer for the Covenant DSL.
 *
 * Tokenizes source text like:
 *   covenant SafeTransfer {
 *     forbid transfer (amount > 500);
 *     permit api_call;
 *     require counterparty.compliance_score >= 0.9;
 *   }
 */

/**
 * All token types recognized by the Covenant DSL lexer.
 *
 * Includes keywords (covenant, permit, forbid, require), literals
 * (identifiers, numbers, strings), comparison operators, delimiters,
 * and the special EOF sentinel.
 */
export enum TokenType {
  // Keywords
  Covenant = 'Covenant',
  Permit = 'Permit',
  Forbid = 'Forbid',
  Require = 'Require',

  // Literals
  Identifier = 'Identifier',
  Number = 'Number',
  String = 'String',

  // Operators
  GreaterThan = 'GreaterThan',
  LessThan = 'LessThan',
  GreaterEqual = 'GreaterEqual',
  LessEqual = 'LessEqual',
  EqualEqual = 'EqualEqual',
  NotEqual = 'NotEqual',

  // Delimiters
  LeftBrace = 'LeftBrace',
  RightBrace = 'RightBrace',
  LeftParen = 'LeftParen',
  RightParen = 'RightParen',
  Semicolon = 'Semicolon',
  Dot = 'Dot',

  // Special
  EOF = 'EOF',
}

/**
 * A single token produced by the lexer.
 *
 * Each token records its type, raw string value, and the line/column
 * position in the source text where it begins.
 */
export interface Token {
  /** The classified type of this token. */
  readonly type: TokenType;
  /** The raw string value extracted from the source. */
  readonly value: string;
  /** The 1-based line number where this token starts. */
  readonly line: number;
  /** The 1-based column number where this token starts. */
  readonly column: number;
}

const KEYWORDS: Record<string, TokenType> = {
  covenant: TokenType.Covenant,
  permit: TokenType.Permit,
  forbid: TokenType.Forbid,
  require: TokenType.Require,
};

/**
 * Error thrown when the lexer encounters invalid or unexpected characters
 * in the source text.
 *
 * Includes the line and column where the error occurred for diagnostic purposes.
 */
export class LexerError extends Error {
  /** The 1-based line number where the error occurred. */
  readonly line: number;
  /** The 1-based column number where the error occurred. */
  readonly column: number;

  /**
   * @param message - A human-readable description of the lexer error.
   * @param line - The 1-based line number where the error occurred.
   * @param column - The 1-based column number where the error occurred.
   */
  constructor(message: string, line: number, column: number) {
    super(`${message} at line ${line}, column ${column}`);
    this.name = 'LexerError';
    this.line = line;
    this.column = column;
  }
}

/**
 * Tokenize Covenant DSL source text into an array of tokens.
 *
 * Scans the input character by character, producing tokens for keywords,
 * identifiers, numbers, strings, operators, and delimiters. Whitespace and
 * single-line comments (starting with `//`) are skipped. The returned array
 * always ends with an {@link TokenType.EOF} token.
 *
 * @param source - The raw Covenant DSL source text to tokenize.
 * @returns An array of tokens ending with an EOF token.
 * @throws {LexerError} If the source contains an unexpected character or an unterminated string.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  function peek(): string {
    return pos < source.length ? source[pos]! : '\0';
  }

  function advance(): string {
    const ch = source[pos]!;
    pos++;
    if (ch === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
    return ch;
  }

  function addToken(type: TokenType, value: string, startLine: number, startCol: number): void {
    tokens.push({ type, value, line: startLine, column: startCol });
  }

  while (pos < source.length) {
    const ch = peek();

    // Skip whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      advance();
      continue;
    }

    // Skip single-line comments
    if (ch === '/' && pos + 1 < source.length && source[pos + 1] === '/') {
      while (pos < source.length && peek() !== '\n') advance();
      continue;
    }

    const startLine = line;
    const startCol = column;

    // Delimiters
    if (ch === '{') { advance(); addToken(TokenType.LeftBrace, '{', startLine, startCol); continue; }
    if (ch === '}') { advance(); addToken(TokenType.RightBrace, '}', startLine, startCol); continue; }
    if (ch === '(') { advance(); addToken(TokenType.LeftParen, '(', startLine, startCol); continue; }
    if (ch === ')') { advance(); addToken(TokenType.RightParen, ')', startLine, startCol); continue; }
    if (ch === ';') { advance(); addToken(TokenType.Semicolon, ';', startLine, startCol); continue; }
    if (ch === '.') { advance(); addToken(TokenType.Dot, '.', startLine, startCol); continue; }

    // Operators
    if (ch === '>') {
      advance();
      if (peek() === '=') { advance(); addToken(TokenType.GreaterEqual, '>=', startLine, startCol); }
      else { addToken(TokenType.GreaterThan, '>', startLine, startCol); }
      continue;
    }
    if (ch === '<') {
      advance();
      if (peek() === '=') { advance(); addToken(TokenType.LessEqual, '<=', startLine, startCol); }
      else { addToken(TokenType.LessThan, '<', startLine, startCol); }
      continue;
    }
    if (ch === '=' && pos + 1 < source.length && source[pos + 1] === '=') {
      advance(); advance();
      addToken(TokenType.EqualEqual, '==', startLine, startCol);
      continue;
    }
    if (ch === '!' && pos + 1 < source.length && source[pos + 1] === '=') {
      advance(); advance();
      addToken(TokenType.NotEqual, '!=', startLine, startCol);
      continue;
    }

    // Numbers
    if (ch >= '0' && ch <= '9') {
      let num = '';
      while (pos < source.length && ((peek() >= '0' && peek() <= '9') || peek() === '.')) {
        num += advance();
      }
      addToken(TokenType.Number, num, startLine, startCol);
      continue;
    }

    // Strings (single or double quoted)
    if (ch === '"' || ch === "'") {
      const quote = advance();
      let str = '';
      while (pos < source.length && peek() !== quote) {
        if (peek() === '\n') throw new LexerError('Unterminated string', startLine, startCol);
        str += advance();
      }
      if (pos >= source.length) throw new LexerError('Unterminated string', startLine, startCol);
      advance(); // closing quote
      addToken(TokenType.String, str, startLine, startCol);
      continue;
    }

    // Identifiers and keywords
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let ident = '';
      while (
        pos < source.length &&
        ((peek() >= 'a' && peek() <= 'z') ||
          (peek() >= 'A' && peek() <= 'Z') ||
          (peek() >= '0' && peek() <= '9') ||
          peek() === '_')
      ) {
        ident += advance();
      }
      const keyword = KEYWORDS[ident.toLowerCase()];
      if (keyword) {
        addToken(keyword, ident, startLine, startCol);
      } else {
        addToken(TokenType.Identifier, ident, startLine, startCol);
      }
      continue;
    }

    throw new LexerError(`Unexpected character '${ch}'`, startLine, startCol);
  }

  addToken(TokenType.EOF, '', line, column);
  return tokens;
}
