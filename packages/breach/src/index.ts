export type {
  TrustStatus,
  BreachAttestation,
  TrustNode,
  BreachEvent,
} from './types.js';

import type { KeyPair, HashHex } from '@stele/crypto';
import type { Severity } from '@stele/ccl';
import {
  sha256Object,
  canonicalizeJson,
  signString,
  verify,
  toHex,
  fromHex,
  timestamp,
} from '@stele/crypto';

import type {
  BreachAttestation,
  TrustNode,
  TrustStatus,
  BreachEvent,
} from './types.js';

/**
 * Map severity to recommended action.
 */
function recommendedActionForSeverity(
  severity: Severity,
): 'revoke' | 'restrict' | 'monitor' | 'notify' {
  switch (severity) {
    case 'critical':
      return 'revoke';
    case 'high':
      return 'restrict';
    case 'medium':
      return 'monitor';
    case 'low':
      return 'notify';
    default: {
      const _exhaustive: never = severity;
      throw new Error(`Unknown severity: ${_exhaustive}`);
    }
  }
}

/**
 * Map severity to the trust status applied to the violator.
 */
function statusForSeverity(severity: Severity): TrustStatus {
  switch (severity) {
    case 'critical':
      return 'revoked';
    case 'high':
      return 'restricted';
    case 'medium':
      return 'degraded';
    case 'low':
      return 'trusted';
    default: {
      const _exhaustive: never = severity;
      throw new Error(`Unknown severity: ${_exhaustive}`);
    }
  }
}

/**
 * Degrade a trust status by one level.
 * revoked -> restricted -> degraded -> (stop)
 */
function degradeStatus(status: TrustStatus): TrustStatus | null {
  switch (status) {
    case 'revoked':
      return 'restricted';
    case 'restricted':
      return 'degraded';
    default:
      return null;
  }
}

/**
 * Numeric ordering of trust statuses for comparison.
 * Lower number means worse trust.
 */
function statusSeverityRank(status: TrustStatus): number {
  switch (status) {
    case 'revoked':
      return 0;
    case 'restricted':
      return 1;
    case 'degraded':
      return 2;
    case 'trusted':
      return 3;
    case 'unknown':
      return 4;
  }
}

/**
 * Returns the worse (lower-ranked) of two trust statuses.
 */
function worseStatus(a: TrustStatus, b: TrustStatus): TrustStatus {
  return statusSeverityRank(a) <= statusSeverityRank(b) ? a : b;
}

/**
 * Create and sign a breach attestation.
 *
 * Constructs the attestation object, determines the recommended action from
 * the severity, computes the content hash as the attestation ID, and signs
 * the canonical JSON with the reporter's key pair.
 */
export async function createBreachAttestation(
  covenantId: HashHex,
  violatorIdentityHash: HashHex,
  violatedConstraint: string,
  severity: Severity,
  action: string,
  resource: string,
  evidenceHash: HashHex,
  affectedCovenants: HashHex[],
  reporterKeyPair: KeyPair,
): Promise<BreachAttestation> {
  const recommendedAction = recommendedActionForSeverity(severity);
  const reportedAt = timestamp();
  const reporterPublicKey = reporterKeyPair.publicKeyHex;

  // Build the content object (everything except id and signature)
  const content = {
    covenantId,
    violatorIdentityHash,
    violatedConstraint,
    severity,
    action,
    resource,
    evidenceHash,
    recommendedAction,
    reporterPublicKey,
    reportedAt,
    affectedCovenants,
  };

  // ID is the SHA-256 of the canonical content
  const id = sha256Object(content);

  // Sign the canonical JSON of the attestation sans signature (includes id)
  const attestationForSigning = { ...content, id };
  const canonical = canonicalizeJson(attestationForSigning);
  const signature = await signString(canonical, reporterKeyPair.privateKey);
  const reporterSignature = toHex(signature);

  return {
    id,
    covenantId,
    violatorIdentityHash,
    violatedConstraint,
    severity,
    action,
    resource,
    evidenceHash,
    recommendedAction,
    reporterPublicKey,
    reporterSignature,
    reportedAt,
    affectedCovenants,
  };
}

/**
 * Verify a breach attestation's integrity and signature.
 *
 * Checks that the ID matches the SHA-256 of the content and that the
 * reporter's signature is valid over the canonical JSON (sans signature).
 */
