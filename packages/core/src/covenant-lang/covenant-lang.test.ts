import { describe, it, expect } from 'vitest';
import {
  tokenize,
  TokenType,
  LexerError,
  parse,
  ParseError,
  compile,
  serialize,
  parseSource,
} from './index';
import type { CovenantSpec } from '../types/index';

// ─── Lexer tests ─────────────────────────────────────────────────────────────

describe('Lexer', () => {
  it('tokenizes a simple covenant', () => {
    const tokens = tokenize('covenant Test { permit read; }');
    const types = tokens.map(t => t.type);
    expect(types).toEqual([
      TokenType.Covenant,
      TokenType.Identifier,
      TokenType.LeftBrace,
      TokenType.Permit,
      TokenType.Identifier,
      TokenType.Semicolon,
      TokenType.RightBrace,
      TokenType.EOF,
    ]);
  });

  it('tokenizes comparison operators', () => {
    const tokens = tokenize('> < >= <= == !=');
    const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
    expect(types).toEqual([
      TokenType.GreaterThan,
      TokenType.LessThan,
      TokenType.GreaterEqual,
      TokenType.LessEqual,
      TokenType.EqualEqual,
      TokenType.NotEqual,
    ]);
  });

  it('tokenizes numbers', () => {
    const tokens = tokenize('500 0.9 42');
    const numbers = tokens.filter(t => t.type === TokenType.Number).map(t => t.value);
    expect(numbers).toEqual(['500', '0.9', '42']);
  });

  it('tokenizes double-quoted strings', () => {
    const tokens = tokenize('"hello world"');
    expect(tokens[0]!.type).toBe(TokenType.String);
    expect(tokens[0]!.value).toBe('hello world');
  });

  it('tokenizes single-quoted strings', () => {
    const tokens = tokenize("'hello'");
    expect(tokens[0]!.type).toBe(TokenType.String);
    expect(tokens[0]!.value).toBe('hello');
  });

  it('tokenizes dot paths as separate tokens', () => {
    const tokens = tokenize('counterparty.compliance_score');
    const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
    expect(types).toEqual([
      TokenType.Identifier,
      TokenType.Dot,
      TokenType.Identifier,
    ]);
  });

  it('skips single-line comments', () => {
    const tokens = tokenize('// this is a comment\npermit');
    expect(tokens[0]!.type).toBe(TokenType.Permit);
  });

  it('skips whitespace', () => {
    const tokens = tokenize('  \t\n  permit  ');
    expect(tokens[0]!.type).toBe(TokenType.Permit);
  });

  it('tracks line and column numbers', () => {
    const tokens = tokenize('permit\nforbid');
    expect(tokens[0]!.line).toBe(1);
    expect(tokens[0]!.column).toBe(1);
    expect(tokens[1]!.line).toBe(2);
    expect(tokens[1]!.column).toBe(1);
  });

  it('throws LexerError on unexpected character', () => {
    expect(() => tokenize('@')).toThrow(LexerError);
  });

  it('throws LexerError on unterminated string', () => {
    expect(() => tokenize('"hello')).toThrow(LexerError);
  });

  it('tokenizes full covenant with conditions', () => {
    const source = `covenant SafeTransfer {
      forbid transfer (amount > 500);
      permit api_call;
      require counterparty.compliance_score >= 0.9;
    }`;
    const tokens = tokenize(source);
    expect(tokens.length).toBeGreaterThan(10);
    expect(tokens[tokens.length - 1]!.type).toBe(TokenType.EOF);
  });

  it('recognizes keywords case-insensitively', () => {
    const tokens = tokenize('Covenant PERMIT Forbid REQUIRE');
    expect(tokens[0]!.type).toBe(TokenType.Covenant);
    expect(tokens[1]!.type).toBe(TokenType.Permit);
    expect(tokens[2]!.type).toBe(TokenType.Forbid);
    expect(tokens[3]!.type).toBe(TokenType.Require);
  });
});

// ─── Parser tests ─────────────────────────────────────────────────────────────

