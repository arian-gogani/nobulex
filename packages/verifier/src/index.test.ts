import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPair } from '@stele/crypto';
import type { KeyPair } from '@stele/crypto';
import {
  buildCovenant,
  PROTOCOL_VERSION,
  MAX_CHAIN_DEPTH,
} from '@stele/core';
import type {
  CovenantDocument,
  CovenantBuilderOptions,
  Issuer,
  Beneficiary,
  ChainReference,
} from '@stele/core';

import { Verifier, verifyBatch } from './index';
import type {
  VerificationReport,
  ChainVerificationReport,
  ActionVerificationReport,
  BatchVerificationReport,
  VerificationRecord,
} from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeParties(): Promise<{
  issuerKeyPair: KeyPair;
  beneficiaryKeyPair: KeyPair;
  issuer: Issuer;
  beneficiary: Beneficiary;
}> {
  const issuerKeyPair = await generateKeyPair();
  const beneficiaryKeyPair = await generateKeyPair();

  const issuer: Issuer = {
    id: 'issuer-1',
    publicKey: issuerKeyPair.publicKeyHex,
    role: 'issuer',
  };

  const beneficiary: Beneficiary = {
    id: 'beneficiary-1',
    publicKey: beneficiaryKeyPair.publicKeyHex,
    role: 'beneficiary',
  };

  return { issuerKeyPair, beneficiaryKeyPair, issuer, beneficiary };
}

async function buildValidDoc(
  overrides?: Partial<CovenantBuilderOptions>,
): Promise<{ doc: CovenantDocument; issuerKeyPair: KeyPair; beneficiaryKeyPair: KeyPair }> {
  const { issuerKeyPair, beneficiaryKeyPair, issuer, beneficiary } = await makeParties();

  const options: CovenantBuilderOptions = {
    issuer,
    beneficiary,
    constraints: "permit read on 'data'",
    privateKey: issuerKeyPair.privateKey,
    ...overrides,
  };

  const doc = await buildCovenant(options);
  return { doc, issuerKeyPair, beneficiaryKeyPair };
}

async function buildDocWithConstraints(
  constraints: string,
  overrides?: Partial<CovenantBuilderOptions>,
): Promise<{ doc: CovenantDocument; issuerKeyPair: KeyPair }> {
  const { issuerKeyPair, beneficiaryKeyPair, issuer, beneficiary } = await makeParties();

  const options: CovenantBuilderOptions = {
    issuer,
    beneficiary,
    constraints,
    privateKey: issuerKeyPair.privateKey,
    ...overrides,
  };

  const doc = await buildCovenant(options);
  return { doc, issuerKeyPair };
}

/**
 * Build a chain of covenant documents where each child narrows the parent.
 */