export async function verifyBreachAttestation(
  attestation: BreachAttestation,
): Promise<boolean> {
  // Reconstruct the content object (everything except id and signature)
  const content = {
    covenantId: attestation.covenantId,
    violatorIdentityHash: attestation.violatorIdentityHash,
    violatedConstraint: attestation.violatedConstraint,
    severity: attestation.severity,
    action: attestation.action,
    resource: attestation.resource,
    evidenceHash: attestation.evidenceHash,
    recommendedAction: attestation.recommendedAction,
    reporterPublicKey: attestation.reporterPublicKey,
    reportedAt: attestation.reportedAt,
    affectedCovenants: attestation.affectedCovenants,
  };

  // Verify ID matches content hash
  const expectedId = sha256Object(content);
  if (attestation.id !== expectedId) {
    return false;
  }

  // Verify signature over canonical JSON of attestation sans signature
  const attestationForSigning = { ...content, id: attestation.id };
  const canonical = canonicalizeJson(attestationForSigning);
  const message = new TextEncoder().encode(canonical);
  const signatureBytes = fromHex(attestation.reporterSignature);
  const publicKeyBytes = fromHex(attestation.reporterPublicKey);

  return verify(message, signatureBytes, publicKeyBytes);
}

/**
 * A directed graph tracking trust relationships between agents.
 *
 * When a breach is processed, the violator's trust status is updated and the
 * degradation propagates through the dependency graph to all transitive
 * dependents via BFS, with each hop degrading the status by one level.
 */
export class TrustGraph {
  private nodes: Map<HashHex, TrustNode> = new Map();
  private listeners: Set<(event: BreachEvent) => void> = new Set();

  /**
   * Ensure a node exists in the graph, creating it with defaults if necessary.
   */
  private ensureNode(identityHash: HashHex): TrustNode {
    let node = this.nodes.get(identityHash);
    if (!node) {
      node = {
        identityHash,
        status: 'trusted',
        breachCount: 0,
        dependents: [],
        dependencies: [],
      };
      this.nodes.set(identityHash, node);
    }
    return node;
  }

  /**
   * Register a dependency edge: parentHash depends on childHash.
   * If parentHash is breached, all its dependents are affected.
   * childHash is a dependent of parentHash, meaning childHash depends on parentHash.
   *
   * The edge means: parentHash -> childHash (parent has childHash as dependent,
   * childHash has parentHash as dependency).
   */
  registerDependency(parentHash: HashHex, childHash: HashHex): void {
    const parent = this.ensureNode(parentHash);
    const child = this.ensureNode(childHash);

    if (!parent.dependents.includes(childHash)) {
      parent.dependents.push(childHash);
    }
    if (!child.dependencies.includes(parentHash)) {
      child.dependencies.push(parentHash);
    }
  }

  /**
   * Process a breach attestation:
   * 1. Verify the attestation cryptographically
   * 2. Update the violator's trust status based on severity
   * 3. BFS-propagate degraded status to all transitive dependents
   * 4. Emit BreachEvents for every affected node
   * 5. Notify all registered listeners
   */
  async processBreach(attestation: BreachAttestation): Promise<BreachEvent[]> {
    // Step 1: Verify attestation
    const valid = await verifyBreachAttestation(attestation);
    if (!valid) {
      throw new Error('Invalid breach attestation: verification failed');
    }

    const events: BreachEvent[] = [];
    const violatorHash = attestation.violatorIdentityHash;
    const violator = this.ensureNode(violatorHash);

    // Step 2: Update violator status
    const previousStatus = violator.status;
    const newViolatorStatus = statusForSeverity(attestation.severity);

    // Apply the worse of current and new status
    violator.status = worseStatus(violator.status, newViolatorStatus);
    violator.breachCount += 1;
    violator.lastBreachAt = attestation.reportedAt;

    // Create event for the violator (depth 0)
    events.push({
      attestation,
      affectedAgent: violatorHash,
      previousStatus,
      newStatus: violator.status,
      propagationDepth: 0,
    });

    // Step 3: BFS propagation to dependents
    // Each level degrades by one step from the status applied at the parent level
    const visited = new Set<HashHex>([violatorHash]);

    // BFS queue entries: [nodeHash, statusToPropagateFromParent, depth]
    interface QueueEntry {
      hash: HashHex;
      parentAppliedStatus: TrustStatus;
      depth: number;
    }

    const queue: QueueEntry[] = [];

    // Seed the queue with the violator's dependents
    for (const depHash of violator.dependents) {
      if (!visited.has(depHash)) {
        queue.push({
          hash: depHash,
          parentAppliedStatus: violator.status,
          depth: 1,
        });
      }
    }

    while (queue.length > 0) {
      const entry = queue.shift()!;
      if (visited.has(entry.hash)) {
        continue;
      }
      visited.add(entry.hash);

      // Degrade by one level from the parent's applied status
      const degraded = degradeStatus(entry.parentAppliedStatus);
      if (degraded === null) {
        // No further degradation possible (parent was degraded or trusted)
        continue;
      }

      const node = this.ensureNode(entry.hash);
      const prevNodeStatus = node.status;

      // Only apply if it makes things worse
      const appliedStatus = worseStatus(node.status, degraded);
      if (appliedStatus === prevNodeStatus) {
        // Status didn't change, but still need to propagate through dependents
        // if the degraded status could affect nodes further down
      }
      node.status = appliedStatus;

      events.push({
        attestation,
        affectedAgent: entry.hash,
        previousStatus: prevNodeStatus,
        newStatus: node.status,
        propagationDepth: entry.depth,
      });

      // Enqueue this node's dependents for further propagation
      for (const depHash of node.dependents) {
        if (!visited.has(depHash)) {
          queue.push({
            hash: depHash,
            parentAppliedStatus: appliedStatus,
            depth: entry.depth + 1,
          });
        }
      }
    }

    // Step 5: Notify all listeners
    for (const listener of this.listeners) {
      for (const event of events) {
        listener(event);
      }
    }

    return events;
  }

