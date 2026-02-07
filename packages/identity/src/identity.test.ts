import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '@stele/crypto';
import type { KeyPair } from '@stele/crypto';

import {
  createIdentity,
  verifyIdentity,
  evolveIdentity,
  computeCapabilityManifestHash,
  computeIdentityHash,
  computeCarryForward,
  getLineage,
  shareAncestor,
  serializeIdentity,
  deserializeIdentity,
  DEFAULT_EVOLUTION_POLICY,
} from './index';

import type {
  AgentIdentity,
  ModelAttestation,
  DeploymentContext,
  CreateIdentityOptions,
} from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function testModel(): ModelAttestation {
  return {
    provider: 'anthropic',
    modelId: 'claude-3',
    modelVersion: '20240101',
    attestationType: 'provider_signed',
  };
}

function testDeployment(): DeploymentContext {
  return {
    runtime: 'container',
    region: 'us-east-1',
    provider: 'aws',
  };
}

function testCapabilities(): string[] {
  return ['text_generation', 'code_generation', 'web_search'];
}

async function createTestIdentity(
  overrides?: Partial<CreateIdentityOptions>,
): Promise<{ identity: AgentIdentity; operatorKeyPair: KeyPair }> {
  const operatorKeyPair = await generateKeyPair();

  const options: CreateIdentityOptions = {
    operatorKeyPair,
    model: testModel(),
    capabilities: testCapabilities(),
    deployment: testDeployment(),
    ...overrides,
  };

  const identity = await createIdentity(options);
  return { identity, operatorKeyPair };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@stele/identity', () => {
  // ── createIdentity ─────────────────────────────────────────────────────

  describe('createIdentity', () => {
    it('produces a valid AgentIdentity', async () => {
      const { identity, operatorKeyPair } = await createTestIdentity();

      expect(identity).toBeDefined();
      expect(identity.id).toBeTruthy();
      expect(typeof identity.id).toBe('string');
      expect(identity.operatorPublicKey).toBe(operatorKeyPair.publicKeyHex);
      expect(identity.model).toEqual(testModel());
      // Capabilities should be sorted
      expect(identity.capabilities).toEqual([...testCapabilities()].sort());
      expect(identity.capabilityManifestHash).toBeTruthy();
      expect(identity.deployment).toEqual(testDeployment());
      expect(identity.version).toBe(1);
      expect(identity.createdAt).toBeTruthy();
      expect(identity.updatedAt).toBeTruthy();
      expect(identity.signature).toBeTruthy();
      expect(identity.lineage).toHaveLength(1);
      expect(identity.lineage[0]!.changeType).toBe('created');
      expect(identity.lineage[0]!.parentHash).toBeNull();
      expect(identity.lineage[0]!.reputationCarryForward).toBe(1.0);
    });

    it('includes operatorIdentifier when provided', async () => {
      const { identity } = await createTestIdentity({
        operatorIdentifier: 'operator-abc',
      });

      expect(identity.operatorIdentifier).toBe('operator-abc');
    });

    it('sorts capabilities lexicographically', async () => {
      const { identity } = await createTestIdentity({
        capabilities: ['z_cap', 'a_cap', 'm_cap'],
      });

      expect(identity.capabilities).toEqual(['a_cap', 'm_cap', 'z_cap']);
    });
  });

  // ── createIdentity → verifyIdentity round-trip ─────────────────────────

  describe('createIdentity → verifyIdentity round-trip', () => {
    it('all checks pass for a freshly-created identity', async () => {
      const { identity } = await createTestIdentity();

      const result = await verifyIdentity(identity);

      expect(result.valid).toBe(true);
      expect(result.checks.length).toBeGreaterThanOrEqual(5);
      for (const check of result.checks) {
        expect(check.passed).toBe(true);
      }
    });
  });

  // ── evolveIdentity ────────────────────────────────────────────────────

  describe('evolveIdentity', () => {
    it('preserves lineage chain', async () => {
      const { identity, operatorKeyPair } = await createTestIdentity();

      const evolved = await evolveIdentity(identity, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Added new capability',
        updates: {
          capabilities: [...testCapabilities(), 'image_generation'],
        },
      });

      // Original lineage entry should still be present
      expect(evolved.lineage).toHaveLength(2);
      expect(evolved.lineage[0]!.changeType).toBe('created');
      expect(evolved.lineage[1]!.changeType).toBe('capability_change');

      // New entry's parentHash should point to the previous identity hash
      expect(evolved.lineage[1]!.parentHash).toBe(
        identity.lineage[identity.lineage.length - 1]!.identityHash,
      );
    });

    it('increments version', async () => {
      const { identity, operatorKeyPair } = await createTestIdentity();

      expect(identity.version).toBe(1);

      const evolved = await evolveIdentity(identity, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Update',
        updates: { capabilities: ['text_generation'] },
      });

      expect(evolved.version).toBe(2);

      const evolved2 = await evolveIdentity(evolved, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Another update',
        updates: { capabilities: ['text_generation', 'code_generation'] },
      });

      expect(evolved2.version).toBe(3);
    });

    it('applies model updates correctly', async () => {
      const { identity, operatorKeyPair } = await createTestIdentity();

      const newModel: ModelAttestation = {
        provider: 'anthropic',
        modelId: 'claude-3',
        modelVersion: '20240201',
        attestationType: 'provider_signed',
      };

      const evolved = await evolveIdentity(identity, {
        operatorKeyPair,
        changeType: 'model_update',
        description: 'Model version bump',
        updates: { model: newModel },
      });

      expect(evolved.model).toEqual(newModel);
      // Other fields should be preserved
      expect(evolved.capabilities).toEqual(identity.capabilities);
      expect(evolved.deployment).toEqual(identity.deployment);
    });

    it('applies capability updates correctly', async () => {
      const { identity, operatorKeyPair } = await createTestIdentity();

      const newCapabilities = ['text_generation', 'image_generation'];

      const evolved = await evolveIdentity(identity, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Changed capabilities',
        updates: { capabilities: newCapabilities },
      });

      expect(evolved.capabilities).toEqual([...newCapabilities].sort());
      expect(evolved.capabilityManifestHash).toBe(
        computeCapabilityManifestHash(newCapabilities),
      );
    });

    it('applies deployment updates correctly', async () => {
      const { identity, operatorKeyPair } = await createTestIdentity();

      const newDeployment: DeploymentContext = {
        runtime: 'tee',
        region: 'eu-west-1',
        provider: 'gcp',
      };

      const evolved = await evolveIdentity(identity, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Deployment change',
        updates: { deployment: newDeployment },
      });

      expect(evolved.deployment).toEqual(newDeployment);
    });

    it('evolved identity passes verification', async () => {
      const { identity, operatorKeyPair } = await createTestIdentity();

      const evolved = await evolveIdentity(identity, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Test evolution',
        updates: { capabilities: ['text_generation'] },
      });

      const result = await verifyIdentity(evolved);
      expect(result.valid).toBe(true);
    });

    it('does not mutate the original identity', async () => {
      const { identity, operatorKeyPair } = await createTestIdentity();
      const originalId = identity.id;
      const originalVersion = identity.version;
      const originalLineageLength = identity.lineage.length;

      await evolveIdentity(identity, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Test',
        updates: { capabilities: ['text_generation'] },
      });

      expect(identity.id).toBe(originalId);
      expect(identity.version).toBe(originalVersion);
      expect(identity.lineage).toHaveLength(originalLineageLength);
    });

    it('supports explicit reputationCarryForward override', async () => {
      const { identity, operatorKeyPair } = await createTestIdentity();

      const evolved = await evolveIdentity(identity, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Test',
        updates: { capabilities: ['text_generation'] },
        reputationCarryForward: 0.42,
      });

      const lastEntry = evolved.lineage[evolved.lineage.length - 1]!;
      expect(lastEntry.reputationCarryForward).toBe(0.42);
    });
  });

  // ── verifyIdentity fails on tampering ──────────────────────────────────

  describe('verifyIdentity fails on tampering', () => {
    it('fails if identity hash is tampered', async () => {
      const { identity } = await createTestIdentity();

      const tampered = { ...identity };
      const idChars = tampered.id.split('');
      idChars[0] = idChars[0] === 'a' ? 'b' : 'a';
      tampered.id = idChars.join('');

      const result = await verifyIdentity(tampered);

      expect(result.valid).toBe(false);
      const hashCheck = result.checks.find((c) => c.name === 'composite_identity_hash');
      expect(hashCheck).toBeDefined();
      expect(hashCheck!.passed).toBe(false);
    });

    it('fails if signature is tampered', async () => {
      const { identity } = await createTestIdentity();

      const tampered = { ...identity };
      const sigChars = tampered.signature.split('');
      sigChars[0] = sigChars[0] === 'a' ? 'b' : 'a';
      tampered.signature = sigChars.join('');

      const result = await verifyIdentity(tampered);

      expect(result.valid).toBe(false);
      const sigCheck = result.checks.find((c) => c.name === 'operator_signature');
      expect(sigCheck).toBeDefined();
      expect(sigCheck!.passed).toBe(false);
    });

    it('fails if capabilities are modified after creation', async () => {
      const { identity } = await createTestIdentity();

      const tampered = {
        ...identity,
        capabilities: ['tampered_capability'],
      };

      const result = await verifyIdentity(tampered);

      expect(result.valid).toBe(false);
      const capCheck = result.checks.find((c) => c.name === 'capability_manifest_hash');
      expect(capCheck).toBeDefined();
      expect(capCheck!.passed).toBe(false);
    });

    it('fails if version does not match lineage length', async () => {
      const { identity } = await createTestIdentity();

      const tampered = { ...identity, version: 99 };

      const result = await verifyIdentity(tampered);

      expect(result.valid).toBe(false);
      const versionCheck = result.checks.find((c) => c.name === 'version_lineage_match');
      expect(versionCheck).toBeDefined();
      expect(versionCheck!.passed).toBe(false);
    });
  });

  // ── computeCapabilityManifestHash ──────────────────────────────────────

  describe('computeCapabilityManifestHash', () => {
    it('is deterministic', () => {
      const caps = ['text_generation', 'code_generation', 'web_search'];

      const hash1 = computeCapabilityManifestHash(caps);
      const hash2 = computeCapabilityManifestHash(caps);

      expect(hash1).toBe(hash2);
    });

    it('is order-independent (sorts before hashing)', () => {
      const caps1 = ['a', 'b', 'c'];
      const caps2 = ['c', 'a', 'b'];

      const hash1 = computeCapabilityManifestHash(caps1);
      const hash2 = computeCapabilityManifestHash(caps2);

      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different capabilities', () => {
      const hash1 = computeCapabilityManifestHash(['text_generation']);
      const hash2 = computeCapabilityManifestHash(['image_generation']);

      expect(hash1).not.toBe(hash2);
    });

    it('produces a hex string', () => {
      const hash = computeCapabilityManifestHash(['test']);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── computeIdentityHash ────────────────────────────────────────────────

  describe('computeIdentityHash', () => {
    it('changes when components change', async () => {
      const { identity } = await createTestIdentity();

      // Compute hash from the identity's components
      const { id: _id, signature: _sig, ...rest } = identity;
      const hash1 = computeIdentityHash(rest);

      // Modify a component and see if hash changes
      const modified = { ...rest, operatorPublicKey: 'different_key' };
      const hash2 = computeIdentityHash(modified);

      expect(hash1).not.toBe(hash2);
    });

    it('is deterministic for the same inputs', async () => {
      const { identity } = await createTestIdentity();

      const { id: _id, signature: _sig, ...rest } = identity;
      const hash1 = computeIdentityHash(rest);
      const hash2 = computeIdentityHash(rest);

      expect(hash1).toBe(hash2);
    });

    it('changes when model changes', async () => {
      const { identity } = await createTestIdentity();

      const { id: _id, signature: _sig, ...rest } = identity;
      const hash1 = computeIdentityHash(rest);

      const modifiedRest = {
        ...rest,
        model: { ...rest.model, modelVersion: '99999' },
      };
      const hash2 = computeIdentityHash(modifiedRest);

      expect(hash1).not.toBe(hash2);
    });

    it('changes when deployment changes', async () => {
      const { identity } = await createTestIdentity();

      const { id: _id, signature: _sig, ...rest } = identity;
      const hash1 = computeIdentityHash(rest);

      const modifiedRest = {
        ...rest,
        deployment: { ...rest.deployment, runtime: 'wasm' as const },
      };
      const hash2 = computeIdentityHash(modifiedRest);

      expect(hash1).not.toBe(hash2);
    });
  });

  // ── computeCarryForward ────────────────────────────────────────────────

  describe('computeCarryForward', () => {
    let identity: AgentIdentity;

    // Create a fresh identity before each test
    async function freshIdentity(): Promise<AgentIdentity> {
      const { identity: id } = await createTestIdentity();
      return id;
    }

    it('returns correct rates per change type', async () => {
      identity = await freshIdentity();

      // created
      const createdRate = computeCarryForward('created', identity, {});
      expect(createdRate).toBe(1.0);

      // operator_transfer
      const transferRate = computeCarryForward('operator_transfer', identity, {});
      expect(transferRate).toBe(DEFAULT_EVOLUTION_POLICY.operatorTransfer);

      // fork
      const forkRate = computeCarryForward('fork', identity, {});
      expect(forkRate).toBe(DEFAULT_EVOLUTION_POLICY.operatorTransfer);

      // merge
      const mergeRate = computeCarryForward('merge', identity, {});
      expect(mergeRate).toBe(Math.min(DEFAULT_EVOLUTION_POLICY.capabilityExpansion, DEFAULT_EVOLUTION_POLICY.modelVersionChange));
    });

    it('model family change returns low carry-forward (0.20)', async () => {
      identity = await freshIdentity();

      const rate = computeCarryForward('model_update', identity, {
        model: {
          provider: 'different-provider',
          modelId: 'different-model',
          modelVersion: '1.0',
        },
      });

      expect(rate).toBe(0.20);
      expect(rate).toBe(DEFAULT_EVOLUTION_POLICY.modelFamilyChange);
    });

    it('model version change (same family) returns 0.80', async () => {
      identity = await freshIdentity();

      const rate = computeCarryForward('model_update', identity, {
        model: {
          provider: 'anthropic',
          modelId: 'claude-3',
          modelVersion: '20240201',
        },
      });

      expect(rate).toBe(0.80);
      expect(rate).toBe(DEFAULT_EVOLUTION_POLICY.modelVersionChange);
    });

    it('model_update with no model in updates returns minorUpdate', async () => {
      identity = await freshIdentity();

      const rate = computeCarryForward('model_update', identity, {});
      expect(rate).toBe(DEFAULT_EVOLUTION_POLICY.minorUpdate);
    });

    it('capability reduction returns full carry-forward (1.0)', async () => {
      identity = await freshIdentity();

      // Remove a capability (reduction)
      const rate = computeCarryForward('capability_change', identity, {
        capabilities: ['text_generation'],
      });

      expect(rate).toBe(1.0);
      expect(rate).toBe(DEFAULT_EVOLUTION_POLICY.capabilityReduction);
    });

    it('capability expansion returns 0.90', async () => {
      identity = await freshIdentity();

      // Add capabilities (expansion, keep all existing)
      const rate = computeCarryForward('capability_change', identity, {
        capabilities: [...testCapabilities(), 'image_generation'],
      });

      expect(rate).toBe(0.90);
      expect(rate).toBe(DEFAULT_EVOLUTION_POLICY.capabilityExpansion);
    });

    it('mixed capability change returns min of expansion and reduction', async () => {
      identity = await freshIdentity();

      // Remove one, add a new one
      const rate = computeCarryForward('capability_change', identity, {
        capabilities: ['text_generation', 'image_generation'],
      });

      expect(rate).toBe(
        Math.min(
          DEFAULT_EVOLUTION_POLICY.capabilityExpansion,
          DEFAULT_EVOLUTION_POLICY.capabilityReduction,
        ),
      );
    });

    it('capability_change with no capabilities in updates returns minorUpdate', async () => {
      identity = await freshIdentity();

      const rate = computeCarryForward('capability_change', identity, {});
      expect(rate).toBe(DEFAULT_EVOLUTION_POLICY.minorUpdate);
    });

    it('unknown change type returns fullRebuild (0.0)', async () => {
      identity = await freshIdentity();

      const rate = computeCarryForward(
        'unknown_type' as 'created',
        identity,
        {},
      );
      expect(rate).toBe(0.0);
      expect(rate).toBe(DEFAULT_EVOLUTION_POLICY.fullRebuild);
    });

    it('respects custom policy', async () => {
      identity = await freshIdentity();

      const customPolicy = {
        minorUpdate: 0.50,
        modelVersionChange: 0.60,
        modelFamilyChange: 0.10,
        operatorTransfer: 0.30,
        capabilityExpansion: 0.70,
        capabilityReduction: 0.80,
        fullRebuild: 0.05,
      };

      const rate = computeCarryForward(
        'operator_transfer',
        identity,
        {},
        customPolicy,
      );
      expect(rate).toBe(0.30);
    });
  });

  // ── getLineage ────────────────────────────────────────────────────────

  describe('getLineage', () => {
    it('returns all entries', async () => {
      const { identity, operatorKeyPair } = await createTestIdentity();

      const evolved = await evolveIdentity(identity, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Step 1',
        updates: { capabilities: ['text_generation'] },
      });

      const evolved2 = await evolveIdentity(evolved, {
        operatorKeyPair,
        changeType: 'model_update',
        description: 'Step 2',
        updates: {
          model: { provider: 'anthropic', modelId: 'claude-3', modelVersion: '20240301' },
        },
      });

      const lineage = getLineage(evolved2);

      expect(lineage).toHaveLength(3);
      expect(lineage[0]!.changeType).toBe('created');
      expect(lineage[1]!.changeType).toBe('capability_change');
      expect(lineage[2]!.changeType).toBe('model_update');
    });

    it('returns a copy (not a reference to the original array)', async () => {
      const { identity } = await createTestIdentity();

      const lineage = getLineage(identity);
      lineage.push(lineage[0]!);

      expect(identity.lineage).toHaveLength(1);
    });
  });

  // ── shareAncestor ──────────────────────────────────────────────────────

  describe('shareAncestor', () => {
    it('returns true for evolved identities (shared lineage)', async () => {
      const { identity, operatorKeyPair } = await createTestIdentity();

      const evolved = await evolveIdentity(identity, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Evolved',
        updates: { capabilities: ['text_generation'] },
      });

      // identity and evolved share the first lineage entry's identityHash
      const result = shareAncestor(identity, evolved);
      expect(result).toBe(true);
    });

    it('returns true symmetrically', async () => {
      const { identity, operatorKeyPair } = await createTestIdentity();

      const evolved = await evolveIdentity(identity, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Evolved',
        updates: { capabilities: ['text_generation'] },
      });

      expect(shareAncestor(identity, evolved)).toBe(true);
      expect(shareAncestor(evolved, identity)).toBe(true);
    });

    it('returns false for unrelated identities', async () => {
      const { identity: identity1 } = await createTestIdentity();
      const { identity: identity2 } = await createTestIdentity();

      const result = shareAncestor(identity1, identity2);
      expect(result).toBe(false);
    });

    it('returns true for sibling evolutions', async () => {
      const { identity, operatorKeyPair } = await createTestIdentity();

      const sibling1 = await evolveIdentity(identity, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Branch A',
        updates: { capabilities: ['text_generation'] },
      });

      const sibling2 = await evolveIdentity(identity, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Branch B',
        updates: { capabilities: ['image_generation'] },
      });

      expect(shareAncestor(sibling1, sibling2)).toBe(true);
    });
  });

  // ── serializeIdentity → deserializeIdentity round-trip ─────────────────

  describe('serializeIdentity → deserializeIdentity round-trip', () => {
    it('produces an identical identity', async () => {
      const { identity } = await createTestIdentity();

      const json = serializeIdentity(identity);
      const restored = deserializeIdentity(json);

      expect(restored.id).toBe(identity.id);
      expect(restored.operatorPublicKey).toBe(identity.operatorPublicKey);
      expect(restored.model).toEqual(identity.model);
      expect(restored.capabilities).toEqual(identity.capabilities);
      expect(restored.capabilityManifestHash).toBe(identity.capabilityManifestHash);
      expect(restored.deployment).toEqual(identity.deployment);
      expect(restored.version).toBe(identity.version);
      expect(restored.createdAt).toBe(identity.createdAt);
      expect(restored.updatedAt).toBe(identity.updatedAt);
      expect(restored.signature).toBe(identity.signature);
      expect(restored.lineage).toEqual(identity.lineage);
    });

    it('deserialized identity still passes verification', async () => {
      const { identity } = await createTestIdentity();

      const json = serializeIdentity(identity);
      const restored = deserializeIdentity(json);

      const result = await verifyIdentity(restored);
      expect(result.valid).toBe(true);
    });

    it('deserializeIdentity throws on non-object JSON', () => {
      expect(() => deserializeIdentity('"just a string"')).toThrow(
        'expected an object',
      );
    });

    it('deserializeIdentity throws on null', () => {
      expect(() => deserializeIdentity('null')).toThrow(
        'expected an object',
      );
    });

    it('deserializeIdentity throws on missing required fields', () => {
      expect(() => deserializeIdentity('{}')).toThrow(
        'missing required field',
      );
    });

    it('deserializeIdentity throws when lineage is not an array', () => {
      const fake = {
        id: 'x',
        operatorPublicKey: 'y',
        model: {},
        capabilities: [],
        capabilityManifestHash: 'z',
        deployment: {},
        lineage: 'not-an-array',
        version: 1,
        createdAt: 'now',
        updatedAt: 'now',
        signature: 'sig',
      };
      expect(() => deserializeIdentity(JSON.stringify(fake))).toThrow(
        'lineage must be an array',
      );
    });

    it('deserializeIdentity throws when capabilities is not an array', () => {
      const fake = {
        id: 'x',
        operatorPublicKey: 'y',
        model: {},
        capabilities: 'not-an-array',
        capabilityManifestHash: 'z',
        deployment: {},
        lineage: [],
        version: 1,
        createdAt: 'now',
        updatedAt: 'now',
        signature: 'sig',
      };
      expect(() => deserializeIdentity(JSON.stringify(fake))).toThrow(
        'capabilities must be an array',
      );
    });

    it('deserializeIdentity throws when version is not a number', () => {
      const fake = {
        id: 'x',
        operatorPublicKey: 'y',
        model: {},
        capabilities: [],
        capabilityManifestHash: 'z',
        deployment: {},
        lineage: [],
        version: 'not-a-number',
        createdAt: 'now',
        updatedAt: 'now',
        signature: 'sig',
      };
      expect(() => deserializeIdentity(JSON.stringify(fake))).toThrow(
        'version must be a number',
      );
    });
  });

  // ── DEFAULT_EVOLUTION_POLICY ───────────────────────────────────────────

  describe('DEFAULT_EVOLUTION_POLICY', () => {
    it('has correct values', () => {
      expect(DEFAULT_EVOLUTION_POLICY.minorUpdate).toBe(0.95);
      expect(DEFAULT_EVOLUTION_POLICY.modelVersionChange).toBe(0.80);
      expect(DEFAULT_EVOLUTION_POLICY.modelFamilyChange).toBe(0.20);
      expect(DEFAULT_EVOLUTION_POLICY.operatorTransfer).toBe(0.50);
      expect(DEFAULT_EVOLUTION_POLICY.capabilityExpansion).toBe(0.90);
      expect(DEFAULT_EVOLUTION_POLICY.capabilityReduction).toBe(1.00);
      expect(DEFAULT_EVOLUTION_POLICY.fullRebuild).toBe(0.00);
    });

    it('has all required fields', () => {
      const expectedKeys = [
        'minorUpdate',
        'modelVersionChange',
        'modelFamilyChange',
        'operatorTransfer',
        'capabilityExpansion',
        'capabilityReduction',
        'fullRebuild',
      ];

      for (const key of expectedKeys) {
        expect(DEFAULT_EVOLUTION_POLICY).toHaveProperty(key);
        expect(typeof (DEFAULT_EVOLUTION_POLICY as unknown as Record<string, unknown>)[key]).toBe('number');
      }
    });

    it('all values are between 0 and 1 inclusive', () => {
      for (const value of Object.values(DEFAULT_EVOLUTION_POLICY)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });
  });

  // ── Multi-step evolution and full verification ─────────────────────────

  describe('multi-step evolution', () => {
    it('three-step evolution maintains valid state at each step', async () => {
      const { identity, operatorKeyPair } = await createTestIdentity();

      // Step 1: capability change
      const step1 = await evolveIdentity(identity, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Add image generation',
        updates: { capabilities: [...testCapabilities(), 'image_generation'] },
      });
      let result = await verifyIdentity(step1);
      expect(result.valid).toBe(true);
      expect(step1.version).toBe(2);

      // Step 2: model update
      const step2 = await evolveIdentity(step1, {
        operatorKeyPair,
        changeType: 'model_update',
        description: 'Upgrade model version',
        updates: {
          model: {
            provider: 'anthropic',
            modelId: 'claude-3',
            modelVersion: '20240601',
            attestationType: 'provider_signed',
          },
        },
      });
      result = await verifyIdentity(step2);
      expect(result.valid).toBe(true);
      expect(step2.version).toBe(3);

      // Step 3: deployment change
      const step3 = await evolveIdentity(step2, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: 'Change deployment',
        updates: { deployment: { runtime: 'tee', region: 'eu-west-1' } },
      });
      result = await verifyIdentity(step3);
      expect(result.valid).toBe(true);
      expect(step3.version).toBe(4);
      expect(step3.lineage).toHaveLength(4);

      // Verify lineage chain linkage
      for (let i = 1; i < step3.lineage.length; i++) {
        expect(step3.lineage[i]!.parentHash).toBe(
          step3.lineage[i - 1]!.identityHash,
        );
      }
    });
  });
});

