/**
 * End-to-end integration tests for the Nobulex Covenant Primitives.
 *
 * Full flow: DID creation → covenant authoring → attestation →
 * middleware enforcement → action logging → verification →
 * violation detection → slashing.
 *
 * Plus agent-to-agent covenant negotiation via composability.
 */
import { describe, it, expect } from 'vitest';

// Identity
import { createDID, signWithDID, verifyWithDID, DIDResolver } from '@nobulex/identity';
import type { DIDKeyPair } from '@nobulex/identity';

// Covenant DSL
import { parseSource, compile, serialize } from '@nobulex/covenant-lang';
import type { CovenantSpec, EnforcementFn } from '@nobulex/covenant-lang';

// Action Log
import { ActionLogBuilder, verifyIntegrity, generateMerkleProof, verifyMerkleProof, buildMerkleTree } from '@nobulex/action-log';

// Middleware
import { EnforcementMiddleware, createMiddleware } from '@nobulex/middleware';

// Verification
import { verify, verifyWithProofs, verifyBatch } from '@nobulex/verification';

// Composability (merged into @nobulex/core)
import { checkCompatibility, findCompatibleAgents, analyzeTopology, mergeCovenants } from '@nobulex/core';

// TEE
import { generateQuote, generateEndorsements, verifyAttestation, bindEnclaveToDID, verifyBinding, TEERegistry, createEvidence, generateReportData } from '@nobulex/tee';

// Contracts
import { ContractSimulator, computeSlashAmount } from '@nobulex/contracts';

// SDK Primitives
import { CovenantAgent } from '@nobulex/sdk';

