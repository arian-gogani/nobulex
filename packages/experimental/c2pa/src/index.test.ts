import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPair, sha256String } from '@nobulex/crypto';
import type { KeyPair, HashHex } from '@nobulex/crypto';
import {
  createManifest,
  verifyManifest,
  inputFromEvidence,
  hashContent,
  serializeManifest,
  addAssertion,
  validateManifest,
  verifyManifestChain,
  embedManifestInJSON,
  extractManifestFromJSON,
  embedManifestInBinary,
  extractManifestFromBinary,
  ManifestStore,
  diffManifests,
  summarizeManifest,
  manifestStats,
  generateClaim,
  assertionFromEvidence,
  creativeWorkAssertion,
  dataProvenanceAssertion,
  createBatchManifests,
} from './index';
import type {
  ManifestInput,
  ProvenanceManifest,
  Assertion,
  CreativeWorkAssertion,
  ActionAssertion,
  IngredientAssertion,
  DataHashAssertion,
  DataProvenanceAssertion,
  CustomAssertion,
} from './index';
import type { EvidenceItem } from '@nobulex/evidence-core';

// ─── Test Helpers ───────────────────────────────────────────────────────────

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

async function makeManifest(
  kp: KeyPair,
  overrides?: Partial<ManifestInput>,
): Promise<ProvenanceManifest> {
  return createManifest(makeManifestInput(overrides), kp);
}

function makeCreativeWorkAssertion(
  overrides?: Partial<CreativeWorkAssertion>,
): CreativeWorkAssertion {
  return {
    type: 'creativeWork',
    digitalSourceType: 'trainedAlgorithmicMedia',
    authors: ['did:nobulex:agent1'],
    ...overrides,
  };
}

function makeActionAssertion(overrides?: Partial<ActionAssertion>): ActionAssertion {
  return {
    type: 'action',
    action: 'c2pa.created',
    softwareAgent: 'nobulex/agent/0.1.0',
    when: new Date().toISOString(),
    ...overrides,
  };
}

function makeIngredientAssertion(
  overrides?: Partial<IngredientAssertion>,
): IngredientAssertion {
  return {
    type: 'ingredient',
    title: 'User prompt',
    contentHash: sha256String('input data'),
    relationship: 'inputTo',
    ...overrides,
  };
}

function makeDataHashAssertion(
  overrides?: Partial<DataHashAssertion>,
): DataHashAssertion {
  return {
    type: 'dataHash',
    algorithm: 'sha256',
    hash: sha256String('content to hash'),
    name: 'primary content',
    ...overrides,
  };
}

function makeDataProvenanceAssertionHelper(
  overrides?: Partial<DataProvenanceAssertion>,
): DataProvenanceAssertion {
  return {
    type: 'dataProvenance',
    sourceName: 'Wikipedia API',
    sourceUri: 'https://en.wikipedia.org/api/rest_v1',
    collectedBy: 'did:nobulex:agent1',
    ...overrides,
  };
}

function makeCustomAssertion(overrides?: Partial<CustomAssertion>): CustomAssertion {
  return {
    type: 'custom',
    label: 'nobulex.compliance',
    data: { regulation: 'EU-AI-Act', risk_level: 'minimal' },
    ...overrides,
  };
}

