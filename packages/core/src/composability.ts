/**
 * Covenant compatibility and trust topology analysis.
 *
 * Merged from @nobulex/composability into @nobulex/core.
 *
 * Check whether two covenants are compatible, find compatible agents
 * for a given covenant, and analyze the trust topology of a multi-agent system.
 */

import type { CovenantSpec, CovenantStatement, CovenantRequirement } from './types/index';

export type { CovenantSpec, CovenantStatement, CovenantRequirement } from './types/index';


/** Result of a compatibility check between two covenants. */
export interface CompatibilityResult {
  readonly compatible: boolean;
  readonly conflicts: readonly Conflict[];
  readonly overlapActions: readonly string[];
  readonly score: number;
}

export interface Conflict {
  readonly action: string;
  readonly specA: string;
  readonly specB: string;
  readonly reason: string;
}

/**
 * Check compatibility between two covenants.
 *
 * Two covenants are compatible if they don't have conflicting rules
 * for the same actions (e.g., one permits what the other forbids
 * unconditionally).
 *
 * @param a - First covenant.
 * @param b - Second covenant.
 * @returns CompatibilityResult with conflicts and a compatibility score.
 */
export function checkCompatibility(a: CovenantSpec, b: CovenantSpec): CompatibilityResult {
  const conflicts: Conflict[] = [];

  // Get all actions from both specs
  const actionsA = new Map<string, CovenantStatement[]>();
  for (const stmt of a.statements) {
    if (!actionsA.has(stmt.action)) actionsA.set(stmt.action, []);
    actionsA.get(stmt.action)!.push(stmt);
  }

  const actionsB = new Map<string, CovenantStatement[]>();
  for (const stmt of b.statements) {
    if (!actionsB.has(stmt.action)) actionsB.set(stmt.action, []);
    actionsB.get(stmt.action)!.push(stmt);
  }

  // Find overlapping actions
  const allActions = new Set([...actionsA.keys(), ...actionsB.keys()]);
  const overlapActions: string[] = [];

  for (const action of allActions) {
    const stmtsA = actionsA.get(action) ?? [];
    const stmtsB = actionsB.get(action) ?? [];

    if (stmtsA.length > 0 && stmtsB.length > 0) {
      overlapActions.push(action);
    }

    // Check for direct conflicts: A permits unconditionally, B forbids unconditionally (or vice versa)
    for (const sa of stmtsA) {
      for (const sb of stmtsB) {
        if (sa.effect !== sb.effect) {
          const aUnconditional = sa.conditions.length === 0;
          const bUnconditional = sb.conditions.length === 0;

          if (aUnconditional && bUnconditional) {
            conflicts.push({
              action,
              specA: a.name,
              specB: b.name,
              reason: `${a.name} ${sa.effect}s '${action}' unconditionally, but ${b.name} ${sb.effect}s it unconditionally`,
            });
          } else if (aUnconditional || bUnconditional) {
            conflicts.push({
              action,
              specA: a.name,
              specB: b.name,
              reason: `${a.name} ${sa.effect}s '${action}'${aUnconditional ? ' unconditionally' : ' conditionally'}, but ${b.name} ${sb.effect}s it${bUnconditional ? ' unconditionally' : ' conditionally'}`,
            });
          }
          // Conditional + conditional conflicts are potential but not definite
        }
      }
    }
  }

  // Check requirement conflicts
  const reqFieldsA = new Map<string, CovenantRequirement>();
  for (const req of a.requirements) {
    reqFieldsA.set(req.field, req);
  }

  for (const reqB of b.requirements) {
    const reqA = reqFieldsA.get(reqB.field);
    if (reqA && areRequirementsConflicting(reqA, reqB)) {
      conflicts.push({
        action: `requirement:${reqB.field}`,
        specA: a.name,
        specB: b.name,
        reason: `Conflicting requirements on '${reqB.field}': ${a.name} requires ${reqA.operator} ${reqA.value}, ${b.name} requires ${reqB.operator} ${reqB.value}`,
      });
    }
  }

  // Compute compatibility score (0-1)
  const totalRules = a.statements.length + b.statements.length + a.requirements.length + b.requirements.length;
  const score = totalRules > 0 ? Math.max(0, 1 - conflicts.length / totalRules) : 1;

  return {
    compatible: conflicts.length === 0,
    conflicts,
    overlapActions,
    score,
  };
}

function areRequirementsConflicting(a: CovenantRequirement, b: CovenantRequirement): boolean {
  if (typeof a.value !== 'number' || typeof b.value !== 'number') return false;

  // Detect impossible ranges (e.g., field >= 0.9 AND field <= 0.1)
  if ((a.operator === '>=' || a.operator === '>') && (b.operator === '<=' || b.operator === '<')) {
    return a.value > b.value;
  }
  if ((a.operator === '<=' || a.operator === '<') && (b.operator === '>=' || b.operator === '>')) {
    return b.value > a.value;
  }
  return false;
}

