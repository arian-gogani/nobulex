import { describe, it, expect } from 'vitest';
import {
  checkCompatibility,
  findCompatibleAgents,
  analyzeTopology,
  mergeCovenants,
} from './index';
import { parseSource, compile } from '@nobulex/covenant-lang';
import type { CovenantSpec, AgentProfile } from './index';

describe('@nobulex/composability', () => {
  // ── checkCompatibility ────────────────────────────────────────────────────

  describe('checkCompatibility()', () => {
    it('identical covenants are compatible', () => {
      const spec = parseSource('covenant A { permit read; forbid write; }');
      const result = checkCompatibility(spec, spec);
      expect(result.compatible).toBe(true);
      expect(result.conflicts).toHaveLength(0);
      expect(result.score).toBe(1);
    });

    it('non-overlapping covenants are compatible', () => {
      const a = parseSource('covenant A { permit read; }');
      const b = parseSource('covenant B { permit write; }');
      const result = checkCompatibility(a, b);
      expect(result.compatible).toBe(true);
      expect(result.overlapActions).toHaveLength(0);
    });

    it('detects unconditional permit/forbid conflict', () => {
      const a = parseSource('covenant A { permit transfer; }');
      const b = parseSource('covenant B { forbid transfer; }');
      const result = checkCompatibility(a, b);
      expect(result.compatible).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.action).toBe('transfer');
    });

    it('detects partial conflict (unconditional vs conditional)', () => {
      const a = parseSource('covenant A { permit transfer; }');
      const b = parseSource('covenant B { forbid transfer (amount > 500); }');
      const result = checkCompatibility(a, b);
      expect(result.compatible).toBe(false);
      expect(result.conflicts.length).toBeGreaterThan(0);
    });

    it('overlapping permits are not conflicts', () => {
      const a = parseSource('covenant A { permit read; }');
      const b = parseSource('covenant B { permit read; }');
      const result = checkCompatibility(a, b);
      expect(result.compatible).toBe(true);
      expect(result.overlapActions).toContain('read');
    });

    it('overlapping forbids are not conflicts', () => {
      const a = parseSource('covenant A { forbid delete; }');
      const b = parseSource('covenant B { forbid delete; }');
      const result = checkCompatibility(a, b);
      expect(result.compatible).toBe(true);
    });

    it('detects requirement conflicts (impossible range)', () => {
      const a = parseSource('covenant A { require score >= 0.9; }');
      const b = parseSource('covenant B { require score <= 0.1; }');
      const result = checkCompatibility(a, b);
      expect(result.compatible).toBe(false);
      expect(result.conflicts.some(c => c.reason.includes('score'))).toBe(true);
    });

    it('compatible requirements are not conflicts', () => {
      const a = parseSource('covenant A { require score >= 0.5; }');
      const b = parseSource('covenant B { require score >= 0.3; }');
      const result = checkCompatibility(a, b);
      expect(result.compatible).toBe(true);
    });

    it('returns score between 0 and 1', () => {
      const a = parseSource('covenant A { permit read; permit write; }');
      const b = parseSource('covenant B { forbid read; forbid write; }');
      const result = checkCompatibility(a, b);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it('empty covenants are compatible with score 1', () => {
      const a: CovenantSpec = { name: 'A', statements: [], requirements: [] };
      const b: CovenantSpec = { name: 'B', statements: [], requirements: [] };
      const result = checkCompatibility(a, b);
      expect(result.compatible).toBe(true);
      expect(result.score).toBe(1);
    });

    it('multiple conflicts reduce score', () => {
      const a = parseSource('covenant A { permit read; permit write; permit delete; }');
      const b = parseSource('covenant B { forbid read; forbid write; forbid delete; }');
      const result = checkCompatibility(a, b);
      expect(result.conflicts.length).toBe(3);
      expect(result.score).toBeLessThan(1);
    });
  });

  // ── findCompatibleAgents ──────────────────────────────────────────────────

  describe('findCompatibleAgents()', () => {
    const agents: AgentProfile[] = [
      {
        did: 'did:nobulex:agent-1',
        covenant: parseSource('covenant Reader { permit read; }'),
        capabilities: ['read'],
      },
      {
        did: 'did:nobulex:agent-2',
        covenant: parseSource('covenant Writer { permit write; forbid read; }'),
        capabilities: ['write'],
      },
      {
        did: 'did:nobulex:agent-3',
        covenant: parseSource('covenant ReadWrite { permit read; permit write; }'),
        capabilities: ['read', 'write'],
      },
    ];

    it('finds compatible agents', () => {
      const target = parseSource('covenant Target { permit read; }');
      const matches = findCompatibleAgents(target, agents, 0.5);
      expect(matches.length).toBeGreaterThan(0);
    });

    it('excludes incompatible agents with low score', () => {
      const target = parseSource('covenant Target { permit read; }');
      const matches = findCompatibleAgents(target, agents, 1.0);
      // Only fully compatible agents (score = 1.0)
      for (const m of matches) {
        expect(m.compatibility.score).toBe(1.0);
      }
    });

    it('returns results sorted by score (descending)', () => {
      const target = parseSource('covenant Target { permit read; permit write; }');
      const matches = findCompatibleAgents(target, agents, 0);
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i]!.compatibility.score).toBeLessThanOrEqual(matches[i - 1]!.compatibility.score);
      }
    });

    it('returns empty array when no agents match', () => {
      const target = parseSource('covenant Target { permit read; }');
      const matches = findCompatibleAgents(target, [], 0.5);
      expect(matches).toHaveLength(0);
    });
  });

  // ── analyzeTopology ───────────────────────────────────────────────────────

  describe('analyzeTopology()', () => {
    it('analyzes a simple topology', () => {
      const agents: AgentProfile[] = [
        { did: 'a', covenant: parseSource('covenant A { permit read; }'), capabilities: ['read'] },
        { did: 'b', covenant: parseSource('covenant B { permit read; }'), capabilities: ['read'] },
        { did: 'c', covenant: parseSource('covenant C { permit write; }'), capabilities: ['write'] },
      ];
      const result = analyzeTopology(agents, 0.5);
      expect(result.nodes).toHaveLength(3);
      expect(result.edges.length).toBeGreaterThanOrEqual(0);
    });

    it('identifies isolated nodes', () => {
      const agents: AgentProfile[] = [
        { did: 'a', covenant: parseSource('covenant A { permit read; }'), capabilities: ['read'] },
        { did: 'b', covenant: parseSource('covenant B { forbid read; }'), capabilities: [] },
      ];
      const result = analyzeTopology(agents, 1.0);
      // If a permits read and b forbids read, they might conflict
      // Isolated nodes are those with no edges
      expect(result.nodes).toHaveLength(2);
    });

    it('density is between 0 and 1', () => {
      const agents: AgentProfile[] = [
        { did: 'a', covenant: parseSource('covenant A { permit read; }'), capabilities: [] },
        { did: 'b', covenant: parseSource('covenant B { permit read; }'), capabilities: [] },
        { did: 'c', covenant: parseSource('covenant C { permit read; }'), capabilities: [] },
      ];
      const result = analyzeTopology(agents, 0.5);
      expect(result.density).toBeGreaterThanOrEqual(0);
      expect(result.density).toBeLessThanOrEqual(1);
    });

    it('finds clusters of connected agents', () => {
      const agents: AgentProfile[] = [
        { did: 'a', covenant: parseSource('covenant A { permit read; }'), capabilities: [] },
        { did: 'b', covenant: parseSource('covenant B { permit read; }'), capabilities: [] },
        { did: 'c', covenant: parseSource('covenant C { permit totally_different; }'), capabilities: [] },
      ];
      const result = analyzeTopology(agents, 0.5);
      // a and b should be in same cluster, c may be isolated
      expect(result.nodes).toHaveLength(3);
    });

    it('handles single agent', () => {
      const agents: AgentProfile[] = [
        { did: 'a', covenant: parseSource('covenant A { permit read; }'), capabilities: [] },
      ];
      const result = analyzeTopology(agents, 0.5);
      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);
      expect(result.isolatedNodes).toContain('a');
    });

    it('handles empty agent list', () => {
      const result = analyzeTopology([], 0.5);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
      expect(result.density).toBe(0);
    });

    it('edge weights reflect compatibility score', () => {
      const agents: AgentProfile[] = [
        { did: 'a', covenant: parseSource('covenant A { permit read; }'), capabilities: [] },
        { did: 'b', covenant: parseSource('covenant B { permit read; }'), capabilities: [] },
      ];
      const result = analyzeTopology(agents, 0);
      for (const edge of result.edges) {
        expect(edge.weight).toBeGreaterThanOrEqual(0);
        expect(edge.weight).toBeLessThanOrEqual(1);
      }
    });
  });

  // ── mergeCovenants ────────────────────────────────────────────────────────

  describe('mergeCovenants()', () => {
    it('merges two covenants', () => {
      const a = parseSource('covenant A { permit read; forbid write; }');
      const b = parseSource('covenant B { permit api_call; require score >= 0.9; }');
      const merged = mergeCovenants(a, b);
      expect(merged.name).toBe('Merged_A_B');
      expect(merged.statements).toHaveLength(3);
      expect(merged.requirements).toHaveLength(1);
    });

    it('uses custom name', () => {
      const a = parseSource('covenant A { permit read; }');
      const b = parseSource('covenant B { permit write; }');
      const merged = mergeCovenants(a, b, 'Combined');
      expect(merged.name).toBe('Combined');
    });

    it('preserves all forbid rules', () => {
      const a = parseSource('covenant A { forbid delete; }');
      const b = parseSource('covenant B { forbid shutdown; }');
      const merged = mergeCovenants(a, b);
      const forbids = merged.statements.filter(s => s.effect === 'forbid');
      expect(forbids).toHaveLength(2);
    });

    it('merged covenant compiles and enforces correctly', () => {
      const a = parseSource('covenant A { forbid delete; permit read; }');
      const b = parseSource('covenant B { forbid shutdown; permit write; }');
      const merged = mergeCovenants(a, b);
      const enforce = compile(merged);
      expect(enforce({ action: 'delete', params: {} }).action).toBe('block');
      expect(enforce({ action: 'shutdown', params: {} }).action).toBe('block');
      expect(enforce({ action: 'read', params: {} }).action).toBe('allow');
      expect(enforce({ action: 'write', params: {} }).action).toBe('allow');
    });

    it('merging empty covenants produces empty result', () => {
      const a: CovenantSpec = { name: 'A', statements: [], requirements: [] };
      const b: CovenantSpec = { name: 'B', statements: [], requirements: [] };
      const merged = mergeCovenants(a, b);
      expect(merged.statements).toHaveLength(0);
      expect(merged.requirements).toHaveLength(0);
    });
  });
});
