# @nobulex/composability

Covenant compatibility checking, agent matching, and trust topology analysis. This package answers questions like: "Can these two agents work together?" and "What does the trust network look like across a set of agents?"

## Installation

```bash
npm install @nobulex/composability
```

**Requirements:** Node.js >= 18

**Dependencies:** `@nobulex/core-types`, `@nobulex/covenant-lang`

## Quick Usage

```typescript
import {
  checkCompatibility,
  findCompatibleAgents,
  analyzeTopology,
  mergeCovenants,
} from '@nobulex/composability';
import { parseSource } from '@nobulex/covenant-lang';

const specA = parseSource('covenant Reader { permit read; forbid write; }');
const specB = parseSource('covenant Writer { permit write; forbid read; }');
const specC = parseSource('covenant ReadOnly { permit read; forbid delete; }');

// Check pairwise compatibility
const result = checkCompatibility(specA, specB);
console.log(result.compatible); // false -- A forbids write, B permits write
console.log(result.conflicts);  // [{action: 'read', ...}, {action: 'write', ...}]
console.log(result.score);      // 0..1 compatibility score

// Find compatible agents from a pool
const agents = [
  { did: 'did:nobulex:a', covenant: specA, capabilities: ['read'] },
  { did: 'did:nobulex:b', covenant: specB, capabilities: ['write'] },
  { did: 'did:nobulex:c', covenant: specC, capabilities: ['read'] },
];

const matches = findCompatibleAgents(specA, agents, 0.5);
console.log(matches.map(m => m.agent.did)); // compatible agents

// Analyze trust topology
const topology = analyzeTopology(agents, 0.5);
console.log(topology.clusters);     // connected components
console.log(topology.density);      // graph density
console.log(topology.isolatedNodes); // agents with no compatible peers

// Merge two compatible covenants
const merged = mergeCovenants(specA, specC, 'CombinedPolicy');
console.log(merged.statements.length); // sum of both
```

## API Reference

### Functions

#### `checkCompatibility(a: CovenantSpec, b: CovenantSpec): CompatibilityResult`

Check compatibility between two covenants. Two covenants are compatible if they have no conflicting rules for the same actions (e.g., one unconditionally permits what the other unconditionally forbids).

```typescript
const result = checkCompatibility(specA, specB);
console.log(result.compatible);     // boolean
console.log(result.conflicts);      // Conflict[]
console.log(result.overlapActions); // actions present in both specs
console.log(result.score);         // 0..1, 1 = fully compatible
```

Also detects conflicting requirements on the same field (e.g., `field >= 0.9` in one spec and `field <= 0.1` in another).

#### `findCompatibleAgents(target: CovenantSpec, agents: readonly AgentProfile[], minScore?: number): AgentMatch[]`

Find agents whose covenants are compatible with a target covenant. Results are sorted by compatibility score (descending).

| Parameter  | Type                      | Default | Description                       |
| ---------- | ------------------------- | ------- | --------------------------------- |
| `target`   | `CovenantSpec`            | --      | Covenant to match against         |
| `agents`   | `readonly AgentProfile[]` | --      | Pool of agents to search          |
| `minScore` | `number`                  | `0.5`   | Minimum compatibility score (0-1) |

```typescript
const matches = findCompatibleAgents(targetSpec, agentPool, 0.7);
for (const { agent, compatibility } of matches) {
  console.log(`${agent.did}: score ${compatibility.score}`);
}
```

#### `analyzeTopology(agents: readonly AgentProfile[], minScore?: number): TopologyAnalysis`

Analyze the trust topology of a set of agents. Builds a graph where agents are nodes and compatibility relationships are weighted edges. Uses union-find to identify clusters (connected components).

| Parameter  | Type                      | Default | Description                           |
| ---------- | ------------------------- | ------- | ------------------------------------- |
| `agents`   | `readonly AgentProfile[]` | --      | Agent profiles to analyze             |
| `minScore` | `number`                  | `0.5`   | Minimum score to create an edge       |

```typescript
const topo = analyzeTopology(agents);
console.log(topo.nodes);         // all agent DIDs
console.log(topo.edges);         // TrustEdge[] with from, to, weight
console.log(topo.clusters);      // string[][] -- connected components
console.log(topo.density);       // actual edges / max possible edges
console.log(topo.isolatedNodes); // agents with no compatible peers
```

#### `mergeCovenants(a: CovenantSpec, b: CovenantSpec, name?: string): CovenantSpec`

Merge two covenants into one, combining all statements and requirements. Forbid rules from both are preserved; forbid-wins semantics applies at evaluation time.

```typescript
const merged = mergeCovenants(specA, specB); // name defaults to "Merged_A_B"
const merged2 = mergeCovenants(specA, specB, 'CustomName');
```

### Interfaces

#### `CompatibilityResult`

| Field            | Type                 | Description                              |
| ---------------- | -------------------- | ---------------------------------------- |
| `compatible`     | `boolean`            | True if no conflicts exist               |
| `conflicts`      | `readonly Conflict[]`| All detected conflicts                   |
| `overlapActions`  | `readonly string[]` | Actions that appear in both specs        |
| `score`          | `number`             | Compatibility score from 0 (incompatible) to 1 (fully compatible) |

#### `Conflict`

| Field    | Type     | Description                          |
| -------- | -------- | ------------------------------------ |
| `action` | `string` | The conflicting action name          |
| `specA`  | `string` | Name of the first covenant           |
| `specB`  | `string` | Name of the second covenant          |
| `reason` | `string` | Human-readable conflict description  |

#### `AgentProfile`

| Field          | Type                   | Description                    |
| -------------- | ---------------------- | ------------------------------ |
| `did`          | `string`               | Agent's DID                    |
| `covenant`     | `CovenantSpec`         | Agent's covenant specification |
| `capabilities` | `readonly string[]`    | Agent's declared capabilities  |

#### `AgentMatch`

| Field           | Type                  | Description                     |
| --------------- | --------------------- | ------------------------------- |
| `agent`         | `AgentProfile`        | The matched agent               |
| `compatibility` | `CompatibilityResult` | Compatibility details and score |

#### `TrustEdge`

| Field          | Type     | Description                          |
| -------------- | -------- | ------------------------------------ |
| `from`         | `string` | Source agent DID                     |
| `to`           | `string` | Target agent DID                     |
| `covenantName` | `string` | Combined covenant names              |
| `weight`       | `number` | Compatibility score (0-1)            |

#### `TopologyAnalysis`

| Field           | Type                    | Description                    |
| --------------- | ----------------------- | ------------------------------ |
| `nodes`         | `readonly string[]`     | All agent DIDs                 |
| `edges`         | `readonly TrustEdge[]`  | Compatibility edges            |
| `clusters`      | `readonly string[][]`   | Connected components           |
| `density`       | `number`                | Graph density (0-1)            |
| `isolatedNodes` | `readonly string[]`     | Agents with no edges           |

### Re-exported Types (from `@nobulex/core-types`)

- `CovenantSpec`
- `CovenantStatement`
- `CovenantRequirement`

## License

MIT