// agent matching

// An agent with a covenant and capabilities
export interface AgentProfile {
  readonly did: string;
  readonly covenant: CovenantSpec;
  readonly capabilities: readonly string[];
}

/** Result of searching for compatible agents. */
export interface AgentMatch {
  readonly agent: AgentProfile;
  readonly compatibility: CompatibilityResult;
}

/**
 * Find agents whose covenants are compatible with a target covenant.
 *
 * @param target - The covenant to match against.
 * @param agents - Pool of agents to search.
 * @param minScore - Minimum compatibility score (0-1). Default: 0.5.
 * @returns Array of matching agents, sorted by compatibility score (descending).
 */
export function findCompatibleAgents(
  target: CovenantSpec,
  agents: readonly AgentProfile[],
  minScore: number = 0.5,
): AgentMatch[] {
  const matches: AgentMatch[] = [];

  for (const agent of agents) {
    const compatibility = checkCompatibility(target, agent.covenant);
    if (compatibility.score >= minScore) {
      matches.push({ agent, compatibility });
    }
  }

  return matches.sort((a, b) => b.compatibility.score - a.compatibility.score);
}

// trust topology

/** An edge in the trust graph. */
export interface TrustEdge {
  readonly from: string;
  readonly to: string;
  readonly covenantName: string;
  readonly weight: number;
}

/** Analysis of a trust topology. */
export interface TopologyAnalysis {
  readonly nodes: readonly string[];
  readonly edges: readonly TrustEdge[];
  readonly clusters: readonly string[][];
  readonly density: number;
  readonly isolatedNodes: readonly string[];
}

/**
 * Analyze the trust topology of a set of agents and their covenants.
 *
 * Builds a graph where agents are nodes and compatibility relationships
 * are edges. Identifies clusters (connected components), density, and
 * isolated nodes.
 *
 * @param agents - Array of agent profiles.
 * @param minScore - Minimum compatibility score to create an edge. Default: 0.5.
 * @returns TopologyAnalysis with graph metrics.
 */
export function analyzeTopology(
  agents: readonly AgentProfile[],
  minScore: number = 0.5,
): TopologyAnalysis {
  const nodes = agents.map(a => a.did);
  const edges: TrustEdge[] = [];

  // Build edges from pairwise compatibility
  for (let i = 0; i < agents.length; i++) {
    // note: order matters, tests rely on this
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i]!;
      const b = agents[j]!;
      const compat = checkCompatibility(a.covenant, b.covenant);
      if (compat.score >= minScore) {
        edges.push({
          from: a.did,
          to: b.did,
          covenantName: `${a.covenant.name}↔${b.covenant.name}`,
          weight: compat.score,
        });
      }
    }
  }

  // Find connected components (clusters) using union-find
  const parent = new Map<string, string>();
  for (const node of nodes) parent.set(node, node);

  function find(x: string): string {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  }

  function union(x: string, y: string): void {
    parent.set(find(x), find(y));
  }

  for (const edge of edges) {
    union(edge.from, edge.to);
  }

  // Group nodes into clusters
  const clusterMap = new Map<string, string[]>();
  for (const node of nodes) {
    const root = find(node);
    if (!clusterMap.has(root)) clusterMap.set(root, []);
    clusterMap.get(root)!.push(node);
  }
  const clusters = [...clusterMap.values()].filter(c => c.length > 1);
  const connectedNodes = new Set(edges.flatMap(e => [e.from, e.to]));
  const isolatedNodes = nodes.filter(n => !connectedNodes.has(n));

  // Density = actual edges / max possible edges
  const maxEdges = nodes.length > 1 ? (nodes.length * (nodes.length - 1)) / 2 : 1;
  const density = edges.length / maxEdges;

  return { nodes, edges, clusters, density, isolatedNodes };
}

/**
 * Merge two covenants into one, combining all rules.
 *
 * Statements from both specs are concatenated. Forbid rules from
 * both are preserved (forbid-wins semantics applies at evaluation time).
 *
 * @param a - First covenant.
 * @param b - Second covenant.
 * @param name - Name for the merged covenant. Default: "Merged_{a.name}_{b.name}".
 * @returns A new CovenantSpec combining both covenants.
 */
export function mergeCovenants(
  a: CovenantSpec,
  b: CovenantSpec,
  name?: string,
): CovenantSpec {
  return {
    name: name ?? `Merged_${a.name}_${b.name}`,
    statements: [...a.statements, ...b.statements],
    requirements: [...a.requirements, ...b.requirements],
  };
}
