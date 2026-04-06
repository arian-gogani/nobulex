import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '@nobulex/crypto';
import { createIdentity } from '@nobulex/identity';
import type { AgentIdentity } from '@nobulex/identity';
import type { ComplianceProof } from '@nobulex/proof';
import type { CovenantDocument } from '@nobulex/core';

import {
  createTrustVector,
  createTrustVectorFromValues,
  trustMagnitude,
  scaleTrustVector,
  multiplyTrustVectors,
  weightedAverageTrustVectors,
  trustDotProduct,
  trustCosineSimilarity,
  createTrustContext,
  contextsMatch,
  createDirectionalTrust,
  createDecayConfig,
  applyDecay,
  reinforceDecay,
  computeHalfLife,
  createTrustChain,
  computeChainTrust,
  TrustGraph,
  aggregateTrust,
  consensusTrust,
  detectDisputes,
  createTrustStake,
  resolveStake,
  CORE_DIMENSIONS,
  DEFAULT_ATTENUATION,
  DEFAULT_MAX_CHAIN_LENGTH,
  DEFAULT_DECAY_RATE,
} from './index';

import type { DecayConfig } from './index';

// ─── Test Helpers ───────────────────────────────────────────────────────────

async function createTestAgent(capabilities: string[] = ['text_generation']): Promise<AgentIdentity> {
  const kp = await generateKeyPair();
  return createIdentity({
    operatorKeyPair: kp,
    model: { provider: 'anthropic', modelId: 'claude-3' },
    capabilities,
    deployment: { runtime: 'container' },
  });
}

function mockComplianceProof(covenantId: string): ComplianceProof {
  return {
    version: '1.0',
    covenantId,
    auditLogCommitment: 'a'.repeat(64),
    constraintCommitment: 'b'.repeat(64),
    proof: 'c'.repeat(64),
    publicInputs: [],
    proofSystem: 'poseidon_hash',
    generatedAt: new Date().toISOString(),
    entryCount: 1,
  };
}

function mockCovenantDocument(id: string): CovenantDocument {
  return {
    id,
    version: '1.0',
    issuer: {
      id: 'issuer-1',
      publicKey: 'd'.repeat(64),
      role: 'issuer',
    },
    beneficiary: {
      id: 'beneficiary-1',
      publicKey: 'e'.repeat(64),
      role: 'beneficiary',
    },
    constraints: 'MUST log_access',
    nonce: 'f'.repeat(64),
    createdAt: new Date().toISOString(),
    signature: '0'.repeat(128),
  };
}

// ─── Trust Vector Tests ─────────────────────────────────────────────────────

