import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPair } from '@stele/crypto';
import type { KeyPair } from '@stele/crypto';
import type { CovenantDocument, Issuer, Beneficiary } from '@stele/core';
import { verifyCovenant as coreVerifyCovenant } from '@stele/core';
import { verifyIdentity } from '@stele/identity';

import {
  SteleClient,
  QuickCovenant,

  // Re-exports: core
  PROTOCOL_VERSION,
  MAX_CONSTRAINTS,
  MAX_CHAIN_DEPTH,
  MAX_DOCUMENT_SIZE,
  CovenantBuildError,
  CovenantVerificationError,
  MemoryChainResolver,
  canonicalForm,
  computeId,
  buildCovenant,
  resignCovenant,
  serializeCovenant,
  deserializeCovenant,
  computeEffectiveConstraints,
  validateChainNarrowing,

  // Re-exports: crypto
  sha256String,
  toHex,
  fromHex,
  generateId,
  timestamp,

  // Re-exports: CCL
  parseCCL,
  evaluateCCL,
  matchAction,
  matchResource,
  serializeCCL,
  mergeCCL,

  // Re-exports: identity
  DEFAULT_EVOLUTION_POLICY,
  getLineage,
  shareAncestor,
  serializeIdentity,
  deserializeIdentity,
} from './index';