// Crypto
import { sha256String, canonicalizeJson, timestamp } from '@nobulex/crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: Full agent lifecycle, DID → Covenant → Enforce → Verify → Slash
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E Scenario 1: Full agent lifecycle', () => {
  let agentDID: DIDKeyPair;
  let auditorDID: DIDKeyPair;
  let resolver: DIDResolver;
  let spec: CovenantSpec;

  it('Step 1: Create agent and auditor DIDs', async () => {
    agentDID = await createDID();
    auditorDID = await createDID();
    resolver = new DIDResolver();
    resolver.register(agentDID.document);
    resolver.register(auditorDID.document);

    expect(agentDID.did).toMatch(/^did:nobulex:/);
    expect(auditorDID.did).toMatch(/^did:nobulex:/);
    expect(resolver.resolve(agentDID.did).found).toBe(true);
    expect(resolver.resolve(auditorDID.did).found).toBe(true);
  });

  it('Step 2: Author covenant DSL', () => {
    spec = parseSource(`
      covenant TradingBot {
        forbid transfer (amount > 10000);
        permit transfer;
        permit read;
        permit query;
        forbid shutdown;
        forbid admin;
        require agent.risk_score <= 0.5;
      }
    `);
    expect(spec.name).toBe('TradingBot');
    expect(spec.statements).toHaveLength(6);
    expect(spec.requirements).toHaveLength(1);
  });

  it('Step 3: Compile and enforce actions through middleware', async () => {
    const middleware = new EnforcementMiddleware({
      agentDid: agentDID.did,
      spec,
    });

    // Allowed actions
    const r1 = await middleware.execute({ action: 'read', params: { agent: { risk_score: 0.3 } } }, () => 'data');
    expect(r1.executed).toBe(true);
    expect(r1.value).toBe('data');

    const r2 = await middleware.execute({ action: 'transfer', params: { amount: 500, agent: { risk_score: 0.3 } } }, () => 'sent');
    expect(r2.executed).toBe(true);

    const r3 = await middleware.execute({ action: 'query', params: { agent: { risk_score: 0.2 } } }, () => [42]);
    expect(r3.executed).toBe(true);

    // Blocked actions
    const r4 = await middleware.execute({ action: 'transfer', params: { amount: 50000, agent: { risk_score: 0.1 } } }, () => 'no');
    expect(r4.executed).toBe(false);

    const r5 = await middleware.execute({ action: 'shutdown', params: {} }, () => 'no');
    expect(r5.executed).toBe(false);

    const r6 = await middleware.execute({ action: 'admin', params: {} }, () => 'no');
    expect(r6.executed).toBe(false);

    // Action log integrity
    const log = middleware.getLog();
    expect(log.entries).toHaveLength(6);
    expect(middleware.actionCount).toBe(6);
    const integrity = verifyIntegrity(log);
    expect(integrity.valid).toBe(true);
  });

  it('Step 4: Verify covenant compliance post-hoc', async () => {
    const middleware = new EnforcementMiddleware({ agentDid: agentDID.did, spec });
    await middleware.execute({ action: 'read', params: { agent: { risk_score: 0.3 } } }, () => 'ok');
    await middleware.execute({ action: 'shutdown', params: {} }, () => 'no');
    await middleware.execute({ action: 'transfer', params: { amount: 100, agent: { risk_score: 0.2 } } }, () => 'sent');

    const log = middleware.getLog();
    const result = verify(spec, log);
    // Blocked actions are enforced, so agent is compliant
    expect(result.compliant).toBe(true);
    expect(result.totalActions).toBe(3);
  });

  it('Step 5: Generate Merkle proofs for audit trail', async () => {
    const middleware = new EnforcementMiddleware({ agentDid: agentDID.did, spec });
    await middleware.execute({ action: 'read', params: { agent: { risk_score: 0.1 } } }, () => 'ok');
    await middleware.execute({ action: 'query', params: { agent: { risk_score: 0.1 } } }, () => 42);
    await middleware.execute({ action: 'transfer', params: { amount: 200, agent: { risk_score: 0.3 } } }, () => 'sent');

    const log = middleware.getLog();
    // Generate proof for each entry
    for (let i = 0; i < log.entries.length; i++) {
      const proof = generateMerkleProof(log, i);
      expect(verifyMerkleProof(proof)).toBe(true);
    }
  });

  it('Step 6: Sign audit result with DID', async () => {
    const auditMessage = canonicalizeJson({
      agent: agentDID.did,
      auditor: auditorDID.did,
      result: 'compliant',
      timestamp: timestamp(),
    });

    const signature = await signWithDID(auditMessage, auditorDID);
    const valid = await verifyWithDID(auditMessage, signature, auditorDID.document);
    expect(valid).toBe(true);

    // Tampered message fails
    const tampered = await verifyWithDID(auditMessage + 'x', signature, auditorDID.document);
    expect(tampered).toBe(false);
  });

  it('Step 7: Slash agent stake on violation', async () => {
    const sim = new ContractSimulator({ baseSlashPercent: 10, escalationPercent: 5, maxSlashPercent: 50, minStake: 100n, cooldownSec: 0 });
    const cov = await sim.registerCovenant(agentDID.did, await sha256String(serialize(spec)));
    sim.stake(agentDID.did, cov.id, 10000n);

    const evidenceHash = await sha256String('violation_evidence_merkle_root');
    const { slashAmount, record } = sim.submitViolation(agentDID.did, cov.id, evidenceHash, 1);
    expect(slashAmount).toBe(1000n); // 10% of 10000
    expect(record.incidentCount).toBe(1);

    const remainingStake = sim.getStake(agentDID.did, cov.id);
    expect(remainingStake!.amount).toBe(9000n);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: CovenantAgent high-level API (SDK primitives)
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E Scenario 2: CovenantAgent SDK flow', () => {
  it('create → execute → attest → verify → prove', async () => {
    // Create agent
    const agent = await CovenantAgent.create(`
      covenant DataProcessor {
        permit read;
        permit process;
        permit export;
        forbid delete;
        forbid transfer (amount > 1000);
        permit transfer;
      }
    `);

    // Execute actions
    await agent.execute('read', {}, () => 'raw data');
    await agent.execute('process', {}, () => 'processed');
    await agent.execute('export', {}, () => 'exported');
    await agent.execute('delete', {}, () => 'no'); // blocked
    await agent.execute('transfer', { amount: 500 }, () => 'ok'); // allowed
    await agent.execute('transfer', { amount: 5000 }, () => 'no'); // blocked

    // Verify
    const result = agent.verify();
    expect(result.compliant).toBe(true);

    // Proofs
    const { result: proofResult, proofs } = agent.verifyWithProofs();
    expect(proofResult.compliant).toBe(true);
    expect(proofs.size).toBe(0);

    // Action log integrity
    const log = agent.getLog();
    expect(log.entries).toHaveLength(6);
    expect(verifyIntegrity(log).valid).toBe(true);

    // Attestation
    const subjectAgent = await CovenantAgent.create('covenant Subject { permit read; }');
    const attestation = await agent.attest(subjectAgent.did.did);
    expect(attestation.type).toContain('CovenantAttestation');
    expect(attestation.issuer).toBe(agent.did.did);
    expect(attestation.credentialSubject.id).toBe(subjectAgent.did.did);

    // DID signing
    const msg = 'compliance_attestation_payload';
    const sig = await agent.sign(msg);
    const valid = await CovenantAgent.verifySignature(msg, sig, agent.did.document);
    expect(valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: TEE attestation + DID binding
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E Scenario 3: TEE attestation with DID binding', () => {
  it('full TEE flow: quote → verify → bind → registry', async () => {
    const agentDID = await createDID();

    // Generate report data binding DID to enclave
    const reportData = await generateReportData(agentDID.did, agentDID.publicKeyHex, 'nonce123');

    // TEE generates quote
    const quote = await generateQuote('sgx', reportData, { securityVersion: 2 });

    // Platform endorsements
    const endorsements = generateEndorsements(3, 86400);
    const evidence = createEvidence(quote, endorsements, 'hardware');

    // Verify attestation
    const verResult = verifyAttestation(evidence);
    expect(verResult.valid).toBe(true);
    expect(verResult.platform).toBe('sgx');
    expect(verResult.securityLevel).toBe('hardware');

    // Bind enclave to DID
    const identity = await bindEnclaveToDID(agentDID.did, quote);
    expect(await verifyBinding(identity)).toBe(true);

    // Register in TEE registry
    const registry = new TEERegistry();
    registry.register(identity);
    registry.registerEvidence(evidence);
    expect(registry.isValid(agentDID.did)).toBe(true);
    expect(registry.getEvidence(quote.id)).toBe(evidence);

    // Now agent can prove: "I am running in a verified SGX enclave"
    const attestationProof = canonicalizeJson({
      agent: agentDID.did,
      enclaveMeasurement: identity.measurement,
      platform: identity.platform,
      bindingProof: identity.bindingProof,
      timestamp: timestamp(),
    });
    const sig = await signWithDID(attestationProof, agentDID);
    const valid = await verifyWithDID(attestationProof, sig, agentDID.document);
    expect(valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Multi-agent negotiation via composability
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E Scenario 4: Agent-to-agent covenant negotiation', () => {
  it('negotiation: check compatibility → find matches → merge → enforce', async () => {
    // Create three agents with different covenants
    const agentA = await CovenantAgent.create(`
      covenant DataProvider {
        permit read;
        permit query;
        forbid write;
        forbid delete;
      }
    `);

    const agentB = await CovenantAgent.create(`
      covenant DataConsumer {
        permit read;
        permit analyze;
        forbid write;
        forbid admin;
      }
    `);

    const agentC = await CovenantAgent.create(`
      covenant DataEditor {
        permit read;
        permit write;
        permit delete;
        forbid admin;
      }
    `);

    // Step 1: Check pairwise compatibility
    const abCompat = checkCompatibility(agentA.spec, agentB.spec);
    expect(abCompat.compatible).toBe(true); // Both forbid write
    expect(abCompat.overlapActions).toContain('read');

    const acCompat = checkCompatibility(agentA.spec, agentC.spec);
    expect(acCompat.compatible).toBe(false); // A forbids write, C permits write

    // Step 2: Find compatible partners for agentA
    const profiles = [
      { did: agentB.did.did, covenant: agentB.spec, capabilities: ['read', 'analyze'] },
      { did: agentC.did.did, covenant: agentC.spec, capabilities: ['read', 'write', 'delete'] },
    ];
    const matches = findCompatibleAgents(agentA.spec, profiles, 0.5);
    // agentB should match, agentC should not (or low score)
    const matchedDids = matches.map(m => m.agent.did);
    expect(matchedDids).toContain(agentB.did.did);

    // Step 3: Analyze trust topology
    const allProfiles = [
      { did: agentA.did.did, covenant: agentA.spec, capabilities: ['read', 'query'] },
      ...profiles,
    ];
    const topology = analyzeTopology(allProfiles, 0.5);
    expect(topology.nodes).toHaveLength(3);
    expect(topology.edges.length).toBeGreaterThan(0);

    // Step 4: Merge compatible covenants for joint operation
    const merged = mergeCovenants(agentA.spec, agentB.spec, 'JointOperation');
    expect(merged.name).toBe('JointOperation');
    expect(merged.statements.length).toBe(
      agentA.spec.statements.length + agentB.spec.statements.length,
    );

    // Step 5: Compile merged covenant and enforce
    const enforce = compile(merged);
    const readDecision = enforce({ action: 'read', params: {} });
    expect(readDecision.action).toBe('allow');
    const writeDecision = enforce({ action: 'write', params: {} });
    expect(writeDecision.action).toBe('block'); // Both forbid write
    const adminDecision = enforce({ action: 'admin', params: {} });
    expect(adminDecision.action).toBe('block'); // B forbids admin
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: End-to-end with staking, violation detection, and slashing
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E Scenario 5: Staking + violation detection + slashing', () => {
  it('register → stake → operate → detect violation → slash', async () => {
    const sim = new ContractSimulator({
      baseSlashPercent: 15,
      escalationPercent: 10,
      maxSlashPercent: 75,
      minStake: 500n,
      cooldownSec: 0,
    });

    // 1. Agent creates DID and covenant
    const agent = await CovenantAgent.create(`
      covenant StakedAgent {
        permit read;
        permit write;
        forbid delete;
        forbid transfer (amount > 1000);
        permit transfer;
      }
    `);

    // 2. Register covenant on-chain
    const covenantHash = await sha256String(serialize(agent.spec));
    const cov = await sim.registerCovenant(agent.did.did, covenantHash);
    expect(cov.active).toBe(true);

    // 3. Stake on covenant
    sim.stake(agent.did.did, cov.id, 50000n);
    expect(sim.getStake(agent.did.did, cov.id)!.amount).toBe(50000n);

    // 4. Agent operates normally
    await agent.execute('read', {}, () => 'data');
    await agent.execute('write', {}, () => 'written');
    await agent.execute('transfer', { amount: 100 }, () => 'sent');
    await agent.execute('delete', {}, () => 'no'); // blocked by enforcement

    // 5. Verify compliance
    const result = agent.verify();
    expect(result.compliant).toBe(true);

    // 6. Simulate external violation report (maybe agent circumvented middleware)
    const log = agent.getLog();
    const merkleRoot = buildMerkleTree(log.entries.map(e => e.hash)).root;
    const { slashAmount, record } = sim.submitViolation(
      agent.did.did,
      cov.id,
      merkleRoot,
      1,
    );

    // 15% of 50000 = 7500
    expect(slashAmount).toBe(7500n);
    expect(sim.getStake(agent.did.did, cov.id)!.amount).toBe(42500n);

    // 7. Second violation, escalated
    const { slashAmount: slash2 } = sim.submitViolation(
      agent.did.did,
      cov.id,
      await sha256String('second_violation'),
      1,
    );
    // 25% of 42500 = 10625
    expect(slash2).toBe(10625n);
    expect(sim.getSlashingRecord(agent.did.did, cov.id)!.incidentCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6: Cross-agent attestation and mutual verification
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E Scenario 6: Cross-agent attestation and mutual verification', () => {
  it('two agents attest each other and verify', async () => {
    const issuer = await CovenantAgent.create(`
      covenant Auditor {
        permit audit;
        permit attest;
        permit sign;
        forbid transfer;
      }
    `);

    const subject = await CovenantAgent.create(`
      covenant Worker {
        permit read;
        permit write;
        permit export;
        forbid delete;
      }
    `);

    // Subject executes actions
    await subject.execute('read', {}, () => 'data');
    await subject.execute('write', {}, () => 'written');
    await subject.execute('export', {}, () => 'exported');

    // Issuer verifies subject's compliance
    const subjectLog = subject.getLog();
    const subjectVerification = verify(subject.spec, subjectLog);
    expect(subjectVerification.compliant).toBe(true);

    // Issuer attests subject
    const attestation = await issuer.attest(subject.did.did);
    expect(attestation.issuer).toBe(issuer.did.did);
    expect(attestation.credentialSubject.id).toBe(subject.did.did);
    expect(attestation.type).toContain('CovenantAttestation');

    // Verify attestation signature
    const attestSig = await issuer.sign(canonicalizeJson({
      compliant: true,
      subject: subject.did.did,
      covenantName: subject.spec.name,
      actionCount: subject.actionCount,
    }));
    const valid = await CovenantAgent.verifySignature(
      canonicalizeJson({
        compliant: true,
        subject: subject.did.did,
        covenantName: subject.spec.name,
        actionCount: subject.actionCount,
      }),
      attestSig,
      issuer.did.document,
    );
    expect(valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7: Batch verification of multiple agents
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E Scenario 7: Batch verification of multiple agents', () => {
  it('verify batch of agents in one call', async () => {
    const agents = await Promise.all([
      CovenantAgent.create('covenant A { permit read; permit write; forbid delete; }'),
      CovenantAgent.create('covenant B { permit read; forbid write; }'),
      CovenantAgent.create('covenant C { permit read; permit query; forbid admin; }'),
    ]);

    // Execute actions
    await agents[0]!.execute('read', {}, () => 'ok');
    await agents[0]!.execute('write', {}, () => 'ok');
    await agents[1]!.execute('read', {}, () => 'ok');
    await agents[1]!.execute('write', {}, () => 'no'); // blocked
    await agents[2]!.execute('query', {}, () => 42);
    await agents[2]!.execute('admin', {}, () => 'no'); // blocked

    // Verify each individually (verifyBatch takes specs + single log)
    for (const agent of agents) {
      const result = verify(agent.spec, agent.getLog());
      expect(result.compliant).toBe(true);
    }

    // Also test verifyBatch with single agent's log against multiple specs
    const allSpecs = agents.map(a => a.spec);
    const batchResults = verifyBatch(allSpecs, agents[0]!.getLog());
    expect(batchResults.size).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 8: DID resolver + covenant serialize/deserialize round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E Scenario 8: Serialize/deserialize round-trip', () => {
  it('covenant DSL round-trips through serialize/parse', () => {
    const source = `
      covenant RoundTrip {
        forbid transfer (amount > 999);
        permit transfer;
        permit read;
        forbid delete;
        require agent.trust >= 0.8;
      }
    `;
    const spec = parseSource(source);
    const serialized = serialize(spec);
    const reparsed = parseSource(serialized);

    expect(reparsed.name).toBe(spec.name);
    expect(reparsed.statements).toHaveLength(spec.statements.length);
    expect(reparsed.requirements).toHaveLength(spec.requirements.length);

    // Compilation produces same enforcement
    const enforce1 = compile(spec);
    const enforce2 = compile(reparsed);

    expect(enforce1({ action: 'read', params: {} }).action)
      .toBe(enforce2({ action: 'read', params: {} }).action);
    expect(enforce1({ action: 'delete', params: {} }).action)
      .toBe(enforce2({ action: 'delete', params: {} }).action);
    expect(enforce1({ action: 'transfer', params: { amount: 100 } }).action)
      .toBe(enforce2({ action: 'transfer', params: { amount: 100 } }).action);
    expect(enforce1({ action: 'transfer', params: { amount: 5000 } }).action)
      .toBe(enforce2({ action: 'transfer', params: { amount: 5000 } }).action);
  });
});
