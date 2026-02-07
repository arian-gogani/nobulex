import { describe, it, expect } from 'vitest';
import {
  parse,
  tokenize,
  parseTokens,
  evaluate,
  matchAction,
  matchResource,
  specificity,
  evaluateCondition,
  checkRateLimit,
  merge,
  validateNarrowing,
  serialize,
  CCLSyntaxError,
} from './index';
import type {
  CCLDocument,
  Condition,
  CompoundCondition,
  PermitDenyStatement,
  LimitStatement,
  EvaluationContext,
} from './types';

// ---------------------------------------------------------------------------
// Helper to build a minimal CCLDocument from statements
// ---------------------------------------------------------------------------
function buildDoc(opts: {
  permits?: PermitDenyStatement[];
  denies?: PermitDenyStatement[];
  obligations?: any[];
  limits?: LimitStatement[];
}): CCLDocument {
  const permits = opts.permits ?? [];
  const denies = opts.denies ?? [];
  const obligations = opts.obligations ?? [];
  const limits = opts.limits ?? [];
  return {
    statements: [...permits, ...denies, ...obligations, ...limits],
    permits,
    denies,
    obligations,
    limits,
  };
}

function makePermit(action: string, resource: string, extra?: Partial<PermitDenyStatement>): PermitDenyStatement {
  return { type: 'permit', action, resource, severity: 'high', line: 1, ...extra };
}

function makeDeny(action: string, resource: string, extra?: Partial<PermitDenyStatement>): PermitDenyStatement {
  return { type: 'deny', action, resource, severity: 'high', line: 1, ...extra };
}

function makeLimit(action: string, count: number, periodSeconds: number, extra?: Partial<LimitStatement>): LimitStatement {
  return { type: 'limit', action, count, periodSeconds, severity: 'high', line: 1, ...extra };
}

// ===========================================================================
// LEXER
// ===========================================================================
describe('Lexer (tokenize)', () => {
  it('tokenizes a simple permit statement', () => {
    const tokens = tokenize("permit file.read on '/data'");
    const types = tokens.map((t) => t.type);
    expect(types).toContain('PERMIT');
    expect(types).toContain('IDENTIFIER');
    expect(types).toContain('DOT');
    expect(types).toContain('ON');
    expect(types).toContain('STRING');
    expect(types).toContain('EOF');

    // Check the STRING token value is the resource path
    const stringToken = tokens.find((t) => t.type === 'STRING');
    expect(stringToken?.value).toBe('/data');
  });

  it('tokenizes a deny statement with condition', () => {
    const tokens = tokenize("deny network.send on '**' when user.role = 'guest'");
    const types = tokens.map((t) => t.type);
    expect(types).toContain('DENY');
    expect(types).toContain('WHEN');
    expect(types).toContain('OPERATOR'); // =
    // Find the operator token
    const opToken = tokens.find((t) => t.type === 'OPERATOR');
    expect(opToken?.value).toBe('=');
  });

  it('tokenizes a limit statement', () => {
    const tokens = tokenize('limit api.call 100 per 60 seconds');
    const types = tokens.map((t) => t.type);
    expect(types).toContain('LIMIT');
    expect(types).toContain('NUMBER');
    expect(types).toContain('PER');
    expect(types).toContain('SECONDS');
    // Check the numbers
    const numbers = tokens.filter((t) => t.type === 'NUMBER');
    expect(numbers.map((n) => n.value)).toEqual(['100', '60']);
  });

  it('handles comments and blank lines', () => {
    const source = `# This is a comment
permit file.read on '/data'

# Another comment
deny file.write on '/data'`;

    const tokens = tokenize(source);
    const comments = tokens.filter((t) => t.type === 'COMMENT');
    expect(comments.length).toBe(2);
    expect(comments[0]?.value).toContain('This is a comment');
    expect(comments[1]?.value).toContain('Another comment');
  });

  it('tokenizes wildcard patterns', () => {
    const tokens = tokenize("permit ** on '**'");
    const wildcardTokens = tokens.filter(
      (t) => t.type === 'DOUBLE_WILDCARD' || t.type === 'WILDCARD',
    );
    expect(wildcardTokens.length).toBeGreaterThanOrEqual(1);
    // The first ** should be DOUBLE_WILDCARD
    expect(wildcardTokens[0]?.type).toBe('DOUBLE_WILDCARD');
  });

  it('tokenizes comparison operators correctly', () => {
    const tokens = tokenize("permit file.read on '/data' when count >= 5");
    const ops = tokens.filter((t) => t.type === 'OPERATOR');
    expect(ops.map((o) => o.value)).toContain('>=');
  });

  it('tokenizes all comparison operators', () => {
    const source = "deny ** on '**' when a = 1\ndeny ** on '**' when b != 2\ndeny ** on '**' when c < 3\ndeny ** on '**' when d > 4\ndeny ** on '**' when e <= 5\ndeny ** on '**' when f >= 6";
    const tokens = tokenize(source);
    const ops = tokens.filter((t) => t.type === 'OPERATOR').map((t) => t.value);
    expect(ops).toContain('=');
    expect(ops).toContain('!=');
    expect(ops).toContain('<');
    expect(ops).toContain('>');
    expect(ops).toContain('<=');
    expect(ops).toContain('>=');
  });

  it('tokenizes word operators (contains, in, matches, etc.)', () => {
    const source = "deny file.read on '/data' when content contains 'secret'";
    const tokens = tokenize(source);
    const ops = tokens.filter((t) => t.type === 'OPERATOR');
    expect(ops.some((o) => o.value === 'contains')).toBe(true);
  });

  it('tokenizes parentheses', () => {
    const tokens = tokenize("deny ** on '**' when (a = 1 or b = 2)");
    const types = tokens.map((t) => t.type);
    expect(types).toContain('LPAREN');
    expect(types).toContain('RPAREN');
  });

  it('tokenizes brackets and commas for array values', () => {
    const tokens = tokenize("deny ** on '**' when role in ['admin', 'moderator']");
    const types = tokens.map((t) => t.type);
    expect(types).toContain('LBRACKET');
    expect(types).toContain('RBRACKET');
    expect(types).toContain('COMMA');
  });

  it('tracks line and column numbers', () => {
    const tokens = tokenize("permit file.read on '/data'\ndeny file.write on '/data'");
    const permitToken = tokens.find((t) => t.type === 'PERMIT');
    const denyToken = tokens.find((t) => t.type === 'DENY');
    expect(permitToken?.line).toBe(1);
    expect(permitToken?.column).toBe(1);
    expect(denyToken?.line).toBe(2);
  });

  it('tokenizes single wildcard *', () => {
    const tokens = tokenize("permit file.* on '/data'");
    const wildcard = tokens.find((t) => t.type === 'WILDCARD');
    expect(wildcard).toBeDefined();
    expect(wildcard?.value).toBe('*');
  });

  it('tokenizes resource paths starting with /', () => {
    const tokens = tokenize("permit file.read on /data/files");
    // A path starting with / is collected as a STRING token
    const stringToken = tokens.find((t) => t.type === 'STRING');
    expect(stringToken).toBeDefined();
    expect(stringToken?.value).toBe('/data/files');
  });
});

