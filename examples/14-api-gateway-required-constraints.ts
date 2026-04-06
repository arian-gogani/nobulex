/**
 * Example 14: API Gateway with Required Constraints
 *
 * Demonstrates kovaGatewayMiddleware with requiredConstraints: the API
 * rejects agents whose covenant does not include specific CCL statements.
 *
 * Run: npx tsx examples/14-api-gateway-required-constraints.ts
 *
 * This example simulates the middleware flow (no HTTP server). For a full
 * Express setup, see docs/API-GATEWAY-GUIDE.md.
 */

import { NobulexClient, kovaGatewayMiddleware, serializeCovenant } from '@nobulex/sdk';
import { generateKeyPair } from '@nobulex/crypto';
import type { CovenantDocument } from '@nobulex/core';
import type { IncomingRequest, OutgoingResponse } from '@nobulex/sdk';

async function main() {
  console.log('========================================');
  console.log('  Example 14: API Gateway with Required Constraints');
  console.log('========================================\n');

  const issuerKp = await generateKeyPair();
  const benKp = await generateKeyPair();
  const client = new NobulexClient({ keyPair: issuerKp });

  // Covenant WITH required constraint
  const covenantWithAudit = await client.createCovenant({
    issuer: { id: 'issuer-1', publicKey: issuerKp.publicKeyHex, role: 'issuer' },
    beneficiary: { id: 'ben-1', publicKey: benKp.publicKeyHex, role: 'beneficiary' },
    constraints: [
      "permit get on '/api/data'",
      "deny write on '/system/**' severity critical",
      "require audit.log on '**'",
    ].join('\n'),
  });

  // Covenant WITHOUT required constraint (missing audit.log)
  const covenantWithoutAudit = await client.createCovenant({
    issuer: { id: 'issuer-2', publicKey: issuerKp.publicKeyHex, role: 'issuer' }, // same issuer key
    beneficiary: { id: 'ben-2', publicKey: benKp.publicKeyHex, role: 'beneficiary' },
    constraints: [
      "permit get on '/api/data'",
      "deny write on '/system/**' severity critical",
    ].join('\n'),
  });

  const requiredConstraints = ["require audit.log on '**'"];

  const runTest = async (
    name: string,
    covenant: CovenantDocument,
    expectAllowed: boolean,
  ): Promise<boolean> => {
    let status = 200;
    let bodyStr = '';
    let nextCalled = false;

    const mw = kovaGatewayMiddleware({
      client,
      covenantExtractor: () => serializeCovenant(covenant),
      requiredConstraints,
    });

    const res: OutgoingResponse = {
      set statusCode(n: number) {
        status = n;
      },
      setHeader: () => {},
      end: (b?: string) => {
        bodyStr = b ?? '';
      },
    };

    mw(
      { method: 'GET', path: '/api/data', headers: {} } as IncomingRequest,
      res,
      () => {
        nextCalled = true;
      },
    );

    await new Promise((r) => setTimeout(r, 100));

    const ok = expectAllowed ? nextCalled : !nextCalled && status === 401;
    console.log(`  ${name}: ${ok ? '✓' : '✗'} ${expectAllowed ? 'Allowed' : '401 (constraint missing)'}`);
    if (!expectAllowed && bodyStr) {
      try {
        const parsed = JSON.parse(bodyStr);
        console.log(`    Error: ${parsed.error}`);
        console.log(`    Missing: ${JSON.stringify(parsed.missing)}`);
      } catch {
        // ignore
      }
    }
    return ok;
  };

  console.log('--- Tests ---\n');
  await runTest('Covenant with "require audit.log"', covenantWithAudit, true);
  await runTest('Covenant without "require audit.log"', covenantWithoutAudit, false);

  console.log('\n--- Summary ---\n');
  console.log('requiredConstraints ensures agents include mandatory CCL statements.');
  console.log('Use case: API provider requires all callers to have audit logging.');
  console.log('\nSee docs/API-GATEWAY-GUIDE.md for full Express setup.');

  console.log('\n========================================');
  console.log('  Example complete!');
  console.log('========================================');
}

main().catch(console.error);