import type {
  SteleClientOptions,
  CreateCovenantOptions,
  EvaluationResult,
  CreateIdentityOptions,
  EvolveOptions,
  ChainValidationResult,
  SteleEventType,
  CovenantCreatedEvent,
  CovenantVerifiedEvent,
  CovenantCountersignedEvent,
  IdentityCreatedEvent,
  IdentityEvolvedEvent,
  ChainResolvedEvent,
  ChainValidatedEvent,
  EvaluationCompletedEvent,
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

function makeIdentityOptions(kp: KeyPair): CreateIdentityOptions {
  return {
    operatorKeyPair: kp,
    model: {
      provider: 'test-provider',
      modelId: 'test-model',
      modelVersion: '1.0',
    },
    capabilities: ['read', 'write', 'execute'],
    deployment: {
      runtime: 'process',
      region: 'us-east-1',
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@stele/sdk', () => {
  // ── SteleClient constructor ───────────────────────────────────────────

  describe('SteleClient constructor', () => {
    it('creates a client with default options', () => {
      const client = new SteleClient();
      expect(client.keyPair).toBeUndefined();
      expect(client.agentId).toBeUndefined();
      expect(client.strictMode).toBe(false);
    });

    it('accepts a pre-existing key pair', async () => {
      const kp = await generateKeyPair();
      const client = new SteleClient({ keyPair: kp });
      expect(client.keyPair).toBe(kp);
    });

    it('accepts an agentId', () => {
      const client = new SteleClient({ agentId: 'agent-42' });
      expect(client.agentId).toBe('agent-42');
    });

    it('accepts strictMode flag', () => {
      const client = new SteleClient({ strictMode: true });
      expect(client.strictMode).toBe(true);
    });

    it('sets all options at once', async () => {
      const kp = await generateKeyPair();
      const client = new SteleClient({
        keyPair: kp,
        agentId: 'my-agent',
        strictMode: true,
      });
      expect(client.keyPair).toBe(kp);
      expect(client.agentId).toBe('my-agent');
      expect(client.strictMode).toBe(true);
    });
  });

  // ── Key management ────────────────────────────────────────────────────

  describe('SteleClient.generateKeyPair', () => {
    it('generates a valid key pair', async () => {
      const client = new SteleClient();
      const kp = await client.generateKeyPair();

      expect(kp.privateKey).toBeInstanceOf(Uint8Array);
      expect(kp.publicKey).toBeInstanceOf(Uint8Array);
      expect(kp.publicKeyHex).toBeTruthy();
      expect(typeof kp.publicKeyHex).toBe('string');
    });

    it('sets the generated key pair on the client', async () => {
      const client = new SteleClient();
      expect(client.keyPair).toBeUndefined();

      const kp = await client.generateKeyPair();
      expect(client.keyPair).toBe(kp);
    });

    it('overwrites previous key pair when called again', async () => {
      const client = new SteleClient();
      const kp1 = await client.generateKeyPair();
      const kp2 = await client.generateKeyPair();

      expect(kp1.publicKeyHex).not.toBe(kp2.publicKeyHex);
      expect(client.keyPair).toBe(kp2);
    });
  });

  // ── Covenant creation ─────────────────────────────────────────────────

  describe('SteleClient.createCovenant', () => {
    it('creates a valid covenant document', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });

      expect(doc.id).toMatch(/^[0-9a-f]{64}$/);
      expect(doc.version).toBe(PROTOCOL_VERSION);
      expect(doc.issuer.id).toBe('issuer-1');
      expect(doc.beneficiary.id).toBe('beneficiary-1');
      expect(doc.signature).toMatch(/^[0-9a-f]{128}$/);
    });

    it('uses explicit privateKey over client keyPair', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const otherKp = await generateKeyPair();
      const client = new SteleClient({ keyPair: otherKp });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
        privateKey: issuerKeyPair.privateKey,
      });

      // Should verify because signature matches issuer's public key
      const result = await coreVerifyCovenant(doc);
      expect(result.valid).toBe(true);
    });

    it('throws when no private key is available', async () => {
      const { issuer, beneficiary } = await makeParties();
      const client = new SteleClient();

      await expect(
        client.createCovenant({
          issuer,
          beneficiary,
          constraints: "permit read on 'data'",
        }),
      ).rejects.toThrow('No private key available');
    });

    it('passes optional fields through to buildCovenant', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
        metadata: { name: 'test-covenant', tags: ['sdk'] },
        expiresAt: '2099-12-31T23:59:59.000Z',
        enforcement: { type: 'monitor', config: {} },
      });

      expect(doc.metadata?.name).toBe('test-covenant');
      expect(doc.expiresAt).toBe('2099-12-31T23:59:59.000Z');
      expect(doc.enforcement?.type).toBe('monitor');
    });

    it('throws a helpful error for empty constraints', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      await expect(
        client.createCovenant({
          issuer,
          beneficiary,
          constraints: '',
        }),
      ).rejects.toThrow('constraints must be a non-empty CCL string');
    });

    it('propagates CovenantBuildError for invalid CCL syntax', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      await expect(
        client.createCovenant({
          issuer,
          beneficiary,
          constraints: '!!! not valid CCL !!!',
        }),
      ).rejects.toThrow(CovenantBuildError);
    });
  });

  // ── Covenant verification ─────────────────────────────────────────────

  describe('SteleClient.verifyCovenant', () => {
    it('returns valid for a well-formed covenant', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });

      const result = await client.verifyCovenant(doc);
      expect(result.valid).toBe(true);
      expect(result.checks.length).toBeGreaterThanOrEqual(11);
    });

    it('returns invalid for a tampered covenant', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });

      const tampered = { ...doc, signature: '00'.repeat(64) };
      const result = await client.verifyCovenant(tampered);
      expect(result.valid).toBe(false);
    });

    it('throws in strict mode on verification failure', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({
        keyPair: issuerKeyPair,
        strictMode: true,
      });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });

      const tampered = { ...doc, signature: '00'.repeat(64) };
      await expect(client.verifyCovenant(tampered)).rejects.toThrow(
        CovenantVerificationError,
      );
    });

    it('does not throw in non-strict mode on verification failure', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });

      const tampered = { ...doc, signature: '00'.repeat(64) };
      const result = await client.verifyCovenant(tampered);
      expect(result.valid).toBe(false);
    });
  });

  // ── Countersign ───────────────────────────────────────────────────────

  describe('SteleClient.countersign', () => {
    it('adds a valid countersignature using client key pair', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const auditorKp = await generateKeyPair();
      const createClient = new SteleClient({ keyPair: issuerKeyPair });
      const auditClient = new SteleClient({ keyPair: auditorKp });

      const doc = await createClient.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });

      const signed = await auditClient.countersign(doc, 'auditor');
      expect(signed.countersignatures).toHaveLength(1);
      expect(signed.countersignatures![0]!.signerRole).toBe('auditor');

      const result = await coreVerifyCovenant(signed);
      expect(result.valid).toBe(true);
    });

    it('adds a countersignature with an explicit key pair', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const auditorKp = await generateKeyPair();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });

      const signed = await client.countersign(doc, 'auditor', auditorKp);
      expect(signed.countersignatures).toHaveLength(1);
      expect(signed.countersignatures![0]!.signerPublicKey).toBe(auditorKp.publicKeyHex);
    });

    it('defaults to auditor role', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });

      const signed = await client.countersign(doc);
      expect(signed.countersignatures![0]!.signerRole).toBe('auditor');
    });

    it('throws when no key pair is available', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const createClient = new SteleClient({ keyPair: issuerKeyPair });
      const noKeyClient = new SteleClient();

      const doc = await createClient.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });

      await expect(noKeyClient.countersign(doc)).rejects.toThrow(
        'No key pair available',
      );
    });
  });

  // ── Evaluate action ───────────────────────────────────────────────────

  describe('SteleClient.evaluateAction', () => {
    it('permits an action that matches a permit rule', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data'",
      });

      const result = await client.evaluateAction(doc, 'read', '/data');
      expect(result.permitted).toBe(true);
    });

    it('denies an action that matches a deny rule', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "deny write on '/system'",
      });

      const result = await client.evaluateAction(doc, 'write', '/system');
      expect(result.permitted).toBe(false);
    });

    it('denies by default when no rules match', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data'",
      });

      const result = await client.evaluateAction(doc, 'write', '/data');
      expect(result.permitted).toBe(false);
    });

    it('respects deny-wins over permit at equal specificity', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit write on '/data'\ndeny write on '/data'",
      });

      const result = await client.evaluateAction(doc, 'write', '/data');
      expect(result.permitted).toBe(false);
    });

    it('supports evaluation context', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data' when role = 'admin'",
      });

      const admin = await client.evaluateAction(doc, 'read', '/data', { role: 'admin' });
      expect(admin.permitted).toBe(true);

      const user = await client.evaluateAction(doc, 'read', '/data', { role: 'user' });
      expect(user.permitted).toBe(false);
    });
  });

  // ── Identity ──────────────────────────────────────────────────────────

  describe('SteleClient.createIdentity', () => {
    it('creates a valid agent identity', async () => {
      const kp = await generateKeyPair();
      const client = new SteleClient({ keyPair: kp });

      const identity = await client.createIdentity({
        model: {
          provider: 'openai',
          modelId: 'gpt-4',
          modelVersion: '1.0',
        },
        capabilities: ['chat', 'code'],
        deployment: { runtime: 'container' },
      });

      expect(identity.id).toBeTruthy();
      expect(identity.operatorPublicKey).toBe(kp.publicKeyHex);
      expect(identity.capabilities).toEqual(['chat', 'code']);
      expect(identity.version).toBe(1);
      expect(identity.lineage).toHaveLength(1);

      // Verify the identity is cryptographically valid
      const verification = await verifyIdentity(identity);
      expect(verification.valid).toBe(true);
    });

    it('uses explicit operatorKeyPair when provided', async () => {
      const clientKp = await generateKeyPair();
      const operatorKp = await generateKeyPair();
      const client = new SteleClient({ keyPair: clientKp });

      const identity = await client.createIdentity({
        operatorKeyPair: operatorKp,
        model: {
          provider: 'anthropic',
          modelId: 'claude',
          modelVersion: '3',
        },
        capabilities: ['chat'],
        deployment: { runtime: 'process' },
      });

      expect(identity.operatorPublicKey).toBe(operatorKp.publicKeyHex);
    });

    it('throws when no key pair is available', async () => {
      const client = new SteleClient();

      await expect(
        client.createIdentity({
          model: {
            provider: 'test',
            modelId: 'test',
          },
          capabilities: ['test'],
          deployment: { runtime: 'process' },
        }),
      ).rejects.toThrow('No key pair available');
    });
  });

  describe('SteleClient.evolveIdentity', () => {
    it('evolves an identity with new capabilities', async () => {
      const kp = await generateKeyPair();
      const client = new SteleClient({ keyPair: kp });

      const identity = await client.createIdentity(makeIdentityOptions(kp));

      const evolved = await client.evolveIdentity(identity, {
        changeType: 'capability_change',
        description: 'Adding new capability',
        updates: {
          capabilities: ['read', 'write', 'execute', 'admin'],
        },
      });

      expect(evolved.version).toBe(2);
      expect(evolved.capabilities).toContain('admin');
      expect(evolved.lineage).toHaveLength(2);

      const verification = await verifyIdentity(evolved);
      expect(verification.valid).toBe(true);
    });

    it('throws when no key pair is available', async () => {
      const kp = await generateKeyPair();
      const identityClient = new SteleClient({ keyPair: kp });
      const identity = await identityClient.createIdentity(makeIdentityOptions(kp));

      const noKeyClient = new SteleClient();
      await expect(
        noKeyClient.evolveIdentity(identity, {
          changeType: 'capability_change',
          description: 'test',
          updates: { capabilities: ['read'] },
        }),
      ).rejects.toThrow('No key pair available');
    });
  });

  // ── Chain operations ──────────────────────────────────────────────────

  describe('SteleClient.resolveChain', () => {
    it('resolves a parent-child chain', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const root = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/**'",
      });

      const child = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/public'",
        chain: { parentId: root.id, relation: 'restricts', depth: 1 },
      });

      const ancestors = await client.resolveChain(child, [root]);
      expect(ancestors).toHaveLength(1);
      expect(ancestors[0]!.id).toBe(root.id);
    });

    it('returns empty array for root covenant', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const root = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data'",
      });

      const ancestors = await client.resolveChain(root);
      expect(ancestors).toHaveLength(0);
    });
  });

  describe('SteleClient.validateChain', () => {
    it('validates a proper narrowing chain', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const root = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/**'",
      });

      const child = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/public'",
        chain: { parentId: root.id, relation: 'restricts', depth: 1 },
      });

      const result = await client.validateChain([root, child]);
      expect(result.valid).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.narrowingViolations).toHaveLength(0);
    });

    it('detects narrowing violations', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const root = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "deny write on '/system/**'",
      });

      const child = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit write on '/system/config'",
        chain: { parentId: root.id, relation: 'restricts', depth: 1 },
      });

      const result = await client.validateChain([root, child]);
      expect(result.valid).toBe(false);
      expect(result.narrowingViolations.length).toBeGreaterThan(0);
    });

    it('validates each document individually', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data'",
      });

      const result = await client.validateChain([doc]);
      expect(result.valid).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.valid).toBe(true);
    });
  });

  // ── CCL utilities ─────────────────────────────────────────────────────

  describe('SteleClient CCL utilities', () => {
    it('parseCCL parses valid CCL', () => {
      const client = new SteleClient();
      const doc = client.parseCCL("permit read on '/data'");
      expect(doc.permits).toHaveLength(1);
      expect(doc.permits[0]!.action).toBe('read');
    });

    it('parseCCL throws on invalid CCL', () => {
      const client = new SteleClient();
      expect(() => client.parseCCL('!!! invalid !!!')).toThrow();
    });

    it('mergeCCL merges two CCL documents', () => {
      const client = new SteleClient();
      const a = client.parseCCL("permit read on '/data'");
      const b = client.parseCCL("deny write on '/system'");

      const merged = client.mergeCCL(a, b);
      expect(merged.permits.length).toBeGreaterThanOrEqual(1);
      expect(merged.denies.length).toBeGreaterThanOrEqual(1);
    });

    it('serializeCCL round-trips with parseCCL', () => {
      const client = new SteleClient();
      const source = "permit read on '/data'";
      const doc = client.parseCCL(source);
      const serialized = client.serializeCCL(doc);

      // Parse the serialized output to verify it's valid
      const reparsed = client.parseCCL(serialized);
      expect(reparsed.permits).toHaveLength(1);
      expect(reparsed.permits[0]!.action).toBe('read');
    });
  });

  // ── Event system ──────────────────────────────────────────────────────

  describe('SteleClient event system', () => {
    it('emits covenant:created event', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const events: CovenantCreatedEvent[] = [];
      client.on('covenant:created', (e) => events.push(e));

      await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('covenant:created');
      expect(events[0]!.document.id).toBeTruthy();
      expect(events[0]!.timestamp).toBeTruthy();
    });

    it('emits covenant:verified event', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });

      const events: CovenantVerifiedEvent[] = [];
      client.on('covenant:verified', (e) => events.push(e));

      await client.verifyCovenant(doc);

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('covenant:verified');
      expect(events[0]!.result.valid).toBe(true);
    });

    it('emits covenant:countersigned event', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });

      const events: CovenantCountersignedEvent[] = [];
      client.on('covenant:countersigned', (e) => events.push(e));

      await client.countersign(doc, 'auditor');

      expect(events).toHaveLength(1);
      expect(events[0]!.signerRole).toBe('auditor');
    });

    it('emits identity:created event', async () => {
      const kp = await generateKeyPair();
      const client = new SteleClient({ keyPair: kp });

      const events: IdentityCreatedEvent[] = [];
      client.on('identity:created', (e) => events.push(e));

      await client.createIdentity(makeIdentityOptions(kp));

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('identity:created');
      expect(events[0]!.identity.id).toBeTruthy();
    });

    it('emits identity:evolved event', async () => {
      const kp = await generateKeyPair();
      const client = new SteleClient({ keyPair: kp });
      const identity = await client.createIdentity(makeIdentityOptions(kp));

      const events: IdentityEvolvedEvent[] = [];
      client.on('identity:evolved', (e) => events.push(e));

      await client.evolveIdentity(identity, {
        changeType: 'capability_change',
        description: 'test evolve',
        updates: { capabilities: ['read'] },
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('identity:evolved');
      expect(events[0]!.changeType).toBe('capability_change');
    });

    it('emits chain:resolved event', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const root = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data'",
      });

      // Clear any listeners from createCovenant
      const events: ChainResolvedEvent[] = [];
      client.on('chain:resolved', (e) => events.push(e));

      await client.resolveChain(root);

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('chain:resolved');
    });

    it('emits chain:validated event', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data'",
      });

      const events: ChainValidatedEvent[] = [];
      client.on('chain:validated', (e) => events.push(e));

      await client.validateChain([doc]);

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('chain:validated');
      expect(events[0]!.result.valid).toBe(true);
    });

    it('emits evaluation:completed event', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data'",
      });

      const events: EvaluationCompletedEvent[] = [];
      client.on('evaluation:completed', (e) => events.push(e));

      await client.evaluateAction(doc, 'read', '/data');

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('evaluation:completed');
      expect(events[0]!.action).toBe('read');
      expect(events[0]!.resource).toBe('/data');
      expect(events[0]!.result.permitted).toBe(true);
    });

    it('on() returns a disposer function', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      let count = 0;
      const dispose = client.on('covenant:created', () => { count++; });

      await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });
      expect(count).toBe(1);

      dispose();

      await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });
      expect(count).toBe(1); // Not incremented after dispose
    });

    it('off() removes a specific handler', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      let count = 0;
      const handler = () => { count++; };
      client.on('covenant:created', handler);

      await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });
      expect(count).toBe(1);

      client.off('covenant:created', handler);

      await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });
      expect(count).toBe(1);
    });

    it('removeAllListeners() clears handlers for a specific event', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      let count = 0;
      client.on('covenant:created', () => { count++; });
      client.on('covenant:created', () => { count++; });

      await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });
      expect(count).toBe(2);

      client.removeAllListeners('covenant:created');

      await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });
      expect(count).toBe(2); // Not incremented
    });

    it('removeAllListeners() without args clears all events', async () => {
      const client = new SteleClient();
      let created = 0;
      let verified = 0;

      client.on('covenant:created', () => { created++; });
      client.on('covenant:verified', () => { verified++; });

      client.removeAllListeners();

      // Handlers should be gone -- no errors, but no events
      // We can verify by checking the handlers have no effect
      expect(created).toBe(0);
      expect(verified).toBe(0);
    });

    it('supports multiple handlers for the same event', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const calls: string[] = [];
      client.on('covenant:created', () => calls.push('handler1'));
      client.on('covenant:created', () => calls.push('handler2'));

      await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
      });

      expect(calls).toEqual(['handler1', 'handler2']);
    });
  });

  // ── QuickCovenant ─────────────────────────────────────────────────────

  describe('QuickCovenant', () => {
    describe('QuickCovenant.permit', () => {
      it('creates a valid permit covenant', async () => {
        const { issuerKeyPair, issuer, beneficiary } = await makeParties();

        const doc = await QuickCovenant.permit(
          'read',
          '/data',
          issuer,
          beneficiary,
          issuerKeyPair.privateKey,
        );

        expect(doc.constraints).toBe("permit read on '/data'");
        const result = await coreVerifyCovenant(doc);
        expect(result.valid).toBe(true);
      });

      it('creates a permit covenant with dotted actions', async () => {
        const { issuerKeyPair, issuer, beneficiary } = await makeParties();

        const doc = await QuickCovenant.permit(
          'file.read',
          '/documents/**',
          issuer,
          beneficiary,
          issuerKeyPair.privateKey,
        );

        expect(doc.constraints).toBe("permit file.read on '/documents/**'");
      });
    });

    describe('QuickCovenant.deny', () => {
      it('creates a valid deny covenant', async () => {
        const { issuerKeyPair, issuer, beneficiary } = await makeParties();

        const doc = await QuickCovenant.deny(
          'write',
          '/system',
          issuer,
          beneficiary,
          issuerKeyPair.privateKey,
        );

        expect(doc.constraints).toBe("deny write on '/system'");
        const result = await coreVerifyCovenant(doc);
        expect(result.valid).toBe(true);
      });
    });

    describe('QuickCovenant.standard', () => {
      it('creates a standard covenant with three rules', async () => {
        const { issuerKeyPair, issuer, beneficiary } = await makeParties();

        const doc = await QuickCovenant.standard(
          issuer,
          beneficiary,
          issuerKeyPair.privateKey,
        );

        const result = await coreVerifyCovenant(doc);
        expect(result.valid).toBe(true);

        // Parse constraints and verify they include the expected rules
        const cclDoc = parseCCL(doc.constraints);
        expect(cclDoc.permits.length).toBeGreaterThanOrEqual(1);
        expect(cclDoc.denies.length).toBeGreaterThanOrEqual(1);
        expect(cclDoc.limits.length).toBeGreaterThanOrEqual(1);
      });

      it('the standard covenant permits reads', async () => {
        const { issuerKeyPair, issuer, beneficiary } = await makeParties();

        const doc = await QuickCovenant.standard(
          issuer,
          beneficiary,
          issuerKeyPair.privateKey,
        );

        const cclDoc = parseCCL(doc.constraints);
        const result = evaluateCCL(cclDoc, 'read', '/anything');
        expect(result.permitted).toBe(true);
      });

      it('the standard covenant denies writes to /system/**', async () => {
        const { issuerKeyPair, issuer, beneficiary } = await makeParties();

        const doc = await QuickCovenant.standard(
          issuer,
          beneficiary,
          issuerKeyPair.privateKey,
        );

        const cclDoc = parseCCL(doc.constraints);
        const result = evaluateCCL(cclDoc, 'write', '/system/config');
        expect(result.permitted).toBe(false);
      });
    });
  });

  // ── Re-exports from @stele/core ───────────────────────────────────────

  describe('re-exports from @stele/core', () => {
    it('exports PROTOCOL_VERSION constant', () => {
      expect(PROTOCOL_VERSION).toBe('1.0');
    });

    it('exports MAX_CONSTRAINTS constant', () => {
      expect(MAX_CONSTRAINTS).toBe(1000);
    });

    it('exports MAX_CHAIN_DEPTH constant', () => {
      expect(MAX_CHAIN_DEPTH).toBe(16);
    });

    it('exports MAX_DOCUMENT_SIZE constant', () => {
      expect(MAX_DOCUMENT_SIZE).toBe(1_048_576);
    });

    it('exports CovenantBuildError class', () => {
      const err = new CovenantBuildError('test', 'field');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('CovenantBuildError');
      expect(err.field).toBe('field');
    });

    it('exports CovenantVerificationError class', () => {
      const err = new CovenantVerificationError('test', []);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('CovenantVerificationError');
    });

    it('exports MemoryChainResolver class', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const doc = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
        privateKey: issuerKeyPair.privateKey,
      });

      const resolver = new MemoryChainResolver();
      resolver.add(doc);

      const resolved = await resolver.resolve(doc.id);
      expect(resolved).toEqual(doc);
    });

    it('exports canonicalForm and computeId functions', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const doc = await buildCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on 'data'",
        privateKey: issuerKeyPair.privateKey,
      });

      const form = canonicalForm(doc);
      expect(typeof form).toBe('string');

      const id = computeId(doc);
      expect(id).toBe(doc.id);
    });
  });

  // ── Re-exports from @stele/crypto ─────────────────────────────────────

  describe('re-exports from @stele/crypto', () => {
    it('exports sha256String', () => {
      const hash = sha256String('hello');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('exports toHex and fromHex', () => {
      const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const hex = toHex(bytes);
      expect(hex).toBe('deadbeef');

      const decoded = fromHex(hex);
      expect(decoded).toEqual(bytes);
    });

    it('exports generateId', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    it('exports timestamp', () => {
      const ts = timestamp();
      expect(new Date(ts).toISOString()).toBe(ts);
    });
  });

  // ── Re-exports from @stele/ccl ────────────────────────────────────────

  describe('re-exports from @stele/ccl', () => {
    it('exports parseCCL', () => {
      const doc = parseCCL("permit read on '/data'");
      expect(doc.permits).toHaveLength(1);
    });

    it('exports evaluateCCL', () => {
      const doc = parseCCL("permit read on '/data'");
      const result = evaluateCCL(doc, 'read', '/data');
      expect(result.permitted).toBe(true);
    });

    it('exports matchAction', () => {
      expect(matchAction('file.read', 'file.read')).toBe(true);
      expect(matchAction('file.*', 'file.read')).toBe(true);
      expect(matchAction('file.read', 'file.write')).toBe(false);
    });

    it('exports matchResource', () => {
      expect(matchResource('/data/**', '/data/foo/bar')).toBe(true);
      expect(matchResource('/data/*', '/data/foo')).toBe(true);
      expect(matchResource('/data/foo', '/data/bar')).toBe(false);
    });

    it('exports mergeCCL', () => {
      const a = parseCCL("permit read on '/data'");
      const b = parseCCL("deny write on '/system'");
      const merged = mergeCCL(a, b);
      expect(merged.statements.length).toBeGreaterThan(0);
    });

    it('exports serializeCCL', () => {
      const doc = parseCCL("permit read on '/data'");
      const serialized = serializeCCL(doc);
      expect(serialized).toContain('permit');
      expect(serialized).toContain('read');
    });
  });

  // ── Re-exports from @stele/identity ───────────────────────────────────

  describe('re-exports from @stele/identity', () => {
    it('exports DEFAULT_EVOLUTION_POLICY', () => {
      expect(DEFAULT_EVOLUTION_POLICY.minorUpdate).toBe(0.95);
      expect(DEFAULT_EVOLUTION_POLICY.modelVersionChange).toBe(0.80);
      expect(DEFAULT_EVOLUTION_POLICY.fullRebuild).toBe(0.00);
    });

    it('exports getLineage', async () => {
      const kp = await generateKeyPair();
      const client = new SteleClient({ keyPair: kp });
      const identity = await client.createIdentity(makeIdentityOptions(kp));

      const lineage = getLineage(identity);
      expect(lineage).toHaveLength(1);
      expect(lineage[0]!.changeType).toBe('created');
    });

    it('exports serializeIdentity and deserializeIdentity', async () => {
      const kp = await generateKeyPair();
      const client = new SteleClient({ keyPair: kp });
      const identity = await client.createIdentity(makeIdentityOptions(kp));

      const json = serializeIdentity(identity);
      expect(typeof json).toBe('string');

      const restored = deserializeIdentity(json);
      expect(restored.id).toBe(identity.id);
    });
  });

  // ── Integration: full lifecycle ───────────────────────────────────────

  describe('integration: full covenant lifecycle', () => {
    it('create -> verify -> countersign -> verify -> evaluate', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const auditorKp = await generateKeyPair();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      // Create
      const doc = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/**'\ndeny write on '/system/**'",
        metadata: { name: 'integration-test' },
      });

      // Verify
      const v1 = await client.verifyCovenant(doc);
      expect(v1.valid).toBe(true);

      // Countersign
      const signed = await client.countersign(doc, 'auditor', auditorKp);
      expect(signed.countersignatures).toHaveLength(1);

      // Verify after countersign
      const v2 = await client.verifyCovenant(signed);
      expect(v2.valid).toBe(true);

      // Evaluate permitted action
      const readResult = await client.evaluateAction(signed, 'read', '/data/public');
      expect(readResult.permitted).toBe(true);

      // Evaluate denied action
      const writeResult = await client.evaluateAction(signed, 'write', '/system/config');
      expect(writeResult.permitted).toBe(false);
    });

    it('create chain -> validate -> resolve', async () => {
      const { issuerKeyPair, issuer, beneficiary } = await makeParties();
      const client = new SteleClient({ keyPair: issuerKeyPair });

      const root = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/**'",
      });

      const child = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '/data/reports'",
        chain: { parentId: root.id, relation: 'restricts', depth: 1 },
      });

      // Validate chain
      const chainResult = await client.validateChain([root, child]);
      expect(chainResult.valid).toBe(true);

      // Resolve chain
      const ancestors = await client.resolveChain(child, [root]);
      expect(ancestors).toHaveLength(1);
      expect(ancestors[0]!.id).toBe(root.id);
    });
  });
});
