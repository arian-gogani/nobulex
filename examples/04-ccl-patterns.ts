/**
 * Example 04: CCL Patterns
 *
 * Deep dive into the Covenant Constraint Language (CCL). Demonstrates:
 * - Basic permit/deny parsing and evaluation
 * - Conditional constraints with `when` clauses (role, time_of_day)
 * - Rate limiting with `limit` statements
 * - Resource wildcards: '**', '/data/**'
 * - Merging two CCL documents (deny-wins semantics)
 * - Narrowing validation between parent and child constraints
 *
 * Note: `severity` is a reserved keyword in CCL `when` conditions.
 * Use `risk_level` or similar names instead.
 *
 * Run: npx tsx examples/04-ccl-patterns.ts
 */

import {
  parse,
  evaluate,
  merge,
  serialize,
  validateNarrowing,
  checkRateLimit,
  matchAction,
  matchResource,
  type CCLDocument,
  type EvaluationContext,
} from '@stele/ccl';

function main() {
  console.log('========================================');
  console.log('  Example 04: CCL Patterns');
  console.log('========================================\n');

  // ── Pattern 1: Basic Permit/Deny ────────────────────────────────────────
  // The simplest constraints: allow or block specific action/resource pairs.

  console.log('--- Pattern 1: Basic Permit/Deny ---\n');

  const basicCCL = parse([
    "permit read on '/data/**'",
    "permit list on '/data/**'",
    "deny write on '/data/secrets/**'",
    "deny delete on '**'",
  ].join('\n'));

  console.log('Parsed', basicCCL.statements.length, 'statements:');
  console.log('  Permits:', basicCCL.permits.length);
  console.log('  Denies: ', basicCCL.denies.length);
  console.log('  Limits: ', basicCCL.limits.length);

  // Evaluate some actions
  const basicTests = [
    { action: 'read', resource: '/data/users' },
    { action: 'write', resource: '/data/secrets/api-key' },
    { action: 'delete', resource: '/data/users' },
    { action: 'read', resource: '/other/path' },
  ];

  console.log('\nEvaluations:');
  for (const { action, resource } of basicTests) {
    const result = evaluate(basicCCL, action, resource);
    const status = result.permitted ? 'PERMITTED' : 'DENIED';
    const reason = result.reason ? ` (${result.reason})` : '';
    console.log(`  ${action} ${resource} => ${status}${reason}`);
  }

  // ── Pattern 2: Conditional Constraints (when clauses) ───────────────────
  // Constraints can include conditions that check context variables.
  // IMPORTANT: Do NOT use "severity" as a condition key -- it is reserved.
  // Use names like "role", "time_of_day", "risk_level" instead.

  console.log('\n--- Pattern 2: Conditional Constraints ---\n');

  const conditionalCCL = parse([
    "permit read on '/data/**' when role = 'admin'",
    "permit read on '/data/public/**' when role = 'viewer'",
    "deny write on '/data/**' when time_of_day = 'night'",
    "permit write on '/data/staging/**' when role = 'admin'",
  ].join('\n'));

  console.log('Parsed', conditionalCCL.statements.length, 'conditional statements');

  // Evaluate with different contexts
  const contextTests: Array<{ action: string; resource: string; context: EvaluationContext; label: string }> = [
    {
      action: 'read',
      resource: '/data/reports',
      context: { role: 'admin' },
      label: 'admin reads /data/reports',
    },
    {
      action: 'read',
      resource: '/data/reports',
      context: { role: 'viewer' },
      label: 'viewer reads /data/reports',
    },
    {
      action: 'read',
      resource: '/data/public/readme',
      context: { role: 'viewer' },
      label: 'viewer reads /data/public/readme',
    },
    {
      action: 'write',
      resource: '/data/staging/output.csv',
      context: { role: 'admin', time_of_day: 'day' },
      label: 'admin writes staging (daytime)',
    },
    {
      action: 'write',
      resource: '/data/staging/output.csv',
      context: { role: 'admin', time_of_day: 'night' },
      label: 'admin writes staging (nighttime)',
    },
  ];

  console.log('\nContext-aware evaluations:');
  for (const { action, resource, context, label } of contextTests) {
    const result = evaluate(conditionalCCL, action, resource, context);
    const status = result.permitted ? 'PERMITTED' : 'DENIED';
    console.log(`  ${label} => ${status}`);
  }

  // ── Pattern 3: Rate Limiting ────────────────────────────────────────────
  // Limit statements restrict how many times an action can be performed
  // within a time period.

  console.log('\n--- Pattern 3: Rate Limiting ---\n');

  const rateLimitCCL = parse([
    "permit read on '**'",
    "permit write on '/data/**'",
    'limit api.call 1000 per 1 hours',
    'limit data.write 100 per 1 hours',
  ].join('\n'));

  console.log('Rate limit rules:');
  for (const limit of rateLimitCCL.limits) {
    console.log(`  ${limit.action}: ${limit.count} per ${limit.periodCount} ${limit.periodUnit}`);
  }

  // Check rate limits programmatically
  const rateLimitResult1 = checkRateLimit(rateLimitCCL, 'api.call', 500);
  console.log('\nRate limit check (api.call, 500 used):');
  console.log('  Exceeded:', rateLimitResult1.exceeded);
  console.log('  Remaining:', rateLimitResult1.remaining);

  const rateLimitResult2 = checkRateLimit(rateLimitCCL, 'api.call', 1001);
  console.log('\nRate limit check (api.call, 1001 used):');
  console.log('  Exceeded:', rateLimitResult2.exceeded);
  console.log('  Remaining:', rateLimitResult2.remaining);

  // ── Pattern 4: Resource Wildcards ───────────────────────────────────────
  // '**' matches any resource path. '/data/**' matches anything under /data/.
  // Exact paths like '/secrets' do NOT match '/secrets/key' -- use '/secrets/**'.

  console.log('\n--- Pattern 4: Resource Wildcards ---\n');

  const wildcardTests = [
    { pattern: '**', resource: '/anything/at/all', expected: true },
    { pattern: '/data/**', resource: '/data/users/123', expected: true },
    { pattern: '/data/**', resource: '/other/path', expected: false },
    { pattern: '/secrets', resource: '/secrets', expected: true },
    { pattern: '/secrets', resource: '/secrets/key', expected: false },
    { pattern: '/secrets/**', resource: '/secrets/key', expected: true },
  ];

  console.log('Resource matching:');
  for (const { pattern, resource, expected } of wildcardTests) {
    const matches = matchResource(pattern, resource);
    const icon = matches === expected ? 'OK' : 'MISMATCH';
    console.log(`  matchResource('${pattern}', '${resource}') => ${matches} [${icon}]`);
  }

  // Action matching works similarly
  console.log('\nAction matching:');
  const actionTests = [
    { pattern: 'read', action: 'read', expected: true },
    { pattern: 'read', action: 'write', expected: false },
    { pattern: '**', action: 'anything', expected: true },
    { pattern: 'file.*', action: 'file.read', expected: true },
    { pattern: 'file.*', action: 'file.write', expected: true },
    { pattern: 'file.*', action: 'network.read', expected: false },
  ];

  for (const { pattern, action, expected } of actionTests) {
    const matches = matchAction(pattern, action);
    const icon = matches === expected ? 'OK' : 'MISMATCH';
    console.log(`  matchAction('${pattern}', '${action}') => ${matches} [${icon}]`);
  }

  // ── Pattern 5: Merging CCL Documents (Deny-Wins) ────────────────────────
  // When two CCL documents are merged, denies from either document prevail.
  // Limits use the more restrictive value.

  console.log('\n--- Pattern 5: Merging CCL Documents ---\n');

  const docA = parse([
    "permit read on '**'",
    "permit write on '/data/**'",
    'limit api.call 1000 per 1 hours',
  ].join('\n'));

  const docB = parse([
    "deny write on '/data/production/**'",
    "permit read on '/data/**'",
    'limit api.call 500 per 1 hours',
  ].join('\n'));

  console.log('Document A:');
  console.log('  ' + serialize(docA).split('\n').join('\n  '));

  console.log('\nDocument B:');
  console.log('  ' + serialize(docB).split('\n').join('\n  '));

  const merged = merge(docA, docB);

  console.log('\nMerged result (deny-wins):');
  console.log('  ' + serialize(merged).split('\n').join('\n  '));

  // Verify merged behavior
  console.log('\nMerged evaluations:');
  const mergedTests = [
    { action: 'read', resource: '/data/users' },
    { action: 'write', resource: '/data/staging/file.csv' },
    { action: 'write', resource: '/data/production/table' },
  ];

  for (const { action, resource } of mergedTests) {
    const result = evaluate(merged, action, resource);
    const status = result.permitted ? 'PERMITTED' : 'DENIED';
    console.log(`  ${action} ${resource} => ${status}`);
  }

  // ── Pattern 6: Narrowing Validation ─────────────────────────────────────
  // A child document must only narrow (restrict) permissions, never broaden.
  // This ensures the principle of least privilege in delegation chains.

  console.log('\n--- Pattern 6: Narrowing Validation ---\n');

  const parentCCL = parse([
    "permit read on '/data/**'",
    "permit write on '/data/staging/**'",
    "deny delete on '**'",
  ].join('\n'));

  // Valid narrowing: child restricts to read-only
  const validChildCCL = parse([
    "permit read on '/data/**'",
    "deny write on '**'",
    "deny delete on '**'",
  ].join('\n'));

  const narrowResult1 = validateNarrowing(parentCCL, validChildCCL);
  console.log('Valid narrowing (read-only child):');
  console.log('  Valid:', narrowResult1.valid);
  console.log('  Violations:', narrowResult1.violations.length);

  // Invalid narrowing: child tries to permit something parent denies
  const invalidChildCCL = parse([
    "permit read on '/data/**'",
    "permit delete on '/data/staging/**'",  // Parent denies delete on '**'
  ].join('\n'));

  const narrowResult2 = validateNarrowing(parentCCL, invalidChildCCL);
  console.log('\nInvalid narrowing (child permits delete):');
  console.log('  Valid:', narrowResult2.valid);
  console.log('  Violations:', narrowResult2.violations.length);
  for (const v of narrowResult2.violations) {
    console.log(`    - ${v.reason}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log('\n--- Summary ---\n');
  console.log('Patterns demonstrated:');
  console.log('  1. Basic permit/deny parsing and evaluation');
  console.log('  2. Conditional constraints with when clauses');
  console.log('  3. Rate limiting with limit statements');
  console.log('  4. Resource and action wildcard matching');
  console.log('  5. Merging CCL documents with deny-wins semantics');
  console.log('  6. Narrowing validation for delegation chains');

  console.log('\n========================================');
  console.log('  Example complete!');
  console.log('========================================');
}

main();