// ===========================================================================
// PARSER
// ===========================================================================
describe('Parser (parse / parseTokens)', () => {
  it('parses a permit statement', () => {
    const doc = parse("permit file.read on '/data'");
    expect(doc.permits.length).toBe(1);
    expect(doc.permits[0]?.type).toBe('permit');
    expect(doc.permits[0]?.action).toBe('file.read');
    expect(doc.permits[0]?.resource).toBe('/data');
  });

  it('parses a deny statement', () => {
    const doc = parse("deny network.send on '**'");
    expect(doc.denies.length).toBe(1);
    expect(doc.denies[0]?.type).toBe('deny');
    expect(doc.denies[0]?.action).toBe('network.send');
    expect(doc.denies[0]?.resource).toBe('**');
  });

  it('parses a require statement', () => {
    const doc = parse("require audit.log on '/sensitive'");
    expect(doc.obligations.length).toBe(1);
    expect(doc.obligations[0]?.type).toBe('require');
    expect(doc.obligations[0]?.action).toBe('audit.log');
    expect(doc.obligations[0]?.resource).toBe('/sensitive');
  });

  it('parses a limit statement', () => {
    const doc = parse('limit api.call 100 per 60 seconds');
    expect(doc.limits.length).toBe(1);
    const limit = doc.limits[0]!;
    expect(limit.type).toBe('limit');
    expect(limit.action).toBe('api.call');
    expect(limit.count).toBe(100);
    expect(limit.periodSeconds).toBe(60);
  });

  it('parses all statement types in one document', () => {
    const source = `permit file.read on '/data'
deny file.delete on '/data'
require audit.log on '/data'
limit file.read 50 per 30 seconds`;
    const doc = parse(source);
    expect(doc.permits.length).toBe(1);
    expect(doc.denies.length).toBe(1);
    expect(doc.obligations.length).toBe(1);
    expect(doc.limits.length).toBe(1);
    expect(doc.statements.length).toBe(4);
  });

  it('parses conditions with equality operator', () => {
    const doc = parse("permit file.read on '/data' when user.role = 'admin'");
    const condition = doc.permits[0]?.condition as Condition;
    expect(condition).toBeDefined();
    expect(condition.field).toBe('user.role');
    expect(condition.operator).toBe('=');
    expect(condition.value).toBe('admin');
  });

  it('parses conditions with numeric comparison', () => {
    const doc = parse("permit file.read on '/data' when size < 1000");
    const condition = doc.permits[0]?.condition as Condition;
    expect(condition.field).toBe('size');
    expect(condition.operator).toBe('<');
    expect(condition.value).toBe(1000);
  });

  it('parses conditions with != operator', () => {
    const doc = parse("deny file.write on '/data' when status != 'active'");
    const condition = doc.denies[0]?.condition as Condition;
    expect(condition.operator).toBe('!=');
  });

  it('parses compound AND conditions', () => {
    const doc = parse("permit file.read on '/data' when user.role = 'admin' and user.active = true");
    const condition = doc.permits[0]?.condition as CompoundCondition;
    expect(condition.type).toBe('and');
    expect(condition.conditions.length).toBe(2);
  });

  it('parses compound OR conditions', () => {
    const doc = parse("permit file.read on '/data' when user.role = 'admin' or user.role = 'superuser'");
    const condition = doc.permits[0]?.condition as CompoundCondition;
    expect(condition.type).toBe('or');
    expect(condition.conditions.length).toBe(2);
  });

  it('parses NOT conditions', () => {
    const doc = parse("deny file.read on '/secret' when not user.authorized = true");
    const condition = doc.denies[0]?.condition as CompoundCondition;
    expect(condition.type).toBe('not');
    expect(condition.conditions.length).toBe(1);
  });

  it('parses parenthesized conditions', () => {
    const doc = parse("permit file.read on '/data' when (user.role = 'admin' or user.role = 'superuser') and user.active = true");
    const condition = doc.permits[0]?.condition as CompoundCondition;
    expect(condition.type).toBe('and');
    expect(condition.conditions.length).toBe(2);
    // The first sub-condition should be an OR
    const orCondition = condition.conditions[0] as CompoundCondition;
    expect(orCondition.type).toBe('or');
  });

  it('parses severity levels', () => {
    const doc = parse("deny file.delete on '/system' severity critical");
    expect(doc.denies[0]?.severity).toBe('critical');
  });

  it('parses all severity values', () => {
    const sources = [
      "deny a on '/' severity critical",
      "deny b on '/' severity high",
      "deny c on '/' severity medium",
      "deny d on '/' severity low",
    ];
    const docs = sources.map(parse);
    expect(docs[0]?.denies[0]?.severity).toBe('critical');
    expect(docs[1]?.denies[0]?.severity).toBe('high');
    expect(docs[2]?.denies[0]?.severity).toBe('medium');
    expect(docs[3]?.denies[0]?.severity).toBe('low');
  });

  it('default severity is high when not specified', () => {
    const doc = parse("permit file.read on '/data'");
    expect(doc.permits[0]?.severity).toBe('high');
  });

  it('parses double wildcard action **', () => {
    const doc = parse("permit ** on '**'");
    expect(doc.permits[0]?.action).toBe('**');
    expect(doc.permits[0]?.resource).toBe('**');
  });

  it('parses dot-wildcard action pattern like file.*', () => {
    const doc = parse("permit file.* on '/data'");
    expect(doc.permits[0]?.action).toBe('file.*');
  });

  it('parses array values in conditions', () => {
    const doc = parse("deny file.read on '/data' when user.role in ['admin', 'editor']");
    const condition = doc.denies[0]?.condition as Condition;
    expect(condition.operator).toBe('in');
    expect(Array.isArray(condition.value)).toBe(true);
    expect(condition.value).toEqual(['admin', 'editor']);
  });

  it('parses conditions with boolean values', () => {
    const doc = parse("permit file.read on '/data' when authorized = true");
    const condition = doc.permits[0]?.condition as Condition;
    expect(condition.value).toBe(true);
  });

  it('handles comments in multi-statement documents', () => {
    const source = `# Access rules
permit file.read on '/public'
# Deny sensitive
deny file.read on '/secret'`;
    const doc = parse(source);
    expect(doc.permits.length).toBe(1);
    expect(doc.denies.length).toBe(1);
  });

  it('handles blank lines between statements', () => {
    const source = `permit file.read on '/a'

permit file.write on '/b'`;
    const doc = parse(source);
    expect(doc.permits.length).toBe(2);
  });

  it('records line numbers on statements', () => {
    const source = `permit file.read on '/data'
deny file.write on '/data'`;
    const doc = parse(source);
    expect(doc.permits[0]?.line).toBe(1);
    expect(doc.denies[0]?.line).toBe(2);
  });
});

