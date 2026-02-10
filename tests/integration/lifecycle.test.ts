/**
 * Cross-package lifecycle integration tests for the Stele SDK.
 *
 * Tests FULL LIFECYCLE flows that span multiple packages working together:
 *
 *   1. Covenant -> Enforcement -> Reputation -> Breach pipeline
 *   2. Identity evolution + covenant binding
 *   3. SDK SteleClient full workflow
 *   4. Store + Verifier batch operations
 *   5. Attestation + Reputation cross-validation
 *
 * All tests use real implementations (no mocks).
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

import {
  generateKeyPair,
  sha256String,
  sha256Object,
  toHex,
  timestamp,
} from '@stele/crypto';
import type { KeyPair, HashHex } from '@stele/crypto';

import {
  buildCovenant,
  verifyCovenant,
  countersignCovenant,
  resolveChain,
  computeEffectiveConstraints,
  validateChainNarrowing,
  MemoryChainResolver,
  serializeCovenant,
  deserializeCovenant,
  CovenantBuildError,
} from '@stele/core';
import type { CovenantDocument } from '@stele/core';

import { parse, evaluate, merge, serialize, validateNarrowing } from '@stele/ccl';

import { MemoryStore } from '@stele/store';
import type { StoreEvent } from '@stele/store';

import { Verifier, verifyBatch } from '@stele/verifier';

import { SteleClient, QuickCovenant } from '@stele/sdk';
import type {
  CovenantCreatedEvent,
  CovenantVerifiedEvent,
  CovenantCountersignedEvent,
  IdentityCreatedEvent,
  IdentityEvolvedEvent,
  ChainResolvedEvent,
  ChainValidatedEvent,
  EvaluationCompletedEvent,
} from '@stele/sdk';

import {
  createIdentity,
  evolveIdentity,
  verifyIdentity,
  serializeIdentity,
  deserializeIdentity,
  computeIdentityHash,
} from '@stele/identity';
import type { AgentIdentity } from '@stele/identity';

import {
  Monitor,
  MonitorDeniedError,
  verifyMerkleProof,
} from '@stele/enforcement';

import {
  createReceipt,
  verifyReceipt,
  computeReputationScore,
  createStake,
  releaseStake,
  burnStake,
  createEndorsement,
  verifyEndorsement,
  verifyReceiptChain,
} from '@stele/reputation';
import type { ExecutionReceipt, Endorsement } from '@stele/reputation';

import {
  createBreachAttestation,
  verifyBreachAttestation,
  TrustGraph,
} from '@stele/breach';
import type { BreachEvent } from '@stele/breach';

import {
  createAttestation,
  signAttestation,
  verifyAttestation,
  reconcile,
  getDiscrepancies,
  computeAttestationCoverage,
} from '@stele/attestation';
import type { ReceiptSummary, AgentAction } from '@stele/attestation';

import {
  generateCanary,
  evaluateCanary,
  detectionProbability,
  isExpired,
} from '@stele/canary';


// ===========================================================================
// 1. Covenant -> Enforcement -> Reputation -> Breach pipeline
// ===========================================================================

describe('Covenant -> Enforcement -> Reputation -> Breach pipeline', () => {
  let operatorKp: KeyPair;
  let beneficiaryKp: KeyPair;
  let agentKp: KeyPair;
  let reporterKp: KeyPair;
  let agentIdentity: AgentIdentity;
  let covenant: CovenantDocument;
  let monitor: Monitor;
  let receipts: ExecutionReceipt[];

  const CONSTRAINTS = [
    "permit file.read on '/data/**'",
    "permit api.call on '/internal/**'",
    "deny file.write on '/system/**' severity critical",
    "deny file.delete on '**' severity high",
  ].join('\n');

  beforeAll(async () => {
    [operatorKp, beneficiaryKp, agentKp, reporterKp] = await Promise.all([
      generateKeyPair(),
      generateKeyPair(),
      generateKeyPair(),
      generateKeyPair(),
    ]);

    agentIdentity = await createIdentity({
      operatorKeyPair: operatorKp,
      operatorIdentifier: 'lifecycle-corp',
      model: {
        provider: 'anthropic',
        modelId: 'claude-opus-4',
        modelVersion: '2025-04-14',
        attestationType: 'provider_signed',
      },
      capabilities: ['file.read', 'api.call'],
      deployment: { runtime: 'container' },
    });

    covenant = await buildCovenant({
      issuer: {
        id: agentIdentity.id,
        publicKey: operatorKp.publicKeyHex,
        role: 'issuer',
        name: 'Lifecycle Agent',
      },
      beneficiary: {
        id: sha256String('lifecycle-principal'),
        publicKey: beneficiaryKp.publicKeyHex,
        role: 'beneficiary',
        name: 'Principal Team',
      },
      constraints: CONSTRAINTS,
      privateKey: operatorKp.privateKey,
      enforcement: {
        type: 'monitor',
        config: { mode: 'enforce' },
        description: 'Runtime constraint monitor',
      },
    });

    monitor = new Monitor(covenant.id, CONSTRAINTS, {
      mode: 'enforce',
      failureMode: 'fail_closed',
    });

    receipts = [];
  });

  it('should build a valid covenant from the agent identity', async () => {
    expect(covenant.id).toMatch(/^[0-9a-f]{64}$/);
    expect(covenant.issuer.id).toBe(agentIdentity.id);
    const result = await verifyCovenant(covenant);
    expect(result.valid).toBe(true);
  });

  it('should permit allowed actions through the monitor', async () => {
    const r1 = await monitor.evaluate('file.read', '/data/report.csv');
    expect(r1.permitted).toBe(true);

    const r2 = await monitor.evaluate('api.call', '/internal/status');
    expect(r2.permitted).toBe(true);

    expect(monitor.getAuditLog().count).toBe(2);
  });

  it('should deny forbidden actions and throw MonitorDeniedError', async () => {
    await expect(
      monitor.evaluate('file.write', '/system/config.yaml'),
    ).rejects.toThrow(MonitorDeniedError);

    await expect(
      monitor.evaluate('file.delete', '/data/important.txt'),
    ).rejects.toThrow(MonitorDeniedError);

    expect(monitor.getAuditLog().count).toBe(4);
  });

  it('should maintain a tamper-evident hash chain in the audit log', () => {
    expect(monitor.verifyAuditLogIntegrity()).toBe(true);
    const merkleRoot = monitor.computeMerkleRoot();
    expect(merkleRoot).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should generate valid Merkle proofs for audit entries', () => {
    const proof = monitor.generateMerkleProof(0);
    expect(verifyMerkleProof(proof)).toBe(true);

    const proof2 = monitor.generateMerkleProof(2);
    expect(verifyMerkleProof(proof2)).toBe(true);
  });

  it('should create fulfilled execution receipts and chain them', async () => {
    const r1 = await createReceipt(
      covenant.id,
      agentIdentity.id,
      beneficiaryKp.publicKeyHex,
      'fulfilled',
      sha256String('proof-1'),
      1200,
      agentKp,
      null,
    );
    expect(r1.outcome).toBe('fulfilled');
    expect(r1.previousReceiptHash).toBeNull();
    receipts.push(r1);

    const r2 = await createReceipt(
      covenant.id,
      agentIdentity.id,
      beneficiaryKp.publicKeyHex,
      'fulfilled',
      sha256String('proof-2'),
      900,
      agentKp,
      r1.receiptHash,
    );
    expect(r2.previousReceiptHash).toBe(r1.receiptHash);
    receipts.push(r2);
  });

  it('should create a breached receipt with severity', async () => {
    const breachedReceipt = await createReceipt(
      covenant.id,
      agentIdentity.id,
      beneficiaryKp.publicKeyHex,
      'breached',
      sha256String('breach-proof'),
      500,
      agentKp,
      receipts[1]!.receiptHash,
      'critical',
    );
    expect(breachedReceipt.outcome).toBe('breached');
    expect(breachedReceipt.breachSeverity).toBe('critical');
    receipts.push(breachedReceipt);
  });

  it('should verify receipt chain integrity', () => {
    expect(verifyReceiptChain(receipts)).toBe(true);
  });

  it('should compute a reputation score reflecting the mixed history', () => {
    const score = computeReputationScore(agentIdentity.id, receipts);
    expect(score.totalExecutions).toBe(3);
    expect(score.fulfilled).toBe(2);
    expect(score.breached).toBe(1);
    expect(score.successRate).toBeCloseTo(2 / 3, 2);
    expect(score.weightedScore).toBeGreaterThanOrEqual(0);
    expect(score.weightedScore).toBeLessThanOrEqual(1);
    expect(score.receiptsMerkleRoot).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should compute a higher score with endorsements blended in', async () => {
    const endorserKp = await generateKeyPair();
    const endorsement = await createEndorsement(
      endorserKp.publicKeyHex as HashHex,
      agentIdentity.id,
      { covenantsCompleted: 50, breachRate: 0.02, averageOutcomeScore: 0.95 },
      ['file.read', 'api.call'],
      0.9,
      endorserKp,
    );

    const scoreWithEndorsement = computeReputationScore(
      agentIdentity.id,
      receipts,
      [endorsement],
    );
    const scoreWithout = computeReputationScore(agentIdentity.id, receipts);

    // Endorsement should push the score upward
    expect(scoreWithEndorsement.weightedScore).toBeGreaterThan(scoreWithout.weightedScore);
  });

  it('should create and verify a breach attestation', async () => {
    const auditLog = monitor.getAuditLog();
    const evidenceHash = sha256Object({
      auditLog: auditLog.merkleRoot,
      deniedAction: 'file.write',
    });

    const breach = await createBreachAttestation(
      covenant.id,
      agentIdentity.id,
      "deny file.write on '/system/**' severity critical",
      'critical',
      'file.write',
      '/system/config.yaml',
      evidenceHash,
      [covenant.id],
      reporterKp,
    );

    expect(breach.severity).toBe('critical');
    expect(breach.recommendedAction).toBe('revoke');
    const valid = await verifyBreachAttestation(breach);
    expect(valid).toBe(true);
  });

  it('should propagate breach through a trust graph correctly', async () => {
    const graph = new TrustGraph();
    const depA = sha256String('dependent-agent-a') as HashHex;
    const depB = sha256String('dependent-agent-b') as HashHex;

    graph.registerDependency(agentIdentity.id, depA);
    graph.registerDependency(depA, depB);

    expect(graph.isTrusted(agentIdentity.id)).toBe(true);
    expect(graph.isTrusted(depA)).toBe(true);
    expect(graph.isTrusted(depB)).toBe(true);

    const breach = await createBreachAttestation(
      covenant.id,
      agentIdentity.id,
      "deny file.write on '/system/**' severity critical",
      'critical',
      'file.write',
      '/system/config.yaml',
      sha256String('evidence'),
      [covenant.id],
      reporterKp,
    );

    const events = await graph.processBreach(breach);
    expect(events.length).toBeGreaterThanOrEqual(2);

    expect(graph.getStatus(agentIdentity.id)).toBe('revoked');
    expect(graph.isTrusted(agentIdentity.id)).toBe(false);
    expect(graph.getStatus(depA)).toBe('restricted');
    expect(graph.getStatus(depB)).toBe('degraded');
  });

  it('should notify breach listeners on the trust graph', async () => {
    const graph = new TrustGraph();
    const received: BreachEvent[] = [];
    graph.onBreach((e) => received.push(e));

    graph.registerDependency(agentIdentity.id, sha256String('listener-dep') as HashHex);

    const breach = await createBreachAttestation(
      covenant.id,
      agentIdentity.id,
      'constraint violation',
      'high',
      'file.write',
      '/system/db',
      sha256String('evidence'),
      [covenant.id],
      reporterKp,
    );

    await graph.processBreach(breach);
    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(received[0]!.affectedAgent).toBe(agentIdentity.id);
  });

  it('should reject a tampered breach attestation', async () => {
    const breach = await createBreachAttestation(
      covenant.id,
      agentIdentity.id,
      'constraint violation',
      'critical',
      'file.write',
      '/system/config',
      sha256String('evidence'),
      [covenant.id],
      reporterKp,
    );

    const tampered = { ...breach, severity: 'low' as const };
    expect(await verifyBreachAttestation(tampered)).toBe(false);
  });

  it('should link reputation stakes to the breach workflow', async () => {
    const stake = await createStake(agentIdentity.id, covenant.id, 0.7, agentKp);
    expect(stake.status).toBe('active');
    expect(stake.amount).toBe(0.7);

    // On breach, burn the stake
    const burned = burnStake(stake);
    expect(burned.status).toBe('burned');
    expect(burned.resolvedAt).toBeDefined();
  });
});


// ===========================================================================
// 2. Identity evolution + covenant binding
// ===========================================================================

describe('Identity evolution + covenant binding', () => {
  let operatorKp: KeyPair;
  let beneficiaryKp: KeyPair;
  let initialIdentity: AgentIdentity;
  let evolvedIdentity: AgentIdentity;
  let initialCovenant: CovenantDocument;
  let evolvedCovenant: CovenantDocument;

  beforeAll(async () => {
    [operatorKp, beneficiaryKp] = await Promise.all([
      generateKeyPair(),
      generateKeyPair(),
    ]);

    initialIdentity = await createIdentity({
      operatorKeyPair: operatorKp,
      operatorIdentifier: 'evolution-corp',
      model: {
        provider: 'anthropic',
        modelId: 'claude-opus-4',
        modelVersion: '1.0',
        attestationType: 'provider_signed',
      },
      capabilities: ['file.read'],
      deployment: { runtime: 'container' },
    });
  });

  it('should create and verify the initial identity', async () => {
    const result = await verifyIdentity(initialIdentity);
    expect(result.valid).toBe(true);
    expect(initialIdentity.version).toBe(1);
    expect(initialIdentity.capabilities).toContain('file.read');
  });

  it('should create a covenant bound to the initial identity', async () => {
    initialCovenant = await buildCovenant({
      issuer: {
        id: initialIdentity.id,
        publicKey: operatorKp.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'beneficiary-team',
        publicKey: beneficiaryKp.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: "permit file.read on '/data/**'",
      privateKey: operatorKp.privateKey,
    });

    const result = await verifyCovenant(initialCovenant);
    expect(result.valid).toBe(true);
    expect(initialCovenant.issuer.id).toBe(initialIdentity.id);
  });

  it('should evolve the identity with new capabilities', async () => {
    evolvedIdentity = await evolveIdentity(initialIdentity, {
      operatorKeyPair: operatorKp,
      changeType: 'capability_change',
      description: 'Added file.write capability',
      updates: { capabilities: ['file.read', 'file.write'] },
    });

    expect(evolvedIdentity.version).toBe(2);
    expect(evolvedIdentity.capabilities).toContain('file.write');
    expect(evolvedIdentity.lineage).toHaveLength(2);
    expect(evolvedIdentity.id).not.toBe(initialIdentity.id);
  });

  it('should verify the evolved identity passes all checks', async () => {
    const result = await verifyIdentity(evolvedIdentity);
    expect(result.valid).toBe(true);
    for (const check of result.checks) {
      expect(check.passed).toBe(true);
    }
  });

  it('should keep the original covenant valid after identity evolution', async () => {
    const result = await verifyCovenant(initialCovenant);
    expect(result.valid).toBe(true);
    // The old covenant is still bound to the original identity hash
    expect(initialCovenant.issuer.id).toBe(initialIdentity.id);
  });

  it('should create a new covenant for the evolved identity', async () => {
    evolvedCovenant = await buildCovenant({
      issuer: {
        id: evolvedIdentity.id,
        publicKey: operatorKp.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: 'beneficiary-team',
        publicKey: beneficiaryKp.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: "permit file.read on '/data/**'\npermit file.write on '/output/**'",
      privateKey: operatorKp.privateKey,
    });

    const result = await verifyCovenant(evolvedCovenant);
    expect(result.valid).toBe(true);
    expect(evolvedCovenant.issuer.id).toBe(evolvedIdentity.id);
  });

  it('should round-trip the evolved identity through serialization', async () => {
    const json = serializeIdentity(evolvedIdentity);
    const restored = deserializeIdentity(json);

    expect(restored.id).toBe(evolvedIdentity.id);
    expect(restored.version).toBe(2);

    const result = await verifyIdentity(restored);
    expect(result.valid).toBe(true);
  });

  it('should evolve through a model update and maintain lineage integrity', async () => {
    const modelUpdated = await evolveIdentity(evolvedIdentity, {
      operatorKeyPair: operatorKp,
      changeType: 'model_update',
      description: 'Upgraded to claude-opus-4 v2',
      updates: {
        model: {
          provider: 'anthropic',
          modelId: 'claude-opus-4',
          modelVersion: '2.0',
          attestationType: 'provider_signed',
        },
      },
    });

    expect(modelUpdated.version).toBe(3);
    expect(modelUpdated.lineage).toHaveLength(3);
    expect(modelUpdated.model.modelVersion).toBe('2.0');

    const result = await verifyIdentity(modelUpdated);
    expect(result.valid).toBe(true);

    // All lineage entries should be temporally ordered
    for (let i = 1; i < modelUpdated.lineage.length; i++) {
      expect(modelUpdated.lineage[i]!.timestamp >= modelUpdated.lineage[i - 1]!.timestamp).toBe(true);
    }
  });

  it('should produce distinct identity hashes for different capability sets', async () => {
    const idA = await createIdentity({
      operatorKeyPair: operatorKp,
      operatorIdentifier: 'test-a',
      model: { provider: 'anthropic', modelId: 'claude-opus-4', modelVersion: '1.0', attestationType: 'provider_signed' },
      capabilities: ['file.read'],
      deployment: { runtime: 'container' },
    });

    const idB = await createIdentity({
      operatorKeyPair: operatorKp,
      operatorIdentifier: 'test-b',
      model: { provider: 'anthropic', modelId: 'claude-opus-4', modelVersion: '1.0', attestationType: 'provider_signed' },
      capabilities: ['file.read', 'file.write'],
      deployment: { runtime: 'container' },
    });

    expect(idA.id).not.toBe(idB.id);
    expect(idA.capabilityManifestHash).not.toBe(idB.capabilityManifestHash);
  });

  it('should bind both old and new covenants to different monitor instances', async () => {
    const oldMonitor = new Monitor(initialCovenant.id, initialCovenant.constraints, { mode: 'enforce' });
    const newMonitor = new Monitor(evolvedCovenant.id, evolvedCovenant.constraints, { mode: 'enforce' });

    // Old covenant only permits file.read
    const r1 = await oldMonitor.evaluate('file.read', '/data/file.txt');
    expect(r1.permitted).toBe(true);

    // New covenant permits file.read and file.write
    const r2 = await newMonitor.evaluate('file.read', '/data/file.txt');
    expect(r2.permitted).toBe(true);

    const r3 = await newMonitor.evaluate('file.write', '/output/result.txt');
    expect(r3.permitted).toBe(true);

    // Old monitor should deny via default deny (no permit for file.write)
    // In enforce mode, denial throws MonitorDeniedError
    await expect(
      oldMonitor.evaluate('file.write', '/output/result.txt'),
    ).rejects.toThrow(MonitorDeniedError);
  });
});


// ===========================================================================
// 3. SDK SteleClient full workflow
// ===========================================================================

describe('SDK SteleClient full workflow', () => {
  let client: SteleClient;
  let auditorKp: KeyPair;

  beforeEach(async () => {
    client = new SteleClient();
    auditorKp = await generateKeyPair();
  });

  it('should generate keys and create a covenant through the client', async () => {
    const kp = await client.generateKeyPair();
    expect(kp.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(client.keyPair).toBeDefined();

    const doc = await client.createCovenant({
      issuer: { id: 'sdk-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'sdk-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\ndeny file.write on '/system/**' severity critical",
    });

    expect(doc.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should verify a covenant and emit the verified event', async () => {
    const kp = await client.generateKeyPair();
    const verifiedEvents: CovenantVerifiedEvent[] = [];
    client.on('covenant:verified', (e) => verifiedEvents.push(e as CovenantVerifiedEvent));

    const doc = await client.createCovenant({
      issuer: { id: 'v-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'v-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });

    const result = await client.verifyCovenant(doc);
    expect(result.valid).toBe(true);
    expect(verifiedEvents).toHaveLength(1);
    expect(verifiedEvents[0]!.result.valid).toBe(true);
  });

  it('should evaluate actions against a covenant', async () => {
    const kp = await client.generateKeyPair();
    const evalEvents: EvaluationCompletedEvent[] = [];
    client.on('evaluation:completed', (e) => evalEvents.push(e as EvaluationCompletedEvent));

    const doc = await client.createCovenant({
      issuer: { id: 'e-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'e-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\ndeny file.write on '/system/**' severity critical",
    });

    const readResult = await client.evaluateAction(doc, 'file.read', '/data/test.csv');
    expect(readResult.permitted).toBe(true);

    const writeResult = await client.evaluateAction(doc, 'file.write', '/system/config');
    expect(writeResult.permitted).toBe(false);
    expect(writeResult.severity).toBe('critical');

    expect(evalEvents).toHaveLength(2);
  });

  it('should countersign a covenant and emit the event', async () => {
    const kp = await client.generateKeyPair();
    const csEvents: CovenantCountersignedEvent[] = [];
    client.on('covenant:countersigned', (e) => csEvents.push(e as CovenantCountersignedEvent));

    const doc = await client.createCovenant({
      issuer: { id: 'cs-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'cs-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });

    const countersigned = await client.countersign(doc, 'auditor', auditorKp);
    expect(countersigned.countersignatures).toHaveLength(1);
    expect(countersigned.countersignatures![0]!.signerRole).toBe('auditor');
    expect(csEvents).toHaveLength(1);

    const verifyResult = await client.verifyCovenant(countersigned);
    expect(verifyResult.valid).toBe(true);
  });

  it('should resolve and validate a covenant chain', async () => {
    const kp = await client.generateKeyPair();
    const resolvedEvents: ChainResolvedEvent[] = [];
    const validatedEvents: ChainValidatedEvent[] = [];
    client.on('chain:resolved', (e) => resolvedEvents.push(e as ChainResolvedEvent));
    client.on('chain:validated', (e) => validatedEvents.push(e as ChainValidatedEvent));

    const root = await client.createCovenant({
      issuer: { id: 'chain-root', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'chain-child', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'\ndeny file.delete on '**' severity critical",
    });

    const child = await client.createCovenant({
      issuer: { id: 'chain-child', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'chain-leaf', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\ndeny file.delete on '**' severity critical",
      chain: { parentId: root.id, relation: 'restricts', depth: 1 },
    });

    const ancestors = await client.resolveChain(child, [root]);
    expect(ancestors).toHaveLength(1);
    expect(resolvedEvents).toHaveLength(1);

    const chainResult = await client.validateChain([root, child]);
    expect(chainResult.valid).toBe(true);
    expect(validatedEvents).toHaveLength(1);
    expect(validatedEvents[0]!.result.valid).toBe(true);
  });

  it('should create and evolve an identity with events', async () => {
    const kp = await client.generateKeyPair();
    const createdEvents: IdentityCreatedEvent[] = [];
    const evolvedEvents: IdentityEvolvedEvent[] = [];
    client.on('identity:created', (e) => createdEvents.push(e as IdentityCreatedEvent));
    client.on('identity:evolved', (e) => evolvedEvents.push(e as IdentityEvolvedEvent));

    const identity = await client.createIdentity({
      operatorIdentifier: 'sdk-agent',
      model: { provider: 'anthropic', modelId: 'claude-opus-4', modelVersion: '1.0' },
      capabilities: ['file.read'],
      deployment: { runtime: 'container' },
    });

    expect(createdEvents).toHaveLength(1);
    expect(identity.version).toBe(1);

    const evolved = await client.evolveIdentity(identity, {
      changeType: 'capability_change',
      description: 'Add write capability',
      updates: { capabilities: ['file.read', 'file.write'] },
    });

    expect(evolvedEvents).toHaveLength(1);
    expect(evolved.version).toBe(2);
  });

  it('should use once semantics via on/off pattern', async () => {
    const kp = await client.generateKeyPair();
    let callCount = 0;
    const unsub = client.on('covenant:created', () => {
      callCount++;
      unsub(); // Remove listener after first call
    });

    await client.createCovenant({
      issuer: { id: 'once-1', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'once-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });

    await client.createCovenant({
      issuer: { id: 'once-2', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'once-ben-2', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });

    expect(callCount).toBe(1);
  });

  it('should removeAllListeners to silence all events', async () => {
    const kp = await client.generateKeyPair();
    const events: unknown[] = [];
    client.on('covenant:created', (e) => events.push(e));
    client.on('covenant:verified', (e) => events.push(e));

    client.removeAllListeners();

    const doc = await client.createCovenant({
      issuer: { id: 'silent-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'silent-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });
    await client.verifyCovenant(doc);

    expect(events).toHaveLength(0);
  });

  it('should use CCL utilities on the client for parsing and merging', () => {
    const doc1 = client.parseCCL("permit file.read on '/data/**'");
    const doc2 = client.parseCCL("deny file.write on '/system/**' severity critical");
    const merged = client.mergeCCL(doc1, doc2);

    expect(merged.statements.length).toBe(2);
    const readResult = evaluate(merged, 'file.read', '/data/test.csv');
    expect(readResult.permitted).toBe(true);

    const writeResult = evaluate(merged, 'file.write', '/system/config');
    expect(writeResult.permitted).toBe(false);
  });

  it('should serialize and deserialize covenants round-trip through the workflow', async () => {
    const kp = await client.generateKeyPair();
    const doc = await client.createCovenant({
      issuer: { id: 'ser-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'ser-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\ndeny file.write on '**' severity critical",
    });

    const json = serializeCovenant(doc);
    const restored = deserializeCovenant(json);

    expect(restored.id).toBe(doc.id);
    const result = await client.verifyCovenant(restored);
    expect(result.valid).toBe(true);
  });
});


// ===========================================================================
// 4. Store + Verifier batch operations
// ===========================================================================

describe('Store + Verifier batch operations', () => {
  let store: MemoryStore;
  let kp: KeyPair;

  beforeEach(async () => {
    kp = await generateKeyPair();
    store = new MemoryStore();
  });

  it('should store multiple covenants and retrieve them all', async () => {
    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 10; i++) {
      const doc = await buildCovenant({
        issuer: { id: `batch-issuer-${i}`, publicKey: kp.publicKeyHex, role: 'issuer' },
        beneficiary: { id: `batch-ben-${i}`, publicKey: kp.publicKeyHex, role: 'beneficiary' },
        constraints: `permit file.read on '/data/${i}/**'`,
        privateKey: kp.privateKey,
      });
      docs.push(doc);
    }

    await store.putBatch(docs);
    expect(store.size).toBe(10);

    const all = await store.list();
    expect(all).toHaveLength(10);
  });

  it('should batch verify all stored documents and all pass', async () => {
    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 5; i++) {
      const doc = await buildCovenant({
        issuer: { id: `verify-${i}`, publicKey: kp.publicKeyHex, role: 'issuer' },
        beneficiary: { id: `ben-${i}`, publicKey: kp.publicKeyHex, role: 'beneficiary' },
        constraints: `permit file.read on '/batch/${i}/**'`,
        privateKey: kp.privateKey,
      });
      docs.push(doc);
    }

    await store.putBatch(docs);
    const all = await store.list();
    const batchReport = await verifyBatch(all);

    expect(batchReport.summary.total).toBe(5);
    expect(batchReport.summary.passed).toBe(5);
    expect(batchReport.summary.failed).toBe(0);
  });

  it('should detect tampered documents in batch verification from store', async () => {
    const legit = await buildCovenant({
      issuer: { id: 'legit', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
      privateKey: kp.privateKey,
    });

    const tampered = { ...legit, constraints: "deny file.read on '**'" };

    const batchReport = await verifyBatch([legit, tampered]);
    expect(batchReport.summary.passed).toBe(1);
    expect(batchReport.summary.failed).toBe(1);
  });

  it('should filter stored covenants by issuer and beneficiary', async () => {
    const docA = await buildCovenant({
      issuer: { id: 'alice', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'bob', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/a/**'",
      privateKey: kp.privateKey,
    });
    const docB = await buildCovenant({
      issuer: { id: 'charlie', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'dave', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/b/**'",
      privateKey: kp.privateKey,
    });
    const docC = await buildCovenant({
      issuer: { id: 'alice', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'dave', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/c/**'",
      privateKey: kp.privateKey,
    });

    await store.putBatch([docA, docB, docC]);

    const aliceDocs = await store.list({ issuerId: 'alice' });
    expect(aliceDocs).toHaveLength(2);

    const daveDocs = await store.list({ beneficiaryId: 'dave' });
    expect(daveDocs).toHaveLength(2);

    const aliceDaveDocs = await store.list({ issuerId: 'alice', beneficiaryId: 'dave' });
    expect(aliceDaveDocs).toHaveLength(1);
    expect(aliceDaveDocs[0]!.id).toBe(docC.id);
  });

  it('should count with and without filters', async () => {
    for (let i = 0; i < 4; i++) {
      await store.put(await buildCovenant({
        issuer: { id: 'counter', publicKey: kp.publicKeyHex, role: 'issuer' },
        beneficiary: { id: `b-${i}`, publicKey: kp.publicKeyHex, role: 'beneficiary' },
        constraints: `permit file.read on '/data/${i}/**'`,
        privateKey: kp.privateKey,
      }));
    }

    expect(await store.count()).toBe(4);
    expect(await store.count({ issuerId: 'counter' })).toBe(4);
    expect(await store.count({ issuerId: 'nonexistent' })).toBe(0);
  });

  it('should support getBatch for selective retrieval', async () => {
    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 6; i++) {
      const doc = await buildCovenant({
        issuer: { id: `sel-${i}`, publicKey: kp.publicKeyHex, role: 'issuer' },
        beneficiary: { id: `ben-${i}`, publicKey: kp.publicKeyHex, role: 'beneficiary' },
        constraints: `permit file.read on '/sel/${i}/**'`,
        privateKey: kp.privateKey,
      });
      docs.push(doc);
    }
    await store.putBatch(docs);

    // Retrieve a subset
    const subset = await store.getBatch([docs[1]!.id, docs[3]!.id, docs[5]!.id]);
    expect(subset).toHaveLength(3);
    expect(subset[0]!.id).toBe(docs[1]!.id);
    expect(subset[1]!.id).toBe(docs[3]!.id);
    expect(subset[2]!.id).toBe(docs[5]!.id);
  });

  it('should fire store events on put and delete', async () => {
    const events: StoreEvent[] = [];
    store.onEvent((e) => events.push(e));

    const doc = await buildCovenant({
      issuer: { id: 'evt', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'evt-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
      privateKey: kp.privateKey,
    });

    await store.put(doc);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('put');

    await store.delete(doc.id);
    expect(events).toHaveLength(2);
    expect(events[1]!.type).toBe('delete');
  });

  it('should verify documents in store match their Verifier reports', async () => {
    const verifier = new Verifier({ verifierId: 'store-verifier' });
    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 3; i++) {
      const doc = await buildCovenant({
        issuer: { id: `vr-${i}`, publicKey: kp.publicKeyHex, role: 'issuer' },
        beneficiary: { id: `vr-ben-${i}`, publicKey: kp.publicKeyHex, role: 'beneficiary' },
        constraints: `permit file.read on '/vr/${i}/**'`,
        privateKey: kp.privateKey,
      });
      docs.push(doc);
    }
    await store.putBatch(docs);

    for (const doc of docs) {
      const retrieved = await store.get(doc.id);
      expect(retrieved).toBeDefined();
      const report = await verifier.verify(retrieved!);
      expect(report.valid).toBe(true);
      expect(report.verifierId).toBe('store-verifier');
    }

    expect(verifier.getHistory()).toHaveLength(3);
  });

  it('should use Verifier verifyAction on stored covenants for access decisions', async () => {
    const verifier = new Verifier();

    const doc = await buildCovenant({
      issuer: { id: 'action-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'action-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\ndeny file.write on '/system/**' severity critical",
      privateKey: kp.privateKey,
    });
    await store.put(doc);

    const retrieved = await store.get(doc.id);
    const readReport = await verifier.verifyAction(retrieved!, 'file.read', '/data/test.csv');
    expect(readReport.permitted).toBe(true);
    expect(readReport.documentValid).toBe(true);

    const writeReport = await verifier.verifyAction(retrieved!, 'file.write', '/system/config');
    expect(writeReport.permitted).toBe(false);
    expect(writeReport.severity).toBe('critical');
  });

  it('should deleteBatch and confirm absence after batch removal', async () => {
    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 5; i++) {
      const doc = await buildCovenant({
        issuer: { id: `del-${i}`, publicKey: kp.publicKeyHex, role: 'issuer' },
        beneficiary: { id: `del-ben-${i}`, publicKey: kp.publicKeyHex, role: 'beneficiary' },
        constraints: `permit file.read on '/del/${i}/**'`,
        privateKey: kp.privateKey,
      });
      docs.push(doc);
    }
    await store.putBatch(docs);
    expect(store.size).toBe(5);

    const toDelete = docs.slice(0, 3).map((d) => d.id);
    const deleted = await store.deleteBatch(toDelete);
    expect(deleted).toBe(3);
    expect(store.size).toBe(2);

    for (const id of toDelete) {
      expect(await store.has(id)).toBe(false);
    }
  });
});


// ===========================================================================
// 5. Attestation + Reputation cross-validation
// ===========================================================================

describe('Attestation + Reputation cross-validation', () => {
  let agentKp: KeyPair;
  let counterpartyKp: KeyPair;
  let operatorKp: KeyPair;
  let covenantId: HashHex;

  beforeAll(async () => {
    [agentKp, counterpartyKp, operatorKp] = await Promise.all([
      generateKeyPair(),
      generateKeyPair(),
      generateKeyPair(),
    ]);

    const covenant = await buildCovenant({
      issuer: { id: 'att-issuer', publicKey: operatorKp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'att-ben', publicKey: agentKp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit api.call on '/endpoint/**'",
      privateKey: operatorKp.privateKey,
    });
    covenantId = covenant.id;
  });

  it('should create an external attestation with deterministic ID', () => {
    const now = Date.now();
    const att = createAttestation(
      'agent-1',
      'counterparty-1',
      '/endpoint/data',
      sha256String('input-data'),
      sha256String('output-data'),
      sha256String('interaction'),
      now,
    );

    expect(att.id).toMatch(/^[0-9a-f]{64}$/);
    expect(att.agentId).toBe('agent-1');
    expect(att.counterpartyId).toBe('counterparty-1');
    expect(att.counterpartySignature).toBe('');
  });

  it('should sign and verify an attestation', async () => {
    const att = createAttestation(
      'agent-1',
      'counterparty-1',
      '/endpoint/data',
      sha256String('input'),
      sha256String('output'),
      sha256String('interaction'),
      Date.now(),
    );

    const signed = await signAttestation(att, counterpartyKp.privateKey);
    expect(signed.counterpartySignature).not.toBe('');

    const valid = await verifyAttestation(signed, counterpartyKp.publicKey);
    expect(valid).toBe(true);

    // Wrong key should fail
    const wrongKeyValid = await verifyAttestation(signed, agentKp.publicKey);
    expect(wrongKeyValid).toBe(false);
  });

  it('should reconcile matching receipt and attestation with no discrepancies', () => {
    const now = Date.now();
    const interactionHash = sha256String('matching-interaction');
    const inputHash = sha256String('matching-input');
    const outputHash = sha256String('matching-output');

    const receipt: ReceiptSummary = {
      id: sha256String('receipt-1'),
      interactionHash,
      inputHash,
      outputHash,
      endpoint: '/endpoint/data',
      timestamp: now,
    };

    const att = createAttestation(
      'agent-1',
      'counterparty-1',
      '/endpoint/data',
      inputHash,
      outputHash,
      interactionHash,
      now,
    );

    const result = reconcile(receipt, att);
    expect(result.match).toBe(true);
    expect(result.discrepancies).toHaveLength(0);
  });

  it('should detect discrepancies when receipt and attestation differ', () => {
    const now = Date.now();

    const receipt: ReceiptSummary = {
      id: sha256String('receipt-2'),
      interactionHash: sha256String('interaction-a'),
      inputHash: sha256String('input-a'),
      outputHash: sha256String('output-a'),
      endpoint: '/endpoint/data',
      timestamp: now,
    };

    const att = createAttestation(
      'agent-1',
      'counterparty-1',
      '/endpoint/data',
      sha256String('input-b'),
      sha256String('output-a'),
      sha256String('interaction-b'),
      now,
    );

    const result = reconcile(receipt, att);
    expect(result.match).toBe(false);
    expect(result.discrepancies.length).toBeGreaterThan(0);

    const discFields = result.discrepancies.map((d) => d.field);
    expect(discFields).toContain('interactionHash');
    expect(discFields).toContain('inputHash');
  });

  it('should detect timestamp discrepancy when difference exceeds threshold', () => {
    const receipt: ReceiptSummary = {
      id: sha256String('receipt-ts'),
      interactionHash: sha256String('same'),
      inputHash: sha256String('same-input'),
      outputHash: sha256String('same-output'),
      endpoint: '/endpoint/data',
      timestamp: 1000000,
    };

    const att = createAttestation(
      'agent-1', 'cp-1', '/endpoint/data',
      sha256String('same-input'),
      sha256String('same-output'),
      sha256String('same'),
      1010000, // 10 seconds difference, over 5s threshold
    );

    const discrepancies = getDiscrepancies(receipt, att);
    expect(discrepancies.length).toBeGreaterThan(0);
    const tsDisc = discrepancies.find((d) => d.field === 'timestamp');
    expect(tsDisc).toBeDefined();
    expect(tsDisc!.severity).toBe('minor');
  });

  it('should compute attestation coverage for agent actions', () => {
    const now = Date.now();
    // Space actions far apart (20s) so the default 5s window cannot cover distant ones
    const actions: AgentAction[] = [
      { id: 'a1', agentId: 'agent-1', timestamp: now, actionType: 'api.call' },
      { id: 'a2', agentId: 'agent-1', timestamp: now + 20000, actionType: 'api.call' },
      { id: 'a3', agentId: 'agent-1', timestamp: now + 40000, actionType: 'file.read' },
      { id: 'a4', agentId: 'agent-1', timestamp: now + 60000, actionType: 'api.call' },
    ];

    // Create attestations covering only the first 2 actions (within 5s window)
    const att1 = createAttestation(
      'agent-1', 'cp-1', '/endpoint', sha256String('i1'),
      sha256String('o1'), sha256String('h1'), now,
    );
    const att2 = createAttestation(
      'agent-1', 'cp-1', '/endpoint', sha256String('i2'),
      sha256String('o2'), sha256String('h2'), now + 20000,
    );

    const coverage = computeAttestationCoverage(actions, [att1, att2]);
    expect(coverage.totalActions).toBe(4);
    expect(coverage.coveredActions).toBe(2);
    expect(coverage.coveragePercentage).toBe(50);
    expect(coverage.uncoveredActionIds).toHaveLength(2);
    expect(coverage.uncoveredActionIds).toContain('a3');
    expect(coverage.uncoveredActionIds).toContain('a4');
  });

  it('should create execution receipts and reconcile them with attestations', async () => {
    const now = Date.now();
    const interactionHash = sha256String('api-interaction');
    const inputHash = sha256String('api-input');
    const outputHash = sha256String('api-output');

    // Create an execution receipt
    const receipt = await createReceipt(
      covenantId,
      agentKp.publicKeyHex as HashHex,
      operatorKp.publicKeyHex,
      'fulfilled',
      sha256String('compliance-proof'),
      800,
      agentKp,
      null,
    );

    expect(receipt.outcome).toBe('fulfilled');

    // Create a matching attestation (using receipt-compatible fields)
    const receiptSummary: ReceiptSummary = {
      id: receipt.id,
      interactionHash,
      inputHash,
      outputHash,
      endpoint: '/endpoint/api',
      timestamp: now,
    };

    const att = createAttestation(
      agentKp.publicKeyHex,
      counterpartyKp.publicKeyHex,
      '/endpoint/api',
      inputHash,
      outputHash,
      interactionHash,
      now,
    );

    const signed = await signAttestation(att, counterpartyKp.privateKey);
    const attValid = await verifyAttestation(signed, counterpartyKp.publicKey);
    expect(attValid).toBe(true);

    const reconciliation = reconcile(receiptSummary, signed);
    expect(reconciliation.match).toBe(true);
  });

  it('should compute reputation score from receipts paired with endorsements from attestations', async () => {
    // Create a series of fulfilled receipts
    const receipts: ExecutionReceipt[] = [];
    let prevHash: HashHex | null = null;
    for (let i = 0; i < 8; i++) {
      const receipt = await createReceipt(
        covenantId,
        agentKp.publicKeyHex as HashHex,
        operatorKp.publicKeyHex,
        'fulfilled',
        sha256String(`proof-${i}`),
        1000,
        agentKp,
        prevHash,
      );
      receipts.push(receipt);
      prevHash = receipt.receiptHash;
    }

    expect(verifyReceiptChain(receipts)).toBe(true);

    // Create endorsements from the attestation process
    const endorsement = await createEndorsement(
      counterpartyKp.publicKeyHex as HashHex,
      agentKp.publicKeyHex as HashHex,
      { covenantsCompleted: 20, breachRate: 0.0 },
      ['api.call'],
      0.85,
      counterpartyKp,
    );

    const scoreWithEndorsement = computeReputationScore(
      agentKp.publicKeyHex as HashHex,
      receipts,
      [endorsement],
    );

    const scoreWithout = computeReputationScore(
      agentKp.publicKeyHex as HashHex,
      receipts,
    );

    expect(scoreWithEndorsement.totalExecutions).toBe(8);
    expect(scoreWithEndorsement.fulfilled).toBe(8);
    expect(scoreWithEndorsement.successRate).toBe(1.0);
    // Endorsement should blend in and push score up
    expect(scoreWithEndorsement.weightedScore).toBeGreaterThan(scoreWithout.weightedScore);
  });

  it('should verify endorsement integrity', async () => {
    const endorsement = await createEndorsement(
      counterpartyKp.publicKeyHex as HashHex,
      agentKp.publicKeyHex as HashHex,
      { covenantsCompleted: 10, breachRate: 0.05, averageOutcomeScore: 0.9 },
      ['file.read', 'api.call'],
      0.8,
      counterpartyKp,
    );

    expect(endorsement.id).toMatch(/^[0-9a-f]{64}$/);
    expect(endorsement.weight).toBe(0.8);

    // Verify against the endorser's public key hex (which is the endorserIdentityHash)
    const valid = await verifyEndorsement(endorsement);
    expect(valid).toBe(true);
  });

  it('should compute full coverage when all actions have attestations', () => {
    const now = Date.now();
    const actions: AgentAction[] = [
      { id: 'a1', agentId: 'agent-x', timestamp: now, actionType: 'call' },
      { id: 'a2', agentId: 'agent-x', timestamp: now + 500, actionType: 'call' },
    ];

    const attestations = [
      createAttestation('agent-x', 'cp-1', '/ep', sha256String('i1'), sha256String('o1'), sha256String('h1'), now),
      createAttestation('agent-x', 'cp-1', '/ep', sha256String('i2'), sha256String('o2'), sha256String('h2'), now + 500),
    ];

    const coverage = computeAttestationCoverage(actions, attestations);
    expect(coverage.coveragePercentage).toBe(100);
    expect(coverage.uncoveredActionIds).toHaveLength(0);
  });

  it('should link reputation stake lifecycle to attestation-validated receipts', async () => {
    // Create a stake
    const stake = await createStake(
      agentKp.publicKeyHex as HashHex,
      covenantId,
      0.6,
      agentKp,
    );
    expect(stake.status).toBe('active');

    // After successful execution (attested), release the stake
    const released = releaseStake(stake, 'fulfilled');
    expect(released.status).toBe('released');
    expect(released.resolvedAt).toBeDefined();
  });
});