describe('identity - lineage signature verification', () => {
  it('verifyIdentity checks lineage entry signatures', async () => {
    const kp = await generateKeyPair();
    const identity = await createIdentity({
      operatorKeyPair: kp,
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929', attestationType: 'self_reported' },
      capabilities: ['file.read'],
      deployment: { runtime: 'process' },
    });

    const result = await verifyIdentity(identity);
    expect(result.valid).toBe(true);
    const sigCheck = result.checks.find(c => c.name === 'lineage_signatures');
    expect(sigCheck).toBeDefined();
    expect(sigCheck!.passed).toBe(true);
  });

  it('detects tampered lineage entry signature', async () => {
    const kp = await generateKeyPair();
    const identity = await createIdentity({
      operatorKeyPair: kp,
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929', attestationType: 'self_reported' },
      capabilities: ['file.read'],
      deployment: { runtime: 'process' },
    });

    // Tamper with lineage entry signature
    const tampered = { ...identity, lineage: [...identity.lineage] };
    tampered.lineage[0] = { ...tampered.lineage[0]!, signature: 'deadbeef'.repeat(16) };

    const result = await verifyIdentity(tampered);
    const sigCheck = result.checks.find(c => c.name === 'lineage_signatures');
    expect(sigCheck).toBeDefined();
    expect(sigCheck!.passed).toBe(false);
  });

  it('verifies lineage signatures through evolution', async () => {
    const kp = await generateKeyPair();
    const identity = await createIdentity({
      operatorKeyPair: kp,
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929', attestationType: 'self_reported' },
      capabilities: ['file.read'],
      deployment: { runtime: 'process' },
    });

    const evolved = await evolveIdentity(identity, {
      operatorKeyPair: kp,
      changeType: 'capability_change',
      description: 'Added write capability',
      updates: { capabilities: ['file.read', 'file.write'] },
    });

    const result = await verifyIdentity(evolved);
    expect(result.valid).toBe(true);
    const sigCheck = result.checks.find(c => c.name === 'lineage_signatures');
    expect(sigCheck!.passed).toBe(true);
  });
});

