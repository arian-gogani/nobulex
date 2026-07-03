/**
 * Shared test helper: trust store for verification in tests.
 *
 * Production verification is fail-closed. Without a trust anchor, a verifier
 * cannot establish signer authority and returns invalid. That is the product
 * thesis and must never be weakened in library code.
 *
 * Tests, however, want to answer "does a validly-signed, untampered document
 * verify?" To do that they must supply a trust anchor the way a real verifier
 * would. These helpers build that anchor from the key embedded in the document
 * under test. A tampered document still fails, because tampering breaks the
 * signature regardless of which key is trusted.
 *
 * Do NOT import these helpers into library code. Test-only.
 */

import type { CovenantDocument, VerifyOptions } from '../index';

/**
 * Per-call verify options that trust the issuer key embedded in `doc`.
 * Use for verifier.verify(doc, trustDoc(doc)) and verifyCovenant(doc, trustDoc(doc)).
 */
export function trustDoc(doc: CovenantDocument): VerifyOptions {
  return { authorizedKeys: doc.issuer.publicKey };
}

/**
 * Per-call verify options that trust the issuer keys embedded in every doc of
 * a chain or batch.
 */
export function trustDocs(docs: CovenantDocument[]): VerifyOptions {
  return { authorizedKeys: docs.map((d) => d.issuer.publicKey) };
}

/**
 * A resolver-backed VerifyOptions that trusts whatever issuer key is embedded
 * in the document being verified, resolved by issuer id from the supplied set.
 * Use as the constructor trust store: new Verifier(trustStore(docs)).
 */
export function trustStore(
  docs: CovenantDocument[],
): { resolveAuthorizedKeys: (issuerId: string) => string[] | undefined } {
  const byIssuer = new Map<string, string[]>();
  for (const d of docs) {
    const existing = byIssuer.get(d.issuer.id) ?? [];
    existing.push(d.issuer.publicKey);
    byIssuer.set(d.issuer.id, existing);
  }
  return {
    resolveAuthorizedKeys: (issuerId: string) => byIssuer.get(issuerId),
  };
}
