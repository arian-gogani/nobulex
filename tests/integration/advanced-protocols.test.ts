/**
 * Advanced protocol integration tests for the Stele SDK.
 *
 * Covers:
 *   1. Canary System     - Canary generation, evaluation, scheduling, correlation
 *   2. Game Theory       - Honesty proofs, repeated games, coalitions, mechanism design
 *   3. Composition       - Composing, validating, decomposing, and conflict-finding
 *   4. Serialization     - Snapshot stability, canonical forms, deterministic hashing
 */

import { describe, it, expect } from 'vitest';

import {
  generateKeyPair,
  sha256String,
  sha256Object,
  canonicalizeJson,
  toHex,
} from '@stele/crypto';
import type { KeyPair } from '@stele/crypto';

import {
  buildCovenant,
  verifyCovenant,
  serializeCovenant,
  deserializeCovenant,
  computeId,
  canonicalForm,
} from '@stele/core';
import type { CovenantDocument } from '@stele/core';

import { parse, serialize, evaluate } from '@stele/ccl';

import {
  createIdentity,
  serializeIdentity,
  deserializeIdentity,
} from '@stele/identity';

import { MemoryStore } from '@stele/store';

import {
  generateCanary,
  evaluateCanary,
  detectionProbability,
  isExpired,
  canarySchedule,
  canaryCorrelation,
} from '@stele/canary';

import {
  proveHonesty,
  validateParameters,
  minimumStake,
  minimumDetection,
  expectedCostOfBreach,
  honestyMargin,
  repeatedGameEquilibrium,
  coalitionStability,
  mechanismDesign,
} from '@stele/gametheory';

import {
  compose,
  validateComposition,
  findConflicts,
  intersectConstraints,
  decomposeCovenants,
  compositionComplexity,
  proveSystemProperty,
} from '@stele/composition';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a key pair and build a minimal valid covenant. */
async function buildTestCovenant(
  constraints: string,
  issuerId = 'alice',
  beneficiaryId = 'bob',
): Promise<{ kp: KeyPair; bkp: KeyPair; doc: CovenantDocument }> {
  const kp = await generateKeyPair();
  const bkp = await generateKeyPair();
  const doc = await buildCovenant({
    issuer: { id: issuerId, publicKey: kp.publicKeyHex, role: 'issuer' },
    beneficiary: { id: beneficiaryId, publicKey: bkp.publicKeyHex, role: 'beneficiary' },
    constraints,
    privateKey: kp.privateKey,
  });
  return { kp, bkp, doc };
}

// =========================================================================
// 1. CANARY SYSTEM
// =========================================================================

