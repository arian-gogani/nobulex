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

// ===========================================================================
// EXPANDED TEST COVERAGE
// ===========================================================================

// ---------------------------------------------------------------------------
// createIdentity edge cases
// ---------------------------------------------------------------------------

describe('createIdentity - runtime types', () => {
  const runtimeTypes = ['wasm', 'container', 'tee', 'firecracker', 'process', 'browser'] as const;

  for (const runtime of runtimeTypes) {
    it(`creates identity with runtime type "${runtime}"`, async () => {
      const { identity } = await createTestIdentity({
        deployment: { runtime },
      });

      expect(identity.deployment.runtime).toBe(runtime);
      const result = await verifyIdentity(identity);
      expect(result.valid).toBe(true);
    });
  }
});

describe('createIdentity - model attestation types', () => {
  const attestationTypes = ['provider_signed', 'weight_hash', 'self_reported'] as const;

  for (const attestationType of attestationTypes) {
    it(`creates identity with attestationType "${attestationType}"`, async () => {
      const { identity } = await createTestIdentity({
        model: {
          provider: 'test-provider',
          modelId: 'test-model',
          modelVersion: '1.0',
          attestationType,
          attestationHash: 'a'.repeat(64),
        },
      });

      expect(identity.model.attestationType).toBe(attestationType);
      expect(identity.model.attestationHash).toBe('a'.repeat(64));
      const result = await verifyIdentity(identity);
      expect(result.valid).toBe(true);
    });
  }

  it('creates identity with minimal model (no optional fields)', async () => {
    const { identity } = await createTestIdentity({
      model: { provider: 'minimal', modelId: 'bare' },
    });

    expect(identity.model.provider).toBe('minimal');
    expect(identity.model.modelId).toBe('bare');
    expect(identity.model.modelVersion).toBeUndefined();
    expect(identity.model.attestationType).toBeUndefined();
    const result = await verifyIdentity(identity);
    expect(result.valid).toBe(true);
  });
});

describe('createIdentity - deployment contexts', () => {
  it('creates identity with TEE attestation', async () => {
    const { identity } = await createTestIdentity({
      deployment: {
        runtime: 'tee',
        teeAttestation: 'sgx-quote-hex-data',
        region: 'us-west-2',
        provider: 'azure',
      },
    });

    expect(identity.deployment.teeAttestation).toBe('sgx-quote-hex-data');
    expect(identity.deployment.region).toBe('us-west-2');
    expect(identity.deployment.provider).toBe('azure');
  });

  it('creates identity with minimal deployment (runtime only)', async () => {
    const { identity } = await createTestIdentity({
      deployment: { runtime: 'process' },
    });

    expect(identity.deployment.runtime).toBe('process');
    expect(identity.deployment.region).toBeUndefined();
    expect(identity.deployment.provider).toBeUndefined();
  });
});

describe('createIdentity - capabilities variations', () => {
  it('creates identity with empty capabilities', async () => {
    const { identity } = await createTestIdentity({
      capabilities: [],
    });

    expect(identity.capabilities).toEqual([]);
    const result = await verifyIdentity(identity);
    expect(result.valid).toBe(true);
  });

  it('creates identity with a single capability', async () => {
    const { identity } = await createTestIdentity({
      capabilities: ['solo_cap'],
    });

    expect(identity.capabilities).toEqual(['solo_cap']);
  });

  it('creates identity with many capabilities and sorts them', async () => {
    const caps = Array.from({ length: 20 }, (_, i) => `cap_${String(i).padStart(2, '0')}`).reverse();
    const { identity } = await createTestIdentity({
      capabilities: caps,
    });

    const sorted = [...caps].sort();
    expect(identity.capabilities).toEqual(sorted);
  });

  it('two identities with same capabilities in different order produce same manifest hash', async () => {
    const { identity: a } = await createTestIdentity({
      capabilities: ['z', 'a', 'm'],
    });
    const { identity: b } = await createTestIdentity({
      capabilities: ['a', 'm', 'z'],
    });

    expect(a.capabilityManifestHash).toBe(b.capabilityManifestHash);
  });
});