// ===========================================================================
// CCLSyntaxError
// ===========================================================================
describe('CCLSyntaxError', () => {
  it('is thrown on invalid syntax', () => {
    expect(() => parse('invalid_keyword file.read')).toThrow(CCLSyntaxError);
  });

  it('contains line and column information', () => {
    try {
      parse('invalid_keyword file.read');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CCLSyntaxError);
      const err = e as InstanceType<typeof CCLSyntaxError>;
      expect(err.line).toBeDefined();
      expect(err.column).toBeDefined();
      expect(err.message).toContain('CCL Syntax Error');
    }
  });

  it('is thrown when missing ON keyword', () => {
    expect(() => parse("permit file.read '/data'")).toThrow(CCLSyntaxError);
  });

  it('is thrown when limit is missing count', () => {
    expect(() => parse('limit api.call per 60 seconds')).toThrow(CCLSyntaxError);
  });

  it('is thrown for invalid severity value', () => {
    expect(() => parse("deny file.read on '/data' severity invalid_level")).toThrow(CCLSyntaxError);
  });
});

// ===========================================================================
// matchAction
// ===========================================================================
describe('matchAction', () => {
  it('exact match works', () => {
    expect(matchAction('file.read', 'file.read')).toBe(true);
    expect(matchAction('file.read', 'file.write')).toBe(false);
  });

  it('single wildcard * matches exactly one segment', () => {
    expect(matchAction('file.*', 'file.read')).toBe(true);
    expect(matchAction('file.*', 'file.write')).toBe(true);
    expect(matchAction('*.read', 'file.read')).toBe(true);
    expect(matchAction('*.read', 'network.read')).toBe(true);
  });

  it('single wildcard * does not match zero or multiple segments', () => {
    expect(matchAction('file.*', 'file')).toBe(false);
    expect(matchAction('file.*', 'file.read.deep')).toBe(false);
  });

  it('double wildcard ** matches everything', () => {
    expect(matchAction('**', 'file.read')).toBe(true);
    expect(matchAction('**', 'network.send.data')).toBe(true);
    expect(matchAction('**', 'anything')).toBe(true);
  });

  it('double wildcard ** matches zero or more segments as prefix/suffix', () => {
    expect(matchAction('file.**', 'file.read')).toBe(true);
    expect(matchAction('file.**', 'file.read.deep')).toBe(true);
    expect(matchAction('file.**', 'file')).toBe(true);
  });

  it('mixed patterns like file.* match correctly', () => {
    expect(matchAction('file.*', 'file.read')).toBe(true);
    expect(matchAction('file.*', 'network.send')).toBe(false);
  });

  it('multi-segment exact match', () => {
    expect(matchAction('a.b.c', 'a.b.c')).toBe(true);
    expect(matchAction('a.b.c', 'a.b.d')).toBe(false);
  });

  it('wildcard in middle position', () => {
    expect(matchAction('a.*.c', 'a.b.c')).toBe(true);
    expect(matchAction('a.*.c', 'a.x.c')).toBe(true);
    expect(matchAction('a.*.c', 'a.b.d')).toBe(false);
  });

  it('double wildcard in middle position', () => {
    expect(matchAction('a.**.c', 'a.b.c')).toBe(true);
    expect(matchAction('a.**.c', 'a.b.x.c')).toBe(true);
    expect(matchAction('a.**.c', 'a.c')).toBe(true);
  });
});