function makeMockEvidenceItem(overrides?: Partial<EvidenceItem>): EvidenceItem {
  return {
    id: 'ev-001',
    timestamp: '2025-06-15T10:00:00.000Z',
    agentDid: 'did:nobulex:agent1',
    actionType: 'tool_call',
    toolName: 'web_search',
    inputHash: sha256String('search query'),
    outputHash: sha256String('search results'),
    modelVersion: 'claude-opus-4-20250514',
    parentActionId: null,
    previousHash: null,
    hash: sha256String('evidence-hash'),
    signature: 'a'.repeat(128),
    ...overrides,
  } as EvidenceItem;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('c2pa', () => {
  // ── createManifest ──────────────────────────────────────────────────

  describe('createManifest', () => {
    it('should create a signed manifest with all required fields', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);

      expect(manifest.id).toBeTruthy();
      expect(manifest.claimGenerator).toBe('nobulex/c2pa/0.2.0');
      expect(manifest.digitalSourceType).toBe('trainedAlgorithmicMedia');
      expect(manifest.contentHash).toBeTruthy();
      expect(manifest.contentType).toBe('text/plain');
      expect(manifest.agentDid).toBe('did:nobulex:agent1');
      expect(manifest.modelVersion).toBe('claude-opus-4-20250514');
      expect(manifest.hash).toBeTruthy();
      expect(manifest.signature).toBeTruthy();
      expect(manifest.inputs).toEqual([]);
      expect(manifest.transparencyPointer).toBeNull();
      expect(manifest.evidenceChain).toEqual([]);
      expect(manifest.assertions).toEqual([]);
      expect(manifest.createdAt).toBeTruthy();
    });

    it('should include input references', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, {
        inputs: [
          {
            contentHash: sha256String('input-data'),
            relationship: 'inputTo',
            description: 'User prompt',
          },
        ],
      });

      expect(manifest.inputs).toHaveLength(1);
      expect(manifest.inputs[0]!.relationship).toBe('inputTo');
      expect(manifest.inputs[0]!.description).toBe('User prompt');
    });

    it('should include transparency pointer', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, {
        transparencyPointer: {
          logId: 'nobulex-prod',
          entryIndex: 42,
          entryHash: sha256String('entry'),
          endpoint: 'https://log.nobulex.dev',
        },
      });

      expect(manifest.transparencyPointer).not.toBeNull();
      expect(manifest.transparencyPointer!.logId).toBe('nobulex-prod');
      expect(manifest.transparencyPointer!.entryIndex).toBe(42);
    });

    it('should include evidence chain hashes', async () => {
      const kp = await generateKeyPair();
      const hashes = [sha256String('ev1'), sha256String('ev2')];
      const manifest = await makeManifest(kp, { evidenceChain: hashes });

      expect(manifest.evidenceChain).toEqual(hashes);
    });

    it('should include assertions', async () => {
      const kp = await generateKeyPair();
      const assertions: Assertion[] = [
        makeCreativeWorkAssertion(),
        makeActionAssertion(),
      ];
      const manifest = await makeManifest(kp, { assertions });

      expect(manifest.assertions).toHaveLength(2);
      expect(manifest.assertions[0]!.type).toBe('creativeWork');
      expect(manifest.assertions[1]!.type).toBe('action');
    });

    it('should produce unique IDs for each manifest', async () => {
      const kp = await generateKeyPair();
      const m1 = await makeManifest(kp);
      const m2 = await makeManifest(kp);

      expect(m1.id).not.toBe(m2.id);
    });

    it('should produce different hashes for different content', async () => {
      const kp = await generateKeyPair();
      const m1 = await makeManifest(kp, { contentHash: sha256String('content-a') });
      const m2 = await makeManifest(kp, { contentHash: sha256String('content-b') });

      expect(m1.hash).not.toBe(m2.hash);
    });
  });

  // ── createBatchManifests ──────────────────────────────────────────────

  describe('createBatchManifests', () => {
    it('should return empty array for empty inputs', async () => {
      const kp = await generateKeyPair();
      const results = await createBatchManifests([], kp);
      expect(results).toHaveLength(0);
    });

    it('should create manifests for multiple inputs', async () => {
      const kp = await generateKeyPair();
      const inputs = [
        makeManifestInput({ contentHash: sha256String('output-1'), contentType: 'text/plain' }),
        makeManifestInput({ contentHash: sha256String('output-2'), contentType: 'application/json' }),
        makeManifestInput({ contentHash: sha256String('output-3'), contentType: 'text/html' }),
      ];

      const results = await createBatchManifests(inputs, kp);
      expect(results).toHaveLength(3);
      expect(results[0]!.contentType).toBe('text/plain');
      expect(results[1]!.contentType).toBe('application/json');
      expect(results[2]!.contentType).toBe('text/html');
    });

    it('should assign unique IDs to each batch manifest', async () => {
      const kp = await generateKeyPair();
      const inputs = [
        makeManifestInput({ contentHash: sha256String('a') }),
        makeManifestInput({ contentHash: sha256String('b') }),
      ];

      const results = await createBatchManifests(inputs, kp);
      expect(results[0]!.id).not.toBe(results[1]!.id);
    });

    it('should share the same timestamp across batch manifests', async () => {
      const kp = await generateKeyPair();
      const inputs = [
        makeManifestInput({ contentHash: sha256String('x') }),
        makeManifestInput({ contentHash: sha256String('y') }),
        makeManifestInput({ contentHash: sha256String('z') }),
      ];

      const results = await createBatchManifests(inputs, kp);
      expect(results[0]!.createdAt).toBe(results[1]!.createdAt);
      expect(results[1]!.createdAt).toBe(results[2]!.createdAt);
    });

    it('should produce verifiable manifests in batch', async () => {
      const kp = await generateKeyPair();
      const inputs = [
        makeManifestInput({ contentHash: sha256String('batch-1') }),
        makeManifestInput({ contentHash: sha256String('batch-2') }),
      ];

      const results = await createBatchManifests(inputs, kp);
      for (const manifest of results) {
        const verification = await verifyManifest(manifest, kp.publicKey);
        expect(verification.valid).toBe(true);
      }
    });

    it('should include assertions in batch manifests', async () => {
      const kp = await generateKeyPair();
      const inputs = [
        makeManifestInput({
          contentHash: sha256String('with-assertions'),
          assertions: [makeCreativeWorkAssertion()],
        }),
        makeManifestInput({
          contentHash: sha256String('no-assertions'),
        }),
      ];

      const results = await createBatchManifests(inputs, kp);
      expect(results[0]!.assertions).toHaveLength(1);
      expect(results[1]!.assertions).toHaveLength(0);
    });
  });

  // ── verifyManifest ──────────────────────────────────────────────────

  describe('verifyManifest', () => {
    it('should verify a valid manifest', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);

      const result = await verifyManifest(manifest, kp.publicKey);
      expect(result.valid).toBe(true);
      expect(result.checks.every((c) => c.passed)).toBe(true);
    });

    it('should reject a manifest with tampered content hash', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);

      const tampered = { ...manifest, contentHash: sha256String('tampered') as HashHex };
      const result = await verifyManifest(tampered, kp.publicKey);
      expect(result.valid).toBe(false);
      expect(result.checks.find((c) => c.name === 'hash_integrity')?.passed).toBe(false);
    });

    it('should reject a manifest with wrong signer', async () => {
      const kp1 = await generateKeyPair();
      const kp2 = await generateKeyPair();
      const manifest = await makeManifest(kp1);

      const result = await verifyManifest(manifest, kp2.publicKey);
      expect(result.valid).toBe(false);
      expect(result.checks.find((c) => c.name === 'signature_valid')?.passed).toBe(false);
    });

    it('should reject a manifest with empty content hash', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, { contentHash: '' as HashHex });

      const result = await verifyManifest(manifest, kp.publicKey);
      expect(result.valid).toBe(false);
      expect(result.checks.find((c) => c.name === 'content_hash_present')?.passed).toBe(false);
    });

    it('should reject a manifest with empty merkle root', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, { merkleRoot: '' });

      const result = await verifyManifest(manifest, kp.publicKey);
      expect(result.valid).toBe(false);
      expect(result.checks.find((c) => c.name === 'merkle_root_present')?.passed).toBe(false);
    });

    it('should verify a manifest with assertions', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, {
        assertions: [makeCreativeWorkAssertion(), makeActionAssertion()],
      });

      const result = await verifyManifest(manifest, kp.publicKey);
      expect(result.valid).toBe(true);
    });
  });

  // ── Assertion types ─────────────────────────────────────────────────

  describe('assertion types', () => {
    it('should create a CreativeWorkAssertion', () => {
      const a = makeCreativeWorkAssertion();
      expect(a.type).toBe('creativeWork');
      expect(a.digitalSourceType).toBe('trainedAlgorithmicMedia');
      expect(a.authors).toEqual(['did:nobulex:agent1']);
    });

    it('should create an ActionAssertion', () => {
      const a = makeActionAssertion({ action: 'c2pa.edited', parameters: { tool: 'resize' } });
      expect(a.type).toBe('action');
      expect(a.action).toBe('c2pa.edited');
      expect(a.parameters).toEqual({ tool: 'resize' });
    });

    it('should create an IngredientAssertion', () => {
      const a = makeIngredientAssertion({ relationship: 'derivedFrom' });
      expect(a.type).toBe('ingredient');
      expect(a.relationship).toBe('derivedFrom');
    });

    it('should create a DataHashAssertion', () => {
      const a = makeDataHashAssertion({ algorithm: 'sha384' });
      expect(a.type).toBe('dataHash');
      expect(a.algorithm).toBe('sha384');
    });

    it('should create a DataProvenanceAssertion', () => {
      const a = makeDataProvenanceAssertionHelper();
      expect(a.type).toBe('dataProvenance');
      expect(a.sourceName).toBe('Wikipedia API');
      expect(a.sourceUri).toBe('https://en.wikipedia.org/api/rest_v1');
      expect(a.collectedBy).toBe('did:nobulex:agent1');
    });

    it('should create a DataProvenanceAssertion with all optional fields', () => {
      const a = makeDataProvenanceAssertionHelper({
        sourceHash: sha256String('source-data'),
        collectedAt: '2025-06-15T10:00:00.000Z',
        processingDescription: 'Extracted and summarized',
        license: 'CC-BY-4.0',
      });
      expect(a.sourceHash).toBeTruthy();
      expect(a.collectedAt).toBe('2025-06-15T10:00:00.000Z');
      expect(a.processingDescription).toBe('Extracted and summarized');
      expect(a.license).toBe('CC-BY-4.0');
    });

    it('should create a CustomAssertion', () => {
      const a = makeCustomAssertion({ label: 'domain.specific', data: { key: 'value' } });
      expect(a.type).toBe('custom');
      expect(a.label).toBe('domain.specific');
      expect(a.data).toEqual({ key: 'value' });
    });

    it('should create a DataHashAssertion with exclusions', () => {
      const a = makeDataHashAssertion({
        exclusions: [{ start: 0, length: 100 }, { start: 500, length: 50 }],
      });
      expect(a.exclusions).toHaveLength(2);
      expect(a.exclusions![0]!.start).toBe(0);
    });

    it('should include DataProvenanceAssertion in a manifest', async () => {
      const kp = await generateKeyPair();
      const dpAssertion = makeDataProvenanceAssertionHelper({
        sourceHash: sha256String('raw-data'),
        collectedAt: '2025-06-15T10:00:00.000Z',
        license: 'MIT',
      });
      const manifest = await makeManifest(kp, {
        assertions: [dpAssertion],
      });

      expect(manifest.assertions).toHaveLength(1);
      expect(manifest.assertions[0]!.type).toBe('dataProvenance');
      const dp = manifest.assertions[0] as DataProvenanceAssertion;
      expect(dp.sourceName).toBe('Wikipedia API');
      expect(dp.license).toBe('MIT');
    });
  });

  // ── assertionFromEvidence ─────────────────────────────────────────

  describe('assertionFromEvidence', () => {
    it('should create an ActionAssertion from an evidence item', () => {
      const item = makeMockEvidenceItem();
      const assertion = assertionFromEvidence(item);

      expect(assertion.type).toBe('action');
      expect(assertion.action).toBe('tool_call');
      expect(assertion.softwareAgent).toBe('did:nobulex:agent1/claude-opus-4-20250514');
      expect(assertion.when).toBe('2025-06-15T10:00:00.000Z');
    });

    it('should include tool and hash details in parameters', () => {
      const item = makeMockEvidenceItem();
      const assertion = assertionFromEvidence(item);

      expect(assertion.parameters).toBeDefined();
      expect(assertion.parameters!['toolName']).toBe('web_search');
      expect(assertion.parameters!['inputHash']).toBe(item.inputHash);
      expect(assertion.parameters!['outputHash']).toBe(item.outputHash);
    });

    it('should handle different action types', () => {
      const item = makeMockEvidenceItem({ actionType: 'delegation' });
      const assertion = assertionFromEvidence(item);
      expect(assertion.action).toBe('delegation');
    });

    it('should use the evidence item timestamp as when', () => {
      const ts = '2025-12-25T00:00:00.000Z';
      const item = makeMockEvidenceItem({ timestamp: ts });
      const assertion = assertionFromEvidence(item);
      expect(assertion.when).toBe(ts);
    });
  });

  // ── creativeWorkAssertion helper ──────────────────────────────────

  describe('creativeWorkAssertion helper', () => {
    it('should create a CreativeWorkAssertion with required fields', () => {
      const a = creativeWorkAssertion('trainedAlgorithmicMedia');
      expect(a.type).toBe('creativeWork');
      expect(a.digitalSourceType).toBe('trainedAlgorithmicMedia');
    });

    it('should include optional authors', () => {
      const a = creativeWorkAssertion('humanCreated', ['author1', 'author2']);
      expect(a.authors).toEqual(['author1', 'author2']);
    });

    it('should include optional dateCreated', () => {
      const date = '2025-06-15T10:00:00.000Z';
      const a = creativeWorkAssertion('composite', undefined, date);
      expect(a.dateCreated).toBe(date);
    });
  });

  // ── dataProvenanceAssertion helper ────────────────────────────────

  describe('dataProvenanceAssertion helper', () => {
    it('should create a DataProvenanceAssertion with just a source name', () => {
      const a = dataProvenanceAssertion('PubMed');
      expect(a.type).toBe('dataProvenance');
      expect(a.sourceName).toBe('PubMed');
    });

    it('should include all optional fields', () => {
      const a = dataProvenanceAssertion('NOAA Weather API', {
        sourceUri: 'https://api.weather.gov',
        sourceHash: sha256String('weather-data'),
        collectedAt: '2025-06-15T12:00:00.000Z',
        collectedBy: 'did:nobulex:weather-agent',
        processingDescription: 'Fetched and normalized temperature readings',
        license: 'Public Domain',
      });

      expect(a.sourceName).toBe('NOAA Weather API');
      expect(a.sourceUri).toBe('https://api.weather.gov');
      expect(a.sourceHash).toBeTruthy();
      expect(a.collectedAt).toBe('2025-06-15T12:00:00.000Z');
      expect(a.collectedBy).toBe('did:nobulex:weather-agent');
      expect(a.processingDescription).toContain('normalized');
      expect(a.license).toBe('Public Domain');
    });
  });

  // ── addAssertion ────────────────────────────────────────────────────

  describe('addAssertion', () => {
    it('should add an assertion and re-sign the manifest', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);
      expect(manifest.assertions).toHaveLength(0);

      const updated = await addAssertion(manifest, makeCreativeWorkAssertion(), kp);
      expect(updated.assertions).toHaveLength(1);
      expect(updated.assertions[0]!.type).toBe('creativeWork');
      expect(updated.hash).not.toBe(manifest.hash);
      expect(updated.signature).not.toBe(manifest.signature);
    });

    it('should preserve the manifest ID when adding assertions', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);
      const updated = await addAssertion(manifest, makeActionAssertion(), kp);

      expect(updated.id).toBe(manifest.id);
    });

    it('should verify the updated manifest after adding an assertion', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);
      const updated = await addAssertion(manifest, makeIngredientAssertion(), kp);

      const result = await verifyManifest(updated, kp.publicKey);
      expect(result.valid).toBe(true);
    });

    it('should append multiple assertions sequentially', async () => {
      const kp = await generateKeyPair();
      let manifest = await makeManifest(kp);

      manifest = await addAssertion(manifest, makeCreativeWorkAssertion(), kp);
      manifest = await addAssertion(manifest, makeActionAssertion(), kp);
      manifest = await addAssertion(manifest, makeDataHashAssertion(), kp);

      expect(manifest.assertions).toHaveLength(3);
      expect(manifest.assertions[0]!.type).toBe('creativeWork');
      expect(manifest.assertions[1]!.type).toBe('action');
      expect(manifest.assertions[2]!.type).toBe('dataHash');

      const result = await verifyManifest(manifest, kp.publicKey);
      expect(result.valid).toBe(true);
    });

    it('should add a DataProvenanceAssertion to a manifest', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);
      const dpAssertion = dataProvenanceAssertion('Census Data', {
        license: 'Public Domain',
        collectedAt: '2025-01-01T00:00:00.000Z',
      });

      const updated = await addAssertion(manifest, dpAssertion, kp);
      expect(updated.assertions).toHaveLength(1);
      expect(updated.assertions[0]!.type).toBe('dataProvenance');

      const result = await verifyManifest(updated, kp.publicKey);
      expect(result.valid).toBe(true);
    });
  });

  // ── validateManifest ────────────────────────────────────────────────

  describe('validateManifest', () => {
    it('should validate a well-formed manifest', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);

      const report = validateManifest(manifest);
      expect(report.valid).toBe(true);
      expect(report.results.length).toBeGreaterThan(0);
      expect(report.results.every((r) => r.valid)).toBe(true);
    });

    it('should detect invalid DID format', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, { agentDid: 'not-a-did' });

      const report = validateManifest(manifest);
      const didResult = report.results.find((r) => r.field === 'agentDid');
      expect(didResult?.valid).toBe(false);
    });

    it('should detect invalid content hash format', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, { contentHash: 'not-a-hash' as HashHex });

      const report = validateManifest(manifest);
      const hashResult = report.results.find((r) => r.field === 'contentHash');
      expect(hashResult?.valid).toBe(false);
    });

    it('should detect invalid content type', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, { contentType: 'invalid' });

      const report = validateManifest(manifest);
      const ctResult = report.results.find((r) => r.field === 'contentType');
      expect(ctResult?.valid).toBe(false);
    });

    it('should validate assertions within the manifest', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, {
        assertions: [makeCreativeWorkAssertion(), makeActionAssertion()],
      });

      const report = validateManifest(manifest);
      const assertionResults = report.results.filter((r) => r.field.startsWith('assertions['));
      expect(assertionResults.length).toBeGreaterThan(0);
      expect(assertionResults.every((r) => r.valid)).toBe(true);
    });

    it('should validate transparency pointer fields', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, {
        transparencyPointer: {
          logId: 'nobulex-prod',
          entryIndex: 10,
          entryHash: sha256String('entry'),
        },
      });

      const report = validateManifest(manifest);
      const tpResults = report.results.filter((r) => r.field.startsWith('transparencyPointer.'));
      expect(tpResults.length).toBeGreaterThan(0);
      expect(tpResults.every((r) => r.valid)).toBe(true);
    });

    it('should detect empty merkle root', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, { merkleRoot: '' });

      const report = validateManifest(manifest);
      const mrResult = report.results.find((r) => r.field === 'merkleRoot');
      expect(mrResult?.valid).toBe(false);
    });

    it('should validate input references', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, {
        inputs: [
          { contentHash: sha256String('data'), relationship: 'inputTo' },
          { contentHash: sha256String('data2'), relationship: 'derivedFrom' },
        ],
      });

      const report = validateManifest(manifest);
      const inputResults = report.results.filter((r) => r.field.startsWith('inputs['));
      expect(inputResults.every((r) => r.valid)).toBe(true);
    });

    it('should validate DataProvenanceAssertion structure', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, {
        assertions: [makeDataProvenanceAssertionHelper({
          collectedAt: '2025-06-15T10:00:00.000Z',
        })],
      });

      const report = validateManifest(manifest);
      const dpResults = report.results.filter((r) => r.field.startsWith('assertions[0]'));
      expect(dpResults.every((r) => r.valid)).toBe(true);
    });

    it('should detect invalid collectedAt in DataProvenanceAssertion', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, {
        assertions: [{
          type: 'dataProvenance' as const,
          sourceName: 'test',
          collectedAt: 'not-a-date',
        }],
      });

      const report = validateManifest(manifest);
      const collectedAtResult = report.results.find((r) => r.field === 'assertions[0].collectedAt');
      expect(collectedAtResult?.valid).toBe(false);
    });
  });

  // ── verifyManifestChain ─────────────────────────────────────────────

  describe('verifyManifestChain', () => {
    it('should verify an empty chain', () => {
      const result = verifyManifestChain([]);
      expect(result.valid).toBe(true);
      expect(result.chain).toHaveLength(0);
    });

    it('should verify a single manifest chain', async () => {
      const kp = await generateKeyPair();
      const m = await makeManifest(kp);

      const result = verifyManifestChain([m]);
      expect(result.valid).toBe(true);
      expect(result.chain).toHaveLength(1);
    });

    it('should verify a linked chain of manifests', async () => {
      const kp = await generateKeyPair();
      const m1 = await makeManifest(kp, {
        contentHash: sha256String('content-1'),
      });

      const m2 = await makeManifest(kp, {
        contentHash: sha256String('content-2'),
        inputs: [
          { contentHash: m1.contentHash, manifestId: m1.id, relationship: 'inputTo' },
        ],
      });

      const result = verifyManifestChain([m1, m2]);
      expect(result.valid).toBe(true);
      expect(result.chain).toHaveLength(2);
      expect(result.gaps).toHaveLength(0);
      expect(result.cycles).toHaveLength(0);
    });

    it('should detect gaps in the chain', async () => {
      const kp = await generateKeyPair();
      const m1 = await makeManifest(kp, {
        inputs: [
          { contentHash: sha256String('unknown'), manifestId: 'nonexistent-id', relationship: 'inputTo' },
        ],
      });

      const result = verifyManifestChain([m1]);
      expect(result.gaps).toHaveLength(1);
      expect(result.gaps[0]).toContain('nonexistent-id');
    });

    it('should detect duplicate manifest IDs', async () => {
      const kp = await generateKeyPair();
      const m1 = await makeManifest(kp);
      // Create a "duplicate" by reusing the same object
      const result = verifyManifestChain([m1, m1]);
      expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true);
    });

    it('should detect temporal ordering violations', async () => {
      const kp = await generateKeyPair();
      // Create both manifests then override timestamps to force temporal violation
      const m1 = await makeManifest(kp, {
        contentHash: sha256String('content-1'),
      });
      const m2 = await makeManifest(kp, {
        contentHash: sha256String('content-2'),
      });

      // m2 references m1 as input, but give m2 an earlier timestamp
      const m2WithRef: ProvenanceManifest = {
        ...m2,
        createdAt: '2020-01-01T00:00:00.000Z',
        inputs: [
          { contentHash: m1.contentHash, manifestId: m1.id, relationship: 'inputTo' },
        ],
      };

      const result = verifyManifestChain([m1, m2WithRef]);
      // m2WithRef has timestamp 2020, but references m1 which has a 2026 timestamp
      // This is a temporal violation: m2 was "created before" its input m1
      expect(result.errors.some((e) => e.includes('created before'))).toBe(true);
    });

    it('should build a chain graph with correct nodes', async () => {
      const kp = await generateKeyPair();
      const m1 = await makeManifest(kp, { contentHash: sha256String('a') });
      const m2 = await makeManifest(kp, {
        contentHash: sha256String('b'),
        inputs: [{ contentHash: m1.contentHash, manifestId: m1.id, relationship: 'derivedFrom' }],
      });
      const m3 = await makeManifest(kp, {
        contentHash: sha256String('c'),
        inputs: [{ contentHash: m2.contentHash, manifestId: m2.id, relationship: 'derivedFrom' }],
      });

      const result = verifyManifestChain([m1, m2, m3]);
      expect(result.chain).toHaveLength(3);
      expect(result.chain[2]!.inputManifestIds).toContain(m2.id);
      expect(result.chain[1]!.inputManifestIds).toContain(m1.id);
    });
  });

  // ── JSON Embedding ──────────────────────────────────────────────────

  describe('JSON embedding', () => {
    it('should embed a manifest into a JSON object', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);
      const data = { title: 'Test document', body: 'Hello world' };

      const embedded = embedManifestInJSON(data, manifest);
      expect(embedded.title).toBe('Test document');
      expect(embedded.body).toBe('Hello world');
      expect(embedded._c2pa).toBeDefined();
      expect(embedded._c2pa.id).toBe(manifest.id);
    });

    it('should extract a manifest from a JSON object', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);
      const data = { title: 'Test', body: 'Content' };

      const embedded = embedManifestInJSON(data, manifest);
      const extracted = extractManifestFromJSON(embedded);

      expect(extracted).not.toBeNull();
      expect(extracted!.id).toBe(manifest.id);
      expect(extracted!.contentHash).toBe(manifest.contentHash);
      expect(extracted!.agentDid).toBe(manifest.agentDid);
    });

    it('should return null when no manifest is embedded', () => {
      const data = { title: 'No manifest here' };
      const extracted = extractManifestFromJSON(data);
      expect(extracted).toBeNull();
    });

    it('should not mutate the original object during embedding', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);
      const data = { title: 'Original' };

      embedManifestInJSON(data, manifest);
      expect((data as Record<string, unknown>)['_c2pa']).toBeUndefined();
    });

    it('should round-trip manifest through JSON embedding', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, {
        assertions: [makeCreativeWorkAssertion()],
        inputs: [{ contentHash: sha256String('x'), relationship: 'inputTo' }],
      });

      const data = { result: 'analysis complete' };
      const embedded = embedManifestInJSON(data, manifest);
      const extracted = extractManifestFromJSON(embedded);

      expect(extracted).not.toBeNull();
      expect(extracted!.assertions).toHaveLength(1);
      expect(extracted!.inputs).toHaveLength(1);
    });
  });

  // ── Binary Embedding ────────────────────────────────────────────────

  describe('binary embedding', () => {
    it('should embed and extract a manifest from a binary buffer', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);
      const original = new TextEncoder().encode('This is the original content');

      const embedded = embedManifestInBinary(original, manifest);
      expect(embedded.length).toBeGreaterThan(original.length);

      const result = extractManifestFromBinary(embedded);
      expect(result).not.toBeNull();
      expect(result!.manifest.id).toBe(manifest.id);
      expect(result!.manifest.contentHash).toBe(manifest.contentHash);
    });

    it('should recover the original buffer', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);
      const original = new Uint8Array([1, 2, 3, 4, 5, 255, 254, 253]);

      const embedded = embedManifestInBinary(original, manifest);
      const result = extractManifestFromBinary(embedded);

      expect(result).not.toBeNull();
      expect(result!.originalBuffer).toEqual(original);
    });

    it('should return null for a buffer without a manifest', () => {
      const buffer = new TextEncoder().encode('no manifest here');
      const result = extractManifestFromBinary(buffer);
      expect(result).toBeNull();
    });

    it('should return null for a buffer that is too short', () => {
      const buffer = new Uint8Array([1, 2, 3]);
      const result = extractManifestFromBinary(buffer);
      expect(result).toBeNull();
    });
  });

  // ── ManifestStore ───────────────────────────────────────────────────

  describe('ManifestStore', () => {
    let store: ManifestStore;
    let kp: KeyPair;

    beforeEach(async () => {
      store = new ManifestStore();
      kp = await generateKeyPair();
    });

    it('should add and retrieve a manifest by ID', async () => {
      const m = await makeManifest(kp);
      store.add(m);

      const retrieved = store.get(m.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(m.id);
    });

    it('should return undefined for unknown ID', () => {
      expect(store.get('nonexistent')).toBeUndefined();
    });

    it('should list all manifests', async () => {
      const m1 = await makeManifest(kp, { contentHash: sha256String('a') });
      const m2 = await makeManifest(kp, { contentHash: sha256String('b') });

      store.add(m1);
      store.add(m2);

      const all = store.list();
      expect(all).toHaveLength(2);
    });

    it('should retrieve by content hash', async () => {
      const hash = sha256String('specific-content');
      const m = await makeManifest(kp, { contentHash: hash });
      store.add(m);

      const results = store.getByContentHash(hash);
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(m.id);
    });

    it('should return empty array for unknown content hash', () => {
      expect(store.getByContentHash('0000' as HashHex)).toHaveLength(0);
    });

    it('should retrieve by agent DID', async () => {
      const m1 = await makeManifest(kp, {
        agentDid: 'did:nobulex:agent-alpha',
        contentHash: sha256String('c1'),
      });
      const m2 = await makeManifest(kp, {
        agentDid: 'did:nobulex:agent-alpha',
        contentHash: sha256String('c2'),
      });
      const m3 = await makeManifest(kp, {
        agentDid: 'did:nobulex:agent-beta',
        contentHash: sha256String('c3'),
      });

      store.add(m1);
      store.add(m2);
      store.add(m3);

      expect(store.getByAgent('did:nobulex:agent-alpha')).toHaveLength(2);
      expect(store.getByAgent('did:nobulex:agent-beta')).toHaveLength(1);
      expect(store.getByAgent('did:nobulex:agent-gamma')).toHaveLength(0);
    });

    it('should remove a manifest', async () => {
      const m = await makeManifest(kp);
      store.add(m);
      expect(store.size).toBe(1);

      const removed = store.remove(m.id);
      expect(removed).toBe(true);
      expect(store.size).toBe(0);
      expect(store.get(m.id)).toBeUndefined();
    });

    it('should return false when removing nonexistent manifest', () => {
      expect(store.remove('nonexistent')).toBe(false);
    });

    it('should clean up indexes when removing', async () => {
      const m = await makeManifest(kp);
      store.add(m);
      store.remove(m.id);

      expect(store.getByContentHash(m.contentHash)).toHaveLength(0);
      expect(store.getByAgent(m.agentDid)).toHaveLength(0);
    });

    it('should track store size', async () => {
      expect(store.size).toBe(0);

      const m1 = await makeManifest(kp, { contentHash: sha256String('x') });
      const m2 = await makeManifest(kp, { contentHash: sha256String('y') });
      store.add(m1);
      expect(store.size).toBe(1);
      store.add(m2);
      expect(store.size).toBe(2);
      store.remove(m1.id);
      expect(store.size).toBe(1);
    });

    it('should get provenance chain for a manifest', async () => {
      // Build a three-step chain: root -> intermediate -> final
      const root = await makeManifest(kp, {
        contentHash: sha256String('root-content'),
      });

      const intermediate = await makeManifest(kp, {
        contentHash: sha256String('intermediate-content'),
        inputs: [
          { contentHash: root.contentHash, manifestId: root.id, relationship: 'inputTo' },
        ],
      });

      const final = await makeManifest(kp, {
        contentHash: sha256String('final-content'),
        inputs: [
          { contentHash: intermediate.contentHash, manifestId: intermediate.id, relationship: 'derivedFrom' },
        ],
      });

      store.add(root);
      store.add(intermediate);
      store.add(final);

      const chain = store.getChainFor(final.id);
      expect(chain).toHaveLength(3);
      // Chain should be root -> intermediate -> final
      expect(chain[0]!.id).toBe(root.id);
      expect(chain[1]!.id).toBe(intermediate.id);
      expect(chain[2]!.id).toBe(final.id);
    });

    it('should return empty chain for unknown manifest', () => {
      expect(store.getChainFor('unknown')).toHaveLength(0);
    });
  });

  // ── ManifestStore.query ───────────────────────────────────────────

  describe('ManifestStore.query', () => {
    let store: ManifestStore;
    let kp: KeyPair;

    beforeEach(async () => {
      store = new ManifestStore();
      kp = await generateKeyPair();
    });

    it('should return all manifests with empty query', async () => {
      const m1 = await makeManifest(kp, { contentHash: sha256String('q1') });
      const m2 = await makeManifest(kp, { contentHash: sha256String('q2') });
      store.add(m1);
      store.add(m2);

      const results = store.query({});
      expect(results).toHaveLength(2);
    });

    it('should filter by agentDid', async () => {
      const m1 = await makeManifest(kp, {
        agentDid: 'did:nobulex:alpha',
        contentHash: sha256String('qa1'),
      });
      const m2 = await makeManifest(kp, {
        agentDid: 'did:nobulex:beta',
        contentHash: sha256String('qa2'),
      });
      store.add(m1);
      store.add(m2);

      const results = store.query({ agentDid: 'did:nobulex:alpha' });
      expect(results).toHaveLength(1);
      expect(results[0]!.agentDid).toBe('did:nobulex:alpha');
    });

    it('should filter by digitalSourceType', async () => {
      const m1 = await makeManifest(kp, {
        digitalSourceType: 'humanCreated',
        contentHash: sha256String('qd1'),
      });
      const m2 = await makeManifest(kp, {
        digitalSourceType: 'trainedAlgorithmicMedia',
        contentHash: sha256String('qd2'),
      });
      store.add(m1);
      store.add(m2);

      const results = store.query({ digitalSourceType: 'humanCreated' });
      expect(results).toHaveLength(1);
      expect(results[0]!.digitalSourceType).toBe('humanCreated');
    });

    it('should filter by contentType', async () => {
      const m1 = await makeManifest(kp, {
        contentType: 'text/plain',
        contentHash: sha256String('qc1'),
      });
      const m2 = await makeManifest(kp, {
        contentType: 'application/json',
        contentHash: sha256String('qc2'),
      });
      store.add(m1);
      store.add(m2);

      const results = store.query({ contentType: 'application/json' });
      expect(results).toHaveLength(1);
      expect(results[0]!.contentType).toBe('application/json');
    });

    it('should filter by hasInputs', async () => {
      const m1 = await makeManifest(kp, {
        contentHash: sha256String('qi1'),
        inputs: [{ contentHash: sha256String('in'), relationship: 'inputTo' }],
      });
      const m2 = await makeManifest(kp, {
        contentHash: sha256String('qi2'),
        inputs: [],
      });
      store.add(m1);
      store.add(m2);

      const withInputs = store.query({ hasInputs: true });
      expect(withInputs).toHaveLength(1);
      expect(withInputs[0]!.inputs.length).toBeGreaterThan(0);

      const withoutInputs = store.query({ hasInputs: false });
      expect(withoutInputs).toHaveLength(1);
      expect(withoutInputs[0]!.inputs.length).toBe(0);
    });

    it('should filter by assertionType', async () => {
      const m1 = await makeManifest(kp, {
        contentHash: sha256String('qat1'),
        assertions: [makeCreativeWorkAssertion()],
      });
      const m2 = await makeManifest(kp, {
        contentHash: sha256String('qat2'),
        assertions: [makeActionAssertion()],
      });
      const m3 = await makeManifest(kp, {
        contentHash: sha256String('qat3'),
      });
      store.add(m1);
      store.add(m2);
      store.add(m3);

      const results = store.query({ assertionType: 'creativeWork' });
      expect(results).toHaveLength(1);
      expect(results[0]!.assertions[0]!.type).toBe('creativeWork');
    });

    it('should apply limit', async () => {
      for (let i = 0; i < 5; i++) {
        store.add(await makeManifest(kp, { contentHash: sha256String(`ql${i}`) }));
      }

      const results = store.query({ limit: 3 });
      expect(results).toHaveLength(3);
    });

    it('should combine multiple filters with AND logic', async () => {
      const m1 = await makeManifest(kp, {
        agentDid: 'did:nobulex:multi',
        contentType: 'text/plain',
        contentHash: sha256String('qm1'),
        assertions: [makeCreativeWorkAssertion()],
      });
      const m2 = await makeManifest(kp, {
        agentDid: 'did:nobulex:multi',
        contentType: 'application/json',
        contentHash: sha256String('qm2'),
      });
      const m3 = await makeManifest(kp, {
        agentDid: 'did:nobulex:other',
        contentType: 'text/plain',
        contentHash: sha256String('qm3'),
      });
      store.add(m1);
      store.add(m2);
      store.add(m3);

      const results = store.query({
        agentDid: 'did:nobulex:multi',
        contentType: 'text/plain',
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(m1.id);
    });

    it('should return empty for no matches', async () => {
      store.add(await makeManifest(kp, { contentHash: sha256String('qnm') }));

      const results = store.query({ agentDid: 'did:nobulex:nonexistent' });
      expect(results).toHaveLength(0);
    });

    it('should filter by modelVersion', async () => {
      const m1 = await makeManifest(kp, {
        modelVersion: 'gpt-4o',
        contentHash: sha256String('qmv1'),
      });
      const m2 = await makeManifest(kp, {
        modelVersion: 'claude-opus-4-20250514',
        contentHash: sha256String('qmv2'),
      });
      store.add(m1);
      store.add(m2);

      const results = store.query({ modelVersion: 'gpt-4o' });
      expect(results).toHaveLength(1);
      expect(results[0]!.modelVersion).toBe('gpt-4o');
    });
  });

  // ── diffManifests ───────────────────────────────────────────────────

  describe('diffManifests', () => {
    it('should detect identical manifests', async () => {
      const kp = await generateKeyPair();
      const m = await makeManifest(kp);

      const diff = diffManifests(m, m);
      expect(diff.identical).toBe(true);
      expect(diff.fieldsChanged).toHaveLength(0);
    });

    it('should detect content hash change', async () => {
      const kp = await generateKeyPair();
      const m1 = await makeManifest(kp, { contentHash: sha256String('v1') });
      const m2 = await makeManifest(kp, { contentHash: sha256String('v2') });

      const diff = diffManifests(m1, m2);
      expect(diff.identical).toBe(false);
      expect(diff.fieldsChanged.some((f) => f.field === 'contentHash')).toBe(true);
    });

    it('should detect digital source type change', async () => {
      const kp = await generateKeyPair();
      const m1 = await makeManifest(kp, { digitalSourceType: 'humanCreated' });
      const m2 = await makeManifest(kp, { digitalSourceType: 'trainedAlgorithmicMedia' });

      const diff = diffManifests(m1, m2);
      const sourceChange = diff.fieldsChanged.find((f) => f.field === 'digitalSourceType');
      expect(sourceChange).toBeDefined();
      expect(sourceChange!.oldValue).toBe('humanCreated');
      expect(sourceChange!.newValue).toBe('trainedAlgorithmicMedia');
    });

    it('should detect assertion changes', async () => {
      const kp = await generateKeyPair();
      const m1 = await makeManifest(kp, { assertions: [] });
      const m2 = await makeManifest(kp, { assertions: [makeCreativeWorkAssertion()] });

      const diff = diffManifests(m1, m2);
      expect(diff.fieldsChanged.some((f) => f.field === 'assertions')).toBe(true);
    });

    it('should detect input changes', async () => {
      const kp = await generateKeyPair();
      const m1 = await makeManifest(kp, { inputs: [] });
      const m2 = await makeManifest(kp, {
        inputs: [{ contentHash: sha256String('input'), relationship: 'inputTo' as const }],
      });

      const diff = diffManifests(m1, m2);
      expect(diff.fieldsChanged.some((f) => f.field === 'inputs')).toBe(true);
    });

    it('should detect transparency pointer changes', async () => {
      const kp = await generateKeyPair();
      const m1 = await makeManifest(kp);
      const m2 = await makeManifest(kp, {
        transparencyPointer: {
          logId: 'log-1',
          entryIndex: 5,
          entryHash: sha256String('entry'),
        },
      });

      const diff = diffManifests(m1, m2);
      expect(diff.fieldsChanged.some((f) => f.field === 'transparencyPointer')).toBe(true);
    });
  });

  // ── summarizeManifest ───────────────────────────────────────────────

  describe('summarizeManifest', () => {
    it('should produce a human-readable summary', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);

      const summary = summarizeManifest(manifest);
      expect(summary.id).toBe(manifest.id);
      expect(summary.agent).toBe('did:nobulex:agent1');
      expect(summary.sourceType).toContain('AI-generated');
      expect(summary.contentType).toBe('text/plain');
      expect(summary.inputCount).toBe(0);
      expect(summary.assertionCount).toBe(0);
      expect(summary.hasTransparencyPointer).toBe(false);
      expect(summary.summary).toBeTruthy();
    });

    it('should include input count in summary', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, {
        inputs: [
          { contentHash: sha256String('a'), relationship: 'inputTo' },
          { contentHash: sha256String('b'), relationship: 'inputTo' },
        ],
      });

      const summary = summarizeManifest(manifest);
      expect(summary.inputCount).toBe(2);
      expect(summary.summary).toContain('2 input(s)');
    });

    it('should label human-created content correctly', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, { digitalSourceType: 'humanCreated' });

      const summary = summarizeManifest(manifest);
      expect(summary.sourceType).toContain('Human-created');
    });
  });

  // ── manifestStats ──────────────────────────────────────────────────

  describe('manifestStats', () => {
    it('should return empty stats for empty array', () => {
      const stats = manifestStats([]);
      expect(stats.totalManifests).toBe(0);
      expect(stats.uniqueAgents).toHaveLength(0);
      expect(stats.earliestCreatedAt).toBeNull();
      expect(stats.latestCreatedAt).toBeNull();
    });

    it('should compute stats for multiple manifests', async () => {
      const kp = await generateKeyPair();
      const m1 = await makeManifest(kp, {
        agentDid: 'did:nobulex:a1',
        contentHash: sha256String('c1'),
        contentType: 'text/plain',
        assertions: [makeCreativeWorkAssertion()],
      });
      const m2 = await makeManifest(kp, {
        agentDid: 'did:nobulex:a2',
        contentHash: sha256String('c2'),
        contentType: 'application/json',
        digitalSourceType: 'humanCreated',
        assertions: [makeActionAssertion(), makeDataHashAssertion()],
      });
      const m3 = await makeManifest(kp, {
        agentDid: 'did:nobulex:a1',
        contentHash: sha256String('c3'),
        contentType: 'text/plain',
      });

      const stats = manifestStats([m1, m2, m3]);
      expect(stats.totalManifests).toBe(3);
      expect(stats.uniqueAgents).toHaveLength(2);
      expect(stats.uniqueAgents).toContain('did:nobulex:a1');
      expect(stats.uniqueAgents).toContain('did:nobulex:a2');
      expect(stats.sourceTypeDistribution['trainedAlgorithmicMedia']).toBe(2);
      expect(stats.sourceTypeDistribution['humanCreated']).toBe(1);
    });
  });

  // ── generateClaim ──────────────────────────────────────────────────

  describe('generateClaim', () => {
    it('should generate a C2PA claim from a manifest', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, {
        assertions: [makeCreativeWorkAssertion()],
        inputs: [{ contentHash: sha256String('input'), relationship: 'inputTo', description: 'Prompt' }],
      });

      const claim = generateClaim(manifest);
      expect(claim.claimGenerator).toBe(manifest.claimGenerator);
      expect(claim.dc_format).toBe(manifest.contentType);
      expect(claim.instanceId).toBe(manifest.id);
      expect(claim.signature).toBe(manifest.signature);
      expect(claim.createdAt).toBe(manifest.createdAt);
    });

    it('should include assertion references in claim', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp, {
        assertions: [makeCreativeWorkAssertion(), makeActionAssertion()],
      });

      const claim = generateClaim(manifest);
      expect(claim.assertions).toHaveLength(2);
      expect(claim.assertions[0]!.url).toContain('creativeWork');
      expect(claim.assertions[1]!.url).toContain('action');
    });

    it('should include content bindings', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);

      const claim = generateClaim(manifest);
      expect(claim.contentBindings.length).toBeGreaterThanOrEqual(1);
      expect(claim.contentBindings[0]!.algorithm).toBe('sha256');
      expect(claim.contentBindings[0]!.hash).toBe(manifest.contentHash);
    });

    it('should include claim generator info', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);

      const claim = generateClaim(manifest);
      expect(claim.claimGeneratorInfo).toBeDefined();
      expect(claim.claimGeneratorInfo![0]!.name).toBe('Nobulex');
    });
  });

  // ── Convenience helpers ─────────────────────────────────────────────

  describe('helpers', () => {
    it('inputFromEvidence should create an input reference', () => {
      const item = {
        inputHash: sha256String('input'),
      } as unknown as EvidenceItem;

      const ref = inputFromEvidence(item);
      expect(ref.contentHash).toBe(item.inputHash);
      expect(ref.relationship).toBe('inputTo');
    });

    it('inputFromEvidence should accept custom relationship', () => {
      const item = {
        inputHash: sha256String('input'),
      } as unknown as EvidenceItem;

      const ref = inputFromEvidence(item, 'derivedFrom');
      expect(ref.relationship).toBe('derivedFrom');
    });

    it('hashContent should hash a string', () => {
      const hash = hashContent('test content');
      expect(hash).toBeTruthy();
      expect(hash).toBe(sha256String('test content'));
    });

    it('hashContent should produce consistent hashes', () => {
      expect(hashContent('abc')).toBe(hashContent('abc'));
      expect(hashContent('abc')).not.toBe(hashContent('def'));
    });

    it('serializeManifest should produce deterministic JSON', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);
      const json = serializeManifest(manifest);
      expect(json).toBe(serializeManifest(manifest));
    });

    it('serializeManifest should produce valid JSON', async () => {
      const kp = await generateKeyPair();
      const manifest = await makeManifest(kp);
      const json = serializeManifest(manifest);
      const parsed = JSON.parse(json);
      expect(parsed.id).toBe(manifest.id);
    });
  });

  // ── Integration: end-to-end workflow ────────────────────────────────

  describe('integration', () => {
    it('should support full provenance workflow: create, assert, embed, extract, verify', async () => {
      const kp = await generateKeyPair();

      // Step 1: Create manifest
      let manifest = await makeManifest(kp, {
        contentType: 'application/json',
        assertions: [makeCreativeWorkAssertion()],
      });

      // Step 2: Add more assertions including data provenance
      manifest = await addAssertion(manifest, makeActionAssertion({ action: 'c2pa.created' }), kp);
      manifest = await addAssertion(manifest, makeDataHashAssertion(), kp);
      manifest = await addAssertion(manifest, dataProvenanceAssertion('Wikipedia'), kp);

      // Step 3: Validate
      const report = validateManifest(manifest);
      expect(report.valid).toBe(true);

      // Step 4: Verify signature
      const verification = await verifyManifest(manifest, kp.publicKey);
      expect(verification.valid).toBe(true);

      // Step 5: Embed in JSON
      const data = { result: 'AI analysis output' };
      const embedded = embedManifestInJSON(data, manifest);
      const extracted = extractManifestFromJSON(embedded);
      expect(extracted).not.toBeNull();
      expect(extracted!.id).toBe(manifest.id);

      // Step 6: Embed in binary
      const binaryData = new TextEncoder().encode(JSON.stringify(data));
      const binaryEmbedded = embedManifestInBinary(binaryData, manifest);
      const binaryResult = extractManifestFromBinary(binaryEmbedded);
      expect(binaryResult).not.toBeNull();
      expect(binaryResult!.manifest.id).toBe(manifest.id);

      // Step 7: Generate claim
      const claim = generateClaim(manifest);
      expect(claim.assertions).toHaveLength(4);

      // Step 8: Summarize
      const summary = summarizeManifest(manifest);
      expect(summary.assertionCount).toBe(4);
    });

    it('should support multi-agent provenance chain with store and query', async () => {
      const kp1 = await generateKeyPair();
      const kp2 = await generateKeyPair();
      const store = new ManifestStore();

      // Agent 1 creates initial output
      const m1 = await createManifest(
        makeManifestInput({
          agentDid: 'did:nobulex:researcher',
          contentHash: sha256String('research findings'),
          contentType: 'text/markdown',
          assertions: [
            makeCreativeWorkAssertion({ digitalSourceType: 'trainedAlgorithmicMedia' }),
          ],
        }),
        kp1,
      );
      store.add(m1);

      // Agent 2 uses agent 1's output
      const m2 = await createManifest(
        makeManifestInput({
          agentDid: 'did:nobulex:analyst',
          contentHash: sha256String('analysis report'),
          contentType: 'application/pdf',
          inputs: [
            { contentHash: m1.contentHash, manifestId: m1.id, relationship: 'inputTo' },
          ],
          assertions: [
            makeActionAssertion({ action: 'c2pa.created', softwareAgent: 'analyst-agent/1.0' }),
          ],
        }),
        kp2,
      );
      store.add(m2);

      // Verify the chain
      const chainResult = verifyManifestChain(store.list());
      expect(chainResult.valid).toBe(true);

      // Get chain for m2
      const chain = store.getChainFor(m2.id);
      expect(chain).toHaveLength(2);
      expect(chain[0]!.id).toBe(m1.id);
      expect(chain[1]!.id).toBe(m2.id);

      // Query by agent
      const researcherManifests = store.query({ agentDid: 'did:nobulex:researcher' });
      expect(researcherManifests).toHaveLength(1);

      // Query with inputs
      const withInputs = store.query({ hasInputs: true });
      expect(withInputs).toHaveLength(1);
      expect(withInputs[0]!.id).toBe(m2.id);

      // Stats
      const stats = manifestStats(store.list());
      expect(stats.totalManifests).toBe(2);
      expect(stats.uniqueAgents).toHaveLength(2);

      // Diff between versions
      const diff = diffManifests(m1, m2);
      expect(diff.identical).toBe(false);
      expect(diff.fieldsChanged.some((f) => f.field === 'contentHash')).toBe(true);
    });

    it('should support batch creation with evidence-derived assertions', async () => {
      const kp = await generateKeyPair();

      // Create evidence items
      const ev1 = makeMockEvidenceItem({
        actionType: 'tool_call',
        toolName: 'web_search',
      });
      const ev2 = makeMockEvidenceItem({
        actionType: 'tool_call',
        toolName: 'code_execution',
        inputHash: sha256String('code'),
        outputHash: sha256String('result'),
      });

      // Derive assertions from evidence
      const a1 = assertionFromEvidence(ev1);
      const a2 = assertionFromEvidence(ev2);

      // Batch create manifests with evidence-derived assertions
      const inputs = [
        makeManifestInput({
          contentHash: sha256String('output-1'),
          assertions: [a1, dataProvenanceAssertion('Web Search Results')],
        }),
        makeManifestInput({
          contentHash: sha256String('output-2'),
          assertions: [a2],
        }),
      ];

      const manifests = await createBatchManifests(inputs, kp);
      expect(manifests).toHaveLength(2);

      // First manifest has both assertions
      expect(manifests[0]!.assertions).toHaveLength(2);
      expect(manifests[0]!.assertions[0]!.type).toBe('action');
      expect(manifests[0]!.assertions[1]!.type).toBe('dataProvenance');

      // Second manifest has one assertion
      expect(manifests[1]!.assertions).toHaveLength(1);

      // All manifests should be verifiable
      for (const m of manifests) {
        const v = await verifyManifest(m, kp.publicKey);
        expect(v.valid).toBe(true);
      }

      // All manifests should validate structurally
      for (const m of manifests) {
        const report = validateManifest(m);
        expect(report.valid).toBe(true);
      }
    });
  });
});