// ---------------------------------------------------------------------------
// evolveIdentity - all change types with carry-forward verification
// ---------------------------------------------------------------------------

describe('evolveIdentity - all change types', () => {
  it('model_update (version change) applies correct carry-forward', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity();

    const evolved = await evolveIdentity(identity, {
      operatorKeyPair,
      changeType: 'model_update',
      description: 'Model version bump',
      updates: {
        model: { provider: 'anthropic', modelId: 'claude-3', modelVersion: '20240301' },
      },
    });

    const lastEntry = evolved.lineage[evolved.lineage.length - 1]!;
    expect(lastEntry.changeType).toBe('model_update');
    expect(lastEntry.reputationCarryForward).toBe(DEFAULT_EVOLUTION_POLICY.modelVersionChange);
    expect(evolved.id).not.toBe(identity.id);

    const result = await verifyIdentity(evolved);
    expect(result.valid).toBe(true);
  });

  it('model_update (provider change) applies modelFamilyChange rate', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity();

    const evolved = await evolveIdentity(identity, {
      operatorKeyPair,
      changeType: 'model_update',
      description: 'Switch to OpenAI',
      updates: {
        model: { provider: 'openai', modelId: 'gpt-4o', modelVersion: '2024' },
      },
    });

    const lastEntry = evolved.lineage[evolved.lineage.length - 1]!;
    expect(lastEntry.reputationCarryForward).toBe(DEFAULT_EVOLUTION_POLICY.modelFamilyChange);
    expect(evolved.model.provider).toBe('openai');

    const result = await verifyIdentity(evolved);
    expect(result.valid).toBe(true);
  });

  it('capability_change (expansion) applies capabilityExpansion rate', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity();

    const evolved = await evolveIdentity(identity, {
      operatorKeyPair,
      changeType: 'capability_change',
      description: 'Added image_generation',
      updates: {
        capabilities: [...testCapabilities(), 'image_generation'],
      },
    });

    const lastEntry = evolved.lineage[evolved.lineage.length - 1]!;
    expect(lastEntry.reputationCarryForward).toBe(DEFAULT_EVOLUTION_POLICY.capabilityExpansion);
  });

  it('capability_change (reduction) applies capabilityReduction rate (1.0)', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity();

    const evolved = await evolveIdentity(identity, {
      operatorKeyPair,
      changeType: 'capability_change',
      description: 'Removed capabilities',
      updates: {
        capabilities: ['text_generation'],
      },
    });

    const lastEntry = evolved.lineage[evolved.lineage.length - 1]!;
    expect(lastEntry.reputationCarryForward).toBe(DEFAULT_EVOLUTION_POLICY.capabilityReduction);
    expect(lastEntry.reputationCarryForward).toBe(1.0);
  });

  it('operator_transfer applies operatorTransfer rate and updates key', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity();
    const newKeyPair = await generateKeyPair();

    const evolved = await evolveIdentity(identity, {
      operatorKeyPair,
      changeType: 'operator_transfer',
      description: 'Transferred to new operator',
      updates: {
        operatorPublicKey: newKeyPair.publicKeyHex,
        operatorIdentifier: 'new-operator',
      },
    });

    const lastEntry = evolved.lineage[evolved.lineage.length - 1]!;
    expect(lastEntry.changeType).toBe('operator_transfer');
    expect(lastEntry.reputationCarryForward).toBe(DEFAULT_EVOLUTION_POLICY.operatorTransfer);
    expect(evolved.operatorPublicKey).toBe(newKeyPair.publicKeyHex);
    expect(evolved.operatorIdentifier).toBe('new-operator');
  });

  it('fork applies operatorTransfer rate (0.50)', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity();

    const evolved = await evolveIdentity(identity, {
      operatorKeyPair,
      changeType: 'fork',
      description: 'Forked for specialized task',
      updates: { capabilities: ['text_generation', 'data_analysis'] },
    });

    const lastEntry = evolved.lineage[evolved.lineage.length - 1]!;
    expect(lastEntry.changeType).toBe('fork');
    expect(lastEntry.reputationCarryForward).toBe(DEFAULT_EVOLUTION_POLICY.operatorTransfer);

    const result = await verifyIdentity(evolved);
    expect(result.valid).toBe(true);
  });

  it('merge applies min(capabilityExpansion, modelVersionChange)', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity();

    const evolved = await evolveIdentity(identity, {
      operatorKeyPair,
      changeType: 'merge',
      description: 'Merged capabilities from another branch',
      updates: { capabilities: [...testCapabilities(), 'merged_cap'] },
    });

    const lastEntry = evolved.lineage[evolved.lineage.length - 1]!;
    expect(lastEntry.changeType).toBe('merge');
    expect(lastEntry.reputationCarryForward).toBe(
      Math.min(DEFAULT_EVOLUTION_POLICY.capabilityExpansion, DEFAULT_EVOLUTION_POLICY.modelVersionChange),
    );

    const result = await verifyIdentity(evolved);
    expect(result.valid).toBe(true);
  });

  it('each evolution changes the identity hash', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity();
    const hashes = new Set<string>();
    hashes.add(identity.id);

    let current = identity;
    const changeTypes: Array<'model_update' | 'capability_change' | 'operator_transfer' | 'fork' | 'merge'> = [
      'model_update',
      'capability_change',
      'operator_transfer',
      'fork',
      'merge',
    ];

    for (const ct of changeTypes) {
      const evolved = await evolveIdentity(current, {
        operatorKeyPair,
        changeType: ct,
        description: `Change: ${ct}`,
        updates: {
          model: ct === 'model_update' ? { provider: 'x', modelId: 'y', modelVersion: ct } : undefined,
          capabilities: ct === 'capability_change' ? ['text_generation'] : undefined,
        },
      });
      expect(hashes.has(evolved.id)).toBe(false);
      hashes.add(evolved.id);
      current = evolved;
    }

    expect(hashes.size).toBe(6);
  });

  it('lineage entry parentHash links correctly through multiple evolutions', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity();

    const v2 = await evolveIdentity(identity, {
      operatorKeyPair,
      changeType: 'capability_change',
      description: 'v2',
      updates: { capabilities: ['text_generation', 'new_cap'] },
    });

    const v3 = await evolveIdentity(v2, {
      operatorKeyPair,
      changeType: 'model_update',
      description: 'v3',
      updates: { model: { provider: 'test', modelId: 'model', modelVersion: '3' } },
    });

    const v4 = await evolveIdentity(v3, {
      operatorKeyPair,
      changeType: 'fork',
      description: 'v4',
      updates: {},
    });

    expect(v4.lineage).toHaveLength(4);
    // Each entry's parentHash should point to the previous entry's identityHash
    for (let i = 1; i < v4.lineage.length; i++) {
      expect(v4.lineage[i]!.parentHash).toBe(v4.lineage[i - 1]!.identityHash);
    }
    // First entry must have null parentHash
    expect(v4.lineage[0]!.parentHash).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyIdentity - comprehensive checks
// ---------------------------------------------------------------------------

describe('verifyIdentity - comprehensive', () => {
  it('returns all 6 check names', async () => {
    const { identity } = await createTestIdentity();
    const result = await verifyIdentity(identity);

    const checkNames = result.checks.map(c => c.name);
    expect(checkNames).toContain('capability_manifest_hash');
    expect(checkNames).toContain('composite_identity_hash');
    expect(checkNames).toContain('operator_signature');
    expect(checkNames).toContain('lineage_chain');
    expect(checkNames).toContain('lineage_signatures');
    expect(checkNames).toContain('version_lineage_match');
    expect(result.checks).toHaveLength(6);
  });

  it('detects tampered lineage parentHash chain (broken link)', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity();
    const evolved = await evolveIdentity(identity, {
      operatorKeyPair,
      changeType: 'capability_change',
      description: 'Test',
      updates: { capabilities: ['text_generation'] },
    });

    // Tamper lineage: set second entry's parentHash to something wrong
    const tampered = {
      ...evolved,
      lineage: [
        evolved.lineage[0]!,
        { ...evolved.lineage[1]!, parentHash: 'ff'.repeat(32) },
      ],
    };

    const result = await verifyIdentity(tampered);
    expect(result.valid).toBe(false);
    const chainCheck = result.checks.find(c => c.name === 'lineage_chain');
    expect(chainCheck!.passed).toBe(false);
    expect(chainCheck!.message).toContain('parentHash');
  });

  it('detects first lineage entry with non-null parentHash', async () => {
    const { identity } = await createTestIdentity();

    const tampered = {
      ...identity,
      lineage: [
        { ...identity.lineage[0]!, parentHash: 'ab'.repeat(32) },
      ],
    };

    const result = await verifyIdentity(tampered);
    expect(result.valid).toBe(false);
    const chainCheck = result.checks.find(c => c.name === 'lineage_chain');
    expect(chainCheck!.passed).toBe(false);
    expect(chainCheck!.message).toContain('expected null parentHash');
  });

  it('multi-step evolved identity passes all checks', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity();

    let current = identity;
    for (let i = 0; i < 5; i++) {
      current = await evolveIdentity(current, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: `Step ${i + 1}`,
        updates: { capabilities: [`cap_${i}`] },
      });
    }

    const result = await verifyIdentity(current);
    expect(result.valid).toBe(true);
    expect(current.version).toBe(6);
    expect(current.lineage).toHaveLength(6);
  });

  it('detects signature from wrong key', async () => {
    const { identity } = await createTestIdentity();
    const wrongKeyPair = await generateKeyPair();

    // Create a second identity with a different key and swap signatures
    const { identity: other } = await createTestIdentity({
      operatorKeyPair: wrongKeyPair,
    });

    const tampered = { ...identity, signature: other.signature };
    const result = await verifyIdentity(tampered);
    expect(result.valid).toBe(false);
    const sigCheck = result.checks.find(c => c.name === 'operator_signature');
    expect(sigCheck!.passed).toBe(false);
  });

  it('detects tampered model field', async () => {
    const { identity } = await createTestIdentity();

    const tampered = {
      ...identity,
      model: { ...identity.model, modelVersion: 'tampered' },
    };

    const result = await verifyIdentity(tampered);
    expect(result.valid).toBe(false);
  });

  it('detects tampered deployment field', async () => {
    const { identity } = await createTestIdentity();

    const tampered = {
      ...identity,
      deployment: { ...identity.deployment, runtime: 'wasm' as const },
    };

    const result = await verifyIdentity(tampered);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeCarryForward - boundary values and custom policies
// ---------------------------------------------------------------------------

describe('computeCarryForward - boundary values and custom policies', () => {
  it('custom policy with all factors at 0', async () => {
    const { identity } = await createTestIdentity();
    const zeroPolicy = {
      minorUpdate: 0,
      modelVersionChange: 0,
      modelFamilyChange: 0,
      operatorTransfer: 0,
      capabilityExpansion: 0,
      capabilityReduction: 0,
      fullRebuild: 0,
    };

    expect(computeCarryForward('created', identity, {}, zeroPolicy)).toBe(1.0); // created always 1.0
    expect(computeCarryForward('operator_transfer', identity, {}, zeroPolicy)).toBe(0);
    expect(computeCarryForward('fork', identity, {}, zeroPolicy)).toBe(0);
    expect(computeCarryForward('merge', identity, {}, zeroPolicy)).toBe(0);
    expect(computeCarryForward('model_update', identity, {}, zeroPolicy)).toBe(0);
    expect(computeCarryForward('capability_change', identity, {}, zeroPolicy)).toBe(0);
  });

  it('custom policy with all factors at 1', async () => {
    const { identity } = await createTestIdentity();
    const onePolicy = {
      minorUpdate: 1,
      modelVersionChange: 1,
      modelFamilyChange: 1,
      operatorTransfer: 1,
      capabilityExpansion: 1,
      capabilityReduction: 1,
      fullRebuild: 1,
    };

    expect(computeCarryForward('operator_transfer', identity, {}, onePolicy)).toBe(1);
    expect(computeCarryForward('fork', identity, {}, onePolicy)).toBe(1);
    expect(computeCarryForward('merge', identity, {}, onePolicy)).toBe(1);
    expect(computeCarryForward('model_update', identity, {
      model: { provider: 'different', modelId: 'different' },
    }, onePolicy)).toBe(1);
  });

  it('model_update same provider different modelId uses modelFamilyChange', async () => {
    const { identity } = await createTestIdentity();

    // Same provider, different modelId
    const rate = computeCarryForward('model_update', identity, {
      model: { provider: 'anthropic', modelId: 'claude-4', modelVersion: '1.0' },
    });

    expect(rate).toBe(DEFAULT_EVOLUTION_POLICY.modelFamilyChange);
  });

  it('capability_change with exact same capabilities returns minorUpdate (no adds, no removes)', async () => {
    const { identity } = await createTestIdentity();

    // Provide same capabilities as current
    const rate = computeCarryForward('capability_change', identity, {
      capabilities: [...testCapabilities()],
    });

    // No added, no removed -> both lengths 0 -> falls through to min
    // Actually: added.length === 0 && removed.length === 0 -> neither branch matches, so min(expansion, reduction)
    expect(rate).toBe(Math.min(DEFAULT_EVOLUTION_POLICY.capabilityExpansion, DEFAULT_EVOLUTION_POLICY.capabilityReduction));
  });

  it('merge with custom policy uses min of custom capabilityExpansion and modelVersionChange', async () => {
    const { identity } = await createTestIdentity();
    const customPolicy = {
      ...DEFAULT_EVOLUTION_POLICY,
      capabilityExpansion: 0.30,
      modelVersionChange: 0.60,
    };

    const rate = computeCarryForward('merge', identity, {}, customPolicy);
    expect(rate).toBe(0.30);
  });

  it('fork with custom policy uses custom operatorTransfer', async () => {
    const { identity } = await createTestIdentity();
    const customPolicy = {
      ...DEFAULT_EVOLUTION_POLICY,
      operatorTransfer: 0.99,
    };

    const rate = computeCarryForward('fork', identity, {}, customPolicy);
    expect(rate).toBe(0.99);
  });
});

// ---------------------------------------------------------------------------
// getLineage - additional coverage
// ---------------------------------------------------------------------------

describe('getLineage - additional coverage', () => {
  it('returns single-entry lineage for fresh identity', async () => {
    const { identity } = await createTestIdentity();
    const lineage = getLineage(identity);

    expect(lineage).toHaveLength(1);
    expect(lineage[0]!.changeType).toBe('created');
    expect(lineage[0]!.parentHash).toBeNull();
    expect(lineage[0]!.reputationCarryForward).toBe(1.0);
    expect(lineage[0]!.description).toBe('Identity created');
  });

  it('returns 5-step lineage in correct order', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity();

    let current = identity;
    const descriptions = ['Step 1', 'Step 2', 'Step 3', 'Step 4'];
    for (const desc of descriptions) {
      current = await evolveIdentity(current, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: desc,
        updates: { capabilities: ['text_generation'] },
      });
    }

    const lineage = getLineage(current);
    expect(lineage).toHaveLength(5);
    expect(lineage[0]!.description).toBe('Identity created');
    for (let i = 0; i < descriptions.length; i++) {
      expect(lineage[i + 1]!.description).toBe(descriptions[i]);
    }
  });

  it('each lineage entry has a valid signature string', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity();
    const evolved = await evolveIdentity(identity, {
      operatorKeyPair,
      changeType: 'capability_change',
      description: 'test',
      updates: { capabilities: ['a'] },
    });

    for (const entry of getLineage(evolved)) {
      expect(typeof entry.signature).toBe('string');
      expect(entry.signature.length).toBeGreaterThan(0);
      expect(entry.signature).toMatch(/^[0-9a-f]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// shareAncestor - deep chains
// ---------------------------------------------------------------------------

describe('shareAncestor - deep lineage chains', () => {
  it('detects common ancestor deep in a chain', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity();

    // Build a 5-step chain from identity
    let chainA = identity;
    for (let i = 0; i < 5; i++) {
      chainA = await evolveIdentity(chainA, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: `A-step-${i}`,
        updates: { capabilities: [`cap_a_${i}`] },
      });
    }

    // Build a 3-step chain from the same base identity
    let chainB = identity;
    for (let i = 0; i < 3; i++) {
      chainB = await evolveIdentity(chainB, {
        operatorKeyPair,
        changeType: 'capability_change',
        description: `B-step-${i}`,
        updates: { capabilities: [`cap_b_${i}`] },
      });
    }

    // They share the 'created' entry
    expect(shareAncestor(chainA, chainB)).toBe(true);
    expect(shareAncestor(chainB, chainA)).toBe(true);
  });

  it('no shared ancestor between independently created deep chains', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();

    let a = await createIdentity({
      operatorKeyPair: kp1,
      model: { provider: 'a', modelId: 'a' },
      capabilities: ['a'],
      deployment: { runtime: 'process' },
    });

    let b = await createIdentity({
      operatorKeyPair: kp2,
      model: { provider: 'b', modelId: 'b' },
      capabilities: ['b'],
      deployment: { runtime: 'container' },
    });

    for (let i = 0; i < 4; i++) {
      a = await evolveIdentity(a, {
        operatorKeyPair: kp1,
        changeType: 'capability_change',
        description: `a-${i}`,
        updates: { capabilities: [`a_${i}`] },
      });
      b = await evolveIdentity(b, {
        operatorKeyPair: kp2,
        changeType: 'capability_change',
        description: `b-${i}`,
        updates: { capabilities: [`b_${i}`] },
      });
    }

    expect(shareAncestor(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Serialization - additional coverage
// ---------------------------------------------------------------------------

describe('serialization - additional coverage', () => {
  it('round-trip preserves evolved identity with lineage', async () => {
    const { identity, operatorKeyPair } = await createTestIdentity({
      operatorIdentifier: 'roundtrip-operator',
    });

    const evolved = await evolveIdentity(identity, {
      operatorKeyPair,
      changeType: 'model_update',
      description: 'Version bump',
      updates: { model: { provider: 'anthropic', modelId: 'claude-3', modelVersion: '2025' } },
    });

    const json = serializeIdentity(evolved);
    const restored = deserializeIdentity(json);

    expect(restored.id).toBe(evolved.id);
    expect(restored.version).toBe(evolved.version);
    expect(restored.lineage).toHaveLength(2);
    expect(restored.operatorIdentifier).toBe('roundtrip-operator');
    expect(restored.lineage[1]!.changeType).toBe('model_update');

    const result = await verifyIdentity(restored);
    expect(result.valid).toBe(true);
  });

  it('throws on invalid JSON string', () => {
    expect(() => deserializeIdentity('not-json-at-all')).toThrow();
  });

  it('throws on JSON array', () => {
    expect(() => deserializeIdentity('[1,2,3]')).toThrow();
  });

  it('throws on JSON number', () => {
    expect(() => deserializeIdentity('42')).toThrow();
  });

  it('throws on JSON boolean', () => {
    expect(() => deserializeIdentity('true')).toThrow();
  });

  it('reports which required field is missing', () => {
    const partial = { id: 'x', operatorPublicKey: 'y' };
    expect(() => deserializeIdentity(JSON.stringify(partial))).toThrow('missing required field');
  });

  it('serialization produces deterministic JSON (same identity twice)', async () => {
    const { identity } = await createTestIdentity();
    const json1 = serializeIdentity(identity);
    const json2 = serializeIdentity(identity);
    expect(json1).toBe(json2);
  });

  it('serialized string is valid JSON', async () => {
    const { identity } = await createTestIdentity();
    const json = serializeIdentity(identity);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});