// ===========================================================================
// matchResource
// ===========================================================================
describe('matchResource', () => {
  it('exact path matches', () => {
    expect(matchResource('/data/files', '/data/files')).toBe(true);
    expect(matchResource('/data/files', '/data/other')).toBe(false);
  });

  it('/data/** matches nested paths', () => {
    expect(matchResource('/data/**', '/data/files')).toBe(true);
    expect(matchResource('/data/**', '/data/files/deep/nested')).toBe(true);
    expect(matchResource('/data/**', '/data')).toBe(true);
  });

  it('** matches everything', () => {
    expect(matchResource('**', '/any/path')).toBe(true);
    expect(matchResource('**', '/a/b/c/d')).toBe(true);
    expect(matchResource('**', 'simple')).toBe(true);
  });

  it('single wildcard * matches exactly one segment', () => {
    expect(matchResource('/data/*', '/data/files')).toBe(true);
    expect(matchResource('/data/*', '/data/other')).toBe(true);
    expect(matchResource('/data/*', '/data/a/b')).toBe(false);
  });

  it('handles leading and trailing slashes', () => {
    expect(matchResource('/data/', '/data')).toBe(true);
    expect(matchResource('data', '/data/')).toBe(true);
  });

  it('wildcard in the middle', () => {
    expect(matchResource('/data/*/files', '/data/user/files')).toBe(true);
    expect(matchResource('/data/*/files', '/data/admin/files')).toBe(true);
    expect(matchResource('/data/*/files', '/data/user/other')).toBe(false);
  });

  it('double wildcard in the middle', () => {
    expect(matchResource('/data/**/files', '/data/a/b/files')).toBe(true);
    expect(matchResource('/data/**/files', '/data/files')).toBe(true);
  });

  it('empty pattern matches empty resource', () => {
    expect(matchResource('', '')).toBe(true);
  });
});

// ===========================================================================
// specificity
// ===========================================================================
describe('specificity', () => {
  it('more specific patterns score higher', () => {
    const s1 = specificity('file.read', '/data/files');
    const s2 = specificity('**', '**');
    expect(s1).toBeGreaterThan(s2);
  });

  it('literal segments score 2 each', () => {
    // file.read = 2 + 2 = 4 for action, /data = 2 for resource => total = 6
    const s = specificity('file.read', '/data');
    expect(s).toBe(6);
  });

  it('single wildcard * scores 1', () => {
    // file.* = 2 + 1 = 3 for action
    const s = specificity('file.*', '');
    expect(s).toBe(3);
  });

  it('double wildcard ** scores 0', () => {
    const s = specificity('**', '');
    expect(s).toBe(0);
  });

  it('mixed patterns score correctly', () => {
    // a.*.c = 2 + 1 + 2 = 5
    const s = specificity('a.*.c', '');
    expect(s).toBe(5);
  });

  it('resource specificity adds to score', () => {
    const s1 = specificity('file.read', '/data/files');
    const s2 = specificity('file.read', '/data/**');
    expect(s1).toBeGreaterThan(s2);
  });
});

