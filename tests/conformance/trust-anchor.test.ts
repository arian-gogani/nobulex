/**
 * Trust-anchor regression tests.
 *
 * verifyCovenant must authenticate against the AUTHORIZED key, not the key
 * embedded in the document, and must fail closed when no anchor is supplied.
 * Locks in the fix for the covenant-verification trust-root finding.
 */
import { describe, it, expect } from 'vitest';

import { generateKeyPair } from '@nobulex/crypto';
import { buildCovenant, verifyCovenant } from '@nobulex/core';

async function genuineDoc() {
  const issuer = await generateKeyPair();
  const beneficiary = await generateKeyPair();
  const doc = await buildCovenant({
    issuer: { id: 'alice', publicKey: issuer.publicKeyHex, role: 'issuer' },
    beneficiary: {
      id: 'bob',
      publicKey: beneficiary.publicKeyHex,
      role: 'beneficiary',
    },
    constraints: "permit read on '/data/**'",
    privateKey: issuer.privateKey,
  });
  return { doc, issuerKey: issuer.publicKeyHex, beneficiary };
}

describe('verifyCovenant trust anchor', () => {
  it('fails closed when no authorized key is supplied', async () => {
    const { doc } = await genuineDoc();
    const result = await verifyCovenant(doc);
    expect(result.valid).toBe(false);
    expect(
      result.checks.find((c) => c.name === 'authorized_signer')?.passed,
    ).toBe(false);
  });

  it('verifies a covenant signed by the authorized key', async () => {
    const { doc, issuerKey } = await genuineDoc();
    const result = await verifyCovenant(doc, { authorizedKeys: issuerKey });
    expect(result.valid).toBe(true);
  });

  it('rejects a covenant self-signed with an unauthorized key', async () => {
    const { issuerKey, beneficiary } = await genuineDoc();
    const attacker = await generateKeyPair();
    const forged = await buildCovenant({
      issuer: { id: 'alice', publicKey: attacker.publicKeyHex, role: 'issuer' },
      beneficiary: {
        id: 'bob',
        publicKey: beneficiary.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: "permit read on '/data/**'",
      privateKey: attacker.privateKey,
    });
    const result = await verifyCovenant(forged, { authorizedKeys: issuerKey });
    expect(result.valid).toBe(false);
    expect(
      result.checks.find((c) => c.name === 'signature_valid')?.passed,
    ).toBe(false);
  });
});