describe('identity - fork and merge carry-forward', () => {
  it('fork uses operatorTransfer rate (0.50)', async () => {
    const kp = await generateKeyPair();
    const identity = await createIdentity({
      operatorKeyPair: kp,
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929', attestationType: 'self_reported' },
      capabilities: ['file.read'],
      deployment: { runtime: 'process' },
    });

    const rate = computeCarryForward('fork', identity, {});
    expect(rate).toBe(0.50);
  });

  it('merge uses min of capabilityExpansion and modelVersionChange (0.80)', async () => {
    const kp = await generateKeyPair();
    const identity = await createIdentity({
      operatorKeyPair: kp,
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929', attestationType: 'self_reported' },
      capabilities: ['file.read'],
      deployment: { runtime: 'process' },
    });

    const rate = computeCarryForward('merge', identity, {});
    expect(rate).toBe(0.80); // min(0.90, 0.80)
  });
});

describe('identity - shareAncestor fork detection', () => {
  it('detects shared ancestor between forked identities', async () => {
    const kp = await generateKeyPair();
    const base = await createIdentity({
      operatorKeyPair: kp,
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929', attestationType: 'self_reported' },
      capabilities: ['file.read'],
      deployment: { runtime: 'process' },
    });

    // Fork A
    const forkA = await evolveIdentity(base, {
      operatorKeyPair: kp,
      changeType: 'fork',
      description: 'Fork A for analysis',
      updates: { capabilities: ['file.read', 'data.analysis'] },
    });

    // Fork B
    const forkB = await evolveIdentity(base, {
      operatorKeyPair: kp,
      changeType: 'fork',
      description: 'Fork B for writing',
      updates: { capabilities: ['file.read', 'file.write'] },
    });

    expect(shareAncestor(forkA, forkB)).toBe(true);
  });

  it('no shared ancestor between unrelated identities', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();

    const identity1 = await createIdentity({
      operatorKeyPair: kp1,
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929', attestationType: 'self_reported' },
      capabilities: ['file.read'],
      deployment: { runtime: 'process' },
    });

    const identity2 = await createIdentity({
      operatorKeyPair: kp2,
      model: { provider: 'openai', modelId: 'gpt-4', attestationType: 'self_reported' },
      capabilities: ['api.call'],
      deployment: { runtime: 'container' },
    });

    expect(shareAncestor(identity1, identity2)).toBe(false);
  });

  it('detects shared ancestor after multiple evolutions', async () => {
    const kp = await generateKeyPair();
    const base = await createIdentity({
      operatorKeyPair: kp,
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929', attestationType: 'self_reported' },
      capabilities: ['file.read'],
      deployment: { runtime: 'process' },
    });

    const v2 = await evolveIdentity(base, {
      operatorKeyPair: kp,
      changeType: 'capability_change',
      description: 'Added write',
      updates: { capabilities: ['file.read', 'file.write'] },
    });

    // Fork from v2
    const forkA = await evolveIdentity(v2, {
      operatorKeyPair: kp,
      changeType: 'fork',
      description: 'Fork A',
      updates: {},
    });

    // Fork from base (earlier)
    const forkB = await evolveIdentity(base, {
      operatorKeyPair: kp,
      changeType: 'fork',
      description: 'Fork B',
      updates: {},
    });

    // forkA has lineage: created, capability_change, fork
    // forkB has lineage: created, fork
    // They share the 'created' entry
    expect(shareAncestor(forkA, forkB)).toBe(true);
  });
});