// ===========================================================================
// evaluateCondition
// ===========================================================================
describe('evaluateCondition', () => {
  it('simple equality returns true when field matches value', () => {
    const cond: Condition = { field: 'role', operator: '=', value: 'admin' };
    expect(evaluateCondition(cond, { role: 'admin' })).toBe(true);
    expect(evaluateCondition(cond, { role: 'user' })).toBe(false);
  });

  it('inequality operator works', () => {
    const cond: Condition = { field: 'status', operator: '!=', value: 'blocked' };
    expect(evaluateCondition(cond, { status: 'active' })).toBe(true);
    expect(evaluateCondition(cond, { status: 'blocked' })).toBe(false);
  });

  it('numeric comparison < works', () => {
    const cond: Condition = { field: 'size', operator: '<', value: 100 };
    expect(evaluateCondition(cond, { size: 50 })).toBe(true);
    expect(evaluateCondition(cond, { size: 100 })).toBe(false);
    expect(evaluateCondition(cond, { size: 150 })).toBe(false);
  });

  it('numeric comparison > works', () => {
    const cond: Condition = { field: 'count', operator: '>', value: 10 };
    expect(evaluateCondition(cond, { count: 20 })).toBe(true);
    expect(evaluateCondition(cond, { count: 5 })).toBe(false);
  });

  it('numeric comparison <= works', () => {
    const cond: Condition = { field: 'score', operator: '<=', value: 100 };
    expect(evaluateCondition(cond, { score: 100 })).toBe(true);
    expect(evaluateCondition(cond, { score: 99 })).toBe(true);
    expect(evaluateCondition(cond, { score: 101 })).toBe(false);
  });

  it('numeric comparison >= works', () => {
    const cond: Condition = { field: 'score', operator: '>=', value: 50 };
    expect(evaluateCondition(cond, { score: 50 })).toBe(true);
    expect(evaluateCondition(cond, { score: 51 })).toBe(true);
    expect(evaluateCondition(cond, { score: 49 })).toBe(false);
  });

  it('nested field access with dot notation', () => {
    const cond: Condition = { field: 'user.role', operator: '=', value: 'admin' };
    expect(evaluateCondition(cond, { user: { role: 'admin' } })).toBe(true);
    expect(evaluateCondition(cond, { user: { role: 'guest' } })).toBe(false);
  });

  it('deeply nested field access', () => {
    const cond: Condition = { field: 'a.b.c', operator: '=', value: 42 };
    expect(evaluateCondition(cond, { a: { b: { c: 42 } } })).toBe(true);
    expect(evaluateCondition(cond, { a: { b: { c: 43 } } })).toBe(false);
  });

  it('missing field returns false (safe default)', () => {
    const cond: Condition = { field: 'missing.field', operator: '=', value: 'anything' };
    expect(evaluateCondition(cond, {})).toBe(false);
  });

  it('missing top-level field returns false', () => {
    const cond: Condition = { field: 'nonexistent', operator: '=', value: 'x' };
    expect(evaluateCondition(cond, { other: 'y' })).toBe(false);
  });

  it('partially missing nested field returns false', () => {
    const cond: Condition = { field: 'user.name.first', operator: '=', value: 'Bob' };
    expect(evaluateCondition(cond, { user: {} })).toBe(false);
  });

  it('contains operator works for strings', () => {
    const cond: Condition = { field: 'text', operator: 'contains', value: 'hello' };
    expect(evaluateCondition(cond, { text: 'say hello world' })).toBe(true);
    expect(evaluateCondition(cond, { text: 'no greeting' })).toBe(false);
  });

  it('contains operator works for arrays', () => {
    const cond: Condition = { field: 'tags', operator: 'contains', value: 'important' };
    expect(evaluateCondition(cond, { tags: ['urgent', 'important', 'review'] })).toBe(true);
    expect(evaluateCondition(cond, { tags: ['minor', 'review'] })).toBe(false);
  });

  it('not_contains operator works for strings', () => {
    const cond: Condition = { field: 'text', operator: 'not_contains', value: 'secret' };
    expect(evaluateCondition(cond, { text: 'public info' })).toBe(true);
    expect(evaluateCondition(cond, { text: 'this is secret' })).toBe(false);
  });

  it('in operator checks if field value is in array', () => {
    const cond: Condition = { field: 'role', operator: 'in', value: ['admin', 'editor'] };
    expect(evaluateCondition(cond, { role: 'admin' })).toBe(true);
    expect(evaluateCondition(cond, { role: 'editor' })).toBe(true);
    expect(evaluateCondition(cond, { role: 'viewer' })).toBe(false);
  });

  it('not_in operator checks if field value is NOT in array', () => {
    const cond: Condition = { field: 'role', operator: 'not_in', value: ['blocked', 'banned'] };
    expect(evaluateCondition(cond, { role: 'admin' })).toBe(true);
    expect(evaluateCondition(cond, { role: 'blocked' })).toBe(false);
  });

  it('matches operator uses regex', () => {
    const cond: Condition = { field: 'email', operator: 'matches', value: '^[a-z]+@example\\.com$' };
    expect(evaluateCondition(cond, { email: 'user@example.com' })).toBe(true);
    expect(evaluateCondition(cond, { email: 'user@other.com' })).toBe(false);
  });

  it('starts_with operator works', () => {
    const cond: Condition = { field: 'path', operator: 'starts_with', value: '/api/' };
    expect(evaluateCondition(cond, { path: '/api/users' })).toBe(true);
    expect(evaluateCondition(cond, { path: '/web/home' })).toBe(false);
  });

  it('ends_with operator works', () => {
    const cond: Condition = { field: 'filename', operator: 'ends_with', value: '.txt' };
    expect(evaluateCondition(cond, { filename: 'readme.txt' })).toBe(true);
    expect(evaluateCondition(cond, { filename: 'image.png' })).toBe(false);
  });

  it('compound AND condition: all must be true', () => {
    const cond: CompoundCondition = {
      type: 'and',
      conditions: [
        { field: 'role', operator: '=', value: 'admin' },
        { field: 'active', operator: '=', value: true },
      ],
    };
    expect(evaluateCondition(cond, { role: 'admin', active: true })).toBe(true);
    expect(evaluateCondition(cond, { role: 'admin', active: false })).toBe(false);
    expect(evaluateCondition(cond, { role: 'user', active: true })).toBe(false);
  });

  it('compound OR condition: at least one must be true', () => {
    const cond: CompoundCondition = {
      type: 'or',
      conditions: [
        { field: 'role', operator: '=', value: 'admin' },
        { field: 'role', operator: '=', value: 'superuser' },
      ],
    };
    expect(evaluateCondition(cond, { role: 'admin' })).toBe(true);
    expect(evaluateCondition(cond, { role: 'superuser' })).toBe(true);
    expect(evaluateCondition(cond, { role: 'guest' })).toBe(false);
  });

  it('compound NOT condition: inverts the inner condition', () => {
    const cond: CompoundCondition = {
      type: 'not',
      conditions: [
        { field: 'blocked', operator: '=', value: true },
      ],
    };
    expect(evaluateCondition(cond, { blocked: false })).toBe(true);
    expect(evaluateCondition(cond, { blocked: true })).toBe(false);
  });

  it('nested compound conditions (AND inside OR)', () => {
    const cond: CompoundCondition = {
      type: 'or',
      conditions: [
        {
          type: 'and',
          conditions: [
            { field: 'role', operator: '=', value: 'admin' },
            { field: 'verified', operator: '=', value: true },
          ],
        },
        { field: 'superuser', operator: '=', value: true },
      ],
    };
    // Verified admin passes
    expect(evaluateCondition(cond, { role: 'admin', verified: true, superuser: false })).toBe(true);
    // Unverified admin fails the AND, but superuser=true passes the OR
    expect(evaluateCondition(cond, { role: 'admin', verified: false, superuser: true })).toBe(true);
    // Neither
    expect(evaluateCondition(cond, { role: 'user', verified: false, superuser: false })).toBe(false);
  });
});