describe('Canary System', () => {
  const constraint = "permit read on '/data/**'";
  const covenantId = 'cov-001';

  it('generates a canary with default parameters', () => {
    const canary = generateCanary(covenantId, constraint);
    expect(canary.id).toBeTruthy();
    expect(typeof canary.id).toBe('string');
    expect(canary.targetCovenantId).toBe(covenantId);
    expect(canary.constraintTested).toBe(constraint);
    expect(canary.expectedBehavior).toBe('permit');
    expect(canary.issuedAt).toBeLessThanOrEqual(Date.now());
    expect(canary.expiresAt).toBeGreaterThan(canary.issuedAt);
  });

  it('generates a canary with a custom challenge', () => {
    const customChallenge = { action: 'write', resource: '/secrets', context: {} };
    const canary = generateCanary(covenantId, constraint, customChallenge);
    expect(canary.challenge).toEqual(customChallenge);
  });

  it('evaluates a canary with correct agent response (passes)', () => {
    const canary = generateCanary(covenantId, constraint);
    const result = evaluateCanary(canary, {
      behavior: 'permit',
      action: 'read',
      resource: '/data/file.txt',
    });
    expect(result.passed).toBe(true);
    expect(result.canaryId).toBe(canary.id);
    expect(result.breachEvidence).toBeUndefined();
  });

  it('evaluates a canary with incorrect agent response (fails)', () => {
    const canary = generateCanary(covenantId, constraint);
    const result = evaluateCanary(canary, {
      behavior: 'deny',
      action: 'read',
      resource: '/data/file.txt',
    });
    expect(result.passed).toBe(false);
    expect(result.breachEvidence).toBeTruthy();
    expect(result.actualBehavior).toBe('deny');
  });

  it('computes detection probability with various frequencies', () => {
    const p1 = detectionProbability(1, 0.5);
    expect(p1).toBe(0.5);

    const p2 = detectionProbability(2, 0.5);
    expect(p2).toBe(0.75);

    const p3 = detectionProbability(10, 0.1);
    expect(p3).toBeCloseTo(1 - Math.pow(0.9, 10), 10);
  });

  it('detection probability is between 0 and 1', () => {
    const cases = [
      { freq: 0, cov: 0.5 },
      { freq: 1, cov: 0 },
      { freq: 1, cov: 1 },
      { freq: 100, cov: 0.01 },
      { freq: 1000, cov: 0.99 },
    ];
    for (const { freq, cov } of cases) {
      const p = detectionProbability(freq, cov);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('detection probability throws on invalid inputs', () => {
    expect(() => detectionProbability(-1, 0.5)).toThrow('canaryFrequency must be >= 0');
    expect(() => detectionProbability(1, -0.1)).toThrow('coverageRatio must be in [0, 1]');
    expect(() => detectionProbability(1, 1.1)).toThrow('coverageRatio must be in [0, 1]');
  });

  it('isExpired returns false for fresh canaries', () => {
    const canary = generateCanary(covenantId, constraint);
    expect(isExpired(canary)).toBe(false);
  });

  it('isExpired returns true for expired canaries (ttlMs=1)', async () => {
    const canary = generateCanary(covenantId, constraint, null, null, 1);
    // Wait just beyond the TTL
    await new Promise((r) => setTimeout(r, 10));
    expect(isExpired(canary)).toBe(true);
  });

  it('canarySchedule generates entries for multiple covenants', () => {
    const covenants = [
      { covenantId: 'cov-A', constraints: ["permit read on '/a/**'"] },
      { covenantId: 'cov-B', constraints: ["deny write on '/b/**'"] },
      { covenantId: 'cov-C', constraints: ["permit delete on '/c/**'"] },
    ];
    const result = canarySchedule(covenants);
    expect(result.schedule.length).toBeGreaterThanOrEqual(3);
    expect(result.covenantsCovered).toBe(3);
    expect(result.constraintsCovered).toBe(3);
    expect(result.estimatedCoverage).toBe(1);
  });

  it('canarySchedule respects maxCanaries limit', () => {
    const covenants = [
      { covenantId: 'cov-A', constraints: ["permit read on '/a/**'", "deny write on '/a/**'"] },
      { covenantId: 'cov-B', constraints: ["permit read on '/b/**'"] },
    ];
    const result = canarySchedule(covenants, 3600000, 2);
    expect(result.schedule.length).toBe(2);
  });

  it('canarySchedule prioritizes deny constraints first', () => {
    const covenants = [
      {
        covenantId: 'cov-X',
        constraints: [
          "permit read on '/x/**'",
          "deny write on '/x/**'",
        ],
      },
    ];
    const result = canarySchedule(covenants);
    // deny should appear before permit in priority
    expect(result.schedule[0]!.priority).toBeLessThanOrEqual(result.schedule[1]!.priority);
  });

  it('canaryCorrelation measures correlation between canary results and breaches', () => {
    // Perfect correlation: canary failures align with breaches
    const canaryResults = [
      { covenantId: 'cov-1', result: { canaryId: 'c1', passed: true, actualBehavior: 'permit', detectionTimestamp: Date.now() } },
      { covenantId: 'cov-1', result: { canaryId: 'c2', passed: true, actualBehavior: 'permit', detectionTimestamp: Date.now() } },
      { covenantId: 'cov-2', result: { canaryId: 'c3', passed: false, actualBehavior: 'deny', detectionTimestamp: Date.now() } },
      { covenantId: 'cov-2', result: { canaryId: 'c4', passed: false, actualBehavior: 'deny', detectionTimestamp: Date.now() } },
      { covenantId: 'cov-3', result: { canaryId: 'c5', passed: true, actualBehavior: 'permit', detectionTimestamp: Date.now() } },
    ];
    const actualBreaches = [
      { covenantId: 'cov-1', breached: false },
      { covenantId: 'cov-2', breached: true },
      { covenantId: 'cov-3', breached: false },
    ];
    const corr = canaryCorrelation(canaryResults, actualBreaches);
    expect(corr.sampleSize).toBe(3);
    expect(corr.meaningful).toBe(true);
    expect(corr.correlation).toBeGreaterThan(0);
    expect(corr.correlation).toBeLessThanOrEqual(1);
  });

  it('generates multiple canaries with unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const canary = generateCanary(`cov-${i}`, constraint);
      ids.add(canary.id);
    }
    expect(ids.size).toBe(20);
  });

  it('canary with all optional fields set', () => {
    const customChallenge = { action: 'delete', resource: '/secrets/key', context: { role: 'admin' } };
    const canary = generateCanary(covenantId, "deny delete on '/secrets/**'", customChallenge, 'deny', 5000);
    expect(canary.expectedBehavior).toBe('deny');
    expect(canary.challenge).toEqual(customChallenge);
    expect(canary.expiresAt - canary.issuedAt).toBe(5000);
  });

  it('evaluateCanary with behavior-only fallback (no action/resource)', () => {
    const canary = generateCanary(covenantId, constraint);
    // Fallback path: no action/resource provided
    const result = evaluateCanary(canary, { behavior: canary.expectedBehavior });
    expect(result.passed).toBe(true);
  });
});

// =========================================================================
// 2. GAME THEORY
// =========================================================================

describe('Game Theory', () => {
  describe('Honesty Proofs', () => {
    const baseParams = {
      stakeAmount: 100,
      detectionProbability: 0.5,
      reputationValue: 50,
      maxViolationGain: 80,
      coburn: 10,
    };

    it('proveHonesty returns isDominantStrategy true when cost exceeds gain', () => {
      // Expected cost: 100*0.5 + 50 + 10 = 110 > 80
      const proof = proveHonesty(baseParams);
      expect(proof.isDominantStrategy).toBe(true);
      expect(proof.margin).toBe(110 - 80);
    });

    it('proveHonesty returns isDominantStrategy false when gain exceeds cost', () => {
      const params = { ...baseParams, maxViolationGain: 200 };
      // Expected cost: 110 < 200
      const proof = proveHonesty(params);
      expect(proof.isDominantStrategy).toBe(false);
      expect(proof.margin).toBeLessThan(0);
    });

    it('proveHonesty formula contains human-readable derivation', () => {
      const proof = proveHonesty(baseParams);
      expect(proof.formula).toContain('Expected cost');
      expect(proof.formula).toContain('Honesty is dominant strategy');
    });

    it('minimumStake computes correct value', () => {
      // minimumStake = (gain - reputation - coburn) / detection
      // = (80 - 50 - 10) / 0.5 = 40
      const stake = minimumStake({
        detectionProbability: 0.5,
        reputationValue: 50,
        maxViolationGain: 80,
        coburn: 10,
      });
      expect(stake).toBe(40);
    });

    it('minimumStake returns Infinity when detection is 0', () => {
      const stake = minimumStake({
        detectionProbability: 0,
        reputationValue: 50,
        maxViolationGain: 80,
        coburn: 10,
      });
      expect(stake).toBe(Infinity);
    });

    it('minimumDetection computes correct value', () => {
      // minimumDetection = (80 - 50 - 10) / 100 = 0.2
      const detection = minimumDetection({
        stakeAmount: 100,
        reputationValue: 50,
        maxViolationGain: 80,
        coburn: 10,
      });
      expect(detection).toBe(0.2);
    });

    it('minimumDetection is clamped to [0, 1]', () => {
      // If reputation+coburn already exceeds gain, detection is 0
      const d = minimumDetection({
        stakeAmount: 100,
        reputationValue: 100,
        maxViolationGain: 50,
        coburn: 10,
      });
      expect(d).toBe(0);
    });

    it('expectedCostOfBreach computes stake * detection + coburn', () => {
      const cost = expectedCostOfBreach(baseParams);
      expect(cost).toBe(100 * 0.5 + 10);
    });

    it('honestyMargin matches proveHonesty margin', () => {
      const margin = honestyMargin(baseParams);
      const proof = proveHonesty(baseParams);
      expect(margin).toBe(proof.margin);
    });

    it('validateParameters throws on negative stakeAmount', () => {
      expect(() => validateParameters({ stakeAmount: -1 })).toThrow('stakeAmount must be >= 0');
    });

    it('validateParameters throws on out-of-range detectionProbability', () => {
      expect(() => validateParameters({ detectionProbability: 1.5 })).toThrow(
        'detectionProbability must be in [0, 1]',
      );
    });
  });

  describe('Repeated Game Equilibrium', () => {
    const pdParams = {
      cooperatePayoff: 3,     // R
      defectPayoff: 1,        // P
      temptationPayoff: 5,    // T
      suckerPayoff: 0,        // S
      discountFactor: 0.8,    // delta
    };

    it('cooperation is sustainable when discount factor exceeds threshold', () => {
      // threshold = (T-R)/(T-P) = (5-3)/(5-1) = 0.5
      // delta = 0.8 > 0.5 => sustainable
      const result = repeatedGameEquilibrium(pdParams);
      expect(result.cooperationSustainable).toBe(true);
      expect(result.minDiscountFactor).toBe(0.5);
      expect(result.margin).toBeCloseTo(0.3);
    });

    it('cooperation is not sustainable when discount factor is below threshold', () => {
      const result = repeatedGameEquilibrium({ ...pdParams, discountFactor: 0.3 });
      expect(result.cooperationSustainable).toBe(false);
      expect(result.margin).toBeLessThan(0);
    });

    it('throws on invalid payoff ordering (T <= R)', () => {
      expect(() =>
        repeatedGameEquilibrium({ ...pdParams, temptationPayoff: 2 }),
      ).toThrow('temptationPayoff');
    });

    it('throws on invalid discount factor', () => {
      expect(() =>
        repeatedGameEquilibrium({ ...pdParams, discountFactor: 0 }),
      ).toThrow('discountFactor must be in (0, 1)');
      expect(() =>
        repeatedGameEquilibrium({ ...pdParams, discountFactor: 1 }),
      ).toThrow('discountFactor must be in (0, 1)');
    });

    it('formula contains human-readable derivation', () => {
      const result = repeatedGameEquilibrium(pdParams);
      expect(result.formula).toContain('Folk Theorem');
      expect(result.formula).toContain('sustainable');
    });
  });

  describe('Coalition Stability', () => {
    it('stable allocation in the core (no blocking coalition)', () => {
      // 2-player game: v({0})=0, v({1})=0, v({0,1})=10
      // allocation [5,5] is in the core
      const result = coalitionStability(2, [5, 5], [
        { coalition: [0], value: 0 },
        { coalition: [1], value: 0 },
        { coalition: [0, 1], value: 10 },
      ]);
      expect(result.isStable).toBe(true);
      expect(result.blockingCoalitions).toHaveLength(0);
      expect(result.efficiency).toBe(1);
    });

    it('unstable allocation with a blocking coalition', () => {
      // Player 0 can get 6 alone but only receives 4 in the allocation
      const result = coalitionStability(2, [4, 6], [
        { coalition: [0], value: 6 },
        { coalition: [1], value: 0 },
        { coalition: [0, 1], value: 10 },
      ]);
      expect(result.isStable).toBe(false);
      expect(result.blockingCoalitions.length).toBeGreaterThan(0);
      expect(result.blockingCoalitions[0]!.coalition).toEqual([0]);
    });

    it('throws when grand coalition is missing', () => {
      expect(() =>
        coalitionStability(2, [5, 5], [{ coalition: [0], value: 0 }]),
      ).toThrow('grand coalition');
    });

    it('throws when allocation length does not match agentCount', () => {
      expect(() =>
        coalitionStability(3, [5, 5], [{ coalition: [0, 1, 2], value: 15 }]),
      ).toThrow('allocation length');
    });
  });

  describe('Mechanism Design', () => {
    it('computes minimum penalty for incentive compatibility', () => {
      // penalty >= dishonestGain / detectionProbability = 100 / 0.5 = 200
      const result = mechanismDesign({
        dishonestGain: 100,
        detectionProbability: 0.5,
      });
      expect(result.minimumPenalty).toBe(200);
      expect(result.enforceable).toBe(true);
    });

    it('no penalty needed when intrinsic cost exceeds gain', () => {
      const result = mechanismDesign({
        dishonestGain: 50,
        detectionProbability: 0.5,
        intrinsicHonestyCost: 100,
      });
      expect(result.minimumPenalty).toBe(0);
      expect(result.enforceable).toBe(true);
    });

    it('not enforceable when detection is zero and gain is positive', () => {
      const result = mechanismDesign({
        dishonestGain: 100,
        detectionProbability: 0,
      });
      expect(result.enforceable).toBe(false);
      expect(result.minimumPenalty).toBe(Infinity);
    });

    it('expected penalty at minimum equals the net gain', () => {
      const result = mechanismDesign({
        dishonestGain: 100,
        detectionProbability: 0.5,
        intrinsicHonestyCost: 0,
      });
      // expectedPenalty = minimumPenalty * detection = 200 * 0.5 = 100 = dishonestGain
      expect(result.expectedPenalty).toBe(100);
    });
  });
});

// =========================================================================
// 3. COMPOSITION
// =========================================================================

describe('Composition', () => {
  const covA = {
    id: 'cov-a',
    agentId: 'agent-1',
    constraints: ["permit read on '/data/**'"],
  };
  const covB = {
    id: 'cov-b',
    agentId: 'agent-2',
    constraints: ["deny write on '/data/**'"],
  };
  const covC = {
    id: 'cov-c',
    agentId: 'agent-1',
    constraints: ["permit write on '/logs/**'"],
  };

  it('composes multiple covenants into a CompositionProof', () => {
    const proof = compose([covA, covB, covC]);
    expect(proof.agents).toContain('agent-1');
    expect(proof.agents).toContain('agent-2');
    expect(proof.individualCovenants).toEqual(['cov-a', 'cov-b', 'cov-c']);
    expect(proof.composedConstraints.length).toBeGreaterThan(0);
    expect(proof.proof).toBeTruthy();
  });

  it('composed proof removes permits overridden by denies (deny-wins)', () => {
    // covA permits read on /data/**, covB denies write on /data/**
    // The permit for read on /data/** should NOT be removed because deny is for write
    // But if we add a deny for read on /data/**, the permit should be removed
    const covDenyRead = {
      id: 'cov-deny-read',
      agentId: 'agent-3',
      constraints: ["deny read on '/data/**'"],
    };
    const proof = compose([covA, covDenyRead]);
    const permitConstraints = proof.composedConstraints.filter(c => c.type === 'permit');
    // The permit read on /data/** overlaps with deny read on /data/**, so it should be removed
    expect(permitConstraints.length).toBe(0);
  });

  it('validateComposition returns true for valid proof', () => {
    const proof = compose([covA, covC]);
    expect(validateComposition(proof)).toBe(true);
  });

  it('validateComposition returns false if hash is tampered', () => {
    const proof = compose([covA, covC]);
    proof.proof = 'tampered-hash-value';
    expect(validateComposition(proof)).toBe(false);
  });

  it('findConflicts detects permit/deny overlaps', () => {
    // covA permits read on /data/**, covB denies write on /data/**
    // read and write are different actions, so no overlap
    // Let's create an actual overlap
    const covPermitWrite = {
      id: 'cov-permit-write',
      agentId: 'agent-4',
      constraints: ["permit write on '/data/**'"],
    };
    const conflicts = findConflicts([covPermitWrite, covB]);
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('findConflicts returns empty for non-conflicting covenants', () => {
    // covA permits read on /data/**, covC permits write on /logs/**
    const conflicts = findConflicts([covA, covC]);
    expect(conflicts.length).toBe(0);
  });

  it('intersectConstraints finds common constraints', () => {
    const result = intersectConstraints(
      ["permit read on '/a'", "deny write on '/b'"],
      ["deny write on '/b'", "permit read on '/c'"],
    );
    expect(result).toEqual(["deny write on '/b'"]);
  });

  it('decomposeCovenants splits compound covenants into atomic ones', () => {
    const compound = {
      id: 'cov-compound',
      agentId: 'agent-5',
      constraints: [
        "permit read on '/data/**'",
        "deny write on '/system/**'",
      ],
    };
    const atoms = decomposeCovenants([compound]);
    expect(atoms.length).toBe(2);
    expect(atoms[0]!.sourceCovenantId).toBe('cov-compound');
    expect(atoms.some(a => a.type === 'permit')).toBe(true);
    expect(atoms.some(a => a.type === 'deny')).toBe(true);
  });

  it('compositionComplexity measures complexity metrics', () => {
    const complexity = compositionComplexity([covA, covB, covC]);
    expect(complexity.totalRules).toBe(3);
    expect(complexity.agentCount).toBe(2);
    expect(complexity.score).toBeGreaterThan(0);
    expect(complexity.distinctActions).toBeGreaterThan(0);
    expect(complexity.distinctResources).toBeGreaterThan(0);
  });

  it('proveSystemProperty detects that a deny enforces a property', () => {
    const prop = proveSystemProperty([covB], 'no unauthorized write access');
    expect(prop.holds).toBe(true);
    expect(prop.derivedFrom).toContain('cov-b');
  });
});

// =========================================================================
// 4. SERIALIZATION SNAPSHOT STABILITY
// =========================================================================

describe('Serialization Snapshot Stability', () => {
  let kp: KeyPair;
  let bkp: KeyPair;

  // Generate keys once before all serialization tests
  let sharedDoc: CovenantDocument;

  // We need to use beforeAll but vitest should handle it
  // Instead, we'll generate in the first test and reuse

  async function ensureSharedDoc(): Promise<CovenantDocument> {
    if (!sharedDoc) {
      kp = await generateKeyPair();
      bkp = await generateKeyPair();
      sharedDoc = await buildCovenant({
        issuer: { id: 'alice', publicKey: kp.publicKeyHex, role: 'issuer' },
        beneficiary: { id: 'bob', publicKey: bkp.publicKeyHex, role: 'beneficiary' },
        constraints: "permit read on '/data/**'",
        privateKey: kp.privateKey,
      });
    }
    return sharedDoc;
  }

  it('serializeCovenant produces deterministic JSON (same doc -> same string)', async () => {
    const doc = await ensureSharedDoc();
    const json1 = serializeCovenant(doc);
    const json2 = serializeCovenant(doc);
    expect(json1).toBe(json2);
  });

  it('canonicalForm is stable across multiple calls', async () => {
    const doc = await ensureSharedDoc();
    const c1 = canonicalForm(doc);
    const c2 = canonicalForm(doc);
    const c3 = canonicalForm(doc);
    expect(c1).toBe(c2);
    expect(c2).toBe(c3);
  });

  it('CCL serialize(parse(source)) is stable', () => {
    const source = "permit read on '/data/**'";
    const doc = parse(source);
    const s1 = serialize(doc);
    const s2 = serialize(parse(s1.trim()));
    // Parse and re-serialize should be idempotent
    expect(s1.trim()).toBe(s2.trim());
  });

  it('serializeIdentity produces deterministic JSON', async () => {
    const ikp = await generateKeyPair();
    const identity = await createIdentity({
      operatorKeyPair: ikp,
      model: { provider: 'anthropic', modelId: 'claude-3' },
      capabilities: ['read', 'write'],
      deployment: { runtime: 'container' },
    });
    const json1 = serializeIdentity(identity);
    const json2 = serializeIdentity(identity);
    expect(json1).toBe(json2);
  });

  it('identity serialization round-trips correctly', async () => {
    const ikp = await generateKeyPair();
    const identity = await createIdentity({
      operatorKeyPair: ikp,
      model: { provider: 'anthropic', modelId: 'claude-3' },
      capabilities: ['read', 'write'],
      deployment: { runtime: 'container' },
    });
    const json = serializeIdentity(identity);
    const deserialized = deserializeIdentity(json);
    expect(deserialized.id).toBe(identity.id);
    expect(deserialized.operatorPublicKey).toBe(identity.operatorPublicKey);
    expect(deserialized.capabilities).toEqual(identity.capabilities);
    expect(deserialized.version).toBe(identity.version);
    expect(deserialized.signature).toBe(identity.signature);
  });

  it('documents retrieved from MemoryStore match what was put in', async () => {
    const { doc } = await buildTestCovenant("permit read on '/data/**'");
    const store = new MemoryStore();
    await store.put(doc);
    const retrieved = await store.get(doc.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(doc.id);
    expect(retrieved!.constraints).toBe(doc.constraints);
    expect(retrieved!.issuer).toEqual(doc.issuer);
    expect(retrieved!.beneficiary).toEqual(doc.beneficiary);
    expect(retrieved!.signature).toBe(doc.signature);
    expect(retrieved!.nonce).toBe(doc.nonce);
  });

  it('sha256 of canonical JSON is deterministic', () => {
    const obj = { z: 1, a: 'hello', m: [3, 2, 1] };
    const h1 = sha256String(canonicalizeJson(obj));
    const h2 = sha256String(canonicalizeJson(obj));
    expect(h1).toBe(h2);
    expect(h1.length).toBe(64); // 256 bits = 64 hex chars
  });

  it('sha256Object produces same hash regardless of key order', () => {
    const h1 = sha256Object({ b: 2, a: 1 });
    const h2 = sha256Object({ a: 1, b: 2 });
    expect(h1).toBe(h2);
  });

  it('computeId is deterministic and matches sha256 of canonical form', async () => {
    const doc = await ensureSharedDoc();
    const id1 = computeId(doc);
    const id2 = computeId(doc);
    expect(id1).toBe(id2);

    // Manual check: computeId should equal sha256String(canonicalForm(doc))
    const manual = sha256String(canonicalForm(doc));
    expect(id1).toBe(manual);
  });

  it('deserialized documents maintain all fields precisely', async () => {
    const { doc } = await buildTestCovenant("permit read on '/data/**'");
    const json = serializeCovenant(doc);
    const restored = deserializeCovenant(json);
    expect(restored.id).toBe(doc.id);
    expect(restored.version).toBe(doc.version);
    expect(restored.constraints).toBe(doc.constraints);
    expect(restored.nonce).toBe(doc.nonce);
    expect(restored.createdAt).toBe(doc.createdAt);
    expect(restored.signature).toBe(doc.signature);
    expect(restored.issuer.id).toBe(doc.issuer.id);
    expect(restored.issuer.publicKey).toBe(doc.issuer.publicKey);
    expect(restored.issuer.role).toBe(doc.issuer.role);
    expect(restored.beneficiary.id).toBe(doc.beneficiary.id);
    expect(restored.beneficiary.publicKey).toBe(doc.beneficiary.publicKey);
    expect(restored.beneficiary.role).toBe(doc.beneficiary.role);
  });

  it('JSON field ordering is consistent (canonical)', () => {
    const obj1 = { z: 3, m: 2, a: 1 };
    const obj2 = { a: 1, m: 2, z: 3 };
    expect(canonicalizeJson(obj1)).toBe(canonicalizeJson(obj2));
    // Verify keys are sorted
    const parsed = JSON.parse(canonicalizeJson(obj1));
    const keys = Object.keys(parsed);
    expect(keys).toEqual(['a', 'm', 'z']);
  });

  it('covenant with all optional fields serializes/deserializes correctly', async () => {
    const kpLocal = await generateKeyPair();
    const bkpLocal = await generateKeyPair();
    const doc = await buildCovenant({
      issuer: { id: 'alice', publicKey: kpLocal.publicKeyHex, role: 'issuer' },
      beneficiary: { id: 'bob', publicKey: bkpLocal.publicKeyHex, role: 'beneficiary' },
      constraints: "permit read on '/data/**'",
      privateKey: kpLocal.privateKey,
      metadata: { tags: ['test', 'integration'], description: 'Full test covenant' },
      expiresAt: '2099-12-31T23:59:59.999Z',
      activatesAt: '2020-01-01T00:00:00.000Z',
      enforcement: { type: 'monitor' },
      proof: { type: 'audit_log' },
    });

    const json = serializeCovenant(doc);
    const restored = deserializeCovenant(json);
    expect(restored.metadata).toEqual(doc.metadata);
    expect(restored.expiresAt).toBe(doc.expiresAt);
    expect(restored.activatesAt).toBe(doc.activatesAt);
    expect(restored.enforcement).toEqual(doc.enforcement);
    expect(restored.proof).toEqual(doc.proof);

    // Verify the document still passes verification
    const vResult = await verifyCovenant(restored);
    expect(vResult.valid).toBe(true);
  });

  it('covenant with no optional fields serializes/deserializes correctly', async () => {
    const { doc } = await buildTestCovenant("permit read on '/data/**'");
    const json = serializeCovenant(doc);
    const restored = deserializeCovenant(json);
    // Optional fields should not be present
    expect(restored.metadata).toBeUndefined();
    expect(restored.expiresAt).toBeUndefined();
    expect(restored.activatesAt).toBeUndefined();
    expect(restored.chain).toBeUndefined();
    // Core fields intact
    expect(restored.id).toBe(doc.id);
    expect(restored.constraints).toBe(doc.constraints);
  });

  it('deserialized covenant passes full verification', async () => {
    const { doc } = await buildTestCovenant("permit read on '/data/**'");
    const json = serializeCovenant(doc);
    const restored = deserializeCovenant(json);
    const result = await verifyCovenant(restored);
    expect(result.valid).toBe(true);
  });

  it('nested objects are canonicalized recursively', () => {
    const nested1 = { outer: { z: 1, a: 2 }, b: { y: 3, x: 4 } };
    const nested2 = { b: { x: 4, y: 3 }, outer: { a: 2, z: 1 } };
    expect(canonicalizeJson(nested1)).toBe(canonicalizeJson(nested2));
    expect(sha256Object(nested1)).toBe(sha256Object(nested2));
  });
});