async function buildChain(length: number): Promise<{
  docs: CovenantDocument[];
  issuerKeyPair: KeyPair;
}> {
  const { issuerKeyPair, beneficiaryKeyPair, issuer, beneficiary } = await makeParties();

  const docs: CovenantDocument[] = [];

  // Root document
  const root = await buildCovenant({
    issuer,
    beneficiary,
    constraints: "permit read on 'data'",
    privateKey: issuerKeyPair.privateKey,
  });
  docs.push(root);

  // Children
  for (let i = 1; i < length; i++) {
    const parent = docs[i - 1]!;
    const chain: ChainReference = {
      parentId: parent.id,
      relation: 'restricts',
      depth: i,
    };

    const child = await buildCovenant({
      issuer,
      beneficiary,
      constraints: "permit read on 'data'",
      privateKey: issuerKeyPair.privateKey,
      chain,
    });
    docs.push(child);
  }

  return { docs, issuerKeyPair };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@stele/verifier', () => {
  // ── Verifier constructor ─────────────────────────────────────────────

  describe('Verifier constructor', () => {
    it('creates a verifier with default options', () => {
      const v = new Verifier();
      expect(v.verifierId).toBeTruthy();
      expect(typeof v.verifierId).toBe('string');
    });

    it('accepts a custom verifierId', () => {
      const v = new Verifier({ verifierId: 'my-auditor-001' });
      expect(v.verifierId).toBe('my-auditor-001');
    });

    it('starts with an empty history', () => {
      const v = new Verifier();
      expect(v.getHistory()).toEqual([]);
    });
  });

  // ── Single document verification ────────────────────────────────────

  describe('verify()', () => {
    let verifier: Verifier;

    beforeEach(() => {
      verifier = new Verifier({ verifierId: 'test-verifier' });
    });

    it('verifies a valid document successfully', async () => {
      const { doc } = await buildValidDoc();
      const report = await verifier.verify(doc);

      expect(report.valid).toBe(true);
      expect(report.verifierId).toBe('test-verifier');
      expect(report.timestamp).toBeTruthy();
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
      expect(report.checks.length).toBeGreaterThan(0);
    });

    it('includes warnings for missing metadata', async () => {
      const { doc } = await buildValidDoc();
      const report = await verifier.verify(doc);

      expect(report.warnings).toContain('Document has no metadata');
    });

    it('includes warnings for missing expiration', async () => {
      const { doc } = await buildValidDoc();
      const report = await verifier.verify(doc);

      expect(report.warnings).toContain('Document has no expiration date');
    });

    it('does not warn about metadata when metadata is present', async () => {
      const { doc } = await buildValidDoc({
        metadata: { name: 'test', description: 'test doc' },
      });
      const report = await verifier.verify(doc);

      expect(report.warnings).not.toContain('Document has no metadata');
    });

    it('does not warn about expiration when expiresAt is set', async () => {
      const future = new Date(Date.now() + 86400_000).toISOString();
      const { doc } = await buildValidDoc({ expiresAt: future });
      const report = await verifier.verify(doc);

      expect(report.warnings).not.toContain('Document has no expiration date');
    });

    it('detects a tampered document ID', async () => {
      const { doc } = await buildValidDoc();
      const tampered = { ...doc, id: 'aaaa' + doc.id.slice(4) };
      const report = await verifier.verify(tampered as CovenantDocument);

      expect(report.valid).toBe(false);
      const idCheck = report.checks.find((c) => c.name === 'id_match');
      expect(idCheck?.passed).toBe(false);
    });

    it('detects a tampered signature', async () => {
      const { doc } = await buildValidDoc();
      const tampered = { ...doc, signature: 'ff'.repeat(32) };
      const report = await verifier.verify(tampered as CovenantDocument);

      expect(report.valid).toBe(false);
      const sigCheck = report.checks.find((c) => c.name === 'signature_valid');
      expect(sigCheck?.passed).toBe(false);
    });

    it('detects an expired document', async () => {
      const past = new Date(Date.now() - 86400_000).toISOString();
      const { doc } = await buildValidDoc({ expiresAt: past });
      const report = await verifier.verify(doc);

      expect(report.valid).toBe(false);
      const expiryCheck = report.checks.find((c) => c.name === 'not_expired');
      expect(expiryCheck?.passed).toBe(false);
    });

    it('detects a not-yet-active document', async () => {
      const future = new Date(Date.now() + 86400_000).toISOString();
      const { doc } = await buildValidDoc({ activatesAt: future });
      const report = await verifier.verify(doc);

      expect(report.valid).toBe(false);
      const activeCheck = report.checks.find((c) => c.name === 'active');
      expect(activeCheck?.passed).toBe(false);
    });

    it('includes the document in the report', async () => {
      const { doc } = await buildValidDoc();
      const report = await verifier.verify(doc);

      expect(report.document).toBeDefined();
      expect(report.document?.id).toBe(doc.id);
    });

    it('records the verification in history', async () => {
      const { doc } = await buildValidDoc();
      await verifier.verify(doc);

      const history = verifier.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0]!.kind).toBe('single');
      expect(history[0]!.documentIds).toEqual([doc.id]);
      expect(history[0]!.valid).toBe(true);
    });
  });

  // ── Strict mode ─────────────────────────────────────────────────────

  describe('strict mode', () => {
    it('fails validation when there are warnings in strict mode', async () => {
      const verifier = new Verifier({ verifierId: 'strict', strictMode: true });
      const { doc } = await buildValidDoc(); // no metadata, no expiry
      const report = await verifier.verify(doc);

      expect(report.valid).toBe(false);
      expect(report.warnings.length).toBeGreaterThan(0);
    });

    it('passes validation when there are no warnings in strict mode', async () => {
      const verifier = new Verifier({ verifierId: 'strict', strictMode: true });
      const future = new Date(Date.now() + 86400_000).toISOString();
      const { doc } = await buildValidDoc({
        metadata: { name: 'test' },
        expiresAt: future,
      });
      const report = await verifier.verify(doc);

      expect(report.valid).toBe(true);
      expect(report.warnings).toHaveLength(0);
    });
  });

  // ── History management ──────────────────────────────────────────────

  describe('history management', () => {
    it('tracks multiple verifications', async () => {
      const verifier = new Verifier({ verifierId: 'hist' });
      const { doc: doc1 } = await buildValidDoc();
      const { doc: doc2 } = await buildValidDoc();

      await verifier.verify(doc1);
      await verifier.verify(doc2);

      expect(verifier.getHistory()).toHaveLength(2);
    });

    it('clearHistory() removes all records', async () => {
      const verifier = new Verifier({ verifierId: 'hist' });
      const { doc } = await buildValidDoc();
      await verifier.verify(doc);

      expect(verifier.getHistory()).toHaveLength(1);
      verifier.clearHistory();
      expect(verifier.getHistory()).toHaveLength(0);
    });

    it('evicts oldest entries when maxHistorySize is exceeded', async () => {
      const verifier = new Verifier({ verifierId: 'hist', maxHistorySize: 2 });
      const { doc: doc1 } = await buildValidDoc();
      const { doc: doc2 } = await buildValidDoc();
      const { doc: doc3 } = await buildValidDoc();

      await verifier.verify(doc1);
      await verifier.verify(doc2);
      await verifier.verify(doc3);

      const history = verifier.getHistory();
      expect(history).toHaveLength(2);
      // The first doc should have been evicted
      expect(history[0]!.documentIds[0]).toBe(doc2.id);
      expect(history[1]!.documentIds[0]).toBe(doc3.id);
    });

    it('getHistory() returns a copy, not a reference', async () => {
      const verifier = new Verifier({ verifierId: 'hist' });
      const { doc } = await buildValidDoc();
      await verifier.verify(doc);

      const history1 = verifier.getHistory();
      const history2 = verifier.getHistory();
      expect(history1).not.toBe(history2);
      expect(history1).toEqual(history2);
    });

    it('history records have correct timestamps and durations', async () => {
      const verifier = new Verifier({ verifierId: 'hist' });
      const { doc } = await buildValidDoc();
      await verifier.verify(doc);

      const record = verifier.getHistory()[0]!;
      expect(typeof record.timestamp).toBe('string');
      expect(new Date(record.timestamp).getTime()).not.toBeNaN();
      expect(typeof record.durationMs).toBe('number');
      expect(record.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Chain verification ──────────────────────────────────────────────

  describe('verifyChain()', () => {
    let verifier: Verifier;

    beforeEach(() => {
      verifier = new Verifier({ verifierId: 'chain-verifier' });
    });

    it('fails for an empty chain', async () => {
      const report = await verifier.verifyChain([]);

      expect(report.valid).toBe(false);
      expect(report.integrityChecks).toHaveLength(1);
      expect(report.integrityChecks[0]!.name).toBe('chain_non_empty');
      expect(report.integrityChecks[0]!.passed).toBe(false);
    });

    it('verifies a single-document chain', async () => {
      const { doc } = await buildValidDoc();
      const report = await verifier.verifyChain([doc]);

      expect(report.valid).toBe(true);
      expect(report.documentResults).toHaveLength(1);
      expect(report.documentResults[0]!.report.valid).toBe(true);
      expect(report.narrowingResults).toHaveLength(0);
    });

    it('verifies a valid two-document chain', async () => {
      const { docs } = await buildChain(2);
      const report = await verifier.verifyChain(docs);

      expect(report.valid).toBe(true);
      expect(report.documentResults).toHaveLength(2);
      expect(report.narrowingResults).toHaveLength(1);
      expect(report.narrowingResults[0]!.valid).toBe(true);
    });

    it('verifies a valid three-document chain', async () => {
      const { docs } = await buildChain(3);
      const report = await verifier.verifyChain(docs);

      expect(report.valid).toBe(true);
      expect(report.documentResults).toHaveLength(3);
      expect(report.narrowingResults).toHaveLength(2);
    });

    it('detects inconsistent parent references', async () => {
      const { docs } = await buildChain(2);
      // Tamper the child's chain reference
      const child = { ...docs[1]!, chain: { ...docs[1]!.chain!, parentId: 'wrong-id' } };
      const report = await verifier.verifyChain([docs[0]!, child]);

      expect(report.valid).toBe(false);
      const parentRefCheck = report.integrityChecks.find((c) => c.name === 'parent_ref_1');
      expect(parentRefCheck?.passed).toBe(false);
    });

    it('detects missing chain reference on non-root document', async () => {
      const { doc: doc1 } = await buildValidDoc();
      const { doc: doc2 } = await buildValidDoc();
      // doc2 has no chain reference
      const report = await verifier.verifyChain([doc1, doc2]);

      expect(report.valid).toBe(false);
      const check = report.integrityChecks.find((c) => c.name === 'parent_ref_1');
      expect(check?.passed).toBe(false);
    });

    it('detects chain depth exceeding the limit', async () => {
      const verifierSmall = new Verifier({ verifierId: 'small', maxChainDepth: 2 });
      const { docs } = await buildChain(3);
      const report = await verifierSmall.verifyChain(docs);

      expect(report.valid).toBe(false);
      const depthCheck = report.integrityChecks.find((c) => c.name === 'chain_depth');
      expect(depthCheck?.passed).toBe(false);
    });

    it('detects narrowing violations', async () => {
      const { issuerKeyPair, beneficiaryKeyPair, issuer, beneficiary } = await makeParties();

      // Parent denies write
      const parent = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "deny write on 'data'",
        privateKey: issuerKeyPair.privateKey,
      });

      // Child tries to permit write (violation)
      const child = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit write on 'data'",
        privateKey: issuerKeyPair.privateKey,
        chain: { parentId: parent.id, relation: 'restricts', depth: 1 },
      });

      const report = await verifier.verifyChain([parent, child]);

      expect(report.valid).toBe(false);
      expect(report.narrowingResults).toHaveLength(1);
      expect(report.narrowingResults[0]!.valid).toBe(false);
      expect(report.narrowingResults[0]!.violations.length).toBeGreaterThan(0);
    });

    it('includes verifierId and timing in chain report', async () => {
      const { docs } = await buildChain(2);
      const report = await verifier.verifyChain(docs);

      expect(report.verifierId).toBe('chain-verifier');
      expect(report.timestamp).toBeTruthy();
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('records chain verification in history', async () => {
      const { docs } = await buildChain(2);
      // Clear history from individual doc verifications inside verifyChain
      verifier.clearHistory();
      await verifier.verifyChain(docs);

      const history = verifier.getHistory();
      // verifyChain calls verify() for each doc, then records 'chain'
      const chainRecords = history.filter((h) => h.kind === 'chain');
      expect(chainRecords).toHaveLength(1);
      expect(chainRecords[0]!.documentIds).toHaveLength(2);
    });
  });

  // ── Action verification ─────────────────────────────────────────────

  describe('verifyAction()', () => {
    let verifier: Verifier;

    beforeEach(() => {
      verifier = new Verifier({ verifierId: 'action-verifier' });
    });

    it('permits an action that matches a permit rule', async () => {
      const { doc } = await buildDocWithConstraints("permit read on 'data'");
      const report = await verifier.verifyAction(doc, 'read', 'data');

      expect(report.permitted).toBe(true);
      expect(report.documentValid).toBe(true);
      expect(report.matchedRule).toBeDefined();
      expect(report.reason).toContain('permit');
    });

    it('denies an action with no matching rules', async () => {
      const { doc } = await buildDocWithConstraints("permit read on 'data'");
      const report = await verifier.verifyAction(doc, 'write', 'data');

      expect(report.permitted).toBe(false);
      expect(report.reason).toContain('No matching rules');
    });

    it('denies an action that matches a deny rule', async () => {
      const { doc } = await buildDocWithConstraints("deny write on 'data'");
      const report = await verifier.verifyAction(doc, 'write', 'data');

      expect(report.permitted).toBe(false);
      expect(report.matchedRule).toBeDefined();
      expect(report.matchedRule?.type).toBe('deny');
    });

    it('deny wins over permit at equal specificity', async () => {
      const { doc } = await buildDocWithConstraints(
        "permit write on 'data'\ndeny write on 'data'",
      );
      const report = await verifier.verifyAction(doc, 'write', 'data');

      expect(report.permitted).toBe(false);
    });

    it('denies action when document is invalid (tampered)', async () => {
      const { doc } = await buildDocWithConstraints("permit read on 'data'");
      const tampered = { ...doc, id: 'aaaa' + doc.id.slice(4) };
      const report = await verifier.verifyAction(tampered as CovenantDocument, 'read', 'data');

      expect(report.permitted).toBe(false);
      expect(report.documentValid).toBe(false);
      expect(report.reason).toContain('Document is invalid');
    });

    it('includes evaluation context in report', async () => {
      const { doc } = await buildDocWithConstraints("permit read on 'data'");
      const ctx = { user: { role: 'admin' } };
      const report = await verifier.verifyAction(doc, 'read', 'data', ctx);

      expect(report.context).toEqual(ctx);
    });

    it('includes timing information', async () => {
      const { doc } = await buildDocWithConstraints("permit read on 'data'");
      const report = await verifier.verifyAction(doc, 'read', 'data');

      expect(report.verifierId).toBe('action-verifier');
      expect(report.timestamp).toBeTruthy();
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('records action verification in history', async () => {
      const { doc } = await buildDocWithConstraints("permit read on 'data'");
      await verifier.verifyAction(doc, 'read', 'data');

      const history = verifier.getHistory();
      const actionRecords = history.filter((h) => h.kind === 'action');
      expect(actionRecords).toHaveLength(1);
      expect(actionRecords[0]!.documentIds).toEqual([doc.id]);
    });

    it('handles wildcard actions', async () => {
      const { doc } = await buildDocWithConstraints("permit ** on 'data'");
      const report = await verifier.verifyAction(doc, 'read', 'data');

      expect(report.permitted).toBe(true);
    });

    it('handles wildcard resources', async () => {
      const { doc } = await buildDocWithConstraints("permit read on '**'");
      const report = await verifier.verifyAction(doc, 'read', 'anything/here');

      expect(report.permitted).toBe(true);
    });

    it('defaults context to empty object when not provided', async () => {
      const { doc } = await buildDocWithConstraints("permit read on 'data'");
      const report = await verifier.verifyAction(doc, 'read', 'data');

      expect(report.context).toEqual({});
    });
  });

  // ── Batch verification ──────────────────────────────────────────────

  describe('verifyBatch()', () => {
    it('verifies an empty batch', async () => {
      const report = await verifyBatch([]);

      expect(report.reports).toHaveLength(0);
      expect(report.summary.total).toBe(0);
      expect(report.summary.passed).toBe(0);
      expect(report.summary.failed).toBe(0);
    });

    it('verifies a batch of valid documents', async () => {
      const { doc: doc1 } = await buildValidDoc();
      const { doc: doc2 } = await buildValidDoc();

      const report = await verifyBatch([doc1, doc2]);

      expect(report.reports).toHaveLength(2);
      expect(report.summary.total).toBe(2);
      expect(report.summary.passed).toBe(2);
      expect(report.summary.failed).toBe(0);
    });

    it('reports mixed valid/invalid documents', async () => {
      const { doc: validDoc } = await buildValidDoc();
      const { doc: expiredDoc } = await buildValidDoc({
        expiresAt: new Date(Date.now() - 86400_000).toISOString(),
      });

      const report = await verifyBatch([validDoc, expiredDoc]);

      expect(report.summary.total).toBe(2);
      expect(report.summary.passed).toBe(1);
      expect(report.summary.failed).toBe(1);
    });

    it('includes verifierId in batch report', async () => {
      const report = await verifyBatch([], { verifierId: 'batch-v' });
      expect(report.verifierId).toBe('batch-v');
    });

    it('includes timestamp in batch report', async () => {
      const report = await verifyBatch([]);
      expect(report.timestamp).toBeTruthy();
      expect(new Date(report.timestamp).getTime()).not.toBeNaN();
    });

    it('includes timing in batch summary', async () => {
      const { doc } = await buildValidDoc();
      const report = await verifyBatch([doc]);

      expect(report.summary.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('uses strict mode when specified', async () => {
      const { doc } = await buildValidDoc(); // no metadata -> warning
      const report = await verifyBatch([doc], { strictMode: true });

      expect(report.summary.failed).toBe(1);
      expect(report.reports[0]!.valid).toBe(false);
    });

    it('handles large batches', async () => {
      const docs: CovenantDocument[] = [];
      for (let i = 0; i < 5; i++) {
        const { doc } = await buildValidDoc();
        docs.push(doc);
      }

      const report = await verifyBatch(docs);

      expect(report.summary.total).toBe(5);
      expect(report.summary.passed).toBe(5);
    });
  });

  // ── Verification with additional document features ──────────────────

  describe('document features', () => {
    let verifier: Verifier;

    beforeEach(() => {
      verifier = new Verifier({ verifierId: 'features' });
    });

    it('verifies a document with enforcement config', async () => {
      const { doc } = await buildValidDoc({
        enforcement: {
          type: 'capability',
          config: { mechanism: 'token-gating' },
        },
      });
      const report = await verifier.verify(doc);
      expect(report.valid).toBe(true);
    });

    it('verifies a document with proof config', async () => {
      const { doc } = await buildValidDoc({
        proof: {
          type: 'audit_log',
          config: { endpoint: 'https://logs.example.com' },
        },
      });
      const report = await verifier.verify(doc);
      expect(report.valid).toBe(true);
    });

    it('verifies a document with obligations', async () => {
      const { doc } = await buildValidDoc({
        obligations: [{
          id: 'ob-1',
          description: 'Log all reads',
          action: 'log',
        }],
      });
      const report = await verifier.verify(doc);
      expect(report.valid).toBe(true);
    });

    it('verifies a document with metadata', async () => {
      const { doc } = await buildValidDoc({
        metadata: {
          name: 'Test Covenant',
          description: 'A test covenant document',
          tags: ['test', 'audit'],
        },
      });
      const report = await verifier.verify(doc);
      expect(report.valid).toBe(true);
      expect(report.warnings).not.toContain('Document has no metadata');
    });

    it('verifies a document with activation time in the past', async () => {
      const past = new Date(Date.now() - 86400_000).toISOString();
      const { doc } = await buildValidDoc({ activatesAt: past });
      const report = await verifier.verify(doc);
      expect(report.valid).toBe(true);
    });
  });

  // ── Cross-feature integration tests ─────────────────────────────────

  describe('integration', () => {
    it('chain verification followed by action verification', async () => {
      const verifier = new Verifier({ verifierId: 'integration' });
      const { docs } = await buildChain(2);

      const chainReport = await verifier.verifyChain(docs);
      expect(chainReport.valid).toBe(true);

      // Verify an action against the leaf document
      const leaf = docs[docs.length - 1]!;
      const actionReport = await verifier.verifyAction(leaf, 'read', 'data');
      expect(actionReport.permitted).toBe(true);

      // History should contain both chain individual verifications, the chain record, and the action record
      const history = verifier.getHistory();
      const kinds = history.map((h) => h.kind);
      expect(kinds).toContain('chain');
      expect(kinds).toContain('action');
    });

    it('batch and single verification produce consistent results', async () => {
      const verifier = new Verifier({ verifierId: 'consistency' });
      const { doc } = await buildValidDoc();

      const singleReport = await verifier.verify(doc);
      const batchReport = await verifyBatch([doc], { verifierId: 'consistency-batch' });

      expect(singleReport.valid).toBe(batchReport.reports[0]!.valid);
      expect(singleReport.checks.length).toBe(batchReport.reports[0]!.checks.length);
    });

    it('verifier preserves history across different verification types', async () => {
      const verifier = new Verifier({ verifierId: 'multi' });
      const { doc } = await buildValidDoc();

      await verifier.verify(doc);
      await verifier.verifyAction(doc, 'read', 'data');

      const history = verifier.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);

      const kinds = new Set(history.map((h) => h.kind));
      expect(kinds.has('single')).toBe(true);
      expect(kinds.has('action')).toBe(true);
    });
  });
});
