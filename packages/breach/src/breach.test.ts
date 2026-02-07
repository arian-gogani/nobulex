import { describe, it, expect, vi } from 'vitest';
import { generateKeyPair, sha256String } from '@stele/crypto';
import type { KeyPair, HashHex } from '@stele/crypto';
import type { Severity } from '@stele/ccl';
import {
  createBreachAttestation,
  verifyBreachAttestation,
  TrustGraph,
} from './index.js';
import type { BreachAttestation, BreachEvent } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeHash(label: string): HashHex {
  return sha256String(label);
}

/** Create a breach attestation with sensible defaults for testing. */
async function makeAttestation(
  reporterKp: KeyPair,
  severity: Severity = 'high',
  violatorHash?: HashHex,
): Promise<BreachAttestation> {
  return createBreachAttestation(
    fakeHash('covenant-1'),
    violatorHash ?? fakeHash('violator-agent'),
    'must-not-exfiltrate-data',
    severity,
    'readFile',
    '/secrets/api-key.env',
    fakeHash('evidence-blob'),
    [fakeHash('covenant-1'), fakeHash('covenant-2')],
    reporterKp,
  );
}

// ---------------------------------------------------------------------------
// createBreachAttestation
// ---------------------------------------------------------------------------

describe('createBreachAttestation', () => {
  it('creates a valid attestation with all required fields', async () => {
    const reporterKp = await generateKeyPair();
    const attestation = await makeAttestation(reporterKp, 'high');

    expect(attestation.id).toBeDefined();
    expect(typeof attestation.id).toBe('string');
    expect(attestation.id.length).toBeGreaterThan(0);
    expect(attestation.covenantId).toBe(fakeHash('covenant-1'));
    expect(attestation.violatorIdentityHash).toBe(fakeHash('violator-agent'));
    expect(attestation.violatedConstraint).toBe('must-not-exfiltrate-data');
    expect(attestation.severity).toBe('high');
    expect(attestation.action).toBe('readFile');
    expect(attestation.resource).toBe('/secrets/api-key.env');
    expect(attestation.evidenceHash).toBe(fakeHash('evidence-blob'));
    expect(attestation.reporterPublicKey).toBe(reporterKp.publicKeyHex);
    expect(attestation.reporterSignature).toBeDefined();
    expect(attestation.reporterSignature.length).toBeGreaterThan(0);
    expect(attestation.reportedAt).toBeDefined();
    expect(attestation.affectedCovenants).toEqual([
      fakeHash('covenant-1'),
      fakeHash('covenant-2'),
    ]);
  });

  it('maps severity to correct recommendedAction', async () => {
    const reporterKp = await generateKeyPair();

    const critical = await makeAttestation(reporterKp, 'critical');
    expect(critical.recommendedAction).toBe('revoke');

    const high = await makeAttestation(reporterKp, 'high');
    expect(high.recommendedAction).toBe('restrict');

    const medium = await makeAttestation(reporterKp, 'medium');
    expect(medium.recommendedAction).toBe('monitor');

    const low = await makeAttestation(reporterKp, 'low');
    expect(low.recommendedAction).toBe('notify');
  });
});

// ---------------------------------------------------------------------------
// createBreachAttestation -> verifyBreachAttestation round-trip
// ---------------------------------------------------------------------------