// ===========================================================================
// evaluate (full document evaluation)
// ===========================================================================
describe('evaluate', () => {
  it('default deny for unmatched actions', () => {
    const doc = buildDoc({
      permits: [makePermit('file.read', '/data')],
    });
    const result = evaluate(doc, 'network.send', '/anywhere');
    expect(result.permitted).toBe(false);
    expect(result.reason).toContain('No matching rules');
  });

  it('permits a matching action', () => {
    const doc = buildDoc({
      permits: [makePermit('file.read', '/data')],
    });
    const result = evaluate(doc, 'file.read', '/data');
    expect(result.permitted).toBe(true);
  });

  it('denies a matching deny rule', () => {
    const doc = buildDoc({
      denies: [makeDeny('file.delete', '/system')],
    });
    const result = evaluate(doc, 'file.delete', '/system');
    expect(result.permitted).toBe(false);
    expect(result.matchedRule?.type).toBe('deny');
  });

  it('deny wins at equal specificity', () => {
    const doc = buildDoc({
      permits: [makePermit('file.read', '/data')],
      denies: [makeDeny('file.read', '/data')],
    });
    const result = evaluate(doc, 'file.read', '/data');
    expect(result.permitted).toBe(false);
    expect(result.matchedRule?.type).toBe('deny');
  });

  it('more specific permit overrides broader deny', () => {
    const doc = buildDoc({
      permits: [makePermit('file.read', '/data/public')],
      denies: [makeDeny('file.*', '/data/**')],
    });
    const result = evaluate(doc, 'file.read', '/data/public');
    expect(result.permitted).toBe(true);
    expect(result.matchedRule?.type).toBe('permit');
  });

  it('more specific deny overrides broader permit', () => {
    const doc = buildDoc({
      permits: [makePermit('file.*', '/data/**')],
      denies: [makeDeny('file.delete', '/data/system')],
    });
    const result = evaluate(doc, 'file.delete', '/data/system');
    expect(result.permitted).toBe(false);
  });

  it('conditions are evaluated for permit rules', () => {
    const doc = buildDoc({
      permits: [
        makePermit('file.read', '/data', {
          condition: { field: 'user.role', operator: '=', value: 'admin' },
        }),
      ],
    });
    // Admin is permitted
    const adminResult = evaluate(doc, 'file.read', '/data', { user: { role: 'admin' } });
    expect(adminResult.permitted).toBe(true);
    // Guest is not permitted (condition fails, so no match, default deny)
    const guestResult = evaluate(doc, 'file.read', '/data', { user: { role: 'guest' } });
    expect(guestResult.permitted).toBe(false);
  });

  it('conditions are evaluated for deny rules', () => {
    const doc = buildDoc({
      permits: [makePermit('file.read', '/data')],
      denies: [
        makeDeny('file.read', '/data', {
          condition: { field: 'user.role', operator: '=', value: 'guest' },
        }),
      ],
    });
    // Guest is denied (deny condition matches)
    const guestResult = evaluate(doc, 'file.read', '/data', { user: { role: 'guest' } });
    expect(guestResult.permitted).toBe(false);
    // Admin: deny condition does not match, permit wins
    const adminResult = evaluate(doc, 'file.read', '/data', { user: { role: 'admin' } });
    expect(adminResult.permitted).toBe(true);
  });

  it('returns severity from the winning rule', () => {
    const doc = buildDoc({
      denies: [makeDeny('file.delete', '/system', { severity: 'critical' })],
    });
    const result = evaluate(doc, 'file.delete', '/system');
    expect(result.severity).toBe('critical');
  });

  it('allMatches includes all matching rules', () => {
    const doc = buildDoc({
      permits: [makePermit('file.read', '/data')],
      denies: [makeDeny('**', '**')],
    });
    const result = evaluate(doc, 'file.read', '/data');
    expect(result.allMatches.length).toBe(2);
  });

  it('wildcard patterns in document rules match actions', () => {
    const doc = buildDoc({
      permits: [makePermit('file.**', '/data/**')],
    });
    const result = evaluate(doc, 'file.read.deep', '/data/nested/path');
    expect(result.permitted).toBe(true);
  });
});