  /**
   * Get the trust status of a node, or 'unknown' if not in the graph.
   */
  getStatus(identityHash: HashHex): TrustStatus {
    const node = this.nodes.get(identityHash);
    return node ? node.status : 'unknown';
  }

  /**
   * Check whether a node is fully trusted.
   */
  isTrusted(identityHash: HashHex): boolean {
    return this.getStatus(identityHash) === 'trusted';
  }

  /**
   * Get all transitive dependents of a node via BFS.
   */
  getDependents(identityHash: HashHex): HashHex[] {
    const result: HashHex[] = [];
    const visited = new Set<HashHex>([identityHash]);
    const queue: HashHex[] = [];

    const startNode = this.nodes.get(identityHash);
    if (!startNode) {
      return result;
    }

    for (const dep of startNode.dependents) {
      if (!visited.has(dep)) {
        queue.push(dep);
        visited.add(dep);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      const node = this.nodes.get(current);
      if (node) {
        for (const dep of node.dependents) {
          if (!visited.has(dep)) {
            queue.push(dep);
            visited.add(dep);
          }
        }
      }
    }

    return result;
  }

  /**
   * Get all direct dependencies of a node.
   */
  getDependencies(identityHash: HashHex): HashHex[] {
    const node = this.nodes.get(identityHash);
    return node ? [...node.dependencies] : [];
  }

  /**
   * Get a node by its identity hash, or undefined if not in the graph.
   */
  getNode(identityHash: HashHex): TrustNode | undefined {
    const node = this.nodes.get(identityHash);
    if (!node) {
      return undefined;
    }
    // Return a shallow copy to prevent external mutation of arrays
    return {
      ...node,
      dependents: [...node.dependents],
      dependencies: [...node.dependencies],
    };
  }

  /**
   * Manually reset a node's trust status.
   */
  resetStatus(identityHash: HashHex, newStatus: TrustStatus): void {
    const node = this.nodes.get(identityHash);
    if (node) {
      node.status = newStatus;
    }
  }

  /**
   * Register a listener that is called for each BreachEvent during processBreach.
   */
  onBreach(listener: (event: BreachEvent) => void): void {
    this.listeners.add(listener);
  }

  /**
   * Remove a previously registered breach listener.
   */
  offBreach(listener: (event: BreachEvent) => void): void {
    this.listeners.delete(listener);
  }

  /**
   * Export the full graph as nodes and edges for serialization or visualization.
   */
  export(): {
    nodes: TrustNode[];
    edges: Array<{ from: HashHex; to: HashHex }>;
  } {
    const nodes: TrustNode[] = [];
    const edges: Array<{ from: HashHex; to: HashHex }> = [];

    for (const node of this.nodes.values()) {
      nodes.push({
        ...node,
        dependents: [...node.dependents],
        dependencies: [...node.dependencies],
      });
      for (const dep of node.dependents) {
        edges.push({ from: node.identityHash, to: dep });
      }
    }

    return { nodes, edges };
  }
}