describe('@nobulex/trust-physics', () => {
  describe('TrustVector creation', () => {
    it('creates a zero trust vector by default', () => {
      const v = createTrustVector();
      for (const dim of CORE_DIMENSIONS) {
        expect(v[dim]).toBe(0);
      }
      expect(v.dimensions.size).toBe(0);
    });

    it('creates a uniform trust vector with a given value', () => {
      const v = createTrustVector(0.75);
      for (const dim of CORE_DIMENSIONS) {
        expect(v[dim]).toBe(0.75);
      }
    });

    it('clamps values above 1 to 1', () => {
      const v = createTrustVector(1.5);
      for (const dim of CORE_DIMENSIONS) {
        expect(v[dim]).toBe(1);
      }
    });

    it('clamps values below 0 to 0', () => {
      const v = createTrustVector(-0.5);
      for (const dim of CORE_DIMENSIONS) {
        expect(v[dim]).toBe(0);
      }
    });

    it('includes custom dimensions', () => {
      const v = createTrustVector(0.5, { speed: 0.8, accuracy: 0.9 });
      expect(v.dimensions.get('speed')).toBe(0.8);
      expect(v.dimensions.get('accuracy')).toBe(0.9);
    });

    it('creates a vector from individual dimension values', () => {
      const v = createTrustVectorFromValues({
        reliability: 0.9,
        capability: 0.8,
        integrity: 0.7,
        benevolence: 0.6,
        predictability: 0.5,
        transparency: 0.4,
      });
      expect(v.reliability).toBe(0.9);
      expect(v.capability).toBe(0.8);
      expect(v.integrity).toBe(0.7);
      expect(v.benevolence).toBe(0.6);
      expect(v.predictability).toBe(0.5);
      expect(v.transparency).toBe(0.4);
    });
  });

  describe('TrustVector math', () => {
    it('computes magnitude of a unit vector as 1', () => {
      const v = createTrustVector(1);
      expect(trustMagnitude(v)).toBeCloseTo(1, 10);
    });

    it('computes magnitude of a zero vector as 0', () => {
      const v = createTrustVector(0);
      expect(trustMagnitude(v)).toBe(0);
    });

    it('computes magnitude correctly for mixed values', () => {
      const v = createTrustVectorFromValues({
        reliability: 0.5,
        capability: 0.5,
        integrity: 0.5,
        benevolence: 0.5,
        predictability: 0.5,
        transparency: 0.5,
      });
      // sqrt((6 * 0.25) / 6) = sqrt(0.25) = 0.5
      expect(trustMagnitude(v)).toBeCloseTo(0.5, 10);
    });

    it('scales a trust vector', () => {
      const v = createTrustVector(0.8);
      const scaled = scaleTrustVector(v, 0.5);
      for (const dim of CORE_DIMENSIONS) {
        expect(scaled[dim]).toBeCloseTo(0.4, 10);
      }
    });

    it('clamps scaled vector dimensions to [0, 1]', () => {
      const v = createTrustVector(0.8);
      const scaled = scaleTrustVector(v, 2.0);
      for (const dim of CORE_DIMENSIONS) {
        expect(scaled[dim]).toBe(1);
      }
    });

    it('multiplies two trust vectors component-wise', () => {
      const a = createTrustVector(0.9);
      const b = createTrustVector(0.8);
      const result = multiplyTrustVectors(a, b);
      for (const dim of CORE_DIMENSIONS) {
        expect(result[dim]).toBeCloseTo(0.72, 10);
      }
    });

    it('multiplies custom dimensions correctly', () => {
      const a = createTrustVector(1, { speed: 0.5 });
      const b = createTrustVector(1, { speed: 0.6, extra: 0.7 });
      const result = multiplyTrustVectors(a, b);
      expect(result.dimensions.get('speed')).toBeCloseTo(0.3, 10);
      // extra: a has 0 (default), b has 0.7 => 0 * 0.7 = 0
      expect(result.dimensions.get('extra')).toBe(0);
    });

    it('computes weighted average of trust vectors', () => {
      const v1 = createTrustVector(1.0);
      const v2 = createTrustVector(0.0);
      const avg = weightedAverageTrustVectors([v1, v2], [1, 1]);
      for (const dim of CORE_DIMENSIONS) {
        expect(avg[dim]).toBeCloseTo(0.5, 10);
      }
    });

    it('respects weights in weighted average', () => {
      const v1 = createTrustVector(1.0);
      const v2 = createTrustVector(0.0);
      const avg = weightedAverageTrustVectors([v1, v2], [3, 1]);
      for (const dim of CORE_DIMENSIONS) {
        expect(avg[dim]).toBeCloseTo(0.75, 10);
      }
    });

    it('throws on empty vector array for weighted average', () => {
      expect(() => weightedAverageTrustVectors([], [])).toThrow(
        'Cannot compute weighted average of zero vectors',
      );
    });

    it('throws on mismatched vector/weight lengths', () => {
      const v = createTrustVector(0.5);
      expect(() => weightedAverageTrustVectors([v], [1, 2])).toThrow(
        'Vectors and weights must have the same length',
      );
    });
  });

  // ─── Trust Context Tests ──────────────────────────────────────────────────

  describe('TrustContext', () => {
    it('creates a trust context', () => {
      const ctx = createTrustContext('financial', 'transactions_under_10k');
      expect(ctx.domain).toBe('financial');
      expect(ctx.scope).toBe('transactions_under_10k');
      expect(ctx.constraints).toEqual([]);
    });

    it('creates a trust context with constraints', () => {
      const ctx = createTrustContext('medical', 'diagnostics', [
        { key: 'max_severity', operator: 'lte', value: 3 },
      ]);
      expect(ctx.constraints).toHaveLength(1);
      expect(ctx.constraints[0]!.key).toBe('max_severity');
    });

    it('matches contexts with same domain and scope', () => {
      const a = createTrustContext('financial', 'payments');
      const b = createTrustContext('financial', 'payments');
      expect(contextsMatch(a, b)).toBe(true);
    });

    it('does not match contexts with different domains', () => {
      const a = createTrustContext('financial', 'payments');
      const b = createTrustContext('medical', 'payments');
      expect(contextsMatch(a, b)).toBe(false);
    });

    it('does not match contexts with different scopes', () => {
      const a = createTrustContext('financial', 'payments');
      const b = createTrustContext('financial', 'lending');
      expect(contextsMatch(a, b)).toBe(false);
    });
  });

  // ─── Directional Trust Tests ──────────────────────────────────────────────

  describe('Directional Trust', () => {
    it('creates directional trust with a content-addressed ID', async () => {
      const agentA = await createTestAgent();
      const agentB = await createTestAgent();
      const vector = createTrustVector(0.8);
      const context = createTrustContext('general', 'default');

      const trust = createDirectionalTrust(agentA, agentB, vector, context);

      expect(trust.id).toBeTruthy();
      expect(trust.id).toHaveLength(64);
      expect(trust.trustor.id).toBe(agentA.id);
      expect(trust.trustee.id).toBe(agentB.id);
    });

    it('A→B trust is different from B→A trust', async () => {
      const agentA = await createTestAgent();
      const agentB = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      const trustAB = createDirectionalTrust(agentA, agentB, createTrustVector(0.9), ctx);
      const trustBA = createDirectionalTrust(agentB, agentA, createTrustVector(0.3), ctx);

      expect(trustAB.id).not.toBe(trustBA.id);
      expect(trustAB.vector.reliability).toBe(0.9);
      expect(trustBA.vector.reliability).toBe(0.3);
    });

    it('includes evidence when provided', async () => {
      const agentA = await createTestAgent();
      const agentB = await createTestAgent();
      const proof = mockComplianceProof('covenant-1');
      const trust = createDirectionalTrust(
        agentA,
        agentB,
        createTrustVector(0.8),
        createTrustContext('general', 'default'),
        [proof],
      );

      expect(trust.evidence).toHaveLength(1);
      expect(trust.evidence[0]!.covenantId).toBe('covenant-1');
    });
  });

  // ─── Time Decay Tests ────────────────────────────────────────────────────

  describe('Time-Decaying Trust', () => {
    it('creates a decay config with default rate', () => {
      const decay = createDecayConfig();
      expect(decay.decayRate).toBe(DEFAULT_DECAY_RATE);
      expect(decay.reinforcementHistory).toHaveLength(1);
    });

    it('trust is unchanged immediately after verification', () => {
      const base = createTrustVector(0.9);
      const decay = createDecayConfig();
      const nowMs = new Date(decay.lastVerified).getTime();

      const current = applyDecay(base, decay, nowMs);
      for (const dim of CORE_DIMENSIONS) {
        expect(current[dim]).toBeCloseTo(0.9, 5);
      }
    });

    it('trust decreases over time', () => {
      const base = createTrustVector(0.9);
      const decay = createDecayConfig(1e-6); // Faster decay for testing

      const nowMs = new Date(decay.lastVerified).getTime();
      const oneHourLater = nowMs + 3_600_000;

      const current = applyDecay(base, decay, oneHourLater);
      for (const dim of CORE_DIMENSIONS) {
        expect(current[dim]).toBeLessThan(0.9);
        expect(current[dim]).toBeGreaterThan(0);
      }
    });

    it('trust decays exponentially following e^(-lambda*t)', () => {
      const lambda = 1e-6;
      const base = createTrustVector(1.0);
      const decay = createDecayConfig(lambda);
      const nowMs = new Date(decay.lastVerified).getTime();
      const elapsed = 1_000_000; // 1M ms

      const current = applyDecay(base, decay, nowMs + elapsed);
      const expectedFactor = Math.exp(-lambda * elapsed);

      for (const dim of CORE_DIMENSIONS) {
        expect(current[dim]).toBeCloseTo(expectedFactor, 5);
      }
    });

    it('reinforcement resets lastVerified timestamp', () => {
      const decay = createDecayConfig();

      const reinforced = reinforceDecay(decay);
      expect(reinforced.reinforcementHistory.length).toBe(
        decay.reinforcementHistory.length + 1,
      );
      expect(reinforced.lastVerified).toBeDefined();
    });

    it('multiple reinforcements slow decay (adaptive decay)', () => {
      const lambda = 1e-6;
      const base = createTrustVector(1.0);
      let decay = createDecayConfig(lambda);

      // Add reinforcements beyond the adaptive threshold
      for (let i = 0; i < 5; i++) {
        decay = reinforceDecay(decay);
      }

      const nowMs = new Date(decay.lastVerified).getTime();
      const elapsed = 1_000_000;

      const decayedNoReinforcement = applyDecay(
        base,
        createDecayConfig(lambda),
        new Date(createDecayConfig(lambda).lastVerified).getTime() + elapsed,
      );

      const decayedWithReinforcement = applyDecay(base, decay, nowMs + elapsed);

      // With reinforcement, trust should be higher (slower decay)
      expect(trustMagnitude(decayedWithReinforcement)).toBeGreaterThan(
        trustMagnitude(decayedNoReinforcement),
      );
    });

    it('computes half-life correctly', () => {
      const lambda = 1e-6;
      const decay = createDecayConfig(lambda);
      const halfLife = computeHalfLife(decay);
      expect(halfLife).toBeCloseTo(Math.LN2 / lambda, 0);
    });

    it('half-life is Infinity when decay rate is 0', () => {
      const decay = createDecayConfig(0);
      expect(computeHalfLife(decay)).toBe(Infinity);
    });
  });

  // ─── Trust Chain Tests ────────────────────────────────────────────────────

  describe('Trust Chains', () => {
    it('creates a valid trust chain', async () => {
      const a = await createTestAgent();
      const b = await createTestAgent();
      const ctx = createTrustContext('general', 'default');
      const link = createDirectionalTrust(a, b, createTrustVector(0.9), ctx);

      const chain = createTrustChain([link]);
      expect(chain.links).toHaveLength(1);
      expect(chain.attenuation).toBe(DEFAULT_ATTENUATION);
    });

    it('throws when chain exceeds max length', async () => {
      const agents: AgentIdentity[] = [];
      for (let i = 0; i < 4; i++) {
        agents.push(await createTestAgent());
      }

      const ctx = createTrustContext('general', 'default');
      const links = [];
      for (let i = 0; i < 3; i++) {
        links.push(
          createDirectionalTrust(agents[i]!, agents[i + 1]!, createTrustVector(0.9), ctx),
        );
      }

      expect(() => createTrustChain(links, DEFAULT_ATTENUATION, 2)).toThrow(
        'exceeds maximum',
      );
    });

    it('throws when chain is not contiguous', async () => {
      const a = await createTestAgent();
      const b = await createTestAgent();
      const c = await createTestAgent();
      const d = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      const linkAB = createDirectionalTrust(a, b, createTrustVector(0.9), ctx);
      const linkCD = createDirectionalTrust(c, d, createTrustVector(0.8), ctx);

      expect(() => createTrustChain([linkAB, linkCD])).toThrow('not contiguous');
    });

    it('computes end-to-end trust with attenuation', async () => {
      const a = await createTestAgent();
      const b = await createTestAgent();
      const c = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      const trustAB = createDirectionalTrust(a, b, createTrustVector(0.9), ctx);
      const trustBC = createDirectionalTrust(b, c, createTrustVector(0.8), ctx);

      const chain = createTrustChain([trustAB, trustBC], 0.7);
      const endToEnd = computeChainTrust(chain);

      // Each dimension: 0.9 * 0.8 * 0.7 = 0.504
      for (const dim of CORE_DIMENSIONS) {
        expect(endToEnd[dim]).toBeCloseTo(0.504, 5);
      }
    });

    it('returns zero vector for empty chain', () => {
      const chain = createTrustChain([]);
      const result = computeChainTrust(chain);
      for (const dim of CORE_DIMENSIONS) {
        expect(result[dim]).toBe(0);
      }
    });

    it('single-link chain equals the link trust (no attenuation applied)', async () => {
      const a = await createTestAgent();
      const b = await createTestAgent();
      const ctx = createTrustContext('general', 'default');
      const trust = createDirectionalTrust(a, b, createTrustVector(0.85), ctx);

      const chain = createTrustChain([trust], 0.7);
      const result = computeChainTrust(chain);

      for (const dim of CORE_DIMENSIONS) {
        expect(result[dim]).toBeCloseTo(0.85, 10);
      }
    });

    it('three-hop chain applies attenuation twice', async () => {
      const agents: AgentIdentity[] = [];
      for (let i = 0; i < 4; i++) {
        agents.push(await createTestAgent());
      }

      const ctx = createTrustContext('general', 'default');
      const links = [];
      for (let i = 0; i < 3; i++) {
        links.push(
          createDirectionalTrust(agents[i]!, agents[i + 1]!, createTrustVector(0.9), ctx),
        );
      }

      const chain = createTrustChain(links, 0.7);
      const result = computeChainTrust(chain);

      // dim: 0.9 * (0.9 * 0.7) * (0.9 * 0.7) = 0.9 * 0.63 * 0.63 = 0.9 * 0.3969
      // Actually: start=0.9, then multiply by 0.9 then scale by 0.7 = 0.9*0.9*0.7=0.567,
      // then multiply by 0.9 and scale by 0.7 = 0.567*0.9*0.7=0.35721
      for (const dim of CORE_DIMENSIONS) {
        expect(result[dim]).toBeCloseTo(0.9 * 0.9 * 0.7 * 0.9 * 0.7, 5);
      }
    });
  });

  // ─── Trust Graph Tests ────────────────────────────────────────────────────

  describe('TrustGraph', () => {
    it('stores agents and edges', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();
      const b = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      const trust = createDirectionalTrust(a, b, createTrustVector(0.8), ctx);
      graph.addTrust(trust);

      expect(graph.agents.size).toBe(2);
      expect(graph.edges).toHaveLength(1);
    });

    it('queries direct trust between agents', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();
      const b = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      const trust = createDirectionalTrust(a, b, createTrustVector(0.8), ctx);
      graph.addTrust(trust);

      const result = graph.queryTrust(a, b);
      expect(result).not.toBeNull();
      expect(result!.reliability).toBe(0.8);
    });

    it('returns null when no direct trust exists', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();
      const b = await createTestAgent();

      const result = graph.queryTrust(a, b);
      expect(result).toBeNull();
    });

    it('queries trust filtered by context', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();
      const b = await createTestAgent();

      const finCtx = createTrustContext('financial', 'payments');
      const medCtx = createTrustContext('medical', 'diagnostics');

      graph.addTrust(
        createDirectionalTrust(a, b, createTrustVector(0.9), finCtx),
      );
      graph.addTrust(
        createDirectionalTrust(a, b, createTrustVector(0.3), medCtx),
      );

      const finTrust = graph.queryTrust(a, b, finCtx);
      const medTrust = graph.queryTrust(a, b, medCtx);

      expect(finTrust!.reliability).toBe(0.9);
      expect(medTrust!.reliability).toBe(0.3);
    });

    it('finds trust paths between agents', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();
      const b = await createTestAgent();
      const c = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      graph.addTrust(createDirectionalTrust(a, b, createTrustVector(0.9), ctx));
      graph.addTrust(createDirectionalTrust(b, c, createTrustVector(0.8), ctx));

      const paths = graph.findTrustPaths(a, c);
      expect(paths).toHaveLength(1);
      expect(paths[0]!.links).toHaveLength(2);
    });

    it('finds no path when agents are disconnected', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();
      const b = await createTestAgent();
      const c = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      graph.addTrust(createDirectionalTrust(a, b, createTrustVector(0.9), ctx));

      const paths = graph.findTrustPaths(a, c);
      expect(paths).toHaveLength(0);
    });

    it('respects maxHops when finding paths', async () => {
      const graph = new TrustGraph();
      const agents: AgentIdentity[] = [];
      for (let i = 0; i < 5; i++) {
        agents.push(await createTestAgent());
      }

      const ctx = createTrustContext('general', 'default');
      for (let i = 0; i < 4; i++) {
        graph.addTrust(
          createDirectionalTrust(agents[i]!, agents[i + 1]!, createTrustVector(0.9), ctx),
        );
      }

      // Path exists with 4 hops, but we limit to 2
      const paths = graph.findTrustPaths(agents[0]!, agents[4]!, 2);
      expect(paths).toHaveLength(0);
    });

    it('computes aggregated reputation vector', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();
      const b = await createTestAgent();
      const c = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      graph.addTrust(createDirectionalTrust(a, c, createTrustVector(0.8), ctx));
      graph.addTrust(createDirectionalTrust(b, c, createTrustVector(0.6), ctx));

      const rep = graph.getReputationVector(c);
      expect(rep.assessorCount).toBe(2);
      expect(rep.vector.reliability).toBeCloseTo(0.7, 5);
    });

    it('returns zero reputation for unknown agent', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();

      const rep = graph.getReputationVector(a);
      expect(rep.assessorCount).toBe(0);
      expect(rep.vector.reliability).toBe(0);
    });

    it('gets contextual trust', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();
      const b = await createTestAgent();
      const target = await createTestAgent();

      const finCtx = createTrustContext('financial', 'payments');
      const medCtx = createTrustContext('medical', 'diagnostics');

      graph.addTrust(createDirectionalTrust(a, target, createTrustVector(0.9), finCtx));
      graph.addTrust(createDirectionalTrust(b, target, createTrustVector(0.3), medCtx));

      const finTrust = graph.getContextualTrust(target, finCtx);
      const medTrust = graph.getContextualTrust(target, medCtx);

      expect(finTrust.reliability).toBeCloseTo(0.9, 5);
      expect(medTrust.reliability).toBeCloseTo(0.3, 5);
    });

    it('prunes edges below decay threshold', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();
      const b = await createTestAgent();
      const c = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      const highTrust = createDirectionalTrust(a, b, createTrustVector(0.9), ctx);
      const lowTrust = createDirectionalTrust(a, c, createTrustVector(0.1), ctx);

      graph.addTrust(highTrust);
      graph.addTrust(lowTrust);

      // Create decay config that makes lowTrust decay below threshold
      const decayConfigs = new Map<string, DecayConfig>();
      decayConfigs.set(highTrust.id, createDecayConfig(0));
      decayConfigs.set(lowTrust.id, {
        decayRate: 1e-3,
        lastVerified: new Date(Date.now() - 10_000_000).toISOString(),
        reinforcementHistory: [],
      });

      const pruned = graph.pruneDecayed(0.05, decayConfigs);
      expect(pruned).toBe(1);
      expect(graph.edges).toHaveLength(1);
    });

    it('avoids cycles during pathfinding', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();
      const b = await createTestAgent();
      const c = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      // Create a cycle: A→B→C→A, but we want path from A→C
      graph.addTrust(createDirectionalTrust(a, b, createTrustVector(0.9), ctx));
      graph.addTrust(createDirectionalTrust(b, c, createTrustVector(0.8), ctx));
      graph.addTrust(createDirectionalTrust(c, a, createTrustVector(0.7), ctx));

      const paths = graph.findTrustPaths(a, c);
      expect(paths.length).toBeGreaterThan(0);
      // Should find A→B→C, not loop infinitely
      expect(paths[0]!.links).toHaveLength(2);
    });
  });

  // ─── Trust Aggregation Tests ──────────────────────────────────────────────

  describe('Trust Aggregation', () => {
    it('aggregates assessments with equal weights', async () => {
      const a = await createTestAgent();
      const b = await createTestAgent();
      const target = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      const assessments = [
        createDirectionalTrust(a, target, createTrustVector(0.8), ctx),
        createDirectionalTrust(b, target, createTrustVector(0.6), ctx),
      ];

      const result = aggregateTrust(assessments);
      expect(result.reliability).toBeCloseTo(0.7, 5);
    });

    it('aggregates with custom assessor weights', async () => {
      const a = await createTestAgent();
      const b = await createTestAgent();
      const target = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      const assessments = [
        createDirectionalTrust(a, target, createTrustVector(1.0), ctx),
        createDirectionalTrust(b, target, createTrustVector(0.0), ctx),
      ];

      const weights = new Map<string, number>();
      weights.set(a.id, 3);
      weights.set(b.id, 1);

      const result = aggregateTrust(assessments, weights);
      expect(result.reliability).toBeCloseTo(0.75, 5);
    });

    it('returns zero vector for empty assessments', () => {
      const result = aggregateTrust([]);
      expect(trustMagnitude(result)).toBe(0);
    });

    it('computes consensus (minimum) trust', async () => {
      const a = await createTestAgent();
      const b = await createTestAgent();
      const target = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      const assessments = [
        createDirectionalTrust(
          a,
          target,
          createTrustVectorFromValues({
            reliability: 0.9,
            capability: 0.7,
            integrity: 0.8,
            benevolence: 0.6,
            predictability: 0.5,
            transparency: 0.4,
          }),
          ctx,
        ),
        createDirectionalTrust(
          b,
          target,
          createTrustVectorFromValues({
            reliability: 0.5,
            capability: 0.9,
            integrity: 0.6,
            benevolence: 0.8,
            predictability: 0.7,
            transparency: 0.3,
          }),
          ctx,
        ),
      ];

      const result = consensusTrust(assessments);
      expect(result.reliability).toBe(0.5);
      expect(result.capability).toBe(0.7);
      expect(result.integrity).toBe(0.6);
      expect(result.benevolence).toBe(0.6);
      expect(result.predictability).toBe(0.5);
      expect(result.transparency).toBe(0.3);
    });
  });

  // ─── Dispute Detection Tests ──────────────────────────────────────────────

  describe('Dispute Detection', () => {
    it('detects disputes when assessors disagree significantly', async () => {
      const a = await createTestAgent();
      const b = await createTestAgent();
      const target = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      const assessments = [
        createDirectionalTrust(a, target, createTrustVector(0.9), ctx),
        createDirectionalTrust(b, target, createTrustVector(0.2), ctx),
      ];

      const disputes = detectDisputes(assessments, 0.5);
      expect(disputes).toHaveLength(1);
      expect(disputes[0]!.maxSpread).toBeCloseTo(0.7, 5);
      expect(disputes[0]!.dimensions).toContain('reliability');
    });

    it('returns no disputes when assessors agree', async () => {
      const a = await createTestAgent();
      const b = await createTestAgent();
      const target = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      const assessments = [
        createDirectionalTrust(a, target, createTrustVector(0.8), ctx),
        createDirectionalTrust(b, target, createTrustVector(0.75), ctx),
      ];

      const disputes = detectDisputes(assessments, 0.1);
      expect(disputes).toHaveLength(0);
    });

    it('returns empty for single assessment', async () => {
      const a = await createTestAgent();
      const target = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      const assessments = [
        createDirectionalTrust(a, target, createTrustVector(0.8), ctx),
      ];

      expect(detectDisputes(assessments, 0.1)).toHaveLength(0);
    });
  });

  // ─── Trust Staking Tests ──────────────────────────────────────────────────

  describe('Trust Staking', () => {
    it('creates a trust stake with a content-addressed ID', async () => {
      const staker = await createTestAgent();
      const subject = await createTestAgent();
      const claim = mockCovenantDocument('c'.repeat(64));

      const stake = createTrustStake(staker, subject, claim, 0.3, 0.1, 0.2, 86_400_000);

      expect(stake.id).toBeTruthy();
      expect(stake.id).toHaveLength(64);
      expect(stake.status).toBe('active');
      expect(stake.stakedReputation).toBe(0.3);
      expect(stake.reward).toBe(0.1);
      expect(stake.penalty).toBe(0.2);
    });

    it('clamps staked values to [0, 1]', async () => {
      const staker = await createTestAgent();
      const subject = await createTestAgent();
      const claim = mockCovenantDocument('c'.repeat(64));

      const stake = createTrustStake(staker, subject, claim, 1.5, 2.0, -0.1, 86_400_000);

      expect(stake.stakedReputation).toBe(1);
      expect(stake.reward).toBe(1);
      expect(stake.penalty).toBe(0);
    });

    it('resolves stake as rewarded when proof matches', async () => {
      const staker = await createTestAgent();
      const subject = await createTestAgent();
      const covenantId = 'c'.repeat(64);
      const claim = mockCovenantDocument(covenantId);

      const stake = createTrustStake(staker, subject, claim, 0.3, 0.1, 0.2, 86_400_000);
      const proof = mockComplianceProof(covenantId);

      const { outcome, updatedStake } = resolveStake(stake, proof);

      expect(outcome.verified).toBe(true);
      expect(outcome.reputationDelta).toBe(0.1);
      expect(updatedStake.status).toBe('resolved_rewarded');
    });

    it('resolves stake as penalized when proof does not match', async () => {
      const staker = await createTestAgent();
      const subject = await createTestAgent();
      const claim = mockCovenantDocument('c'.repeat(64));

      const stake = createTrustStake(staker, subject, claim, 0.3, 0.1, 0.2, 86_400_000);
      const wrongProof = mockComplianceProof('d'.repeat(64));

      const { outcome, updatedStake } = resolveStake(stake, wrongProof);

      expect(outcome.verified).toBe(false);
      expect(outcome.reputationDelta).toBe(-0.2);
      expect(updatedStake.status).toBe('resolved_penalized');
    });

    it('resolves stake as penalized when no proof is provided', async () => {
      const staker = await createTestAgent();
      const subject = await createTestAgent();
      const claim = mockCovenantDocument('c'.repeat(64));

      const stake = createTrustStake(staker, subject, claim, 0.3, 0.1, 0.2, 86_400_000);

      const { outcome, updatedStake } = resolveStake(stake, null);

      expect(outcome.verified).toBe(false);
      expect(outcome.reputationDelta).toBe(-0.2);
      expect(updatedStake.status).toBe('resolved_penalized');
    });

    it('expires stake when past expiry time', async () => {
      const staker = await createTestAgent();
      const subject = await createTestAgent();
      const claim = mockCovenantDocument('c'.repeat(64));

      // Expire immediately
      const stake = createTrustStake(staker, subject, claim, 0.3, 0.1, 0.2, -1);

      const { outcome, updatedStake } = resolveStake(
        stake,
        mockComplianceProof(claim.id),
      );

      expect(outcome.verified).toBe(false);
      expect(updatedStake.status).toBe('expired');
    });
  });

  // ─── Vector Similarity Tests ─────────────────────────────────────────────

  describe('Vector Similarity', () => {
    it('dot product of identical vectors equals sum of squared components', () => {
      const v = createTrustVector(0.5);
      const dot = trustDotProduct(v, v);
      // 6 * (0.5 * 0.5) = 6 * 0.25 = 1.5
      expect(dot).toBeCloseTo(1.5, 10);
    });

    it('dot product of orthogonal-ish vectors is lower', () => {
      const a = createTrustVectorFromValues({
        reliability: 1, capability: 0, integrity: 1,
        benevolence: 0, predictability: 1, transparency: 0,
      });
      const b = createTrustVectorFromValues({
        reliability: 0, capability: 1, integrity: 0,
        benevolence: 1, predictability: 0, transparency: 1,
      });
      expect(trustDotProduct(a, b)).toBe(0);
    });

    it('cosine similarity of identical vectors is 1', () => {
      const v = createTrustVector(0.8);
      expect(trustCosineSimilarity(v, v)).toBeCloseTo(1, 10);
    });

    it('cosine similarity of proportional vectors is 1', () => {
      const a = createTrustVector(0.5);
      const b = createTrustVector(1.0);
      // Same direction, different magnitude
      expect(trustCosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });

    it('cosine similarity of zero vector is 0', () => {
      const zero = createTrustVector(0);
      const nonZero = createTrustVector(0.5);
      expect(trustCosineSimilarity(zero, nonZero)).toBe(0);
      expect(trustCosineSimilarity(nonZero, zero)).toBe(0);
    });

    it('cosine similarity of dissimilar vectors is low', () => {
      const a = createTrustVectorFromValues({
        reliability: 1, capability: 0, integrity: 1,
        benevolence: 0, predictability: 1, transparency: 0,
      });
      const b = createTrustVectorFromValues({
        reliability: 0, capability: 1, integrity: 0,
        benevolence: 1, predictability: 0, transparency: 1,
      });
      expect(trustCosineSimilarity(a, b)).toBe(0);
    });
  });

  // ─── Graph removeTrust Tests ───────────────────────────────────────────────

  describe('TrustGraph.removeTrust', () => {
    it('removes an edge by ID and rebuilds indices', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();
      const b = await createTestAgent();
      const c = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      const trustAB = createDirectionalTrust(a, b, createTrustVector(0.9), ctx);
      const trustAC = createDirectionalTrust(a, c, createTrustVector(0.5), ctx);
      graph.addTrust(trustAB);
      graph.addTrust(trustAC);

      expect(graph.edges).toHaveLength(2);
      const removed = graph.removeTrust(trustAB.id);
      expect(removed).toBe(true);
      expect(graph.edges).toHaveLength(1);

      // Should still find AC
      const result = graph.queryTrust(a, c);
      expect(result).not.toBeNull();
      expect(result!.reliability).toBe(0.5);

      // AB should be gone
      expect(graph.queryTrust(a, b)).toBeNull();
    });

    it('returns false for non-existent edge ID', () => {
      const graph = new TrustGraph();
      expect(graph.removeTrust('nonexistent')).toBe(false);
    });
  });

  // ─── Context-Filtered Pathfinding Tests ────────────────────────────────────

  describe('Context-Filtered Pathfinding', () => {
    it('only follows edges matching the specified context', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();
      const b = await createTestAgent();
      const c = await createTestAgent();

      const finCtx = createTrustContext('financial', 'payments');
      const medCtx = createTrustContext('medical', 'diagnostics');

      // A → B via finance, B → C via medicine
      graph.addTrust(createDirectionalTrust(a, b, createTrustVector(0.9), finCtx));
      graph.addTrust(createDirectionalTrust(b, c, createTrustVector(0.8), medCtx));

      // No path from A to C in finance context (B→C is medical)
      const finPaths = graph.findTrustPaths(a, c, 4, finCtx);
      expect(finPaths).toHaveLength(0);

      // But without context filter, path exists
      const allPaths = graph.findTrustPaths(a, c, 4);
      expect(allPaths).toHaveLength(1);
    });

    it('finds paths when all edges share the same context', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();
      const b = await createTestAgent();
      const c = await createTestAgent();
      const ctx = createTrustContext('logistics', 'delivery');

      graph.addTrust(createDirectionalTrust(a, b, createTrustVector(0.9), ctx));
      graph.addTrust(createDirectionalTrust(b, c, createTrustVector(0.8), ctx));

      const paths = graph.findTrustPaths(a, c, 4, ctx);
      expect(paths).toHaveLength(1);
      expect(paths[0]!.links).toHaveLength(2);
    });
  });

  // ─── Robustness Tests ──────────────────────────────────────────────────────

  describe('Robustness', () => {
    it('clamp01 handles NaN by returning 0', () => {
      const v = createTrustVector(NaN);
      for (const dim of CORE_DIMENSIONS) {
        expect(v[dim]).toBe(0);
      }
    });

    it('clamp01 handles +Infinity by returning 1', () => {
      const v = createTrustVector(Infinity);
      for (const dim of CORE_DIMENSIONS) {
        expect(v[dim]).toBe(1);
      }
    });

    it('clamp01 handles -Infinity by returning 0', () => {
      const v = createTrustVector(-Infinity);
      for (const dim of CORE_DIMENSIONS) {
        expect(v[dim]).toBe(0);
      }
    });

    it('createDecayConfig rejects negative decay rate', () => {
      expect(() => createDecayConfig(-1)).toThrow('non-negative finite');
    });

    it('createDecayConfig rejects NaN decay rate', () => {
      expect(() => createDecayConfig(NaN)).toThrow('non-negative finite');
    });

    it('createDecayConfig rejects Infinity decay rate', () => {
      expect(() => createDecayConfig(Infinity)).toThrow('non-negative finite');
    });

    it('resolveStake rejects already-resolved stake', async () => {
      const staker = await createTestAgent();
      const subject = await createTestAgent();
      const covenantId = 'c'.repeat(64);
      const claim = mockCovenantDocument(covenantId);

      const stake = createTrustStake(staker, subject, claim, 0.3, 0.1, 0.2, 86_400_000);
      const proof = mockComplianceProof(covenantId);

      const { updatedStake } = resolveStake(stake, proof);
      expect(updatedStake.status).toBe('resolved_rewarded');

      // Trying to resolve again should throw
      expect(() => resolveStake(updatedStake, proof)).toThrow("status is 'resolved_rewarded'");
    });

    it('resolveStake rejects penalized stake from being resolved again', async () => {
      const staker = await createTestAgent();
      const subject = await createTestAgent();
      const claim = mockCovenantDocument('c'.repeat(64));

      const stake = createTrustStake(staker, subject, claim, 0.3, 0.1, 0.2, 86_400_000);
      const { updatedStake } = resolveStake(stake, null);
      expect(updatedStake.status).toBe('resolved_penalized');

      expect(() => resolveStake(updatedStake, null)).toThrow("status is 'resolved_penalized'");
    });

    it('weightedAverageTrustVectors handles all-zero weights gracefully', () => {
      const v = createTrustVector(0.8);
      const result = weightedAverageTrustVectors([v], [0]);
      for (const dim of CORE_DIMENSIONS) {
        expect(result[dim]).toBe(0);
      }
    });

    it('createTrustContext rejects empty domain', () => {
      expect(() => createTrustContext('', 'scope')).toThrow('domain must be a non-empty string');
    });

    it('createTrustContext rejects whitespace-only domain', () => {
      expect(() => createTrustContext('   ', 'scope')).toThrow('domain must be a non-empty string');
    });

    it('createTrustContext rejects empty scope', () => {
      expect(() => createTrustContext('domain', '')).toThrow('scope must be a non-empty string');
    });

    it('createDirectionalTrust rejects null trustor', () => {
      const ctx = createTrustContext('general', 'default');
      expect(() =>
        createDirectionalTrust(null as never, null as never, createTrustVector(0.5), ctx),
      ).toThrow('trustor must be a valid AgentIdentity');
    });

    it('createTrustChain rejects attenuation of 0', () => {
      expect(() => createTrustChain([], 0)).toThrow('attenuation must be in (0, 1]');
    });

    it('createTrustChain rejects negative attenuation', () => {
      expect(() => createTrustChain([], -0.5)).toThrow('attenuation must be in (0, 1]');
    });

    it('createTrustChain rejects attenuation > 1', () => {
      expect(() => createTrustChain([], 1.5)).toThrow('attenuation must be in (0, 1]');
    });

    it('createTrustChain rejects non-integer maxLength', () => {
      expect(() => createTrustChain([], 0.7, 3.5)).toThrow('maxLength must be a positive integer');
    });

    it('createTrustChain rejects maxLength of 0', () => {
      expect(() => createTrustChain([], 0.7, 0)).toThrow('maxLength must be a positive integer');
    });

    it('createTrustStake rejects null staker', () => {
      const claim = mockCovenantDocument('c'.repeat(64));
      expect(() =>
        createTrustStake(null as never, null as never, claim, 0.3, 0.1, 0.2, 86_400_000),
      ).toThrow('staker must be a valid AgentIdentity');
    });

    it('createTrustStake rejects null claim', async () => {
      const staker = await createTestAgent();
      const subject = await createTestAgent();
      expect(() =>
        createTrustStake(staker, subject, null as never, 0.3, 0.1, 0.2, 86_400_000),
      ).toThrow('claim must be a valid CovenantDocument');
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('handles max trust (all 1.0)', () => {
      const v = createTrustVector(1);
      expect(trustMagnitude(v)).toBeCloseTo(1, 10);
      const scaled = scaleTrustVector(v, 1);
      for (const dim of CORE_DIMENSIONS) {
        expect(scaled[dim]).toBe(1);
      }
    });

    it('handles zero trust (all 0.0)', () => {
      const v = createTrustVector(0);
      expect(trustMagnitude(v)).toBe(0);
      const multiplied = multiplyTrustVectors(v, createTrustVector(0.9));
      for (const dim of CORE_DIMENSIONS) {
        expect(multiplied[dim]).toBe(0);
      }
    });

    it('self-trust creates a valid edge', async () => {
      const a = await createTestAgent();
      const ctx = createTrustContext('general', 'default');
      const selfTrust = createDirectionalTrust(a, a, createTrustVector(1), ctx);

      expect(selfTrust.trustor.id).toBe(selfTrust.trustee.id);
      expect(selfTrust.id).toBeTruthy();
    });

    it('graph handles self-trust edges', async () => {
      const graph = new TrustGraph();
      const a = await createTestAgent();
      const ctx = createTrustContext('general', 'default');

      graph.addTrust(createDirectionalTrust(a, a, createTrustVector(1), ctx));

      expect(graph.agents.size).toBe(1);
      expect(graph.edges).toHaveLength(1);

      const result = graph.queryTrust(a, a);
      expect(result).not.toBeNull();
      expect(result!.reliability).toBe(1);
    });

    it('CORE_DIMENSIONS has exactly 6 entries', () => {
      expect(CORE_DIMENSIONS).toHaveLength(6);
    });

    it('exports default constants with expected values', () => {
      expect(DEFAULT_ATTENUATION).toBe(0.7);
      expect(DEFAULT_MAX_CHAIN_LENGTH).toBe(6);
      expect(DEFAULT_DECAY_RATE).toBeGreaterThan(0);
    });
  });
});
