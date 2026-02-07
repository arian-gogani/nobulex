/**
 * Cross-package integration tests for the Stele SDK.
 *
 * This test exercises the full lifecycle of the Stele protocol across
 * all core packages:
 *
 *   @stele/crypto     - Key generation and hashing primitives
 *   @stele/identity   - Agent identity creation and verification
 *   @stele/core       - Covenant document building and verification
 *   @stele/enforcement - Runtime constraint monitoring with audit logging
 *   @stele/breach     - Breach attestation creation and trust graph propagation
 *   @stele/proof      - Zero-knowledge compliance proof generation and verification
 *   @stele/reputation - Execution receipts, receipt chains, and reputation scoring
 *
 * Scenario: An AI code-review agent operates under a covenant that permits
 * reading source files and generating reviews, but denies writing to
 * production databases. The test walks through identity creation, covenant
 * binding, permitted and denied actions, breach handling, compliance proofs,
 * and reputation scoring.
 */

import { describe, it, expect } from 'vitest';

import {
  generateKeyPair,
  sha256String,
  sha256Object,
  toHex,
  timestamp,
} from '@stele/crypto';
import type { KeyPair, HashHex } from '@stele/crypto';

import {
  createIdentity,
  verifyIdentity,
} from '@stele/identity';
import type { AgentIdentity } from '@stele/identity';

import {
  buildCovenant,
  verifyCovenant,
} from '@stele/core';
import type { CovenantDocument } from '@stele/core';

import {
  Monitor,
  MonitorDeniedError,
} from '@stele/enforcement';
import type { AuditEntry } from '@stele/enforcement';

import {
  createBreachAttestation,
  verifyBreachAttestation,
  TrustGraph,
} from '@stele/breach';
import type { BreachAttestation, BreachEvent } from '@stele/breach';

import {
  generateComplianceProof,
  verifyComplianceProof,
} from '@stele/proof';
import type { AuditEntryData } from '@stele/proof';

import {
  createReceipt,
  computeReputationScore,
  verifyReceiptChain,
} from '@stele/reputation';
import type { ExecutionReceipt } from '@stele/reputation';

// ---------------------------------------------------------------------------
// Shared CCL constraint definitions used across all tests.
// ---------------------------------------------------------------------------

/**
 * The constraints define what the code-review agent may and may not do.
 * - Permitted: read source files, generate reviews, call analysis APIs
 * - Denied: write to production databases (critical severity)
 * - Denied: delete any resource (high severity)
 */
const CONSTRAINTS = [
  "permit file.read on '/src/**'",
  "permit review.generate on '/reviews/**'",
  "permit api.call on '/analysis/**'",
  "deny db.write on '/prod/**' severity critical",
  "deny file.delete on '**' severity high",
].join('\n');

// ---------------------------------------------------------------------------
// Top-level describe
// ---------------------------------------------------------------------------

