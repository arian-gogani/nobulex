import { describe, it, expect } from 'vitest';
import {
  parse,
  validateCCL,
  tokenize,
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

function buildDoc(opts: {
  permits?: PermitDenyStatement[];
  denies?: PermitDenyStatement[];
  obligations?: unknown[];
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

describe('Lexer (tokenize)', () => {
  it('tokenizes statement keywords, identifiers, strings, and operators', () => {
    const tokens = tokenize("permit file.read on '/data' when user.role = 'admin'");
    const types = tokens.map((t) => t.type);
    expect(types).toContain('PERMIT');
    expect(types).toContain('IDENTIFIER');
    expect(types).toContain('DOT');
    expect(types).toContain('ON');
    expect(types).toContain('STRING');
    expect(types).toContain('WHEN');
    expect(types).toContain('OPERATOR');
    expect(types).toContain('EOF');
    const stringTokens = tokens.filter((t) => t.type === 'STRING').map((t) => t.value);
    expect(stringTokens).toContain('/data');
    expect(stringTokens).toContain('admin');
  });

  it('tokenizes every comparison operator (=, !=, <, >, <=, >=)', () => {
    const source = "deny ** on '**' when a = 1\ndeny ** on '**' when b != 2\ndeny ** on '**' when c < 3\ndeny ** on '**' when d > 4\ndeny ** on '**' when e <= 5\ndeny ** on '**' when f >= 6";
    const ops = tokenize(source).filter((t) => t.type === 'OPERATOR').map((t) => t.value);
    expect(ops).toEqual(expect.arrayContaining(['=', '!=', '<', '>', '<=', '>=']));
  });

  it('tokenizes word operators and list/paren syntax', () => {
    const tokens = tokenize(
      "deny file.read on '/data' when (content contains 'secret' or role in ['admin', 'root'])",
    );
    const types = tokens.map((t) => t.type);
    const opValues = tokens.filter((t) => t.type === 'OPERATOR').map((t) => t.value);
    expect(opValues).toContain('contains');
    expect(opValues).toContain('in');
    expect(types).toContain('LPAREN');
    expect(types).toContain('RPAREN');
    expect(types).toContain('LBRACKET');
    expect(types).toContain('RBRACKET');
    expect(types).toContain('COMMA');
  });

  it('tokenizes wildcards, preserving DOUBLE_WILDCARD vs WILDCARD distinction', () => {
    const tokens = tokenize("permit ** on '**'\npermit file.* on '/data'");
    const doubles = tokens.filter((t) => t.type === 'DOUBLE_WILDCARD');
    const singles = tokens.filter((t) => t.type === 'WILDCARD');
    expect(doubles.length).toBeGreaterThanOrEqual(1);
    expect(singles.length).toBeGreaterThanOrEqual(1);
    expect(singles[0]?.value).toBe('*');
  });

  it('tracks comments, blank lines, and line/column numbers', () => {
    const source = `# This is a comment
permit file.read on '/data'

deny file.write on '/data'`;
    const tokens = tokenize(source);
    const comments = tokens.filter((t) => t.type === 'COMMENT');
    expect(comments.length).toBe(1);
    expect(comments[0]?.value).toContain('This is a comment');
    const permitTok = tokens.find((t) => t.type === 'PERMIT');
    const denyTok = tokens.find((t) => t.type === 'DENY');
    expect(permitTok?.line).toBe(2);
    expect(permitTok?.column).toBe(1);
    expect(denyTok?.line).toBe(4);
  });

  it('tokenizes bare /path resources as STRING', () => {
    const tokens = tokenize("permit file.read on /data/files");
    const str = tokens.find((t) => t.type === 'STRING');
    expect(str?.value).toBe('/data/files');
  });
});

describe('Parser (parse)', () => {
  it('parses permit/deny/require/limit into the right buckets', () => {
    const doc = parse(`permit file.read on '/data'
deny file.delete on '/data'
require audit.log on '/data'
limit file.read 50 per 30 seconds`);
    expect(doc.permits).toHaveLength(1);
    expect(doc.denies).toHaveLength(1);
    expect(doc.obligations).toHaveLength(1);
    expect(doc.limits).toHaveLength(1);
    expect(doc.statements).toHaveLength(4);
    expect(doc.permits[0]).toMatchObject({ type: 'permit', action: 'file.read', resource: '/data' });
    expect(doc.denies[0]).toMatchObject({ type: 'deny', action: 'file.delete' });
    expect(doc.obligations[0]).toMatchObject({ type: 'require', action: 'audit.log' });
    expect(doc.limits[0]).toMatchObject({ type: 'limit', action: 'file.read', count: 50, periodSeconds: 30 });
  });

  it('parses simple conditions with various operators and types', () => {
    const doc = parse("permit file.read on '/data' when user.role = 'admin'");
    const c = doc.permits[0]?.condition as Condition;
    expect(c).toMatchObject({ field: 'user.role', operator: '=', value: 'admin' });

    const numDoc = parse("permit file.read on '/data' when size < 1000");
    expect((numDoc.permits[0]?.condition as Condition)).toMatchObject({ field: 'size', operator: '<', value: 1000 });

    const boolDoc = parse("permit file.read on '/data' when authorized = true");
    expect((boolDoc.permits[0]?.condition as Condition).value).toBe(true);

    const neq = parse("deny file.write on '/data' when status != 'active'");
    expect((neq.denies[0]?.condition as Condition).operator).toBe('!=');

    const arr = parse("deny file.read on '/data' when user.role in ['admin', 'editor']");
    const arrCond = arr.denies[0]?.condition as Condition;
    expect(arrCond.operator).toBe('in');
    expect(arrCond.value).toEqual(['admin', 'editor']);
  });

  it('parses compound conditions (and/or/not) and nested parentheses', () => {
    const andDoc = parse("permit file.read on '/data' when user.role = 'admin' and user.active = true");
    expect((andDoc.permits[0]?.condition as CompoundCondition).type).toBe('and');

    const orDoc = parse("permit file.read on '/data' when user.role = 'admin' or user.role = 'superuser'");
    expect((orDoc.permits[0]?.condition as CompoundCondition).type).toBe('or');

    const notDoc = parse("deny file.read on '/secret' when not user.authorized = true");
    const notCond = notDoc.denies[0]?.condition as CompoundCondition;
    expect(notCond.type).toBe('not');
    expect(notCond.conditions).toHaveLength(1);

    const nested = parse(
      "permit file.read on '/data' when (user.role = 'admin' or user.role = 'superuser') and user.active = true",
    );
    const root = nested.permits[0]?.condition as CompoundCondition;
    expect(root.type).toBe('and');
    expect((root.conditions[0] as CompoundCondition).type).toBe('or');
  });

  it('parses severity levels and defaults to high', () => {
    const severities = ['critical', 'high', 'medium', 'low'] as const;
    for (const sev of severities) {
      const doc = parse(`deny a on '/' severity ${sev}`);
      expect(doc.denies[0]?.severity).toBe(sev);
    }
    expect(parse("permit file.read on '/data'").permits[0]?.severity).toBe('high');
  });

  it('parses enforcement tier hard/soft and surfaces it in evaluate()', () => {
    const doc = parse("permit read on '/data/**' enforcement hard\ndeny write on '/system/**' enforcement soft");
    expect(doc.permits[0]).toHaveProperty('enforcementTier', 'hard');
    expect(doc.denies[0]).toHaveProperty('enforcementTier', 'soft');
    expect(evaluate(doc, 'read', '/data/file').matchedRule).toHaveProperty('enforcementTier', 'hard');
    expect(evaluate(doc, 'write', '/system/config').matchedRule).toHaveProperty('enforcementTier', 'soft');
  });

  it('parses wildcard action patterns (**, file.*)', () => {
    const doc = parse("permit ** on '**'\npermit file.* on '/data'");
    expect(doc.permits[0]?.action).toBe('**');
    expect(doc.permits[0]?.resource).toBe('**');
    expect(doc.permits[1]?.action).toBe('file.*');
  });

  it('records line numbers on statements and handles blank lines', () => {
    const doc = parse(`permit file.read on '/a'

permit file.write on '/b'`);
    expect(doc.permits).toHaveLength(2);
    expect(doc.permits[0]?.line).toBe(1);
    expect(doc.permits[1]?.line).toBe(3);
  });
});

describe('CCLSyntaxError', () => {
  it('is thrown on invalid syntax with line/column info', () => {
    expect(() => parse('invalid_keyword file.read')).toThrow(CCLSyntaxError);
    try {
      parse('invalid_keyword file.read');
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CCLSyntaxError);
      const err = e as InstanceType<typeof CCLSyntaxError>;
      expect(err.line).toBeDefined();
      expect(err.column).toBeDefined();
      expect(err.message).toContain('CCL Syntax Error');
    }
  });

  it('rejects missing ON, missing limit count, and invalid severity', () => {
    expect(() => parse("permit file.read '/data'")).toThrow(CCLSyntaxError);
    expect(() => parse('limit api.call per 60 seconds')).toThrow(CCLSyntaxError);
    expect(() => parse("deny file.read on '/data' severity invalid_level")).toThrow(CCLSyntaxError);
  });
});

describe('validateCCL', () => {
  it('returns true for valid CCL (single and multi statement) and false otherwise', () => {
    expect(validateCCL("permit file.read on '/data/**'")).toBe(true);
    expect(
      validateCCL(`permit file.read on '/data/**'
deny file.write on '/system/**'
limit api.call 100 per 60 seconds
require audit.log on '**'`),
    ).toBe(true);
    expect(validateCCL('invalid_keyword file.read')).toBe(false);
    expect(validateCCL("permit file.read '/data'")).toBe(false);
    expect(validateCCL('')).toBe(false);
    expect(validateCCL("permit read on '/data'\ninvalid_keyword write")).toBe(false);
  });
});

describe('matchAction', () => {
  it('exact, literal, and negative matches', () => {
    expect(matchAction('file.read', 'file.read')).toBe(true);
    expect(matchAction('file.read', 'file.write')).toBe(false);
    expect(matchAction('a.b.c', 'a.b.c')).toBe(true);
    expect(matchAction('a.b.c', 'a.b.d')).toBe(false);
  });

  it('single wildcard * matches exactly one segment', () => {
    expect(matchAction('file.*', 'file.read')).toBe(true);
    expect(matchAction('*.read', 'network.read')).toBe(true);
    expect(matchAction('a.*.c', 'a.b.c')).toBe(true);
    expect(matchAction('a.*.c', 'a.b.d')).toBe(false);
    expect(matchAction('file.*', 'file')).toBe(false);
    expect(matchAction('file.*', 'file.read.deep')).toBe(false);
  });

  it('double wildcard ** matches zero or more segments anywhere', () => {
    expect(matchAction('**', 'file.read')).toBe(true);
    expect(matchAction('**', 'network.send.data')).toBe(true);
    expect(matchAction('file.**', 'file.read.deep')).toBe(true);
    expect(matchAction('file.**', 'file')).toBe(true);
    expect(matchAction('a.**.c', 'a.b.x.c')).toBe(true);
    expect(matchAction('a.**.c', 'a.c')).toBe(true);
  });
});

describe('matchResource', () => {
  it('exact, nested, and wildcard matches', () => {
    expect(matchResource('/data/files', '/data/files')).toBe(true);
    expect(matchResource('/data/files', '/data/other')).toBe(false);
    expect(matchResource('/data/**', '/data/files/deep/nested')).toBe(true);
    expect(matchResource('/data/**', '/data')).toBe(true);
    expect(matchResource('**', 'simple')).toBe(true);
  });

  it('single wildcard exactly one segment, works in middle position', () => {
    expect(matchResource('/data/*', '/data/files')).toBe(true);
    expect(matchResource('/data/*', '/data/a/b')).toBe(false);
    expect(matchResource('/data/*/files', '/data/user/files')).toBe(true);
    expect(matchResource('/data/*/files', '/data/user/other')).toBe(false);
    expect(matchResource('/data/**/files', '/data/a/b/files')).toBe(true);
    expect(matchResource('/data/**/files', '/data/files')).toBe(true);
  });

  it('normalizes trailing/leading slashes and empty patterns', () => {
    expect(matchResource('/data/', '/data')).toBe(true);
    expect(matchResource('data', '/data/')).toBe(true);
    expect(matchResource('', '')).toBe(true);
  });
});

describe('specificity', () => {
  it('literal segments score 2, * scores 1, ** scores 0', () => {
    expect(specificity('file.read', '/data')).toBe(6);
    expect(specificity('file.*', '')).toBe(3);
    expect(specificity('**', '')).toBe(0);
    expect(specificity('a.*.c', '')).toBe(5);
  });

  it('more specific patterns score higher overall', () => {
    expect(specificity('file.read', '/data/files')).toBeGreaterThan(specificity('**', '**'));
    expect(specificity('file.read', '/data/files')).toBeGreaterThan(specificity('file.read', '/data/**'));
  });
});

describe('evaluateCondition', () => {
  it('equality and inequality', () => {
    expect(evaluateCondition({ field: 'role', operator: '=', value: 'admin' }, { role: 'admin' })).toBe(true);
    expect(evaluateCondition({ field: 'role', operator: '=', value: 'admin' }, { role: 'user' })).toBe(false);
    expect(evaluateCondition({ field: 'status', operator: '!=', value: 'blocked' }, { status: 'active' })).toBe(true);
    expect(evaluateCondition({ field: 'status', operator: '!=', value: 'blocked' }, { status: 'blocked' })).toBe(false);
  });

  it('numeric comparisons (<, >, <=, >=) including boundaries', () => {
    expect(evaluateCondition({ field: 's', operator: '<', value: 100 }, { s: 50 })).toBe(true);
    expect(evaluateCondition({ field: 's', operator: '<', value: 100 }, { s: 100 })).toBe(false);
    expect(evaluateCondition({ field: 's', operator: '>', value: 10 }, { s: 20 })).toBe(true);
    expect(evaluateCondition({ field: 's', operator: '>', value: 10 }, { s: 5 })).toBe(false);
    expect(evaluateCondition({ field: 's', operator: '<=', value: 100 }, { s: 100 })).toBe(true);
    expect(evaluateCondition({ field: 's', operator: '<=', value: 100 }, { s: 101 })).toBe(false);
    expect(evaluateCondition({ field: 's', operator: '>=', value: 50 }, { s: 50 })).toBe(true);
    expect(evaluateCondition({ field: 's', operator: '>=', value: 50 }, { s: 49 })).toBe(false);
  });

  it('nested dot-path access, with safe false for missing fields', () => {
    expect(evaluateCondition({ field: 'a.b.c', operator: '=', value: 42 }, { a: { b: { c: 42 } } })).toBe(true);
    expect(evaluateCondition({ field: 'a.b.c', operator: '=', value: 42 }, { a: { b: { c: 43 } } })).toBe(false);
    expect(evaluateCondition({ field: 'missing.field', operator: '=', value: 'x' }, {})).toBe(false);
    expect(evaluateCondition({ field: 'user.name.first', operator: '=', value: 'Bob' }, { user: {} })).toBe(false);
  });

  it('contains / not_contains on strings and arrays', () => {
    const contains = (val: unknown, data: unknown) =>
      evaluateCondition({ field: 'x', operator: 'contains', value: val }, { x: data });
    const notContains = (val: unknown, data: unknown) =>
      evaluateCondition({ field: 'x', operator: 'not_contains', value: val }, { x: data });
    expect(contains('hello', 'say hello world')).toBe(true);
    expect(contains('hello', 'no greeting')).toBe(false);
    expect(contains('important', ['urgent', 'important'])).toBe(true);
    expect(contains('important', ['urgent'])).toBe(false);
    expect(notContains('secret', 'public info')).toBe(true);
    expect(notContains('secret', 'this is secret')).toBe(false);
    expect(notContains('admin', ['user', 'viewer'])).toBe(true);
    expect(notContains('admin', ['user', 'admin'])).toBe(false);
  });

  it('in / not_in against arrays', () => {
    expect(evaluateCondition({ field: 'role', operator: 'in', value: ['admin', 'editor'] }, { role: 'admin' })).toBe(true);
    expect(evaluateCondition({ field: 'role', operator: 'in', value: ['admin', 'editor'] }, { role: 'viewer' })).toBe(false);
    expect(evaluateCondition({ field: 'role', operator: 'not_in', value: ['blocked'] }, { role: 'admin' })).toBe(true);
    expect(evaluateCondition({ field: 'role', operator: 'not_in', value: ['blocked'] }, { role: 'blocked' })).toBe(false);
    // Numbers coerced to strings for 'in' comparison
    expect(evaluateCondition({ field: 'level', operator: 'in', value: ['1', '2', '3'] }, { level: 2 })).toBe(true);
  });

  it('matches (regex), starts_with, ends_with', () => {
    const emailPat = '^[a-z]+@example\\.com$';
    expect(evaluateCondition({ field: 'email', operator: 'matches', value: emailPat }, { email: 'user@example.com' })).toBe(true);
    expect(evaluateCondition({ field: 'email', operator: 'matches', value: emailPat }, { email: 'user@other.com' })).toBe(false);
    expect(evaluateCondition({ field: 'count', operator: 'matches', value: '\\d+' }, { count: 42 })).toBe(false);
    expect(evaluateCondition({ field: 'p', operator: 'starts_with', value: '/api/' }, { p: '/api/users' })).toBe(true);
    expect(evaluateCondition({ field: 'p', operator: 'starts_with', value: '/api/' }, { p: '/web/home' })).toBe(false);
    expect(evaluateCondition({ field: 'f', operator: 'ends_with', value: '.txt' }, { f: 'readme.txt' })).toBe(true);
    expect(evaluateCondition({ field: 'f', operator: 'ends_with', value: '.txt' }, { f: 'image.png' })).toBe(false);
  });

  it('compound AND/OR/NOT semantics including double NOT', () => {
    const and: CompoundCondition = {
      type: 'and',
      conditions: [
        { field: 'role', operator: '=', value: 'admin' },
        { field: 'active', operator: '=', value: true },
      ],
    };
    expect(evaluateCondition(and, { role: 'admin', active: true })).toBe(true);
    expect(evaluateCondition(and, { role: 'admin', active: false })).toBe(false);

    const or: CompoundCondition = {
      type: 'or',
      conditions: [
        { field: 'role', operator: '=', value: 'admin' },
        { field: 'role', operator: '=', value: 'superuser' },
      ],
    };
    expect(evaluateCondition(or, { role: 'superuser' })).toBe(true);
    expect(evaluateCondition(or, { role: 'guest' })).toBe(false);

    const notC: CompoundCondition = {
      type: 'not',
      conditions: [{ field: 'blocked', operator: '=', value: true }],
    };
    expect(evaluateCondition(notC, { blocked: false })).toBe(true);
    expect(evaluateCondition(notC, { blocked: true })).toBe(false);

    const doubleNot: CompoundCondition = {
      type: 'not',
      conditions: [
        { type: 'not', conditions: [{ field: 'x', operator: '=', value: 1 }] },
      ],
    };
    expect(evaluateCondition(doubleNot, { x: 1 })).toBe(true);
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
    expect(evaluateCondition(cond, { role: 'admin', verified: true, superuser: false })).toBe(true);
    expect(evaluateCondition(cond, { role: 'admin', verified: false, superuser: true })).toBe(true);
    expect(evaluateCondition(cond, { role: 'user', verified: false, superuser: false })).toBe(false);
  });
});

describe('evaluate (document)', () => {
  it('default deny for unmatched actions and permits matching ones', () => {
    const doc = buildDoc({ permits: [makePermit('file.read', '/data')] });
    const miss = evaluate(doc, 'network.send', '/anywhere');
    expect(miss.permitted).toBe(false);
    expect(miss.reason).toContain('No matching rules');
    expect(evaluate(doc, 'file.read', '/data').permitted).toBe(true);
  });

  it('deny wins at equal specificity, specific beats broad', () => {
    const tie = buildDoc({
      permits: [makePermit('file.read', '/data')],
      denies: [makeDeny('file.read', '/data')],
    });
    const tieResult = evaluate(tie, 'file.read', '/data');
    expect(tieResult.permitted).toBe(false);
    expect(tieResult.matchedRule?.type).toBe('deny');

    const specificPermit = buildDoc({
      permits: [makePermit('file.read', '/data/public')],
      denies: [makeDeny('file.*', '/data/**')],
    });
    expect(evaluate(specificPermit, 'file.read', '/data/public').permitted).toBe(true);

    const specificDeny = buildDoc({
      permits: [makePermit('file.*', '/data/**')],
      denies: [makeDeny('file.delete', '/data/system')],
    });
    expect(evaluate(specificDeny, 'file.delete', '/data/system').permitted).toBe(false);
  });

  it('conditions gate permit and deny rules', () => {
    const doc = buildDoc({
      permits: [
        makePermit('file.read', '/data', {
          condition: { field: 'user.role', operator: '=', value: 'admin' },
        }),
      ],
      denies: [
        makeDeny('file.read', '/data', {
          condition: { field: 'user.role', operator: '=', value: 'guest' },
        }),
      ],
    });
    expect(evaluate(doc, 'file.read', '/data', { user: { role: 'admin' } }).permitted).toBe(true);
    expect(evaluate(doc, 'file.read', '/data', { user: { role: 'guest' } }).permitted).toBe(false);
  });

  it('returns severity from winning rule and allMatches lists all matching rules', () => {
    const doc = buildDoc({
      denies: [makeDeny('file.delete', '/system', { severity: 'critical' })],
    });
    expect(evaluate(doc, 'file.delete', '/system').severity).toBe('critical');

    const multi = buildDoc({
      permits: [makePermit('file.read', '/data')],
      denies: [makeDeny('**', '**')],
    });
    expect(evaluate(multi, 'file.read', '/data').allMatches).toHaveLength(2);
  });

  it('evaluates not_contains/not_in/ends_with compound parsed conditions', () => {
    const ncDoc = parse("deny file.write on '**' when content not_contains 'safe'");
    expect(evaluate(ncDoc, 'file.write', '/t', { content: 'dangerous' }).permitted).toBe(false);

    const niDoc = parse("deny api.call on '**' when user.role not_in ['admin', 'operator']");
    const niRes = evaluate(niDoc, 'api.call', '/t', { user: { role: 'viewer' } });
    expect(niRes.permitted).toBe(false);
    expect(niRes.matchedRule?.type).toBe('deny');

    const ewDoc = parse(
      "deny file.write on '**' when filename ends_with '.exe' severity critical",
    );
    const ew = evaluate(ewDoc, 'file.write', '/uploads/malware.exe', { filename: 'malware.exe' });
    expect(ew.permitted).toBe(false);
    expect(ew.severity).toBe('critical');
  });

  it('permits with positive "in" list literal, default-denies outside the list', () => {
    const doc = parse("permit api.call on '**' when user.role in ['admin', 'operator', 'manager']");
    expect(evaluate(doc, 'api.call', '/t', { user: { role: 'admin' } }).permitted).toBe(true);
    expect(evaluate(doc, 'api.call', '/t', { user: { role: 'viewer' } }).permitted).toBe(false);
  });

  it('parenthesized NOT with AND composite', () => {
    const doc = parse(
      "deny api.call on '**' when not user.admin = true and request.size > 100",
    );
    expect(
      evaluate(doc, 'api.call', '/t', { user: { admin: false }, request: { size: 200 } }).permitted,
    ).toBe(false);
  });
});

describe('checkRateLimit', () => {
  it('returns remaining when under limit and exceeded when at/over limit', () => {
    const doc = buildDoc({ limits: [makeLimit('api.call', 100, 60)] });
    const now = Date.now();
    const under = checkRateLimit(doc, 'api.call', 50, now - 10000, now);
    expect(under.exceeded).toBe(false);
    expect(under.remaining).toBe(50);
    expect(under.limit).toBeDefined();

    const at = checkRateLimit(doc, 'api.call', 100, now - 10000, now);
    expect(at.exceeded).toBe(true);
    expect(at.remaining).toBe(0);

    const over = checkRateLimit(doc, 'api.call', 20, now - 10000, now);
    expect(over.remaining).toBe(80);

    const way = checkRateLimit(doc, 'api.call', 150, now - 10000, now);
    expect(way.exceeded).toBe(true);
    expect(way.remaining).toBe(0);
  });

  it('resets once the window has elapsed', () => {
    const doc = buildDoc({ limits: [makeLimit('api.call', 100, 60)] });
    const now = Date.now();
    const reset = checkRateLimit(doc, 'api.call', 100, now - 120000, now);
    expect(reset.exceeded).toBe(false);
    expect(reset.remaining).toBe(100);
  });

  it('unlimited when no limit matches', () => {
    const doc = buildDoc({ limits: [makeLimit('api.call', 100, 60)] });
    const now = Date.now();
    const result = checkRateLimit(doc, 'network.send', 9999, now, now);
    expect(result.exceeded).toBe(false);
    expect(result.remaining).toBe(Infinity);
    expect(result.limit).toBeUndefined();
  });

  it('picks the most specific matching wildcard limit', () => {
    const doc = buildDoc({
      limits: [makeLimit('api.*', 100, 60), makeLimit('api.call', 10, 60)],
    });
    const now = Date.now();
    const result = checkRateLimit(doc, 'api.call', 8, now - 5000, now);
    expect(result.limit?.action).toBe('api.call');
    expect(result.limit?.count).toBe(10);
    expect(result.remaining).toBe(2);
  });
});

describe('merge', () => {
  it('concatenates permits/denies/obligations from parent and child', () => {
    const parent = buildDoc({
      permits: [makePermit('file.read', '/data')],
      denies: [makeDeny('file.delete', '/system')],
      obligations: [{ type: 'require', action: 'audit.log', resource: '/data', severity: 'high' as const, line: 1 }],
    });
    const child = buildDoc({
      permits: [makePermit('file.write', '/data')],
      denies: [makeDeny('network.send', '/external')],
      obligations: [{ type: 'require', action: 'verify.auth', resource: '/data', severity: 'high' as const, line: 1 }],
    });
    const merged = merge(parent, child);
    expect(merged.permits).toHaveLength(2);
    expect(merged.denies).toHaveLength(2);
    expect(merged.obligations).toHaveLength(2);
    expect(merged.statements.length).toBeGreaterThanOrEqual(6);
  });

  it('takes the more restrictive limit for same action, keeps distinct actions', () => {
    const parent = buildDoc({ limits: [makeLimit('api.call', 100, 60), makeLimit('file.read', 50, 30)] });
    const child = buildDoc({ limits: [makeLimit('api.call', 50, 60)] });
    const merged = merge(parent, child);
    const apiLimit = merged.limits.find((l) => l.action === 'api.call');
    expect(apiLimit?.count).toBe(50);
    expect(merged.limits.find((l) => l.action === 'file.read')).toBeDefined();
  });

  it('parent deny still wins over child permit via evaluate after merge', () => {
    const merged = merge(
      buildDoc({ denies: [makeDeny('file.delete', '/system')] }),
      buildDoc({ permits: [makePermit('file.delete', '/system')] }),
    );
    expect(evaluate(merged, 'file.delete', '/system').permitted).toBe(false);
  });
});

describe('validateNarrowing', () => {
  it('valid narrowing, empty child, and identical parent/child are accepted', () => {
    const parent = buildDoc({ permits: [makePermit('file.**', '/data/**')] });
    expect(validateNarrowing(parent, buildDoc({ permits: [makePermit('file.read', '/data/public')] })).valid).toBe(true);
    expect(validateNarrowing(parent, buildDoc({})).valid).toBe(true);
    expect(validateNarrowing(parent, parent).valid).toBe(true);
  });

  it('rejects widening and reports conflicting rule pairs', () => {
    const parent = buildDoc({
      permits: [makePermit('file.read', '/data')],
      denies: [makeDeny('file.delete', '/system')],
    });
    const child = buildDoc({ permits: [makePermit('file.delete', '/system')] });
    const result = validateNarrowing(parent, child);
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    const violation = result.violations[0]!;
    expect(violation.childRule).toBeDefined();
    expect(violation.parentRule).toBeDefined();
    expect(result.violations.some((v) => v.reason.includes('denies'))).toBe(true);
  });

  it('rejects broader child permits with no parent-side denies', () => {
    const result = validateNarrowing(
      buildDoc({ permits: [makePermit('file.read', '/data')] }),
      buildDoc({ permits: [makePermit('**', '**')] }),
    );
    expect(result.valid).toBe(false);
  });

  it('allows adding additional denies in the child', () => {
    const result = validateNarrowing(
      buildDoc({ permits: [makePermit('file.read', '/data')] }),
      buildDoc({ denies: [makeDeny('file.read', '/data/secret')] }),
    );
    expect(result.valid).toBe(true);
  });
});

describe('serialize <-> parse round-trip', () => {
  it('round-trips a full multi-statement doc with severity, conditions and compounds', () => {
    const source = `permit file.read on '/data' when user.role = 'admin' and user.active = true
deny file.delete on '/system' severity critical
require audit.log on '/data'
limit api.call 50 per 30 seconds`;
    const doc = parse(source);
    const serialized = serialize(doc);
    const reparsed = parse(serialized);

    expect(reparsed.permits).toHaveLength(1);
    expect(reparsed.denies).toHaveLength(1);
    expect(reparsed.obligations).toHaveLength(1);
    expect(reparsed.limits).toHaveLength(1);
    expect(reparsed.denies[0]?.severity).toBe('critical');

    const cond = reparsed.permits[0]?.condition as CompoundCondition;
    expect(cond.type).toBe('and');
    expect(cond.conditions).toHaveLength(2);

    // Evaluation semantics preserved
    const ctx: EvaluationContext = { user: { role: 'admin', active: true } };
    expect(evaluate(doc, 'file.read', '/data', ctx).permitted).toBe(
      evaluate(reparsed, 'file.read', '/data', ctx).permitted,
    );
    expect(evaluate(doc, 'file.delete', '/system').severity).toBe(
      evaluate(reparsed, 'file.delete', '/system').severity,
    );
  });

  it('omits default-high severity when serializing', () => {
    const serialized = serialize(parse("permit file.read on '/data'"));
    expect(serialized).not.toContain('severity');
    expect(parse(serialized).permits[0]?.severity).toBe('high');
  });

  it('preserves non-high severities on round trip', () => {
    for (const sev of ['critical', 'medium', 'low'] as const) {
      const source = `deny a on '/' severity ${sev}`;
      const rt = parse(serialize(parse(source)));
      expect(rt.denies[0]?.severity).toBe(sev);
    }
  });
});

describe('CCL time unit conversion', () => {
  it('parses seconds/minutes/hours/days into periodSeconds', () => {
    expect(parse("limit api.call 100 per 60 seconds").limits[0]!.periodSeconds).toBe(60);
    expect(parse("limit api.call 100 per 5 minutes").limits[0]!.periodSeconds).toBe(300);
    expect(parse("limit api.call 500 per 1 hours").limits[0]!.periodSeconds).toBe(3600);
    expect(parse("limit token.usage 100000 per 1 days").limits[0]!.periodSeconds).toBe(86400);
  });

  it('accepts singular forms (minute/hour/day)', () => {
    expect(parse("limit api.call 100 per 1 minute").limits[0]!.periodSeconds).toBe(60);
    expect(parse("limit api.call 100 per 1 hour").limits[0]!.periodSeconds).toBe(3600);
    expect(parse("limit api.call 100 per 1 day").limits[0]!.periodSeconds).toBe(86400);
  });

  it('serializes with the best (largest-fitting) time unit, falls back to seconds', () => {
    expect(serialize(parse("limit api.call 500 per 2 hours"))).toContain('per 2 hours');
    expect(serialize(parse("limit api.call 500 per 90 seconds"))).toContain('per 90 seconds');

    const rt = parse(serialize(parse("limit api.call 100 per 5 minutes")));
    expect(rt.limits[0]!.periodSeconds).toBe(300);
    expect(rt.limits[0]!.count).toBe(100);
  });
});
