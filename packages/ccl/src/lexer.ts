import type { Token, TokenType } from './types.js';

const KEYWORDS: Record<string, TokenType> = {
  permit: 'PERMIT',
  deny: 'DENY',
  require: 'REQUIRE',
  limit: 'LIMIT',
  on: 'ON',
  when: 'WHEN',
  severity: 'SEVERITY',
  per: 'PER',
  seconds: 'SECONDS',
  and: 'AND',
  or: 'OR',
  not: 'NOT',
};

const WORD_OPERATORS = new Set([
  'contains',
  'not_contains',
  'in',
  'not_in',
  'matches',
  'starts_with',
  'ends_with',
]);

/**
 * Character-by-character lexer state machine that tokenizes CCL source code.
 * Tracks line and column numbers for error reporting.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  function peek(): string {
    return pos < source.length ? source[pos]! : '';
  }

  function peekAt(offset: number): string {
    const idx = pos + offset;
    return idx < source.length ? source[idx]! : '';
  }

  function advance(): string {
    const ch = source[pos]!;
    pos++;
    column++;
    return ch;
  }

  function addToken(type: TokenType, value: string, startLine: number, startColumn: number): void {
    tokens.push({ type, value, line: startLine, column: startColumn });
  }

  while (pos < source.length) {
    const ch = peek();

    // Skip spaces and tabs (not newlines)
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      advance();
      continue;
    }

    // Newlines
    if (ch === '\n') {
      const startLine = line;
      const startColumn = column;
      advance();
      line++;
      column = 1;
      // Only emit NEWLINE if the last token isn't already a NEWLINE or this isn't the start
      if (tokens.length > 0) {
        const last = tokens[tokens.length - 1]!;
        if (last.type !== 'NEWLINE') {
          addToken('NEWLINE', '\n', startLine, startColumn);
        }
      }
      continue;
    }

    // Comments: # until end of line
    if (ch === '#') {
      const startLine = line;
      const startColumn = column;
      let comment = '';
      while (pos < source.length && peek() !== '\n') {
        comment += advance();
      }
      addToken('COMMENT', comment, startLine, startColumn);
      continue;
    }

    // Single-quoted strings
    if (ch === "'") {
      const startLine = line;
      const startColumn = column;
      advance(); // consume opening quote
      let str = '';
      while (pos < source.length && peek() !== "'") {
        if (peek() === '\n') {
          line++;
          column = 0; // will be incremented by advance
        }
        str += advance();
      }
      if (pos < source.length) {
        advance(); // consume closing quote
      }
      addToken('STRING', str, startLine, startColumn);
      continue;
    }

    // Parentheses
    if (ch === '(') {
      addToken('LPAREN', ch, line, column);
      advance();
      continue;
    }
    if (ch === ')') {
      addToken('RPAREN', ch, line, column);
      advance();
      continue;
    }

    // Brackets
    if (ch === '[') {
      addToken('LBRACKET', ch, line, column);
      advance();
      continue;
    }
    if (ch === ']') {
      addToken('RBRACKET', ch, line, column);
      advance();
      continue;
    }

    // Comma
    if (ch === ',') {
      addToken('COMMA', ch, line, column);
      advance();
      continue;
    }

    // Operators: !=, <=, >=, <, >, =
    if (ch === '!' && peekAt(1) === '=') {
      addToken('OPERATOR', '!=', line, column);
      advance();
      advance();
      continue;
    }
    if (ch === '<' && peekAt(1) === '=') {
      addToken('OPERATOR', '<=', line, column);
      advance();
      advance();
      continue;
    }
    if (ch === '>' && peekAt(1) === '=') {
      addToken('OPERATOR', '>=', line, column);
      advance();
      advance();
      continue;
    }
    if (ch === '<') {
      addToken('OPERATOR', '<', line, column);
      advance();
      continue;
    }
    if (ch === '>') {
      addToken('OPERATOR', '>', line, column);
      advance();
      continue;
    }
    if (ch === '=') {
      addToken('OPERATOR', '=', line, column);
      advance();
      continue;
    }

    // Wildcards: ** and *
    if (ch === '*') {
      const startLine = line;
      const startColumn = column;
      advance();
      if (peek() === '*') {
        advance();
        addToken('DOUBLE_WILDCARD', '**', startLine, startColumn);
      } else {
        addToken('WILDCARD', '*', startLine, startColumn);
      }
      continue;
    }

    // Numbers
    if (ch >= '0' && ch <= '9') {
      const startLine = line;
      const startColumn = column;
      let num = '';
      while (pos < source.length && peek() >= '0' && peek() <= '9') {
        num += advance();
      }
      addToken('NUMBER', num, startLine, startColumn);
      continue;
    }

    // Identifiers, keywords, and word operators
    if (isIdentStart(ch)) {
      const startLine = line;
      const startColumn = column;
      let ident = '';
      while (pos < source.length && isIdentPart(peek())) {
        ident += advance();
      }

      // Check for word operators
      if (WORD_OPERATORS.has(ident)) {
        addToken('OPERATOR', ident, startLine, startColumn);
        continue;
      }

      // Check for keywords
      const lower = ident.toLowerCase();
      const kwType = KEYWORDS[lower];
      if (kwType !== undefined) {
        addToken(kwType, ident, startLine, startColumn);
        continue;
      }

      // Check for boolean values (treat as identifiers)
      addToken('IDENTIFIER', ident, startLine, startColumn);
      continue;
    }

    // Dot
    if (ch === '.') {
      addToken('DOT', ch, line, column);
      advance();
      continue;
    }

    // Forward slash (used in resource paths)
    if (ch === '/') {
      const startLine = line;
      const startColumn = column;
      // Collect the entire resource path as a string
      let path = '';
      while (pos < source.length && !isWhitespace(peek()) && peek() !== '\n') {
        path += advance();
      }
      addToken('STRING', path, startLine, startColumn);
      continue;
    }

    // Unknown character - skip it
    advance();
  }

  // Add EOF token
  addToken('EOF', '', line, column);
  return tokens;
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') ||
         (ch >= 'A' && ch <= 'Z') ||
         ch === '_';
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) ||
         (ch >= '0' && ch <= '9') ||
         ch === '_';
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
}