describe('Stele SDK: Full cross-package integration flow', () => {
  // Shared state across sequential test blocks. Each describe block
  // produces artifacts consumed by the next one, mirroring a real
  // deployment lifecycle.
  let operatorKeyPair: KeyPair;
  let beneficiaryKeyPair: KeyPair;
  let agentKeyPair: KeyPair;
  let reporterKeyPair: KeyPair;

  let agentIdentity: AgentIdentity;
  let covenant: CovenantDocument;
  let monitor: Monitor;
  let breachAttestation: BreachAttestation;

  const collectedViolations: AuditEntry[] = [];

  // =========================================================================
  // Step 0: Key generation
  // =========================================================================

  describe('Step 0 - Cryptographic key generation (@stele/crypto)', () => {
    it('should generate distinct key pairs for operator, beneficiary, agent, and reporter', async () => {
      [operatorKeyPair, beneficiaryKeyPair, agentKeyPair, reporterKeyPair] =
        await Promise.all([
          generateKeyPair(),
          generateKeyPair(),
          generateKeyPair(),
          generateKeyPair(),
        ]);

      // Each key pair should have the expected structure
      for (const kp of [operatorKeyPair, beneficiaryKeyPair, agentKeyPair, reporterKeyPair]) {
        expect(kp.privateKey).toBeInstanceOf(Uint8Array);
        expect(kp.publicKey).toBeInstanceOf(Uint8Array);
        expect(kp.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
      }

      // All public keys should be distinct
      const pubkeys = new Set([
        operatorKeyPair.publicKeyHex,
        beneficiaryKeyPair.publicKeyHex,
        agentKeyPair.publicKeyHex,
        reporterKeyPair.publicKeyHex,
      ]);
      expect(pubkeys.size).toBe(4);
    });
  });

  // =========================================================================
  // Step 1: Agent identity creation and verification (@stele/identity)
  // =========================================================================

  describe('Step 1 - Agent identity creation (@stele/identity)', () => {
    it('should create a valid agent identity with model attestation and capabilities', async () => {
      agentIdentity = await createIdentity({
        operatorKeyPair,
        operatorIdentifier: 'acme-corp',
        model: {
          provider: 'anthropic',
          modelId: 'claude-opus-4',
          modelVersion: '2025-04-14',
          attestationType: 'signed',
        },
        capabilities: [
          'file.read',
          'review.generate',
          'api.call',
        ],
        deployment: {
          runtime: 'container',
        },
      });

      expect(agentIdentity.id).toBeTruthy();
      expect(agentIdentity.operatorPublicKey).toBe(operatorKeyPair.publicKeyHex);
      expect(agentIdentity.model.provider).toBe('anthropic');
      expect(agentIdentity.model.modelId).toBe('claude-opus-4');
      expect(agentIdentity.capabilities).toEqual(['api.call', 'file.read', 'review.generate']); // sorted
      expect(agentIdentity.version).toBe(1);
      expect(agentIdentity.lineage).toHaveLength(1);
      expect(agentIdentity.lineage[0]!.changeType).toBe('created');
      expect(agentIdentity.signature).toBeTruthy();
    });

    it('should pass all verification checks on the newly created identity', async () => {
      const result = await verifyIdentity(agentIdentity);

      expect(result.valid).toBe(true);
      expect(result.checks.length).toBeGreaterThanOrEqual(4);

      // Every individual check should pass
      for (const check of result.checks) {
        expect(check.passed).toBe(true);
      }

      // Ensure specific checks were run
      const checkNames = result.checks.map((c) => c.name);
      expect(checkNames).toContain('capability_manifest_hash');
      expect(checkNames).toContain('composite_identity_hash');
      expect(checkNames).toContain('operator_signature');
      expect(checkNames).toContain('lineage_chain');
      expect(checkNames).toContain('version_lineage_match');
    });
  });

  // =========================================================================
  // Step 2: Covenant creation and verification (@stele/core)
  // =========================================================================

  describe('Step 2 - Covenant building (@stele/core)', () => {
    it('should build a signed covenant document with CCL constraints', async () => {
      covenant = await buildCovenant({
        issuer: {
          id: agentIdentity.id,
          publicKey: operatorKeyPair.publicKeyHex,
          role: 'issuer',
          name: 'Code Review Agent',
        },
        beneficiary: {
          id: sha256String('user-principal'),
          publicKey: beneficiaryKeyPair.publicKeyHex,
          role: 'beneficiary',
          name: 'Development Team',
        },
        constraints: CONSTRAINTS,
        privateKey: operatorKeyPair.privateKey,
        enforcement: {
          type: 'monitor',
          config: { mode: 'enforce' },
          description: 'Runtime constraint monitor with fail-closed semantics',
        },
        proof: {
          type: 'audit_log',
          config: { proofSystem: 'poseidon_hash' },
          description: 'Poseidon hash commitment compliance proof',
        },
      });

      expect(covenant.id).toBeTruthy();
      expect(covenant.id).toMatch(/^[0-9a-f]{64}$/);
      expect(covenant.constraints).toBe(CONSTRAINTS);
      expect(covenant.issuer.id).toBe(agentIdentity.id);
      expect(covenant.beneficiary.publicKey).toBe(beneficiaryKeyPair.publicKeyHex);
      expect(covenant.enforcement!.type).toBe('monitor');
      expect(covenant.proof!.type).toBe('audit_log');
      expect(covenant.signature).toBeTruthy();
      expect(covenant.nonce).toBeTruthy();
    });

    it('should pass all 11 verification checks on the covenant document', async () => {
      const result = await verifyCovenant(covenant);

      expect(result.valid).toBe(true);
      expect(result.checks.length).toBe(11);

      for (const check of result.checks) {
        expect(check.passed).toBe(true);
      }

      // Spot-check a few named checks
      const byName = new Map(result.checks.map((c) => [c.name, c]));
      expect(byName.get('id_match')!.passed).toBe(true);
      expect(byName.get('signature_valid')!.passed).toBe(true);
      expect(byName.get('ccl_parses')!.passed).toBe(true);
      expect(byName.get('enforcement_valid')!.passed).toBe(true);
      expect(byName.get('proof_valid')!.passed).toBe(true);
      expect(byName.get('nonce_present')!.passed).toBe(true);
    });
  });

  // =========================================================================
  // Step 3: Runtime enforcement monitoring (@stele/enforcement)
  // =========================================================================

  describe('Step 3 - Constraint enforcement and audit logging (@stele/enforcement)', () => {
    it('should create a monitor from the covenant constraints in enforce mode', () => {
      monitor = new Monitor(covenant.id, CONSTRAINTS, {
        mode: 'enforce',
        failureMode: 'fail_closed',
        onViolation: (entry) => collectedViolations.push(entry),
      });

      expect(monitor).toBeDefined();
    });

    it('should permit reading a source file and log it as EXECUTED', async () => {
      const result = await monitor.evaluate('file.read', '/src/main.ts');

      expect(result.permitted).toBe(true);

      const log = monitor.getAuditLog();
      expect(log.count).toBe(1);
      expect(log.entries[0]!.action).toBe('file.read');
      expect(log.entries[0]!.resource).toBe('/src/main.ts');
      expect(log.entries[0]!.outcome).toBe('EXECUTED');
    });

    it('should permit generating a review and log it as EXECUTED', async () => {
      const result = await monitor.evaluate('review.generate', '/reviews/pr-42.md');

      expect(result.permitted).toBe(true);

      const log = monitor.getAuditLog();
      expect(log.count).toBe(2);
      expect(log.entries[1]!.outcome).toBe('EXECUTED');
    });

    it('should permit calling an analysis API', async () => {
      const result = await monitor.evaluate('api.call', '/analysis/complexity');

      expect(result.permitted).toBe(true);

      const log = monitor.getAuditLog();
      expect(log.count).toBe(3);
    });

    it('should execute a permitted handler via monitor.execute()', async () => {
      const result = await monitor.execute(
        'file.read',
        '/src/utils.ts',
        async (resource, _ctx) => {
          return { content: `contents of ${resource}`, lines: 42 };
        },
      );

      expect(result).toEqual({ content: 'contents of /src/utils.ts', lines: 42 });

      const log = monitor.getAuditLog();
      expect(log.count).toBe(4);
      expect(log.entries[3]!.outcome).toBe('EXECUTED');
    });

    it('should DENY writing to production database and throw MonitorDeniedError', async () => {
      let caughtError: MonitorDeniedError | undefined;

      try {
        await monitor.evaluate('db.write', '/prod/users');
      } catch (err) {
        if (err instanceof MonitorDeniedError) {
          caughtError = err;
        } else {
          throw err;
        }
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!).toBeInstanceOf(MonitorDeniedError);
      expect(caughtError!.action).toBe('db.write');
      expect(caughtError!.resource).toBe('/prod/users');
      expect(caughtError!.severity).toBe('critical');

      // The denial should still be recorded in the audit log
      const log = monitor.getAuditLog();
      expect(log.count).toBe(5);
      expect(log.entries[4]!.outcome).toBe('DENIED');
      expect(log.entries[4]!.action).toBe('db.write');
    });

    it('should also deny via expect().rejects for handler execution', async () => {
      await expect(
        monitor.execute(
          'file.delete',
          '/src/important.ts',
          async () => 'should not reach here',
        ),
      ).rejects.toThrow(MonitorDeniedError);

      const log = monitor.getAuditLog();
      expect(log.count).toBe(6);
      expect(log.entries[5]!.outcome).toBe('DENIED');
      expect(log.entries[5]!.action).toBe('file.delete');
    });

    it('should have collected violations via the onViolation callback', () => {
      // Two denials: db.write and file.delete
      expect(collectedViolations.length).toBe(2);
      expect(collectedViolations[0]!.action).toBe('db.write');
      expect(collectedViolations[1]!.action).toBe('file.delete');
    });

    it('should maintain a tamper-evident hash chain in the audit log', () => {
      const integrity = monitor.verifyAuditLogIntegrity();
      expect(integrity).toBe(true);
    });

    it('should compute a valid Merkle root over all audit entries', () => {
      const merkleRoot = monitor.computeMerkleRoot();
      expect(merkleRoot).toMatch(/^[0-9a-f]{64}$/);

      const log = monitor.getAuditLog();
      expect(log.merkleRoot).toBe(merkleRoot);
    });
  });

  // =========================================================================
  // Step 4: Breach detection, attestation, and trust graph (@stele/breach)
  // =========================================================================

  describe('Step 4 - Breach attestation and trust graph propagation (@stele/breach)', () => {
    it('should create a signed breach attestation for the denied db.write action', async () => {
      const auditLog = monitor.getAuditLog();
      const deniedEntry = auditLog.entries.find(
        (e) => e.action === 'db.write' && e.outcome === 'DENIED',
      )!;
      expect(deniedEntry).toBeDefined();

      const evidenceHash = sha256Object({
        auditEntry: deniedEntry,
        merkleRoot: auditLog.merkleRoot,
      });

      breachAttestation = await createBreachAttestation(
        covenant.id,
        agentIdentity.id,
        "deny db.write on '/prod/**' severity critical",
        'critical',
        'db.write',
        '/prod/users',
        evidenceHash,
        [covenant.id],
        reporterKeyPair,
      );

      expect(breachAttestation.id).toBeTruthy();
      expect(breachAttestation.id).toMatch(/^[0-9a-f]{64}$/);
      expect(breachAttestation.covenantId).toBe(covenant.id);
      expect(breachAttestation.violatorIdentityHash).toBe(agentIdentity.id);
      expect(breachAttestation.severity).toBe('critical');
      expect(breachAttestation.action).toBe('db.write');
      expect(breachAttestation.resource).toBe('/prod/users');
      expect(breachAttestation.recommendedAction).toBe('revoke');
      expect(breachAttestation.reporterPublicKey).toBe(reporterKeyPair.publicKeyHex);
      expect(breachAttestation.reporterSignature).toBeTruthy();
      expect(breachAttestation.affectedCovenants).toEqual([covenant.id]);
    });

    it('should verify the breach attestation cryptographic integrity', async () => {
      const valid = await verifyBreachAttestation(breachAttestation);
      expect(valid).toBe(true);
    });

    it('should reject a tampered breach attestation', async () => {
      const tampered = { ...breachAttestation, severity: 'low' as const };
      const valid = await verifyBreachAttestation(tampered);
      expect(valid).toBe(false);
    });

    it('should propagate breach through the trust graph to dependent agents', async () => {
      const graph = new TrustGraph();

      // Build a dependency graph:
      //   agentIdentity (violator)
      //     -> dependentAgent1
      //       -> dependentAgent2
      const dependentAgent1Hash = sha256String('dependent-agent-1') as HashHex;
      const dependentAgent2Hash = sha256String('dependent-agent-2') as HashHex;

      // Register: violator has dependent1 as a dependent
      graph.registerDependency(agentIdentity.id, dependentAgent1Hash);
      // Register: dependent1 has dependent2 as a dependent
      graph.registerDependency(dependentAgent1Hash, dependentAgent2Hash);

      // Before breach: all nodes start as trusted
      expect(graph.getStatus(agentIdentity.id)).toBe('trusted');
      expect(graph.getStatus(dependentAgent1Hash)).toBe('trusted');
      expect(graph.getStatus(dependentAgent2Hash)).toBe('trusted');
      expect(graph.isTrusted(agentIdentity.id)).toBe(true);

      // Process the breach
      const events: BreachEvent[] = await graph.processBreach(breachAttestation);

      // Should produce events for violator and propagated dependents
      expect(events.length).toBeGreaterThanOrEqual(2);

      // The violator should be revoked (critical severity)
      const violatorEvent = events.find((e) => e.affectedAgent === agentIdentity.id);
      expect(violatorEvent).toBeDefined();
      expect(violatorEvent!.previousStatus).toBe('trusted');
      expect(violatorEvent!.newStatus).toBe('revoked');
      expect(violatorEvent!.propagationDepth).toBe(0);

      // dependent1 should be restricted (one degradation from revoked)
      const dep1Event = events.find((e) => e.affectedAgent === dependentAgent1Hash);
      expect(dep1Event).toBeDefined();
      expect(dep1Event!.newStatus).toBe('restricted');
      expect(dep1Event!.propagationDepth).toBe(1);

      // dependent2 should be degraded (two degradations from revoked)
      const dep2Event = events.find((e) => e.affectedAgent === dependentAgent2Hash);
      expect(dep2Event).toBeDefined();
      expect(dep2Event!.newStatus).toBe('degraded');
      expect(dep2Event!.propagationDepth).toBe(2);

      // Verify final statuses in the graph
      expect(graph.getStatus(agentIdentity.id)).toBe('revoked');
      expect(graph.isTrusted(agentIdentity.id)).toBe(false);
      expect(graph.getStatus(dependentAgent1Hash)).toBe('restricted');
      expect(graph.getStatus(dependentAgent2Hash)).toBe('degraded');
    });

    it('should notify breach listeners registered on the trust graph', async () => {
      const graph = new TrustGraph();
      const receivedEvents: BreachEvent[] = [];

      graph.onBreach((event) => receivedEvents.push(event));
      graph.registerDependency(agentIdentity.id, sha256String('listener-dep') as HashHex);

      await graph.processBreach(breachAttestation);

      // Should have notified for at least the violator and the dependent
      expect(receivedEvents.length).toBeGreaterThanOrEqual(2);
      expect(receivedEvents[0]!.affectedAgent).toBe(agentIdentity.id);
    });
  });

  // =========================================================================
  // Step 5: Compliance proof generation and verification (@stele/proof)
  // =========================================================================

  describe('Step 5 - Compliance proof generation and verification (@stele/proof)', () => {
    let auditEntryData: AuditEntryData[];

    it('should convert audit log entries into proof-compatible format', () => {
      const auditLog = monitor.getAuditLog();

      auditEntryData = auditLog.entries.map((entry) => ({
        action: entry.action,
        resource: entry.resource,
        outcome: entry.outcome,
        timestamp: entry.timestamp,
        hash: entry.hash,
      }));

      expect(auditEntryData.length).toBe(6);

      // Verify all entries have the required fields
      for (const entry of auditEntryData) {
        expect(entry.action).toBeTruthy();
        expect(entry.resource).toBeTruthy();
        expect(['EXECUTED', 'DENIED']).toContain(entry.outcome);
        expect(entry.timestamp).toBeTruthy();
        expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('should generate a compliance proof from the audit log and constraints', async () => {
      const proof = await generateComplianceProof({
        covenantId: covenant.id,
        constraints: CONSTRAINTS,
        auditEntries: auditEntryData,
      });

      expect(proof.version).toBe('1.0');
      expect(proof.covenantId).toBe(covenant.id);
      expect(proof.proofSystem).toBe('poseidon_hash');
      expect(proof.entryCount).toBe(6);
      expect(proof.auditLogCommitment).toBeTruthy();
      expect(proof.constraintCommitment).toBeTruthy();
      expect(proof.proof).toBeTruthy();
      expect(proof.publicInputs).toHaveLength(4);
      expect(proof.publicInputs[0]).toBe(covenant.id);
      expect(proof.publicInputs[3]).toBe('6');
      expect(proof.generatedAt).toBeTruthy();
    });

    it('should verify a valid compliance proof', async () => {
      const proof = await generateComplianceProof({
        covenantId: covenant.id,
        constraints: CONSTRAINTS,
        auditEntries: auditEntryData,
      });

      const result = await verifyComplianceProof(proof);

      expect(result.valid).toBe(true);
      expect(result.covenantId).toBe(covenant.id);
      expect(result.entryCount).toBe(6);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject a proof with tampered covenant ID', async () => {
      const proof = await generateComplianceProof({
        covenantId: covenant.id,
        constraints: CONSTRAINTS,
        auditEntries: auditEntryData,
      });

      const tampered = {
        ...proof,
        covenantId: sha256String('wrong-covenant') as HashHex,
      };

      const result = await verifyComplianceProof(tampered);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject a proof with tampered proof value', async () => {
      const proof = await generateComplianceProof({
        covenantId: covenant.id,
        constraints: CONSTRAINTS,
        auditEntries: auditEntryData,
      });

      const tampered = { ...proof, proof: sha256String('tampered') };

      const result = await verifyComplianceProof(tampered);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should produce different proofs for different constraint sets', async () => {
      const proofOriginal = await generateComplianceProof({
        covenantId: covenant.id,
        constraints: CONSTRAINTS,
        auditEntries: auditEntryData,
      });

      const differentConstraints = "permit ** on '**'";
      const proofDifferent = await generateComplianceProof({
        covenantId: covenant.id,
        constraints: differentConstraints,
        auditEntries: auditEntryData,
      });

      expect(proofOriginal.constraintCommitment).not.toBe(proofDifferent.constraintCommitment);
      expect(proofOriginal.proof).not.toBe(proofDifferent.proof);
    });
  });

  // =========================================================================
  // Step 6: Execution receipts, chain verification, and reputation scoring
  //         (@stele/reputation)
  // =========================================================================

  describe('Step 6 - Execution receipts and reputation scoring (@stele/reputation)', () => {
    const receipts: ExecutionReceipt[] = [];

    it('should create a fulfilled execution receipt for the compliant execution', async () => {
      const proof = await generateComplianceProof({
        covenantId: covenant.id,
        constraints: CONSTRAINTS,
        auditEntries: monitor.getAuditLog().entries.map((e) => ({
          action: e.action,
          resource: e.resource,
          outcome: e.outcome,
          timestamp: e.timestamp,
          hash: e.hash,
        })),
      });

      const receipt = await createReceipt(
        covenant.id,
        agentIdentity.id,
        beneficiaryKeyPair.publicKeyHex,
        'fulfilled',
        sha256String(proof.proof),
        1500,
        agentKeyPair,
        null, // first receipt in chain
      );

      expect(receipt.id).toBeTruthy();
      expect(receipt.covenantId).toBe(covenant.id);
      expect(receipt.agentIdentityHash).toBe(agentIdentity.id);
      expect(receipt.outcome).toBe('fulfilled');
      expect(receipt.durationMs).toBe(1500);
      expect(receipt.previousReceiptHash).toBeNull();
      expect(receipt.receiptHash).toBeTruthy();
      expect(receipt.agentSignature).toBeTruthy();
      expect(receipt.completedAt).toBeTruthy();

      receipts.push(receipt);
    });

    it('should create a second fulfilled receipt chained to the first', async () => {
      const receipt = await createReceipt(
        covenant.id,
        agentIdentity.id,
        beneficiaryKeyPair.publicKeyHex,
        'fulfilled',
        sha256String('second-proof-hash'),
        800,
        agentKeyPair,
        receipts[0]!.receiptHash, // chain to first
      );

      expect(receipt.previousReceiptHash).toBe(receipts[0]!.receiptHash);

      receipts.push(receipt);
    });

    it('should create a partial execution receipt', async () => {
      const receipt = await createReceipt(
        covenant.id,
        agentIdentity.id,
        beneficiaryKeyPair.publicKeyHex,
        'partial',
        sha256String('partial-proof-hash'),
        2000,
        agentKeyPair,
        receipts[1]!.receiptHash,
      );

      expect(receipt.outcome).toBe('partial');
      expect(receipt.previousReceiptHash).toBe(receipts[1]!.receiptHash);

      receipts.push(receipt);
    });

    it('should create a breached execution receipt with severity', async () => {
      const receipt = await createReceipt(
        covenant.id,
        agentIdentity.id,
        beneficiaryKeyPair.publicKeyHex,
        'breached',
        sha256String('breached-proof-hash'),
        500,
        agentKeyPair,
        receipts[2]!.receiptHash,
        'critical', // breachSeverity
      );

      expect(receipt.outcome).toBe('breached');
      expect(receipt.breachSeverity).toBe('critical');
      expect(receipt.previousReceiptHash).toBe(receipts[2]!.receiptHash);

      receipts.push(receipt);
    });

    it('should verify the receipt chain integrity', () => {
      const valid = verifyReceiptChain(receipts);
      expect(valid).toBe(true);
    });

    it('should reject a broken receipt chain', () => {
      const broken = [receipts[0]!, receipts[2]!]; // skip receipts[1]
      const valid = verifyReceiptChain(broken);
      expect(valid).toBe(false);
    });

    it('should compute a reputation score reflecting the execution history', () => {
      const score = computeReputationScore(agentIdentity.id, receipts);

      expect(score.agentIdentityHash).toBe(agentIdentity.id);
      expect(score.totalExecutions).toBe(4);
      expect(score.fulfilled).toBe(2);
      expect(score.partial).toBe(1);
      expect(score.failed).toBe(0);
      expect(score.breached).toBe(1);

      // successRate = (fulfilled + partial) / total = 3/4 = 0.75
      expect(score.successRate).toBe(0.75);

      // weightedScore should be between 0 and 1 (exact value depends on
      // recency decay, but the breach penalty should pull it down)
      expect(score.weightedScore).toBeGreaterThanOrEqual(0);
      expect(score.weightedScore).toBeLessThanOrEqual(1);

      // With a critical breach (penalty 0.5) and only 4 executions
      // (below the default minimum of 10), the score should be relatively low
      expect(score.weightedScore).toBeLessThan(0.5);

      // Merkle root should be a valid hex hash
      expect(score.receiptsMerkleRoot).toMatch(/^[0-9a-f]{64}$/);

      expect(score.lastUpdatedAt).toBeTruthy();
    });

    it('should produce a higher score for a purely-fulfilled history', async () => {
      const goodReceipts: ExecutionReceipt[] = [];
      let prevHash: HashHex | null = null;

      for (let i = 0; i < 12; i++) {
        const receipt = await createReceipt(
          covenant.id,
          agentIdentity.id,
          beneficiaryKeyPair.publicKeyHex,
          'fulfilled',
          sha256String(`proof-${i}`),
          1000,
          agentKeyPair,
          prevHash,
        );
        goodReceipts.push(receipt);
        prevHash = receipt.receiptHash;
      }

      const goodScore = computeReputationScore(agentIdentity.id, goodReceipts);
      const badScore = computeReputationScore(agentIdentity.id, receipts);

      expect(goodScore.weightedScore).toBeGreaterThan(badScore.weightedScore);
      expect(goodScore.successRate).toBe(1.0);
      expect(goodScore.fulfilled).toBe(12);
      expect(goodScore.breached).toBe(0);

      // 12 executions exceeds the minimum of 10, so no scaling penalty
      expect(goodScore.totalExecutions).toBeGreaterThanOrEqual(10);
    });
  });

  // =========================================================================
  // Step 7: End-to-end data consistency across all packages
  // =========================================================================

  describe('Step 7 - Cross-package data consistency', () => {
    it('should use the same covenant ID across enforcement, proof, breach, and receipts', async () => {
      const auditLog = monitor.getAuditLog();
      expect(auditLog.covenantId).toBe(covenant.id);

      const proof = await generateComplianceProof({
        covenantId: covenant.id,
        constraints: CONSTRAINTS,
        auditEntries: auditLog.entries.map((e) => ({
          action: e.action,
          resource: e.resource,
          outcome: e.outcome,
          timestamp: e.timestamp,
          hash: e.hash,
        })),
      });
      expect(proof.covenantId).toBe(covenant.id);

      expect(breachAttestation.covenantId).toBe(covenant.id);
    });

    it('should link the agent identity through identity hash to breach and receipts', () => {
      expect(breachAttestation.violatorIdentityHash).toBe(agentIdentity.id);
    });

    it('should have a consistent audit log that can be independently verified', () => {
      const auditLog = monitor.getAuditLog();

      // Verify hash chain
      expect(monitor.verifyAuditLogIntegrity()).toBe(true);

      // Verify we have both permitted and denied actions
      const outcomes = new Set(auditLog.entries.map((e) => e.outcome));
      expect(outcomes.has('EXECUTED')).toBe(true);
      expect(outcomes.has('DENIED')).toBe(true);

      // All entries should have valid hashes
      for (const entry of auditLog.entries) {
        expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.previousHash).toMatch(/^[0-9a-f]{64}$/);
      }

      // Entry count matches
      expect(auditLog.count).toBe(auditLog.entries.length);
    });

    it('should round-trip a proof through generate then verify', async () => {
      const auditLog = monitor.getAuditLog();
      const entryData: AuditEntryData[] = auditLog.entries.map((e) => ({
        action: e.action,
        resource: e.resource,
        outcome: e.outcome,
        timestamp: e.timestamp,
        hash: e.hash,
      }));

      const proof = await generateComplianceProof({
        covenantId: covenant.id,
        constraints: CONSTRAINTS,
        auditEntries: entryData,
      });

      const result = await verifyComplianceProof(proof);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.covenantId).toBe(covenant.id);
      expect(result.entryCount).toBe(auditLog.count);
    });
  });

  // =========================================================================
  // Step 8: Log-only mode (non-throwing) enforcement
  // =========================================================================

  describe('Step 8 - Log-only mode enforcement (@stele/enforcement)', () => {
    it('should not throw on denied actions in log_only mode', async () => {
      const logOnlyMonitor = new Monitor(covenant.id, CONSTRAINTS, {
        mode: 'log_only',
        failureMode: 'fail_closed',
      });

      // This action would be denied in enforce mode, but in log_only mode
      // it should return without throwing
      const result = await logOnlyMonitor.evaluate('db.write', '/prod/users');

      // The result still indicates it was not permitted by the constraints
      expect(result.permitted).toBe(false);

      // But the audit log records it as EXECUTED (log_only allows it through)
      const log = logOnlyMonitor.getAuditLog();
      expect(log.count).toBe(1);
      expect(log.entries[0]!.outcome).toBe('EXECUTED');
      expect(log.entries[0]!.action).toBe('db.write');
    });
  });

  // =========================================================================
  // Step 9: Multiple monitors share no state
  // =========================================================================

  describe('Step 9 - Monitor isolation', () => {
    it('should maintain separate audit logs for separate monitors', async () => {
      const monitor1 = new Monitor(covenant.id, CONSTRAINTS, { mode: 'enforce' });
      const monitor2 = new Monitor(covenant.id, CONSTRAINTS, { mode: 'enforce' });

      await monitor1.evaluate('file.read', '/src/a.ts');
      await monitor1.evaluate('file.read', '/src/b.ts');
      await monitor2.evaluate('api.call', '/analysis/lint');

      expect(monitor1.getAuditLog().count).toBe(2);
      expect(monitor2.getAuditLog().count).toBe(1);

      // Both should have independent hash chains
      expect(monitor1.verifyAuditLogIntegrity()).toBe(true);
      expect(monitor2.verifyAuditLogIntegrity()).toBe(true);

      // Merkle roots should differ
      expect(monitor1.computeMerkleRoot()).not.toBe(monitor2.computeMerkleRoot());
    });
  });
});
