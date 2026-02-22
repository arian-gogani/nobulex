/**
 * Example 08: Covenant with When Conditions
 *
 * Creates a full covenant document with conditional CCL constraints,
 * then evaluates actions with different context (role, environment).
 *
 * Demonstrates:
 * - Building a covenant with `when` clauses (role-based, environment-based)
 * - Evaluating actions with EvaluationContext
 * - How the same action can be permitted or denied based on context
 *
 * Run: npx tsx examples/08-covenant-with-when.ts
 */

import {
  SteleClient,
  generateKeyPair,
  type Issuer,
  type Beneficiary,
} from '@nobulex/sdk';

async function main() {
  console.log('========================================');
  console.log('  Example 08: Covenant with When Conditions');
  console.log('========================================\n');

  const issuerKeys = await generateKeyPair();
  const beneficiaryKeys = await generateKeyPair();

  const issuer: Issuer = {
    id: 'org:acme',
    publicKey: issuerKeys.publicKeyHex,
    role: 'issuer',
    name: 'Acme Corp',
  };

  const beneficiary: Beneficiary = {
    id: 'agent:analyst',
    publicKey: beneficiaryKeys.publicKeyHex,
    role: 'beneficiary',
    name: 'Data Analyst Agent',
  };

  const client = new SteleClient({ keyPair: issuerKeys });

  // Covenant with when conditions:
  // - Admins can read/write anywhere in /data
  // - Viewers can only read /data/public
  // - Staging writes allowed for admins; production writes denied at night
  const constraints = [
    "permit read on '/data/**' when role = 'admin'",
    "permit write on '/data/**' when role = 'admin' and environment = 'staging'",
    "permit read on '/data/public/**' when role = 'viewer'",
    "deny write on '/data/production/**' when time_of_day = 'night'",
    "deny delete on '**'",
  ].join('\n');

  console.log('--- Covenant Constraints ---\n');
  console.log(constraints);
  console.log('');

  const covenant = await client.createCovenant({
    issuer,
    beneficiary,
    constraints,
    metadata: { name: 'Role-based data access' },
  });

  console.log('Covenant ID:', covenant.id.slice(0, 24) + '...\n');

  // Evaluate with different contexts
  const testCases: Array<{
    action: string;
    resource: string;
    context?: Record<string, string>;
    label: string;
  }> = [
    { action: 'read', resource: '/data/reports', context: { role: 'admin' }, label: 'admin reads /data/reports' },
    { action: 'read', resource: '/data/reports', context: { role: 'viewer' }, label: 'viewer reads /data/reports (denied)' },
    { action: 'read', resource: '/data/public/readme', context: { role: 'viewer' }, label: 'viewer reads /data/public' },
    { action: 'write', resource: '/data/staging/out.csv', context: { role: 'admin', environment: 'staging' }, label: 'admin writes staging' },
    { action: 'write', resource: '/data/production/out.csv', context: { role: 'admin', time_of_day: 'night' }, label: 'admin writes prod at night (denied)' },
    { action: 'delete', resource: '/data/temp', context: { role: 'admin' }, label: 'admin deletes (denied)' },
  ];

  console.log('--- Context-Aware Evaluations ---\n');

  for (const { action, resource, context, label } of testCases) {
    const result = await client.evaluateAction(covenant, action, resource, context);
    const status = result.permitted ? 'PERMITTED' : 'DENIED';
    const ctxStr = context ? ` { ${Object.entries(context).map(([k, v]) => `${k}=${v}`).join(', ')} }` : '';
    console.log(`  ${label}`);
    console.log(`    ${action} ${resource}${ctxStr} => ${status}`);
    if (result.reason) console.log(`    Reason: ${result.reason}`);
    console.log('');
  }

  console.log('========================================');
  console.log('  Example complete!');
  console.log('========================================');
}

main().catch(console.error);