describe('Parser', () => {
  it('parses a minimal covenant', () => {
    const tokens = tokenize('covenant Minimal { permit read; }');
    const spec = parse(tokens);
    expect(spec.name).toBe('Minimal');
    expect(spec.statements).toHaveLength(1);
    expect(spec.statements[0]!.effect).toBe('permit');
    expect(spec.statements[0]!.action).toBe('read');
    expect(spec.statements[0]!.conditions).toHaveLength(0);
    expect(spec.requirements).toHaveLength(0);
  });

  it('parses forbid with condition', () => {
    const tokens = tokenize('covenant X { forbid transfer (amount > 500); }');
    const spec = parse(tokens);
    expect(spec.statements).toHaveLength(1);
    const stmt = spec.statements[0]!;
    expect(stmt.effect).toBe('forbid');
    expect(stmt.action).toBe('transfer');
    expect(stmt.conditions).toHaveLength(1);
    expect(stmt.conditions[0]!.field).toBe('amount');
    expect(stmt.conditions[0]!.operator).toBe('>');
    expect(stmt.conditions[0]!.value).toBe(500);
  });

  it('parses require statements', () => {
    const tokens = tokenize('covenant X { require counterparty.compliance_score >= 0.9; }');
    const spec = parse(tokens);
    expect(spec.requirements).toHaveLength(1);
    expect(spec.requirements[0]!.field).toBe('counterparty.compliance_score');
    expect(spec.requirements[0]!.operator).toBe('>=');
    expect(spec.requirements[0]!.value).toBe(0.9);
  });

  it('parses the full spec from the prompt', () => {
    const source = `covenant SafeTransfer {
      forbid transfer (amount > 500);
      permit api_call;
      require counterparty.compliance_score >= 0.9;
    }`;
    const spec = parseSource(source);
    expect(spec.name).toBe('SafeTransfer');
    expect(spec.statements).toHaveLength(2);
    expect(spec.requirements).toHaveLength(1);
  });

  it('parses multiple statements', () => {
    const source = `covenant Multi {
      permit read;
      permit write;
      forbid delete;
      forbid transfer (amount > 1000);
    }`;
    const spec = parseSource(source);
    expect(spec.statements).toHaveLength(4);
    expect(spec.statements.filter(s => s.effect === 'permit')).toHaveLength(2);
    expect(spec.statements.filter(s => s.effect === 'forbid')).toHaveLength(2);
  });

  it('parses string values in conditions', () => {
    const source = 'covenant X { forbid deploy (env == "production"); }';
    const spec = parseSource(source);
    expect(spec.statements[0]!.conditions[0]!.value).toBe('production');
  });

  it('parses boolean values in require', () => {
    const source = 'covenant X { require agent.verified == true; }';
    const spec = parseSource(source);
    expect(spec.requirements[0]!.value).toBe(true);
  });

  it('throws ParseError on missing semicolon', () => {
    const tokens = tokenize('covenant X { permit read }');
    expect(() => parse(tokens)).toThrow(ParseError);
  });

  it('throws ParseError on missing closing brace', () => {
    const tokens = tokenize('covenant X { permit read;');
    expect(() => parse(tokens)).toThrow(ParseError);
  });

  it('throws ParseError on unexpected token in body', () => {
    const tokens = tokenize('covenant X { 500; }');
    expect(() => parse(tokens)).toThrow(ParseError);
  });

  it('throws ParseError on trailing content', () => {
    const tokens = tokenize('covenant X { } extra');
    expect(() => parse(tokens)).toThrow(ParseError);
  });
});

// ─── Compiler tests ─────────────────────────────────────────────────────────

describe('Compiler', () => {
  const fullSpec: CovenantSpec = {
    name: 'SafeTransfer',
    statements: [
      { effect: 'forbid', action: 'transfer', conditions: [{ field: 'amount', operator: '>', value: 500 }] },
      { effect: 'permit', action: 'api_call', conditions: [] },
      { effect: 'permit', action: 'transfer', conditions: [] },
    ],
    requirements: [
      { field: 'counterparty.compliance_score', operator: '>=', value: 0.9 },
    ],
  };

  it('blocks forbidden actions when condition matches', () => {
    const enforce = compile(fullSpec);
    const result = enforce({ action: 'transfer', params: { amount: 600 } });
    expect(result.action).toBe('block');
    expect(result.reason).toContain('forbidden');
  });

  it('allows permitted actions', () => {
    const enforce = compile(fullSpec);
    const result = enforce({
      action: 'api_call',
      params: { counterparty: { compliance_score: 0.95 } },
    });
    expect(result.action).toBe('allow');
  });

  it('allows transfer when forbid condition does not match', () => {
    const enforce = compile(fullSpec);
    const result = enforce({
      action: 'transfer',
      params: { amount: 100, counterparty: { compliance_score: 0.95 } },
    });
    expect(result.action).toBe('allow');
  });

  it('blocks when requirement not met', () => {
    const enforce = compile(fullSpec);
    const result = enforce({
      action: 'api_call',
      params: { counterparty: { compliance_score: 0.5 } },
    });
    expect(result.action).toBe('block');
    expect(result.reason).toContain('Requirement not met');
  });

  it('blocks unknown actions (default deny)', () => {
    const enforce = compile(fullSpec);
    const result = enforce({ action: 'unknown_action', params: {} });
    expect(result.action).toBe('block');
    expect(result.reason).toContain('default deny');
  });

  it('forbid wins over permit for same action', () => {
    const spec: CovenantSpec = {
      name: 'ForbidWins',
      statements: [
        { effect: 'permit', action: 'transfer', conditions: [] },
        { effect: 'forbid', action: 'transfer', conditions: [] },
      ],
      requirements: [],
    };
    const enforce = compile(spec);
    const result = enforce({ action: 'transfer', params: {} });
    expect(result.action).toBe('block');
  });

  it('returns timestamp in decision', () => {
    const enforce = compile(fullSpec);
    const result = enforce({ action: 'api_call', params: { counterparty: { compliance_score: 1.0 } } });
    expect(result.timestamp).toBeTruthy();
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });

  it('handles nested field resolution', () => {
    const spec: CovenantSpec = {
      name: 'Nested',
      statements: [
        { effect: 'forbid', action: 'call', conditions: [{ field: 'a.b.c', operator: '>', value: 10 }] },
      ],
      requirements: [],
    };
    const enforce = compile(spec);
    expect(enforce({ action: 'call', params: { a: { b: { c: 20 } } } }).action).toBe('block');
    expect(enforce({ action: 'call', params: { a: { b: { c: 5 } } } }).action).toBe('block'); // default deny, no permit
  });

  it('handles missing fields gracefully', () => {
    const spec: CovenantSpec = {
      name: 'MissingField',
      statements: [
        { effect: 'forbid', action: 'x', conditions: [{ field: 'nonexistent', operator: '>', value: 0 }] },
        { effect: 'permit', action: 'x', conditions: [] },
      ],
      requirements: [],
    };
    const enforce = compile(spec);
    // nonexistent field → condition not met → forbid doesn't match → falls to permit
    const result = enforce({ action: 'x', params: {} });
    expect(result.action).toBe('allow');
  });
});

