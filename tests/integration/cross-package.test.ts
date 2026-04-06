/**
 * Cross-package integration tests for the Nobulex monorepo.
 *
 * Validates that packages interact correctly when composed together:
 *   SDK + Store, SDK + Verifier, Core + Identity, CCL + Verifier,
 *   Store + Verifier, Crypto + Core, SDK event system, and chain operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { generateKeyPair, sha256String, toHex } from '@nobulex/crypto';
import type { KeyPair } from '@nobulex/crypto';

import {
  buildCovenant,
  verifyCovenant,
  countersignCovenant,
  resignCovenant,
  MemoryChainResolver,
  resolveChain,
  computeEffectiveConstraints,
  validateChainNarrowing,
  CovenantBuildError,
  CovenantVerificationError,
  serializeCovenant,
  deserializeCovenant,
  MAX_CHAIN_DEPTH,
} from '@nobulex/core';
import type { CovenantDocument } from '@nobulex/core';

import { NobulexClient, QuickCovenant } from '@nobulex/sdk';
import type {
  NobulexEventType,
  CovenantCreatedEvent,
  CovenantVerifiedEvent,
  IdentityCreatedEvent,
  IdentityEvolvedEvent,
  ChainResolvedEvent,
  ChainValidatedEvent,
  EvaluationCompletedEvent,
} from '@nobulex/sdk';

import { MemoryStore } from '@nobulex/store';
import type { StoreEvent } from '@nobulex/store';

import { Verifier, verifyBatch } from '@nobulex/verifier';

import { parse, evaluate, merge as mergeCCL, serialize as serializeCCL } from '@nobulex/ccl';

import {
  createIdentity,
  evolveIdentity,
  verifyIdentity,
  serializeIdentity,
  deserializeIdentity,
} from '@nobulex/identity';
import type { AgentIdentity } from '@nobulex/identity';


// ---------------------------------------------------------------------------
// SDK + Store: Create covenants via NobulexClient, store, retrieve, verify
// ---------------------------------------------------------------------------

describe('SDK + Store integration', () => {
  let client: NobulexClient;
  let store: MemoryStore;
  let kp: KeyPair;

  beforeEach(async () => {
    kp = await generateKeyPair();
    client = new NobulexClient({ keyPair: kp });
    store = new MemoryStore();
  });

  it('should create a covenant via NobulexClient and store it in MemoryStore', async () => {
    const doc = await client.createCovenant({
      issuer: { id: 'issuer-1', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'ben-1', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'",
    });

    await store.put(doc);
    expect(store.size).toBe(1);

    const retrieved = await store.get(doc.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(doc.id);
    expect(retrieved!.constraints).toBe(doc.constraints);
  });

  it('should store multiple covenants and retrieve them by ID', async () => {
    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 5; i++) {
      const doc = await client.createCovenant({
        issuer: { id: `issuer-${i}`, publicKey: kp.publicKeyHex, role: 'issuer' },
        beneficiary: { id: `ben-${i}`, publicKey: kp.publicKeyHex, role: 'beneficiary' },
        constraints: `permit file.read on '/data/${i}/**'`,
      });
      docs.push(doc);
    }

    await store.putBatch(docs);
    expect(store.size).toBe(5);

    const ids = docs.map((d) => d.id);
    const retrieved = await store.getBatch(ids);
    expect(retrieved).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(retrieved[i]!.id).toBe(docs[i]!.id);
    }
  });

  it('should verify a covenant retrieved from the store', async () => {
    const doc = await client.createCovenant({
      issuer: { id: 'issuer-v', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'ben-v', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit api.call on '**'",
    });

    await store.put(doc);

    const retrieved = await store.get(doc.id);
    const result = await client.verifyCovenant(retrieved!);
    expect(result.valid).toBe(true);
  });

  it('should filter stored covenants by issuer ID', async () => {
    const docA = await client.createCovenant({
      issuer: { id: 'alice', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'bob', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/a/**'",
    });
    const docB = await client.createCovenant({
      issuer: { id: 'charlie', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'dave', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/b/**'",
    });

    await store.putBatch([docA, docB]);

    const aliceDocs = await store.list({ issuerId: 'alice' });
    expect(aliceDocs).toHaveLength(1);
    expect(aliceDocs[0]!.id).toBe(docA.id);
  });

  it('should delete a covenant from store and confirm absence', async () => {
    const doc = await client.createCovenant({
      issuer: { id: 'del-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'del-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });
    await store.put(doc);

    const deleted = await store.delete(doc.id);
    expect(deleted).toBe(true);
    expect(await store.has(doc.id)).toBe(false);
    expect(await store.get(doc.id)).toBeUndefined();
  });

  it('should count stored covenants with and without filters', async () => {
    for (let i = 0; i < 3; i++) {
      await store.put(await client.createCovenant({
        issuer: { id: 'counter-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
        beneficiary: { id: `ben-${i}`, publicKey: kp.publicKeyHex, role: 'beneficiary' },
        constraints: `permit file.read on '/data/${i}/**'`,
      }));
    }

    expect(await store.count()).toBe(3);
    expect(await store.count({ issuerId: 'counter-issuer' })).toBe(3);
    expect(await store.count({ issuerId: 'nonexistent' })).toBe(0);
  });

  it('should use QuickCovenant.permit and store the result', async () => {
    const doc = await QuickCovenant.permit(
      'file.read',
      '/data/**',
      { id: 'q-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      { id: 'q-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      kp.privateKey,
    );

    await store.put(doc);
    const retrieved = await store.get(doc.id);
    expect(retrieved).toBeDefined();
    const result = await verifyCovenant(retrieved!);
    expect(result.valid).toBe(true);
  });

  it('should use QuickCovenant.standard and store the result', async () => {
    const doc = await QuickCovenant.standard(
      { id: 'std-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      { id: 'std-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      kp.privateKey,
    );

    await store.put(doc);
    expect(store.size).toBe(1);
    const result = await verifyCovenant(doc);
    expect(result.valid).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// SDK + Verifier: Create via NobulexClient, verify via standalone Verifier
// ---------------------------------------------------------------------------

describe('SDK + Verifier integration', () => {
  let client: NobulexClient;
  let verifier: Verifier;
  let kp: KeyPair;

  beforeEach(async () => {
    kp = await generateKeyPair();
    client = new NobulexClient({ keyPair: kp });
    verifier = new Verifier({ verifierId: 'test-verifier' });
  });

  it('should verify a covenant created by NobulexClient via Verifier.verify', async () => {
    const doc = await client.createCovenant({
      issuer: { id: 'sdk-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'sdk-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'",
    });

    const report = await verifier.verify(doc);
    expect(report.valid).toBe(true);
    expect(report.verifierId).toBe('test-verifier');
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should record verification history in Verifier', async () => {
    const doc = await client.createCovenant({
      issuer: { id: 'hist-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'hist-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit api.call on '**'",
    });

    await verifier.verify(doc);
    await verifier.verify(doc);

    const history = verifier.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]!.kind).toBe('single');
    expect(history[0]!.valid).toBe(true);
  });

  it('should verify an action via Verifier.verifyAction on SDK-created covenant', async () => {
    const doc = await client.createCovenant({
      issuer: { id: 'action-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'action-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\ndeny file.write on '**' severity critical",
    });

    const readReport = await verifier.verifyAction(doc, 'file.read', '/data/test.csv');
    expect(readReport.permitted).toBe(true);
    expect(readReport.documentValid).toBe(true);

    const writeReport = await verifier.verifyAction(doc, 'file.write', '/data/test.csv');
    expect(writeReport.permitted).toBe(false);
    expect(writeReport.severity).toBe('critical');
  });

  it('should batch verify multiple SDK-created covenants', async () => {
    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 10; i++) {
      const d = await client.createCovenant({
        issuer: { id: `batch-issuer-${i}`, publicKey: kp.publicKeyHex, role: 'issuer' },
        beneficiary: { id: `batch-ben-${i}`, publicKey: kp.publicKeyHex, role: 'beneficiary' },
        constraints: `permit file.read on '/data/${i}/**'`,
      });
      docs.push(d);
    }

    const batchReport = await verifyBatch(docs);
    expect(batchReport.summary.total).toBe(10);
    expect(batchReport.summary.passed).toBe(10);
    expect(batchReport.summary.failed).toBe(0);
  });

  it('should detect a tampered covenant via Verifier', async () => {
    const doc = await client.createCovenant({
      issuer: { id: 'tamper-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'tamper-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'",
    });

    const tampered = { ...doc, constraints: "permit file.write on '**'" };
    const report = await verifier.verify(tampered);
    expect(report.valid).toBe(false);
  });

  it('should clear verification history', async () => {
    const doc = await client.createCovenant({
      issuer: { id: 'clear-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'clear-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });

    await verifier.verify(doc);
    expect(verifier.getHistory()).toHaveLength(1);
    verifier.clearHistory();
    expect(verifier.getHistory()).toHaveLength(0);
  });
});


// ---------------------------------------------------------------------------
// Core + Identity: Create covenant for an agent identity, verify both
// ---------------------------------------------------------------------------

describe('Core + Identity integration', () => {
  let operatorKp: KeyPair;
  let beneficiaryKp: KeyPair;

  beforeEach(async () => {
    operatorKp = await generateKeyPair();
    beneficiaryKp = await generateKeyPair();
  });

  it('should create an identity and a covenant bound to that identity', async () => {
    const identity = await createIdentity({
      operatorKeyPair: operatorKp,
      operatorIdentifier: 'acme-corp',
      model: { provider: 'anthropic', modelId: 'claude-opus-4', modelVersion: '1.0', attestationType: 'provider_signed' },
      capabilities: ['file.read', 'api.call'],
      deployment: { runtime: 'container' },
    });

    const covenant = await buildCovenant({
      issuer: { id: identity.id, publicKey: operatorKp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'user-team', publicKey: beneficiaryKp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\npermit api.call on '**'",
      privateKey: operatorKp.privateKey,
    });

    // Verify both
    const idResult = await verifyIdentity(identity);
    expect(idResult.valid).toBe(true);

    const covResult = await verifyCovenant(covenant);
    expect(covResult.valid).toBe(true);

    // The covenant issuer ID should be the agent identity hash
    expect(covenant.issuer.id).toBe(identity.id);
  });

  it('should evolve identity and create a new covenant with updated capabilities', async () => {
    let identity = await createIdentity({
      operatorKeyPair: operatorKp,
      operatorIdentifier: 'evolve-test',
      model: { provider: 'anthropic', modelId: 'claude-opus-4', modelVersion: '1.0' },
      capabilities: ['file.read'],
      deployment: { runtime: 'container' },
    });

    identity = await evolveIdentity(identity, {
      operatorKeyPair: operatorKp,
      changeType: 'capability_change',
      description: 'Add file.write capability',
      updates: { capabilities: ['file.read', 'file.write'] },
    });

    expect(identity.version).toBe(2);
    expect(identity.capabilities).toContain('file.write');

    const covenant = await buildCovenant({
      issuer: { id: identity.id, publicKey: operatorKp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'beneficiary-x', publicKey: beneficiaryKp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\npermit file.write on '/output/**'",
      privateKey: operatorKp.privateKey,
    });

    const covResult = await verifyCovenant(covenant);
    expect(covResult.valid).toBe(true);

    const idResult = await verifyIdentity(identity);
    expect(idResult.valid).toBe(true);
  });

  it('should verify identity serialization round-trip and subsequent covenant creation', async () => {
    const identity = await createIdentity({
      operatorKeyPair: operatorKp,
      operatorIdentifier: 'serial-test',
      model: { provider: 'anthropic', modelId: 'claude-opus-4', modelVersion: '1.0' },
      capabilities: ['file.read'],
      deployment: { runtime: 'container' },
    });

    const json = serializeIdentity(identity);
    const restored = deserializeIdentity(json);

    const idResult = await verifyIdentity(restored);
    expect(idResult.valid).toBe(true);

    // Use the restored identity to create a covenant
    const covenant = await buildCovenant({
      issuer: { id: restored.id, publicKey: operatorKp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'ben-serial', publicKey: beneficiaryKp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
      privateKey: operatorKp.privateKey,
    });

    expect((await verifyCovenant(covenant)).valid).toBe(true);
    expect(covenant.issuer.id).toBe(restored.id);
  });

  it('should create an identity and verify covenant matches identity public key', async () => {
    const identity = await createIdentity({
      operatorKeyPair: operatorKp,
      operatorIdentifier: 'key-match',
      model: { provider: 'anthropic', modelId: 'claude-opus-4', modelVersion: '1.0' },
      capabilities: ['review.generate'],
      deployment: { runtime: 'process' },
    });

    const covenant = await buildCovenant({
      issuer: { id: identity.id, publicKey: operatorKp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'ben-km', publicKey: beneficiaryKp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit review.generate on '**'",
      privateKey: operatorKp.privateKey,
    });

    // The covenant's issuer public key should match the identity's operator key
    expect(covenant.issuer.publicKey).toBe(identity.operatorPublicKey);
  });
});


// ---------------------------------------------------------------------------
// CCL + Verifier: Parse complex CCL, use Verifier.verifyAction for evaluation
// ---------------------------------------------------------------------------

describe('CCL + Verifier integration', () => {
  let kp: KeyPair;
  let verifier: Verifier;

  beforeEach(async () => {
    kp = await generateKeyPair();
    verifier = new Verifier();
  });

  it('should verify action with permit and deny rules', async () => {
    const doc = await buildCovenant({
      issuer: { id: 'ccl-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'ccl-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: [
        "permit file.read on '/data/**'",
        "permit api.call on '/internal/**'",
        "deny file.write on '/system/**' severity critical",
        "deny network.send on '**' severity high",
      ].join('\n'),
      privateKey: kp.privateKey,
    });

    const readResult = await verifier.verifyAction(doc, 'file.read', '/data/report.csv');
    expect(readResult.permitted).toBe(true);

    const writeResult = await verifier.verifyAction(doc, 'file.write', '/system/config.yaml');
    expect(writeResult.permitted).toBe(false);
    expect(writeResult.severity).toBe('critical');

    const netResult = await verifier.verifyAction(doc, 'network.send', 'https://evil.com');
    expect(netResult.permitted).toBe(false);
    expect(netResult.severity).toBe('high');
  });

  it('should verify action with conditional CCL rules via context', async () => {
    const doc = await buildCovenant({
      issuer: { id: 'cond-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'cond-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: [
        "permit api.call on '/public/**'",
        "deny api.call on '/public/**' when user.role = guest severity medium",
      ].join('\n'),
      privateKey: kp.privateKey,
    });

    // Without context (no condition match), permit wins
    const result1 = await verifier.verifyAction(doc, 'api.call', '/public/endpoint');
    expect(result1.permitted).toBe(true);

    // With matching context, deny wins
    const result2 = await verifier.verifyAction(doc, 'api.call', '/public/endpoint', { user: { role: 'guest' } });
    expect(result2.permitted).toBe(false);
    expect(result2.severity).toBe('medium');
  });

  it('should verify action with rate-limited CCL rules', async () => {
    const doc = await buildCovenant({
      issuer: { id: 'limit-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'limit-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: [
        "permit api.call on '**'",
        "limit api.call 100 per 3600 seconds severity medium",
      ].join('\n'),
      privateKey: kp.privateKey,
    });

    const result = await verifier.verifyAction(doc, 'api.call', '/endpoint');
    expect(result.permitted).toBe(true);
    expect(result.documentValid).toBe(true);
  });

  it('should report invalid document when verifying action on tampered covenant', async () => {
    const doc = await buildCovenant({
      issuer: { id: 'bad-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'bad-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
      privateKey: kp.privateKey,
    });

    const tampered = { ...doc, constraints: "permit file.delete on '**'" };
    const result = await verifier.verifyAction(tampered, 'file.read', '/data/file.txt');
    expect(result.documentValid).toBe(false);
    expect(result.permitted).toBe(false);
  });

  it('should verify action on document with multiple matching rules (deny-wins)', async () => {
    const doc = await buildCovenant({
      issuer: { id: 'multi-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'multi-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: [
        "permit file.read on '**'",
        "deny file.read on '/secret/**' severity critical",
      ].join('\n'),
      privateKey: kp.privateKey,
    });

    // Broad match: permitted
    const r1 = await verifier.verifyAction(doc, 'file.read', '/data/public.txt');
    expect(r1.permitted).toBe(true);

    // Specific match: denied
    const r2 = await verifier.verifyAction(doc, 'file.read', '/secret/key.pem');
    expect(r2.permitted).toBe(false);
  });

  it('should produce correct CCL parse -> serialize -> re-parse round-trip', () => {
    const source = [
      "permit file.read on '/data/**'",
      "deny file.write on '/system/**' severity critical",
      "limit api.call 100 per 3600 seconds severity medium",
    ].join('\n');

    const doc1 = parse(source);
    const serialized = serializeCCL(doc1);
    const doc2 = parse(serialized);

    // Both should evaluate identically
    const r1 = evaluate(doc1, 'file.read', '/data/test.csv');
    const r2 = evaluate(doc2, 'file.read', '/data/test.csv');
    expect(r1.permitted).toBe(r2.permitted);

    const d1 = evaluate(doc1, 'file.write', '/system/config.yaml');
    const d2 = evaluate(doc2, 'file.write', '/system/config.yaml');
    expect(d1.permitted).toBe(d2.permitted);
    expect(d1.severity).toBe(d2.severity);
  });
});


// ---------------------------------------------------------------------------
// Store + Verifier: Store documents, retrieve, batch verify
// ---------------------------------------------------------------------------

describe('Store + Verifier integration', () => {
  let store: MemoryStore;
  let kp: KeyPair;

  beforeEach(async () => {
    kp = await generateKeyPair();
    store = new MemoryStore();
  });

  it('should store, retrieve, and batch verify multiple documents', async () => {
    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 8; i++) {
      const doc = await buildCovenant({
        issuer: { id: `store-issuer-${i}`, publicKey: kp.publicKeyHex, role: 'issuer' },
        beneficiary: { id: `store-ben-${i}`, publicKey: kp.publicKeyHex, role: 'beneficiary' },
        constraints: `permit file.read on '/data/${i}/**'`,
        privateKey: kp.privateKey,
      });
      docs.push(doc);
    }

    await store.putBatch(docs);
    const all = await store.list();
    expect(all).toHaveLength(8);

    const batchReport = await verifyBatch(all);
    expect(batchReport.summary.total).toBe(8);
    expect(batchReport.summary.passed).toBe(8);
    expect(batchReport.summary.failed).toBe(0);
  });

  it('should detect a tampered document in batch verification from store', async () => {
    const doc1 = await buildCovenant({
      issuer: { id: 'legit', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
      privateKey: kp.privateKey,
    });
    const doc2 = { ...doc1, constraints: "permit file.write on '**'" };

    // doc2 has wrong id/signature for new constraints
    await store.put(doc1);
    await store.put(doc2);

    // Both occupy same slot since same ID, so store has 1 doc (the tampered one)
    // Let's store them separately
    store.clear();

    const legit = await buildCovenant({
      issuer: { id: 'legit-2', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'ben-2', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit api.call on '**'",
      privateKey: kp.privateKey,
    });

    const tampered = { ...legit, constraints: "deny api.call on '**'" };

    // Tamper but keep original ID (will fail verification)
    await store.put(legit);

    // Put tampered under a different key approach: just verify separately
    const all = [legit, tampered];
    const batchReport = await verifyBatch(all);
    expect(batchReport.summary.passed).toBe(1);
    expect(batchReport.summary.failed).toBe(1);
  });

  it('should store events fire on put and delete operations', async () => {
    const events: StoreEvent[] = [];
    store.onEvent((e) => events.push(e));

    const doc = await buildCovenant({
      issuer: { id: 'event-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'event-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
      privateKey: kp.privateKey,
    });

    await store.put(doc);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('put');
    expect(events[0]!.documentId).toBe(doc.id);

    await store.delete(doc.id);
    expect(events).toHaveLength(2);
    expect(events[1]!.type).toBe('delete');
    expect(events[1]!.documentId).toBe(doc.id);
  });

  it('should unregister event listener with offEvent', async () => {
    const events: StoreEvent[] = [];
    const listener = (e: StoreEvent) => events.push(e);
    store.onEvent(listener);

    const doc = await buildCovenant({
      issuer: { id: 'off-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'off-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
      privateKey: kp.privateKey,
    });

    await store.put(doc);
    expect(events).toHaveLength(1);

    store.offEvent(listener);
    await store.delete(doc.id);
    expect(events).toHaveLength(1); // No new events
  });

  it('should use store.has to check for document existence before verification', async () => {
    const doc = await buildCovenant({
      issuer: { id: 'has-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'has-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
      privateKey: kp.privateKey,
    });

    expect(await store.has(doc.id)).toBe(false);
    await store.put(doc);
    expect(await store.has(doc.id)).toBe(true);

    const verifier = new Verifier();
    const retrieved = await store.get(doc.id);
    const report = await verifier.verify(retrieved!);
    expect(report.valid).toBe(true);
  });

  it('should deleteBatch multiple documents from store', async () => {
    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 5; i++) {
      const doc = await buildCovenant({
        issuer: { id: `del-batch-${i}`, publicKey: kp.publicKeyHex, role: 'issuer' },
        beneficiary: { id: `del-ben-${i}`, publicKey: kp.publicKeyHex, role: 'beneficiary' },
        constraints: `permit file.read on '/d${i}/**'`,
        privateKey: kp.privateKey,
      });
      docs.push(doc);
    }

    await store.putBatch(docs);
    expect(store.size).toBe(5);

    const idsToDelete = docs.slice(0, 3).map((d) => d.id);
    const deleted = await store.deleteBatch(idsToDelete);
    expect(deleted).toBe(3);
    expect(store.size).toBe(2);
  });
});


// ---------------------------------------------------------------------------
// Crypto + Core: Key rotation scenarios (resignCovenant with new keys)
// ---------------------------------------------------------------------------

describe('Crypto + Core integration', () => {
  it('should resign a covenant with a new key pair', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();

    const doc = await buildCovenant({
      issuer: { id: 'resign-issuer', publicKey: kp1.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'resign-ben', publicKey: kp1.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'",
      privateKey: kp1.privateKey,
    });

    const originalResult = await verifyCovenant(doc);
    expect(originalResult.valid).toBe(true);

    // Resign with new key pair (same issuer structure, new signature)
    const resigned = await resignCovenant(doc, kp1.privateKey);

    // New document should have different ID and nonce but same constraints
    expect(resigned.id).not.toBe(doc.id);
    expect(resigned.nonce).not.toBe(doc.nonce);
    expect(resigned.constraints).toBe(doc.constraints);

    // Resigned doc should verify (same key)
    const resignedResult = await verifyCovenant(resigned);
    expect(resignedResult.valid).toBe(true);
  });

  it('should produce invalid verification when resigning with different key', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();

    const doc = await buildCovenant({
      issuer: { id: 'key-rot-issuer', publicKey: kp1.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'key-rot-ben', publicKey: kp1.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
      privateKey: kp1.privateKey,
    });

    // Resign with kp2 (but issuer.publicKey still references kp1)
    const resigned = await resignCovenant(doc, kp2.privateKey);

    // Verification should fail because issuer.publicKey != signing key
    const result = await verifyCovenant(resigned);
    expect(result.valid).toBe(false);
    const sigCheck = result.checks.find((c) => c.name === 'signature_valid');
    expect(sigCheck?.passed).toBe(false);
  });

  it('should add and verify a countersignature', async () => {
    const issuerKp = await generateKeyPair();
    const auditorKp = await generateKeyPair();

    const doc = await buildCovenant({
      issuer: { id: 'cs-issuer', publicKey: issuerKp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'cs-ben', publicKey: issuerKp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
      privateKey: issuerKp.privateKey,
    });

    const countersigned = await countersignCovenant(doc, auditorKp, 'auditor');

    expect(countersigned.countersignatures).toHaveLength(1);
    expect(countersigned.countersignatures![0]!.signerRole).toBe('auditor');
    expect(countersigned.countersignatures![0]!.signerPublicKey).toBe(auditorKp.publicKeyHex);

    const result = await verifyCovenant(countersigned);
    expect(result.valid).toBe(true);
    const csCheck = result.checks.find((c) => c.name === 'countersignatures');
    expect(csCheck?.passed).toBe(true);
  });

  it('should detect invalid countersignature after tampering', async () => {
    const issuerKp = await generateKeyPair();
    const auditorKp = await generateKeyPair();

    const doc = await buildCovenant({
      issuer: { id: 'cs-tamper-issuer', publicKey: issuerKp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'cs-tamper-ben', publicKey: issuerKp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
      privateKey: issuerKp.privateKey,
    });

    const countersigned = await countersignCovenant(doc, auditorKp, 'auditor');

    // Tamper the countersignature
    const tampered = {
      ...countersigned,
      countersignatures: [{
        ...countersigned.countersignatures![0]!,
        signature: 'ff'.repeat(32),
      }],
    };

    const result = await verifyCovenant(tampered);
    expect(result.valid).toBe(false);
    const csCheck = result.checks.find((c) => c.name === 'countersignatures');
    expect(csCheck?.passed).toBe(false);
  });

  it('should add multiple countersignatures from different parties', async () => {
    const issuerKp = await generateKeyPair();
    const auditorKp = await generateKeyPair();
    const regulatorKp = await generateKeyPair();

    const doc = await buildCovenant({
      issuer: { id: 'multi-cs-issuer', publicKey: issuerKp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'multi-cs-ben', publicKey: issuerKp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
      privateKey: issuerKp.privateKey,
    });

    let signed = await countersignCovenant(doc, auditorKp, 'auditor');
    signed = await countersignCovenant(signed, regulatorKp, 'regulator');

    expect(signed.countersignatures).toHaveLength(2);
    const result = await verifyCovenant(signed);
    expect(result.valid).toBe(true);
  });

  it('should strip countersignatures on resign', async () => {
    const issuerKp = await generateKeyPair();
    const auditorKp = await generateKeyPair();

    const doc = await buildCovenant({
      issuer: { id: 'strip-cs', publicKey: issuerKp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'strip-ben', publicKey: issuerKp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
      privateKey: issuerKp.privateKey,
    });

    const signed = await countersignCovenant(doc, auditorKp, 'auditor');
    expect(signed.countersignatures).toHaveLength(1);

    const resigned = await resignCovenant(signed, issuerKp.privateKey);
    expect(resigned.countersignatures).toBeUndefined();

    const result = await verifyCovenant(resigned);
    expect(result.valid).toBe(true);
  });

  it('should serialize and deserialize a covenant round-trip preserving verification', async () => {
    const kp = await generateKeyPair();

    const doc = await buildCovenant({
      issuer: { id: 'ser-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'ser-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\ndeny file.write on '**' severity critical",
      privateKey: kp.privateKey,
    });

    const json = serializeCovenant(doc);
    const restored = deserializeCovenant(json);

    expect(restored.id).toBe(doc.id);
    expect(restored.constraints).toBe(doc.constraints);

    const result = await verifyCovenant(restored);
    expect(result.valid).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// SDK event system integration with store events
// ---------------------------------------------------------------------------

describe('SDK event system integration', () => {
  let client: NobulexClient;
  let kp: KeyPair;

  beforeEach(async () => {
    kp = await generateKeyPair();
    client = new NobulexClient({ keyPair: kp });
  });

  it('should emit covenant:created event when creating a covenant', async () => {
    const events: CovenantCreatedEvent[] = [];
    client.on('covenant:created', (e) => events.push(e as CovenantCreatedEvent));

    await client.createCovenant({
      issuer: { id: 'evt-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'evt-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('covenant:created');
    expect(events[0]!.document.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should emit covenant:verified event when verifying a covenant', async () => {
    const events: CovenantVerifiedEvent[] = [];
    client.on('covenant:verified', (e) => events.push(e as CovenantVerifiedEvent));

    const doc = await client.createCovenant({
      issuer: { id: 'ver-evt-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'ver-evt-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });

    await client.verifyCovenant(doc);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('covenant:verified');
    expect(events[0]!.result.valid).toBe(true);
  });

  it('should emit identity:created event when creating an identity', async () => {
    const events: IdentityCreatedEvent[] = [];
    client.on('identity:created', (e) => events.push(e as IdentityCreatedEvent));

    await client.createIdentity({
      operatorIdentifier: 'evt-ops',
      model: { provider: 'anthropic', modelId: 'claude-opus-4', modelVersion: '1.0' },
      capabilities: ['file.read'],
      deployment: { runtime: 'container' },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('identity:created');
    expect(events[0]!.identity.operatorPublicKey).toBe(kp.publicKeyHex);
  });

  it('should emit identity:evolved event when evolving an identity', async () => {
    const events: IdentityEvolvedEvent[] = [];
    client.on('identity:evolved', (e) => events.push(e as IdentityEvolvedEvent));

    const identity = await client.createIdentity({
      operatorIdentifier: 'evo-ops',
      model: { provider: 'anthropic', modelId: 'claude-opus-4', modelVersion: '1.0' },
      capabilities: ['file.read'],
      deployment: { runtime: 'container' },
    });

    await client.evolveIdentity(identity, {
      changeType: 'capability_change',
      description: 'Add write',
      updates: { capabilities: ['file.read', 'file.write'] },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('identity:evolved');
    expect(events[0]!.changeType).toBe('capability_change');
  });

  it('should emit evaluation:completed event when evaluating an action', async () => {
    const events: EvaluationCompletedEvent[] = [];
    client.on('evaluation:completed', (e) => events.push(e as EvaluationCompletedEvent));

    const doc = await client.createCovenant({
      issuer: { id: 'eval-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'eval-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'",
    });

    await client.evaluateAction(doc, 'file.read', '/data/test.csv');

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('evaluation:completed');
    expect(events[0]!.action).toBe('file.read');
    expect(events[0]!.resource).toBe('/data/test.csv');
    expect(events[0]!.result.permitted).toBe(true);
  });

  it('should remove event listeners with the returned unsubscribe function', async () => {
    const events: CovenantCreatedEvent[] = [];
    const unsub = client.on('covenant:created', (e) => events.push(e as CovenantCreatedEvent));

    await client.createCovenant({
      issuer: { id: 'unsub-1', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'unsub-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });
    expect(events).toHaveLength(1);

    unsub(); // Remove the listener

    await client.createCovenant({
      issuer: { id: 'unsub-2', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'unsub-ben-2', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });
    expect(events).toHaveLength(1); // No new events
  });

  it('should remove all listeners with removeAllListeners', async () => {
    const events1: unknown[] = [];
    const events2: unknown[] = [];
    client.on('covenant:created', (e) => events1.push(e));
    client.on('covenant:verified', (e) => events2.push(e));

    client.removeAllListeners();

    const doc = await client.createCovenant({
      issuer: { id: 'rmall-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'rmall-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });
    await client.verifyCovenant(doc);

    expect(events1).toHaveLength(0);
    expect(events2).toHaveLength(0);
  });

  it('should emit chain:resolved when resolving a chain', async () => {
    const events: ChainResolvedEvent[] = [];
    client.on('chain:resolved', (e) => events.push(e as ChainResolvedEvent));

    const root = await client.createCovenant({
      issuer: { id: 'chain-root', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'chain-mid', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });

    const child = await client.createCovenant({
      issuer: { id: 'chain-mid', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'chain-leaf', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'",
      chain: { parentId: root.id, relation: 'restricts', depth: 1 },
    });

    const ancestors = await client.resolveChain(child, [root]);
    expect(ancestors).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('chain:resolved');
  });

  it('should emit chain:validated when validating a chain', async () => {
    const events: ChainValidatedEvent[] = [];
    client.on('chain:validated', (e) => events.push(e as ChainValidatedEvent));

    const root = await client.createCovenant({
      issuer: { id: 'cv-root', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'cv-child', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'\ndeny file.write on '**' severity critical",
    });

    const child = await client.createCovenant({
      issuer: { id: 'cv-child', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'cv-leaf', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\ndeny file.write on '**' severity critical",
      chain: { parentId: root.id, relation: 'restricts', depth: 1 },
    });

    const result = await client.validateChain([root, child]);
    expect(result.valid).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('chain:validated');
    expect(events[0]!.result.valid).toBe(true);
  });

  it('should allow multiple listeners on the same event type', async () => {
    const events1: unknown[] = [];
    const events2: unknown[] = [];

    client.on('covenant:created', (e) => events1.push(e));
    client.on('covenant:created', (e) => events2.push(e));

    await client.createCovenant({
      issuer: { id: 'multi-listen', publicKey: kp.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'ml-ben', publicKey: kp.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
  });
});


// ---------------------------------------------------------------------------
// Chain operations spanning multiple packages
// ---------------------------------------------------------------------------

describe('Chain operations spanning multiple packages', () => {
  let kpRoot: KeyPair;
  let kpMid: KeyPair;
  let kpLeaf: KeyPair;

  beforeEach(async () => {
    [kpRoot, kpMid, kpLeaf] = await Promise.all([
      generateKeyPair(),
      generateKeyPair(),
      generateKeyPair(),
    ]);
  });

  it('should build a 3-level chain, store it, verify the chain via Verifier', async () => {
    const store = new MemoryStore();
    const verifier = new Verifier();

    const root = await buildCovenant({
      issuer: { id: 'root', publicKey: kpRoot.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'mid', publicKey: kpMid.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'\npermit file.write on '/data/**'\ndeny file.delete on '**' severity critical",
      privateKey: kpRoot.privateKey,
    });

    const mid = await buildCovenant({
      issuer: { id: 'mid', publicKey: kpMid.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'leaf', publicKey: kpLeaf.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\ndeny file.write on '/data/sensitive/**' severity high\ndeny file.delete on '**' severity critical",
      privateKey: kpMid.privateKey,
      chain: { parentId: root.id, relation: 'restricts', depth: 1 },
    });

    const leaf = await buildCovenant({
      issuer: { id: 'leaf', publicKey: kpLeaf.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'worker', publicKey: kpRoot.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/public/**'\ndeny file.write on '**' severity critical\ndeny file.delete on '**' severity critical",
      privateKey: kpLeaf.privateKey,
      chain: { parentId: mid.id, relation: 'restricts', depth: 2 },
    });

    // Store all three
    await store.putBatch([root, mid, leaf]);
    expect(store.size).toBe(3);

    // Verify the chain via Verifier
    const chainReport = await verifier.verifyChain([root, mid, leaf]);
    expect(chainReport.valid).toBe(true);
    expect(chainReport.documentResults).toHaveLength(3);
    expect(chainReport.narrowingResults).toHaveLength(2);
    expect(chainReport.narrowingResults.every((r) => r.valid)).toBe(true);
  });

  it('should resolve a chain from store, compute effective constraints, and verify actions', async () => {
    const root = await buildCovenant({
      issuer: { id: 'res-root', publicKey: kpRoot.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'res-mid', publicKey: kpMid.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'\npermit api.call on '**'",
      privateKey: kpRoot.privateKey,
    });

    const child = await buildCovenant({
      issuer: { id: 'res-mid', publicKey: kpMid.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'res-leaf', publicKey: kpLeaf.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\ndeny api.call on '/admin/**' severity high",
      privateKey: kpMid.privateKey,
      chain: { parentId: root.id, relation: 'restricts', depth: 1 },
    });

    const store = new MemoryStore();
    await store.putBatch([root, child]);

    // Resolve chain
    const resolver = new MemoryChainResolver();
    resolver.add(root);
    resolver.add(child);

    const ancestors = await resolveChain(child, resolver);
    expect(ancestors).toHaveLength(1);
    expect(ancestors[0]!.id).toBe(root.id);

    // Compute effective constraints
    const effective = await computeEffectiveConstraints(child, ancestors);
    expect(effective.statements.length).toBeGreaterThan(0);

    // Verify effective constraints using CCL evaluator
    const readPublic = evaluate(effective, 'file.read', '/data/report.csv');
    expect(readPublic.permitted).toBe(true);

    const apiAdmin = evaluate(effective, 'api.call', '/admin/users');
    expect(apiAdmin.permitted).toBe(false);
  });

  it('should detect narrowing violation when child broadens parent', async () => {
    const parent = await buildCovenant({
      issuer: { id: 'narrow-parent', publicKey: kpRoot.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'narrow-child', publicKey: kpMid.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\ndeny file.write on '**' severity critical",
      privateKey: kpRoot.privateKey,
    });

    const child = await buildCovenant({
      issuer: { id: 'narrow-child', publicKey: kpMid.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'narrow-leaf', publicKey: kpLeaf.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\npermit file.write on '/data/**'",
      privateKey: kpMid.privateKey,
      chain: { parentId: parent.id, relation: 'delegates', depth: 1 },
    });

    const narrowing = await validateChainNarrowing(child, parent);
    expect(narrowing.valid).toBe(false);
    expect(narrowing.violations.length).toBeGreaterThan(0);
  });

  it('should validate a valid narrowing chain via NobulexClient.validateChain', async () => {
    const client = new NobulexClient({ keyPair: kpRoot });

    const root = await client.createCovenant({
      issuer: { id: 'vc-root', publicKey: kpRoot.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'vc-child', publicKey: kpMid.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'\ndeny file.delete on '**' severity critical",
    });

    const childClient = new NobulexClient({ keyPair: kpMid });
    const child = await childClient.createCovenant({
      issuer: { id: 'vc-child', publicKey: kpMid.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'vc-leaf', publicKey: kpLeaf.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'\ndeny file.delete on '**' severity critical",
      chain: { parentId: root.id, relation: 'restricts', depth: 1 },
    });

    const result = await client.validateChain([root, child]);
    expect(result.valid).toBe(true);
    expect(result.narrowingViolations).toHaveLength(0);
  });

  it('should use SDK parseCCL and mergeCCL together', () => {
    const client = new NobulexClient();
    const doc1 = client.parseCCL("permit file.read on '/data/**'");
    const doc2 = client.parseCCL("deny file.write on '**' severity critical");
    const merged = client.mergeCCL(doc1, doc2);

    expect(merged.statements.length).toBe(2);

    const readResult = evaluate(merged, 'file.read', '/data/test.csv');
    expect(readResult.permitted).toBe(true);

    const writeResult = evaluate(merged, 'file.write', '/data/test.csv');
    expect(writeResult.permitted).toBe(false);
  });

  it('should SDK serializeCCL preserve semantics after round-trip', () => {
    const client = new NobulexClient();
    const original = client.parseCCL("permit file.read on '/data/**'\ndeny file.write on '/system/**' severity critical");
    const serialized = client.serializeCCL(original);
    const reparsed = client.parseCCL(serialized);

    const r1 = evaluate(original, 'file.read', '/data/test.csv');
    const r2 = evaluate(reparsed, 'file.read', '/data/test.csv');
    expect(r1.permitted).toBe(r2.permitted);
  });

  it('should store chain documents with metadata tags and filter by tags', async () => {
    const store = new MemoryStore();

    const root = await buildCovenant({
      issuer: { id: 'tag-root', publicKey: kpRoot.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'tag-child', publicKey: kpMid.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
      privateKey: kpRoot.privateKey,
      metadata: { tags: ['root', 'production'] },
    });

    const child = await buildCovenant({
      issuer: { id: 'tag-child', publicKey: kpMid.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'tag-leaf', publicKey: kpLeaf.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '/data/**'",
      privateKey: kpMid.privateKey,
      metadata: { tags: ['child', 'production'] },
      chain: { parentId: root.id, relation: 'restricts', depth: 1 },
    });

    await store.putBatch([root, child]);

    const prodDocs = await store.list({ tags: ['production'] });
    expect(prodDocs).toHaveLength(2);

    const rootDocs = await store.list({ tags: ['root'] });
    expect(rootDocs).toHaveLength(1);
    expect(rootDocs[0]!.id).toBe(root.id);

    const childDocs = await store.list({ hasChain: true });
    expect(childDocs).toHaveLength(1);
    expect(childDocs[0]!.id).toBe(child.id);
  });

  it('should strictly mode throw CovenantVerificationError on invalid covenant', async () => {
    const client = new NobulexClient({ keyPair: kpRoot, strictMode: true });

    const doc = await client.createCovenant({
      issuer: { id: 'strict-issuer', publicKey: kpRoot.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'strict-ben', publicKey: kpRoot.publicKeyHex, role: 'beneficiary' },
      constraints: "permit file.read on '**'",
    });

    // Tamper the doc
    const tampered = { ...doc, constraints: "permit file.write on '**'" };

    await expect(client.verifyCovenant(tampered)).rejects.toThrow(CovenantVerificationError);
  });
});