describe('createBreachAttestation -> verifyBreachAttestation round-trip', () => {
  it('verifies a freshly created attestation', async () => {
    const reporterKp = await generateKeyPair();
    const attestation = await makeAttestation(reporterKp);

    const valid = await verifyBreachAttestation(attestation);
    expect(valid).toBe(true);
  });

  it('verifies attestations of every severity level', async () => {
    const reporterKp = await generateKeyPair();

    for (const severity of ['critical', 'high', 'medium', 'low'] as Severity[]) {
      const attestation = await makeAttestation(reporterKp, severity);
      const valid = await verifyBreachAttestation(attestation);
      expect(valid).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// verifyBreachAttestation fails with tampered attestation
// ---------------------------------------------------------------------------

describe('verifyBreachAttestation fails with tampered attestation', () => {
  it('fails when a content field is tampered', async () => {
    const reporterKp = await generateKeyPair();
    const attestation = await makeAttestation(reporterKp);

    const tampered = { ...attestation, violatedConstraint: 'different-constraint' };
    const valid = await verifyBreachAttestation(tampered);
    expect(valid).toBe(false);
  });

  it('fails when the id is tampered', async () => {
    const reporterKp = await generateKeyPair();
    const attestation = await makeAttestation(reporterKp);

    const tampered = { ...attestation, id: fakeHash('fake-id') };
    const valid = await verifyBreachAttestation(tampered);
    expect(valid).toBe(false);
  });

  it('fails when the signature is tampered', async () => {
    const reporterKp = await generateKeyPair();
    const attestation = await makeAttestation(reporterKp);

    const sig = attestation.reporterSignature;
    const lastChar = sig[sig.length - 1]!;
    const flipped = lastChar === '0' ? '1' : '0';
    const tampered = { ...attestation, reporterSignature: sig.slice(0, -1) + flipped };
    const valid = await verifyBreachAttestation(tampered);
    expect(valid).toBe(false);
  });

  it('fails when severity is tampered (changes id hash)', async () => {
    const reporterKp = await generateKeyPair();
    const attestation = await makeAttestation(reporterKp, 'high');

    const tampered = { ...attestation, severity: 'low' as Severity };
    const valid = await verifyBreachAttestation(tampered);
    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.registerDependency
// ---------------------------------------------------------------------------

describe('TrustGraph.registerDependency', () => {
  it('creates nodes for both parent and child', () => {
    const graph = new TrustGraph();
    const parentHash = fakeHash('parent');
    const childHash = fakeHash('child');

    graph.registerDependency(parentHash, childHash);

    expect(graph.getStatus(parentHash)).toBe('trusted');
    expect(graph.getStatus(childHash)).toBe('trusted');
  });

  it('correctly sets up dependent and dependency relationships', () => {
    const graph = new TrustGraph();
    const parentHash = fakeHash('parent');
    const childHash = fakeHash('child');

    graph.registerDependency(parentHash, childHash);

    const exported = graph.export();
    const parentNode = exported.nodes.find(n => n.identityHash === parentHash);
    const childNode = exported.nodes.find(n => n.identityHash === childHash);

    expect(parentNode!.dependents).toContain(childHash);
    expect(childNode!.dependencies).toContain(parentHash);
  });

  it('does not duplicate edges on repeated registration', () => {
    const graph = new TrustGraph();
    const parentHash = fakeHash('parent');
    const childHash = fakeHash('child');

    graph.registerDependency(parentHash, childHash);
    graph.registerDependency(parentHash, childHash);

    const exported = graph.export();
    const parentNode = exported.nodes.find(n => n.identityHash === parentHash);

    expect(parentNode!.dependents.filter(d => d === childHash)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.processBreach
// ---------------------------------------------------------------------------

describe('TrustGraph.processBreach', () => {
  it('updates violator status', async () => {
    const reporterKp = await generateKeyPair();
    const violatorHash = fakeHash('violator');
    const graph = new TrustGraph();

    // Register the violator so it starts as 'trusted'
    graph.registerDependency(violatorHash, fakeHash('dep'));
    expect(graph.getStatus(violatorHash)).toBe('trusted');

    const attestation = await makeAttestation(reporterKp, 'high', violatorHash);
    const events = await graph.processBreach(attestation);

    expect(graph.getStatus(violatorHash)).toBe('restricted');
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.affectedAgent).toBe(violatorHash);
    expect(events[0]!.previousStatus).toBe('trusted');
    expect(events[0]!.newStatus).toBe('restricted');
    expect(events[0]!.propagationDepth).toBe(0);
  });

  it('propagates to dependents via BFS', async () => {
    const reporterKp = await generateKeyPair();
    const graph = new TrustGraph();

    const violator = fakeHash('violator');
    const dep1 = fakeHash('dependent-1');
    const dep2 = fakeHash('dependent-2');

    // violator -> dep1 -> dep2
    graph.registerDependency(violator, dep1);
    graph.registerDependency(dep1, dep2);

    const attestation = await makeAttestation(reporterKp, 'critical', violator);
    const events = await graph.processBreach(attestation);

    // Violator should be revoked (critical)
    expect(graph.getStatus(violator)).toBe('revoked');

    // dep1 should be restricted (one level degraded from revoked)
    expect(graph.getStatus(dep1)).toBe('restricted');

    // dep2 should be degraded (one level degraded from restricted)
    expect(graph.getStatus(dep2)).toBe('degraded');

    // Should have events for all three nodes
    expect(events).toHaveLength(3);
    expect(events.map(e => e.affectedAgent)).toContain(violator);
    expect(events.map(e => e.affectedAgent)).toContain(dep1);
    expect(events.map(e => e.affectedAgent)).toContain(dep2);
  });

  it('critical breach results in revoked status', async () => {
    const reporterKp = await generateKeyPair();
    const graph = new TrustGraph();
    const violator = fakeHash('violator');

    graph.registerDependency(violator, fakeHash('dep'));

    const attestation = await makeAttestation(reporterKp, 'critical', violator);
    await graph.processBreach(attestation);

    expect(graph.getStatus(violator)).toBe('revoked');
  });

  it('high breach results in restricted status', async () => {
    const reporterKp = await generateKeyPair();
    const graph = new TrustGraph();
    const violator = fakeHash('violator');

    graph.registerDependency(violator, fakeHash('dep'));

    const attestation = await makeAttestation(reporterKp, 'high', violator);
    await graph.processBreach(attestation);

    expect(graph.getStatus(violator)).toBe('restricted');
  });

  it('medium breach results in degraded status', async () => {
    const reporterKp = await generateKeyPair();
    const graph = new TrustGraph();
    const violator = fakeHash('violator');

    graph.registerDependency(violator, fakeHash('dep'));

    const attestation = await makeAttestation(reporterKp, 'medium', violator);
    await graph.processBreach(attestation);

    expect(graph.getStatus(violator)).toBe('degraded');
  });

  it('low breach keeps violator as trusted', async () => {
    const reporterKp = await generateKeyPair();
    const graph = new TrustGraph();
    const violator = fakeHash('violator');

    graph.registerDependency(violator, fakeHash('dep'));

    const attestation = await makeAttestation(reporterKp, 'low', violator);
    await graph.processBreach(attestation);

    // statusForSeverity('low') = 'trusted', so worseStatus('trusted', 'trusted') = 'trusted'
    expect(graph.getStatus(violator)).toBe('trusted');
  });

  it('increments breachCount on the violator node', async () => {
    const reporterKp = await generateKeyPair();
    const graph = new TrustGraph();
    const violator = fakeHash('violator');

    graph.registerDependency(violator, fakeHash('dep'));

    const att1 = await makeAttestation(reporterKp, 'low', violator);
    await graph.processBreach(att1);
    expect(graph.getNode(violator)!.breachCount).toBe(1);

    const att2 = await makeAttestation(reporterKp, 'low', violator);
    await graph.processBreach(att2);
    expect(graph.getNode(violator)!.breachCount).toBe(2);
  });

  it('rejects an invalid attestation', async () => {
    const reporterKp = await generateKeyPair();
    const graph = new TrustGraph();

    const attestation = await makeAttestation(reporterKp, 'high');
    const tampered = { ...attestation, severity: 'critical' as Severity };

    await expect(graph.processBreach(tampered)).rejects.toThrow(
      'Invalid breach attestation: verification failed',
    );
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.getStatus
// ---------------------------------------------------------------------------

describe('TrustGraph.getStatus', () => {
  it('returns unknown for unregistered agents', () => {
    const graph = new TrustGraph();
    expect(graph.getStatus(fakeHash('nonexistent'))).toBe('unknown');
  });

  it('returns trusted for newly registered agents', () => {
    const graph = new TrustGraph();
    const hash = fakeHash('agent');
    graph.registerDependency(hash, fakeHash('child'));
    expect(graph.getStatus(hash)).toBe('trusted');
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.isTrusted
// ---------------------------------------------------------------------------

describe('TrustGraph.isTrusted', () => {
  it('returns true for trusted agents', () => {
    const graph = new TrustGraph();
    const hash = fakeHash('agent');
    graph.registerDependency(hash, fakeHash('child'));
    expect(graph.isTrusted(hash)).toBe(true);
  });

  it('returns false for unknown agents', () => {
    const graph = new TrustGraph();
    // 'unknown' !== 'trusted'
    expect(graph.isTrusted(fakeHash('nonexistent'))).toBe(false);
  });

  it('returns false for degraded/restricted/revoked agents', async () => {
    const reporterKp = await generateKeyPair();
    const graph = new TrustGraph();
    const violator = fakeHash('violator');

    graph.registerDependency(violator, fakeHash('dep'));

    const attestation = await makeAttestation(reporterKp, 'critical', violator);
    await graph.processBreach(attestation);

    expect(graph.isTrusted(violator)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.getDependents
// ---------------------------------------------------------------------------

describe('TrustGraph.getDependents', () => {
  it('returns transitive dependents', () => {
    const graph = new TrustGraph();
    const a = fakeHash('a');
    const b = fakeHash('b');
    const c = fakeHash('c');
    const d = fakeHash('d');

    // a -> b -> c -> d
    graph.registerDependency(a, b);
    graph.registerDependency(b, c);
    graph.registerDependency(c, d);

    const deps = graph.getDependents(a);
    expect(deps).toContain(b);
    expect(deps).toContain(c);
    expect(deps).toContain(d);
    expect(deps).toHaveLength(3);
  });

  it('returns empty array for a leaf node', () => {
    const graph = new TrustGraph();
    const parent = fakeHash('parent');
    const leaf = fakeHash('leaf');

    graph.registerDependency(parent, leaf);

    const deps = graph.getDependents(leaf);
    expect(deps).toEqual([]);
  });

  it('returns empty array for unknown node', () => {
    const graph = new TrustGraph();
    expect(graph.getDependents(fakeHash('unknown'))).toEqual([]);
  });

  it('handles branching graphs correctly', () => {
    const graph = new TrustGraph();
    const root = fakeHash('root');
    const b1 = fakeHash('branch-1');
    const b2 = fakeHash('branch-2');
    const leaf = fakeHash('leaf');

    // root -> b1 -> leaf
    // root -> b2 -> leaf
    graph.registerDependency(root, b1);
    graph.registerDependency(root, b2);
    graph.registerDependency(b1, leaf);
    graph.registerDependency(b2, leaf);

    const deps = graph.getDependents(root);
    expect(deps).toContain(b1);
    expect(deps).toContain(b2);
    expect(deps).toContain(leaf);
    // leaf should appear only once despite being reachable via two paths
    expect(deps.filter(d => d === leaf)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.resetStatus
// ---------------------------------------------------------------------------

describe('TrustGraph.resetStatus', () => {
  it('resets a node status to a new value', async () => {
    const reporterKp = await generateKeyPair();
    const graph = new TrustGraph();
    const violator = fakeHash('violator');

    graph.registerDependency(violator, fakeHash('dep'));

    const attestation = await makeAttestation(reporterKp, 'critical', violator);
    await graph.processBreach(attestation);
    expect(graph.getStatus(violator)).toBe('revoked');

    graph.resetStatus(violator, 'trusted');
    expect(graph.getStatus(violator)).toBe('trusted');
  });

  it('does nothing for an unregistered node', () => {
    const graph = new TrustGraph();
    // Should not throw
    graph.resetStatus(fakeHash('nonexistent'), 'trusted');
    // Node is still not in the graph
    expect(graph.getStatus(fakeHash('nonexistent'))).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.onBreach / offBreach listener management
// ---------------------------------------------------------------------------

describe('TrustGraph.onBreach / offBreach', () => {
  it('listener receives events during processBreach', async () => {
    const reporterKp = await generateKeyPair();
    const graph = new TrustGraph();
    const violator = fakeHash('violator');

    graph.registerDependency(violator, fakeHash('dep'));

    const receivedEvents: BreachEvent[] = [];
    const listener = (event: BreachEvent) => {
      receivedEvents.push(event);
    };
    graph.onBreach(listener);

    const attestation = await makeAttestation(reporterKp, 'high', violator);
    await graph.processBreach(attestation);

    expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
    expect(receivedEvents[0]!.affectedAgent).toBe(violator);
    expect(receivedEvents[0]!.newStatus).toBe('restricted');
  });

  it('removed listener no longer receives events', async () => {
    const reporterKp = await generateKeyPair();
    const graph = new TrustGraph();
    const violator = fakeHash('violator');

    graph.registerDependency(violator, fakeHash('dep'));

    const receivedEvents: BreachEvent[] = [];
    const listener = (event: BreachEvent) => {
      receivedEvents.push(event);
    };

    graph.onBreach(listener);
    graph.offBreach(listener);

    const attestation = await makeAttestation(reporterKp, 'high', violator);
    await graph.processBreach(attestation);

    expect(receivedEvents).toHaveLength(0);
  });

  it('multiple listeners all receive events', async () => {
    const reporterKp = await generateKeyPair();
    const graph = new TrustGraph();
    const violator = fakeHash('violator');

    graph.registerDependency(violator, fakeHash('dep'));

    const events1: BreachEvent[] = [];
    const events2: BreachEvent[] = [];

    graph.onBreach((e) => events1.push(e));
    graph.onBreach((e) => events2.push(e));

    const attestation = await makeAttestation(reporterKp, 'high', violator);
    await graph.processBreach(attestation);

    expect(events1.length).toBeGreaterThanOrEqual(1);
    expect(events2.length).toBeGreaterThanOrEqual(1);
    expect(events1.length).toBe(events2.length);
  });

  it('listener receives propagation events as well', async () => {
    const reporterKp = await generateKeyPair();
    const graph = new TrustGraph();

    const violator = fakeHash('violator');
    const dep1 = fakeHash('dep1');
    const dep2 = fakeHash('dep2');

    graph.registerDependency(violator, dep1);
    graph.registerDependency(dep1, dep2);

    const receivedEvents: BreachEvent[] = [];
    graph.onBreach((e) => receivedEvents.push(e));

    const attestation = await makeAttestation(reporterKp, 'critical', violator);
    await graph.processBreach(attestation);

    // Should receive events for violator (depth 0), dep1 (depth 1), dep2 (depth 2)
    expect(receivedEvents).toHaveLength(3);
    const depths = receivedEvents.map(e => e.propagationDepth);
    expect(depths).toContain(0);
    expect(depths).toContain(1);
    expect(depths).toContain(2);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.export
// ---------------------------------------------------------------------------

describe('TrustGraph.export', () => {
  it('returns correct graph structure', () => {
    const graph = new TrustGraph();
    const a = fakeHash('a');
    const b = fakeHash('b');
    const c = fakeHash('c');

    graph.registerDependency(a, b);
    graph.registerDependency(a, c);
    graph.registerDependency(b, c);

    const exported = graph.export();

    // Should have 3 nodes
    expect(exported.nodes).toHaveLength(3);

    // Check node identity hashes are present
    const hashes = exported.nodes.map(n => n.identityHash);
    expect(hashes).toContain(a);
    expect(hashes).toContain(b);
    expect(hashes).toContain(c);

    // All nodes start as trusted
    for (const node of exported.nodes) {
      expect(node.status).toBe('trusted');
      expect(node.breachCount).toBe(0);
    }

    // Edges: a->b, a->c, b->c
    expect(exported.edges).toHaveLength(3);
    expect(exported.edges).toContainEqual({ from: a, to: b });
    expect(exported.edges).toContainEqual({ from: a, to: c });
    expect(exported.edges).toContainEqual({ from: b, to: c });
  });

  it('returns empty graph when nothing is registered', () => {
    const graph = new TrustGraph();
    const exported = graph.export();

    expect(exported.nodes).toHaveLength(0);
    expect(exported.edges).toHaveLength(0);
  });

  it('returned nodes are copies (not references to internal state)', () => {
    const graph = new TrustGraph();
    const a = fakeHash('a');
    const b = fakeHash('b');

    graph.registerDependency(a, b);

    const exported = graph.export();
    const nodeA = exported.nodes.find(n => n.identityHash === a)!;

    // Mutate the exported node
    nodeA.dependents.push(fakeHash('injected'));

    // The internal graph should be unaffected
    const reExported = graph.export();
    const nodeA2 = reExported.nodes.find(n => n.identityHash === a)!;
    expect(nodeA2.dependents).not.toContain(fakeHash('injected'));
    expect(nodeA2.dependents).toHaveLength(1);
  });
});