// ===========================================================================
// checkRateLimit
// ===========================================================================
describe('checkRateLimit', () => {
  it('returns not exceeded when within limit', () => {
    const doc = buildDoc({
      limits: [makeLimit('api.call', 100, 60)],
    });
    const now = Date.now();
    const result = checkRateLimit(doc, 'api.call', 50, now - 10000, now);
    expect(result.exceeded).toBe(false);
    expect(result.remaining).toBe(50);
    expect(result.limit).toBeDefined();
  });

  it('returns exceeded when over limit', () => {
    const doc = buildDoc({
      limits: [makeLimit('api.call', 100, 60)],
    });
    const now = Date.now();
    const result = checkRateLimit(doc, 'api.call', 100, now - 10000, now);
    expect(result.exceeded).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('returns exceeded when count exceeds limit', () => {
    const doc = buildDoc({
      limits: [makeLimit('api.call', 10, 60)],
    });
    const now = Date.now();
    const result = checkRateLimit(doc, 'api.call', 15, now - 10000, now);
    expect(result.exceeded).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('resets after period expires', () => {
    const doc = buildDoc({
      limits: [makeLimit('api.call', 100, 60)],
    });
    const now = Date.now();
    // Period started 120 seconds ago (period is 60 seconds), so it's expired
    const result = checkRateLimit(doc, 'api.call', 100, now - 120000, now);
    expect(result.exceeded).toBe(false);
    expect(result.remaining).toBe(100);
  });

  it('returns not exceeded with unlimited remaining when no matching limit', () => {
    const doc = buildDoc({
      limits: [makeLimit('api.call', 100, 60)],
    });
    const now = Date.now();
    const result = checkRateLimit(doc, 'network.send', 9999, now, now);
    expect(result.exceeded).toBe(false);
    expect(result.remaining).toBe(Infinity);
    expect(result.limit).toBeUndefined();
  });

  it('matches wildcard limit patterns', () => {
    const doc = buildDoc({
      limits: [makeLimit('api.*', 50, 30)],
    });
    const now = Date.now();
    const result = checkRateLimit(doc, 'api.call', 30, now - 5000, now);
    expect(result.exceeded).toBe(false);
    expect(result.remaining).toBe(20);
    expect(result.limit?.count).toBe(50);
  });

  it('picks the most specific matching limit', () => {
    const doc = buildDoc({
      limits: [
        makeLimit('api.*', 100, 60),
        makeLimit('api.call', 10, 60),
      ],
    });
    const now = Date.now();
    const result = checkRateLimit(doc, 'api.call', 8, now - 5000, now);
    // api.call is more specific than api.*
    expect(result.limit?.action).toBe('api.call');
    expect(result.limit?.count).toBe(10);
    expect(result.remaining).toBe(2);
  });

  it('remaining never goes below zero', () => {
    const doc = buildDoc({
      limits: [makeLimit('api.call', 5, 60)],
    });
    const now = Date.now();
    const result = checkRateLimit(doc, 'api.call', 20, now - 5000, now);
    expect(result.remaining).toBe(0);
    expect(result.exceeded).toBe(true);
  });
});

// ===========================================================================
// merge
// ===========================================================================
describe('merge', () => {
  it('combines permits from parent and child', () => {
    const parent = buildDoc({
      permits: [makePermit('file.read', '/data')],
    });
    const child = buildDoc({
      permits: [makePermit('file.write', '/data')],
    });
    const merged = merge(parent, child);
    expect(merged.permits.length).toBe(2);
  });

  it('combines denies from parent and child', () => {
    const parent = buildDoc({
      denies: [makeDeny('file.delete', '/system')],
    });
    const child = buildDoc({
      denies: [makeDeny('network.send', '/external')],
    });
    const merged = merge(parent, child);
    expect(merged.denies.length).toBe(2);
  });

  it('takes more restrictive limit when both specify same action', () => {
    const parent = buildDoc({
      limits: [makeLimit('api.call', 100, 60)],
    });
    const child = buildDoc({
      limits: [makeLimit('api.call', 50, 60)],
    });
    const merged = merge(parent, child);
    expect(merged.limits.length).toBe(1);
    expect(merged.limits[0]?.count).toBe(50);
  });

  it('keeps both limits when they target different actions', () => {
    const parent = buildDoc({
      limits: [makeLimit('api.call', 100, 60)],
    });
    const child = buildDoc({
      limits: [makeLimit('file.read', 50, 30)],
    });
    const merged = merge(parent, child);
    expect(merged.limits.length).toBe(2);
  });

  it('merges obligations from both documents', () => {
    const parent = buildDoc({
      obligations: [{ type: 'require', action: 'audit.log', resource: '/data', severity: 'high' as const, line: 1 }],
    });
    const child = buildDoc({
      obligations: [{ type: 'require', action: 'verify.auth', resource: '/data', severity: 'high' as const, line: 1 }],
    });
    const merged = merge(parent, child);
    expect(merged.obligations.length).toBe(2);
  });

  it('merged document has all statements', () => {
    const parent = buildDoc({
      permits: [makePermit('file.read', '/data')],
      denies: [makeDeny('file.delete', '/system')],
    });
    const child = buildDoc({
      permits: [makePermit('file.write', '/data')],
    });
    const merged = merge(parent, child);
    // statements array contains all denies + permits + obligations + limits
    expect(merged.statements.length).toBeGreaterThanOrEqual(3);
  });

  it('parent deny wins over child permit at equal specificity via evaluate', () => {
    const parent = buildDoc({
      denies: [makeDeny('file.delete', '/system')],
    });
    const child = buildDoc({
      permits: [makePermit('file.delete', '/system')],
    });
    const merged = merge(parent, child);
    const result = evaluate(merged, 'file.delete', '/system');
    expect(result.permitted).toBe(false);
  });
});

// ===========================================================================
// validateNarrowing
// ===========================================================================
describe('validateNarrowing', () => {
  it('valid narrowing: child permits subset of parent', () => {
    const parent = buildDoc({
      permits: [makePermit('file.**', '/data/**')],
    });
    const child = buildDoc({
      permits: [makePermit('file.read', '/data/public')],
    });
    const result = validateNarrowing(parent, child);
    expect(result.valid).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it('widening fails: child permits something parent denies', () => {
    const parent = buildDoc({
      permits: [makePermit('file.read', '/data')],
      denies: [makeDeny('file.delete', '/system')],
    });
    const child = buildDoc({
      permits: [makePermit('file.delete', '/system')],
    });
    const result = validateNarrowing(parent, child);
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    // At least one violation should mention the conflict
    const reasons = result.violations.map((v) => v.reason);
    expect(reasons.some((r) => r.includes('denies'))).toBe(true);
  });

  it('widening fails: child permit broader than parent permit', () => {
    const parent = buildDoc({
      permits: [makePermit('file.read', '/data')],
    });
    const child = buildDoc({
      permits: [makePermit('**', '**')],
    });
    const result = validateNarrowing(parent, child);
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('valid narrowing: child adds additional denies (no permits to widen)', () => {
    const parent = buildDoc({
      permits: [makePermit('file.read', '/data')],
    });
    const child = buildDoc({
      denies: [makeDeny('file.read', '/data/secret')],
    });
    // Child only adds denies, no new permits, so it's valid
    const result = validateNarrowing(parent, child);
    expect(result.valid).toBe(true);
  });

  it('identical parent and child is valid', () => {
    const parent = buildDoc({
      permits: [makePermit('file.read', '/data')],
    });
    const child = buildDoc({
      permits: [makePermit('file.read', '/data')],
    });
    const result = validateNarrowing(parent, child);
    expect(result.valid).toBe(true);
  });

  it('empty child is always valid', () => {
    const parent = buildDoc({
      permits: [makePermit('file.read', '/data')],
      denies: [makeDeny('file.delete', '/system')],
    });
    const child = buildDoc({});
    const result = validateNarrowing(parent, child);
    expect(result.valid).toBe(true);
  });

  it('violations include references to the conflicting rules', () => {
    const parent = buildDoc({
      denies: [makeDeny('file.delete', '/system')],
    });
    const child = buildDoc({
      permits: [makePermit('file.delete', '/system')],
    });
    const result = validateNarrowing(parent, child);
    expect(result.violations.length).toBeGreaterThan(0);
    const violation = result.violations[0]!;
    expect(violation.childRule).toBeDefined();
    expect(violation.parentRule).toBeDefined();
    expect(violation.reason).toBeTruthy();
  });
});

// ===========================================================================
// serialize -> parse round-trip
// ===========================================================================
describe('serialize -> parse round-trip', () => {
  it('preserves permit statements', () => {
    const source = "permit file.read on '/data'";
    const doc = parse(source);
    const serialized = serialize(doc);
    const reparsed = parse(serialized);
    expect(reparsed.permits.length).toBe(1);
    expect(reparsed.permits[0]?.action).toBe('file.read');
    expect(reparsed.permits[0]?.resource).toBe('/data');
  });

  it('preserves deny statements', () => {
    const source = "deny file.delete on '/system'";
    const doc = parse(source);
    const serialized = serialize(doc);
    const reparsed = parse(serialized);
    expect(reparsed.denies.length).toBe(1);
    expect(reparsed.denies[0]?.action).toBe('file.delete');
    expect(reparsed.denies[0]?.resource).toBe('/system');
  });

  it('preserves require statements', () => {
    const source = "require audit.log on '/sensitive'";
    const doc = parse(source);
    const serialized = serialize(doc);
    const reparsed = parse(serialized);
    expect(reparsed.obligations.length).toBe(1);
    expect(reparsed.obligations[0]?.action).toBe('audit.log');
  });

  it('preserves limit statements', () => {
    const source = 'limit api.call 100 per 60 seconds';
    const doc = parse(source);
    const serialized = serialize(doc);
    const reparsed = parse(serialized);
    expect(reparsed.limits.length).toBe(1);
    expect(reparsed.limits[0]?.count).toBe(100);
    expect(reparsed.limits[0]?.periodSeconds).toBe(60);
  });

  it('preserves conditions through round-trip', () => {
    const source = "permit file.read on '/data' when user.role = 'admin'";
    const doc = parse(source);
    const serialized = serialize(doc);
    const reparsed = parse(serialized);
    const condition = reparsed.permits[0]?.condition as Condition;
    expect(condition.field).toBe('user.role');
    expect(condition.operator).toBe('=');
    expect(condition.value).toBe('admin');
  });

  it('preserves severity through round-trip', () => {
    const source = "deny file.delete on '/system' severity critical";
    const doc = parse(source);
    const serialized = serialize(doc);
    const reparsed = parse(serialized);
    expect(reparsed.denies[0]?.severity).toBe('critical');
  });

  it('preserves default severity (high) through round-trip by omitting it', () => {
    const source = "permit file.read on '/data'";
    const doc = parse(source);
    const serialized = serialize(doc);
    // Default severity 'high' should not appear in the serialized output
    expect(serialized).not.toContain('severity');
    const reparsed = parse(serialized);
    expect(reparsed.permits[0]?.severity).toBe('high');
  });

  it('preserves compound conditions through round-trip', () => {
    const source = "permit file.read on '/data' when user.role = 'admin' and user.active = true";
    const doc = parse(source);
    const serialized = serialize(doc);
    const reparsed = parse(serialized);
    const condition = reparsed.permits[0]?.condition as CompoundCondition;
    expect(condition.type).toBe('and');
    expect(condition.conditions.length).toBe(2);
  });

  it('preserves evaluation semantics through round-trip', () => {
    const source = `permit file.read on '/data' when user.role = 'admin'
deny file.delete on '/system' severity critical`;
    const doc = parse(source);
    const serialized = serialize(doc);
    const reparsed = parse(serialized);

    // Both docs should evaluate the same way
    const ctx: EvaluationContext = { user: { role: 'admin' } };
    const result1 = evaluate(doc, 'file.read', '/data', ctx);
    const result2 = evaluate(reparsed, 'file.read', '/data', ctx);
    expect(result1.permitted).toBe(result2.permitted);

    const deny1 = evaluate(doc, 'file.delete', '/system');
    const deny2 = evaluate(reparsed, 'file.delete', '/system');
    expect(deny1.permitted).toBe(deny2.permitted);
    expect(deny1.severity).toBe(deny2.severity);
  });

  it('preserves multi-statement documents', () => {
    const source = `permit file.read on '/public'
deny file.delete on '/system'
require audit.log on '/data'
limit api.call 50 per 30 seconds`;
    const doc = parse(source);
    const serialized = serialize(doc);
    const reparsed = parse(serialized);
    expect(reparsed.permits.length).toBe(1);
    expect(reparsed.denies.length).toBe(1);
    expect(reparsed.obligations.length).toBe(1);
    expect(reparsed.limits.length).toBe(1);
    expect(reparsed.statements.length).toBe(4);
  });

  it('preserves non-high severity through round-trip', () => {
    const sources = [
      "deny a on '/' severity critical",
      "deny b on '/' severity medium",
      "deny c on '/' severity low",
    ];
    for (const source of sources) {
      const doc = parse(source);
      const serialized = serialize(doc);
      const reparsed = parse(serialized);
      expect(reparsed.denies[0]?.severity).toBe(doc.denies[0]?.severity);
    }
  });
});