// ─── Serializer tests ───────────────────────────────────────────────────────

describe('Serializer', () => {
  it('round-trips: parse → serialize → parse', () => {
    const source = `covenant RoundTrip {
      forbid transfer (amount > 500);
      permit api_call;
      require counterparty.compliance_score >= 0.9;
    }`;
    const spec1 = parseSource(source);
    const serialized = serialize(spec1);
    const spec2 = parseSource(serialized);
    expect(spec2.name).toBe(spec1.name);
    expect(spec2.statements).toEqual(spec1.statements);
    expect(spec2.requirements).toEqual(spec1.requirements);
  });

  it('serializes empty covenant', () => {
    const spec: CovenantSpec = { name: 'Empty', statements: [], requirements: [] };
    const output = serialize(spec);
    expect(output).toContain('covenant Empty');
    expect(output).toContain('{');
    expect(output).toContain('}');
  });

  it('serializes string values with quotes', () => {
    const spec: CovenantSpec = {
      name: 'WithString',
      statements: [
        { effect: 'forbid', action: 'deploy', conditions: [{ field: 'env', operator: '==', value: 'production' }] },
      ],
      requirements: [],
    };
    const output = serialize(spec);
    expect(output).toContain('"production"');
  });
});

// ─── Integration tests ──────────────────────────────────────────────────────

describe('Integration: source → compile → enforce', () => {
  it('full pipeline from source text', () => {
    const source = `covenant SafeTransfer {
      forbid transfer (amount > 500);
      permit api_call;
      require counterparty.compliance_score >= 0.9;
    }`;
    const spec = parseSource(source);
    const enforce = compile(spec);

    // Forbidden action
    expect(enforce({ action: 'transfer', params: { amount: 600 } }).action).toBe('block');

    // Allowed action with requirement met
    expect(enforce({
      action: 'api_call',
      params: { counterparty: { compliance_score: 0.95 } },
    }).action).toBe('allow');

    // Allowed action with requirement not met
    expect(enforce({
      action: 'api_call',
      params: { counterparty: { compliance_score: 0.5 } },
    }).action).toBe('block');

    // Unknown action (default deny)
    expect(enforce({ action: 'unknown', params: {} }).action).toBe('block');
  });

  it('multiple operator types', () => {
    const source = `covenant Ops {
      forbid big_transfer (amount >= 1000);
      forbid small_transfer (amount < 1);
      forbid exact_transfer (amount == 42);
      forbid not_transfer (amount != 100);
      permit big_transfer;
      permit small_transfer;
      permit exact_transfer;
      permit not_transfer;
    }`;
    const enforce = compile(parseSource(source));

    expect(enforce({ action: 'big_transfer', params: { amount: 1000 } }).action).toBe('block');
    expect(enforce({ action: 'big_transfer', params: { amount: 999 } }).action).toBe('allow');
    expect(enforce({ action: 'small_transfer', params: { amount: 0 } }).action).toBe('block');
    expect(enforce({ action: 'small_transfer', params: { amount: 1 } }).action).toBe('allow');
    expect(enforce({ action: 'exact_transfer', params: { amount: 42 } }).action).toBe('block');
    expect(enforce({ action: 'exact_transfer', params: { amount: 43 } }).action).toBe('allow');
    expect(enforce({ action: 'not_transfer', params: { amount: 50 } }).action).toBe('block');
    expect(enforce({ action: 'not_transfer', params: { amount: 100 } }).action).toBe('allow');
  });
});
