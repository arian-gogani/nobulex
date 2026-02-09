/**
 * Example 01: Basic Covenant
 *
 * Getting started with the Stele SDK. Demonstrates:
 * - Generating Ed25519 key pairs for issuer and beneficiary
 * - Creating a simple permit/deny covenant
 * - Verifying the covenant's cryptographic integrity
 * - Evaluating actions against the covenant's constraints
 * - Inspecting the full document structure
 *
 * Run: npx tsx examples/01-basic-covenant.ts
 */

import {
  SteleClient,
  generateKeyPair,
  type Issuer,
  type Beneficiary,
} from '@stele/sdk';

async function main() {
  console.log('========================================');
  console.log('  Example 01: Basic Covenant');
  console.log('========================================\n');

  // ── Step 1: Generate key pairs ─────────────────────────────────────────
  // Each party in a covenant needs an Ed25519 key pair.
  // The private key signs documents; the public key verifies them.

  console.log('--- Step 1: Generate Key Pairs ---\n');

  const issuerKeys = await generateKeyPair();
  console.log('Issuer public key: ', issuerKeys.publicKeyHex.slice(0, 32) + '...');

  const beneficiaryKeys = await generateKeyPair();
  console.log('Beneficiary public key:', beneficiaryKeys.publicKeyHex.slice(0, 32) + '...');

  // ── Step 2: Define the parties ─────────────────────────────────────────
  // An issuer creates and signs the covenant. A beneficiary is bound by it.

  const issuer: Issuer = {
    id: 'org:acme-corp',
    publicKey: issuerKeys.publicKeyHex,
    role: 'issuer',
    name: 'Acme Corp',
  };

  const beneficiary: Beneficiary = {
    id: 'agent:data-analyst-v1',
    publicKey: beneficiaryKeys.publicKeyHex,
    role: 'beneficiary',
    name: 'Data Analyst Agent v1',
  };

  // ── Step 3: Create the SteleClient ─────────────────────────────────────
  // The client manages key pairs and provides the high-level API.

  const client = new SteleClient({ keyPair: issuerKeys });

  // ── Step 4: Create a covenant ──────────────────────────────────────────
  // Constraints are written in CCL (Covenant Constraint Language).
  // - permit: allows an action on a resource
  // - deny: blocks an action on a resource
  // - **: wildcard matching any path segments

  console.log('\n--- Step 2: Create Covenant ---\n');

  const covenant = await client.createCovenant({
    issuer,
    beneficiary,
    constraints: [
      "permit read on '/data/**'",
      "permit list on '/data/**'",
      "deny write on '/data/secrets/**'",
      "deny delete on '**'",
    ].join('\n'),
    metadata: {
      name: 'Data Access Policy',
      description: 'Read-only data access with secret protection',
      tags: ['data-access', 'read-only', 'production'],
    },
  });

  console.log('Covenant ID:     ', covenant.id.slice(0, 32) + '...');
  console.log('Protocol version:', covenant.version);
  console.log('Created at:      ', covenant.createdAt);
  console.log('Issuer:          ', covenant.issuer.name, '(' + covenant.issuer.id + ')');
  console.log('Beneficiary:     ', covenant.beneficiary.name, '(' + covenant.beneficiary.id + ')');

  // ── Step 5: Verify the covenant ────────────────────────────────────────
  // Verification checks cryptographic integrity, CCL syntax, expiry, etc.

  console.log('\n--- Step 3: Verify Covenant ---\n');

  const verification = await client.verifyCovenant(covenant);
  console.log('Overall valid:', verification.valid);
  console.log('Checks performed:');
  for (const check of verification.checks) {
    const icon = check.passed ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${check.name}: ${check.message}`);
  }

  // ── Step 6: Evaluate actions ───────────────────────────────────────────
  // Test various action/resource pairs against the covenant's constraints.

  console.log('\n--- Step 4: Evaluate Actions ---\n');

  const testCases = [
    { action: 'read', resource: '/data/users' },
    { action: 'list', resource: '/data/reports' },
    { action: 'read', resource: '/data/secrets/api-key' },
    { action: 'write', resource: '/data/secrets/api-key' },
    { action: 'delete', resource: '/data/users' },
    { action: 'write', resource: '/data/public/report.csv' },
  ];

  for (const { action, resource } of testCases) {
    const result = await client.evaluateAction(covenant, action, resource);
    const status = result.permitted ? 'PERMITTED' : 'DENIED';
    const reason = result.reason ? ` (${result.reason})` : '';
    console.log(`  ${action} ${resource} => ${status}${reason}`);
  }

  // ── Step 7: Inspect the full document ──────────────────────────────────
  // The covenant document contains all fields including the cryptographic
  // signature, nonce for replay protection, and metadata.

  console.log('\n--- Step 5: Full Document Structure ---\n');

  console.log(JSON.stringify(covenant, null, 2));

  console.log('\n========================================');
  console.log('  Example complete!');
  console.log('========================================');
}

main().catch(console.error);
