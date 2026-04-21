/**
 * Cross-Implementation Test Vectors
 *
 * Verifies that Nobulex produces identical policy_digest values
 * as AgentLedger (Python) for the same canonical inputs.
 *
 * Reference: RFC 8785 (JSON Canonicalization Scheme)
 * Verified against: github.com/dembovvski/agentledger
 * Discussion: NousResearch/hermes-agent#487
 */
import { describe, it, expect } from 'vitest';
import { sha256String, canonicalizeJson } from '@nobulex/crypto';

import vectors from '../../fixtures/cross-implementation-vectors.json';

describe('Cross-implementation policy_digest vectors (RFC 8785 JCS + SHA-256)', () => {
  for (const vector of vectors.vectors) {
    it(`${vector.id}: canonical form matches`, () => {
      const canonical = canonicalizeJson(vector.input);
      expect(canonical).toBe(vector.canonical);
    });

    it(`${vector.id}: policy_digest matches AgentLedger (Python)`, () => {
      const canonical = canonicalizeJson(vector.input);
      const digest = 'sha256:' + sha256String(canonical);
      expect(digest).toBe(vector.policy_digest);
    });
  }
});