describe('identity - full evolution policy for all 7 change types', () => {
  it('created returns 1.0', async () => {
    const kp = await generateKeyPair();
    const identity = await createIdentity({
      operatorKeyPair: kp,
      model: { provider: 'test', modelId: 'test', attestationType: 'self_reported' },
      capabilities: [],
      deployment: { runtime: 'process' },
    });
    expect(computeCarryForward('created', identity, {})).toBe(1.0);
  });

  it('model_update with same family returns modelVersionChange (0.80)', async () => {
    const kp = await generateKeyPair();
    const identity = await createIdentity({
      operatorKeyPair: kp,
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929', modelVersion: 'v1', attestationType: 'self_reported' },
      capabilities: [],
      deployment: { runtime: 'process' },
    });
    const rate = computeCarryForward('model_update', identity, {
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929', modelVersion: 'v2', attestationType: 'self_reported' }
    });
    expect(rate).toBe(0.80);
  });

  it('model_update with different family returns modelFamilyChange (0.20)', async () => {
    const kp = await generateKeyPair();
    const identity = await createIdentity({
      operatorKeyPair: kp,
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929', attestationType: 'self_reported' },
      capabilities: [],
      deployment: { runtime: 'process' },
    });
    const rate = computeCarryForward('model_update', identity, {
      model: { provider: 'openai', modelId: 'gpt-4o', attestationType: 'self_reported' }
    });
    expect(rate).toBe(0.20);
  });

  it('capability_change expansion returns 0.90', async () => {
    const kp = await generateKeyPair();
    const identity = await createIdentity({
      operatorKeyPair: kp,
      model: { provider: 'test', modelId: 'test', attestationType: 'self_reported' },
      capabilities: ['file.read'],
      deployment: { runtime: 'process' },
    });
    const rate = computeCarryForward('capability_change', identity, {
      capabilities: ['file.read', 'file.write']
    });
    expect(rate).toBe(0.90);
  });

  it('capability_change reduction returns 1.00', async () => {
    const kp = await generateKeyPair();
    const identity = await createIdentity({
      operatorKeyPair: kp,
      model: { provider: 'test', modelId: 'test', attestationType: 'self_reported' },
      capabilities: ['file.read', 'file.write'],
      deployment: { runtime: 'process' },
    });
    const rate = computeCarryForward('capability_change', identity, {
      capabilities: ['file.read']
    });
    expect(rate).toBe(1.00);
  });

  it('operator_transfer returns 0.50', async () => {
    const kp = await generateKeyPair();
    const identity = await createIdentity({
      operatorKeyPair: kp,
      model: { provider: 'test', modelId: 'test', attestationType: 'self_reported' },
      capabilities: [],
      deployment: { runtime: 'process' },
    });
    expect(computeCarryForward('operator_transfer', identity, {})).toBe(0.50);
  });

  it('custom evolution policy overrides defaults', async () => {
    const kp = await generateKeyPair();
    const identity = await createIdentity({
      operatorKeyPair: kp,
      model: { provider: 'test', modelId: 'test', attestationType: 'self_reported' },
      capabilities: [],
      deployment: { runtime: 'process' },
    });
    const customPolicy = {
      ...DEFAULT_EVOLUTION_POLICY,
      operatorTransfer: 0.75,
    };
    expect(computeCarryForward('operator_transfer', identity, {}, customPolicy)).toBe(0.75);
  });
});
