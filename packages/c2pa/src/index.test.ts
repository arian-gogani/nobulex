import { describe, it, expect } from 'vitest';
import { generateKeyPair, sha256String } from '@nobulex/crypto';
import {
  createManifest,
  verifyManifest,
  inputFromEvidence,
  hashContent,
  serializeManifest,
} from './index';
import type { ManifestInput, EvidenceItem } from './index';

function makeManifestInput(overrides?: Partial<ManifestInput>): ManifestInput {
  return {
    digitalSourceType: 'trainedAlgorithmicMedia',
    contentHash: sha256String('Hello, world!'),
    contentType: 'text/plain',
    agentDid: 'did:nobulex:agent1',
    modelVersion: 'claude-opus-4-20250514',
    merkleRoot: sha256String('merkle-root'),
    ...overrides,
  };
}

describe('c2pa', () => {
  describe('createManifest', () => {
    it('should create a signed manifest', async () => {
      const kp = await generateKeyPair();
      const manifest = await createManifest(makeManifestInput(), kp);

      expect(manifest.id).toBeTruthy();
      expect(manifest.claimGenerator).toBe('nobulex/c2pa/0.2.0');
      expect(manifest.digitalSourceType).toBe('trainedAlgorithmicMedia');
      expect(manifest.contentHash).toBeTruthy();
      expect(manifest.agentDid).toBe('did:nobulex:agent1');
      expect(manifest.hash).toBeTruthy();
      expect(manifest.signature).toBeTruthy();
      expect(manifest.inputs).toEqual([]);
      expect(manifest.transparencyPointer).toBeNull();
      expect(manifest.evidenceChain).toEqual([]);
    });

    it('should include input references', async () => {
      const kp = await generateKeyPair();
      const manifest = await createManifest(makeManifestInput({
        inputs: [{
          contentHash: sha256String('input-data'),
          relationship: 'inputTo',
          description: 'User prompt',
        }],
      }), kp);

      expect(manifest.inputs).toHaveLength(1);
      expect(manifest.inputs[0]!.relationship).toBe('inputTo');
    });

    it('should include transparency pointer', async () => {
      const kp = await generateKeyPair();
      const manifest = await createManifest(makeManifestInput({
        transparencyPointer: {
          logId: 'nobulex-prod',
          entryIndex: 42,
          entryHash: sha256String('entry'),
          endpoint: 'https://log.nobulex.dev',
        },
      }), kp);

      expect(manifest.transparencyPointer).not.toBeNull();
      expect(manifest.transparencyPointer!.logId).toBe('nobulex-prod');
      expect(manifest.transparencyPointer!.entryIndex).toBe(42);
    });

    it('should include evidence chain hashes', async () => {
      const kp = await generateKeyPair();
      const hashes = [sha256String('ev1'), sha256String('ev2')];
      const manifest = await createManifest(makeManifestInput({
        evidenceChain: hashes,
      }), kp);

      expect(manifest.evidenceChain).toEqual(hashes);
    });
  });

  describe('verifyManifest', () => {
    it('should verify a valid manifest', async () => {
      const kp = await generateKeyPair();
      const manifest = await createManifest(makeManifestInput(), kp);

      const result = await verifyManifest(manifest, kp.publicKey);
      expect(result.valid).toBe(true);
      expect(result.checks.every((c) => c.passed)).toBe(true);
    });

    it('should reject a manifest with tampered content', async () => {
      const kp = await generateKeyPair();
      const manifest = await createManifest(makeManifestInput(), kp);

      const tampered = { ...manifest, contentHash: sha256String('tampered') };
      const result = await verifyManifest(tampered, kp.publicKey);
      expect(result.valid).toBe(false);
    });

    it('should reject a manifest with wrong signer', async () => {
      const kp1 = await generateKeyPair();
      const kp2 = await generateKeyPair();
      const manifest = await createManifest(makeManifestInput(), kp1);

      const result = await verifyManifest(manifest, kp2.publicKey);
      expect(result.valid).toBe(false);
    });

    it('should reject a manifest with empty content hash', async () => {
      const kp = await generateKeyPair();
      const manifest = await createManifest(makeManifestInput({ contentHash: '' }), kp);

      const result = await verifyManifest(manifest, kp.publicKey);
      expect(result.valid).toBe(false);
      expect(result.checks.find((c) => c.name === 'content_hash_present')?.passed).toBe(false);
    });
  });

  describe('helpers', () => {
    it('inputFromEvidence should create an input reference', () => {
      const item = {
        inputHash: sha256String('input'),
      } as unknown as EvidenceItem;

      const ref = inputFromEvidence(item);
      expect(ref.contentHash).toBe(item.inputHash);
      expect(ref.relationship).toBe('inputTo');
    });

    it('hashContent should hash a string', () => {
      const hash = hashContent('test content');
      expect(hash).toBeTruthy();
      expect(hash).toBe(sha256String('test content'));
    });

    it('serializeManifest should produce deterministic JSON', async () => {
      const kp = await generateKeyPair();
      const manifest = await createManifest(makeManifestInput(), kp);
      const json = serializeManifest(manifest);
      expect(json).toBe(serializeManifest(manifest));
    });
  });
});
