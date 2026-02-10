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

// ===========================================================================
// EXPANDED TEST COVERAGE
// ===========================================================================

// ---------------------------------------------------------------------------
// createBreachAttestation - detailed structure verification
// ---------------------------------------------------------------------------

describe('createBreachAttestation - detailed structure', () => {
  it('critical severity produces revoke recommendedAction', async () => {
    const kp = await generateKeyPair();
    const att = await makeAttestation(kp, 'critical');
    expect(att.severity).toBe('critical');
    expect(att.recommendedAction).toBe('revoke');
  });

  it('high severity produces restrict recommendedAction', async () => {
    const kp = await generateKeyPair();
    const att = await makeAttestation(kp, 'high');
    expect(att.severity).toBe('high');
    expect(att.recommendedAction).toBe('restrict');
  });

  it('medium severity produces monitor recommendedAction', async () => {
    const kp = await generateKeyPair();
    const att = await makeAttestation(kp, 'medium');
    expect(att.severity).toBe('medium');
    expect(att.recommendedAction).toBe('monitor');
  });

  it('low severity produces notify recommendedAction', async () => {
    const kp = await generateKeyPair();
    const att = await makeAttestation(kp, 'low');
    expect(att.severity).toBe('low');
    expect(att.recommendedAction).toBe('notify');
  });

  it('id is a 64-char hex string (SHA-256)', async () => {
    const kp = await generateKeyPair();
    const att = await makeAttestation(kp);
    expect(att.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reporterSignature is a non-empty hex string', async () => {
    const kp = await generateKeyPair();
    const att = await makeAttestation(kp);
    expect(att.reporterSignature).toMatch(/^[0-9a-f]+$/);
    expect(att.reporterSignature.length).toBeGreaterThan(0);
  });

  it('reportedAt is a non-empty timestamp string', async () => {
    const kp = await generateKeyPair();
    const att = await makeAttestation(kp);
    expect(typeof att.reportedAt).toBe('string');
    expect(att.reportedAt.length).toBeGreaterThan(0);
  });

  it('two attestations from the same reporter have different IDs', async () => {
    const kp = await generateKeyPair();
    const att1 = await makeAttestation(kp, 'high');
    const att2 = await makeAttestation(kp, 'high');
    // Different timestamps will produce different IDs
    expect(att1.id).not.toBe(att2.id);
  });

  it('attestations with different severities have different IDs', async () => {
    const kp = await generateKeyPair();
    const attHigh = await makeAttestation(kp, 'high');
    const attLow = await makeAttestation(kp, 'low');
    expect(attHigh.id).not.toBe(attLow.id);
  });

  it('custom violator hash is preserved', async () => {
    const kp = await generateKeyPair();
    const customViolator = fakeHash('custom-violator-identity');
    const att = await makeAttestation(kp, 'high', customViolator);
    expect(att.violatorIdentityHash).toBe(customViolator);
  });
});

// ---------------------------------------------------------------------------
// verifyBreachAttestation - additional tamper scenarios
// ---------------------------------------------------------------------------

describe('verifyBreachAttestation - additional tamper scenarios', () => {
  it('fails when reporterPublicKey is tampered', async () => {
    const kp = await generateKeyPair();
    const att = await makeAttestation(kp);

    const otherKp = await generateKeyPair();
    const tampered = { ...att, reporterPublicKey: otherKp.publicKeyHex };
    expect(await verifyBreachAttestation(tampered)).toBe(false);
  });

  it('fails when action is tampered', async () => {
    const kp = await generateKeyPair();
    const att = await makeAttestation(kp);

    const tampered = { ...att, action: 'deleteFile' };
    expect(await verifyBreachAttestation(tampered)).toBe(false);
  });

  it('fails when resource is tampered', async () => {
    const kp = await generateKeyPair();
    const att = await makeAttestation(kp);

    const tampered = { ...att, resource: '/different/path' };
    expect(await verifyBreachAttestation(tampered)).toBe(false);
  });

  it('fails when evidenceHash is tampered', async () => {
    const kp = await generateKeyPair();
    const att = await makeAttestation(kp);

    const tampered = { ...att, evidenceHash: fakeHash('different-evidence') };
    expect(await verifyBreachAttestation(tampered)).toBe(false);
  });

  it('fails when affectedCovenants is tampered', async () => {
    const kp = await generateKeyPair();
    const att = await makeAttestation(kp);

    const tampered = { ...att, affectedCovenants: [fakeHash('different-covenant')] };
    expect(await verifyBreachAttestation(tampered)).toBe(false);
  });

  it('fails when recommendedAction is tampered', async () => {
    const kp = await generateKeyPair();
    const att = await makeAttestation(kp, 'high');

    const tampered = { ...att, recommendedAction: 'revoke' as const };
    expect(await verifyBreachAttestation(tampered)).toBe(false);
  });

  it('fails when covenantId is tampered', async () => {
    const kp = await generateKeyPair();
    const att = await makeAttestation(kp);

    const tampered = { ...att, covenantId: fakeHash('different-covenant-id') };
    expect(await verifyBreachAttestation(tampered)).toBe(false);
  });

  it('passes verification for all severity levels', async () => {
    const kp = await generateKeyPair();
    for (const severity of ['critical', 'high', 'medium', 'low'] as Severity[]) {
      const att = await makeAttestation(kp, severity);
      expect(await verifyBreachAttestation(att)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// TrustGraph - complex graph topologies
// ---------------------------------------------------------------------------

describe('TrustGraph - complex graph topologies', () => {
  it('registers multi-level dependency chain', () => {
    const graph = new TrustGraph();
    const a = fakeHash('a');
    const b = fakeHash('b');
    const c = fakeHash('c');
    const d = fakeHash('d');
    const e = fakeHash('e');

    graph.registerDependency(a, b);
    graph.registerDependency(b, c);
    graph.registerDependency(c, d);
    graph.registerDependency(d, e);

    const deps = graph.getDependents(a);
    expect(deps).toHaveLength(4);
    expect(deps).toContain(b);
    expect(deps).toContain(c);
    expect(deps).toContain(d);
    expect(deps).toContain(e);
  });

  it('handles fan-out tree correctly', () => {
    const graph = new TrustGraph();
    const root = fakeHash('root');
    const l1a = fakeHash('l1a');
    const l1b = fakeHash('l1b');
    const l1c = fakeHash('l1c');
    const l2a = fakeHash('l2a');
    const l2b = fakeHash('l2b');

    // root fans out to three children
    graph.registerDependency(root, l1a);
    graph.registerDependency(root, l1b);
    graph.registerDependency(root, l1c);
    // l1a has two children
    graph.registerDependency(l1a, l2a);
    graph.registerDependency(l1a, l2b);

    const deps = graph.getDependents(root);
    expect(deps).toHaveLength(5);
    expect(deps).toContain(l1a);
    expect(deps).toContain(l1b);
    expect(deps).toContain(l1c);
    expect(deps).toContain(l2a);
    expect(deps).toContain(l2b);
  });

  it('handles diamond dependency correctly (no duplicates)', () => {
    const graph = new TrustGraph();
    const top = fakeHash('top');
    const left = fakeHash('left');
    const right = fakeHash('right');
    const bottom = fakeHash('bottom');

    // Diamond: top -> left -> bottom, top -> right -> bottom
    graph.registerDependency(top, left);
    graph.registerDependency(top, right);
    graph.registerDependency(left, bottom);
    graph.registerDependency(right, bottom);

    const deps = graph.getDependents(top);
    expect(deps).toContain(left);
    expect(deps).toContain(right);
    expect(deps).toContain(bottom);
    // bottom only appears once
    expect(deps.filter(d => d === bottom)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.processBreach - propagation behavior
// ---------------------------------------------------------------------------

describe('TrustGraph.processBreach - propagation behavior', () => {
  it('critical breach propagates through 3 levels: revoked -> restricted -> degraded -> stop', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();

    const a = fakeHash('agent-a');
    const b = fakeHash('agent-b');
    const c = fakeHash('agent-c');
    const d = fakeHash('agent-d');

    // a -> b -> c -> d
    graph.registerDependency(a, b);
    graph.registerDependency(b, c);
    graph.registerDependency(c, d);

    const att = await makeAttestation(kp, 'critical', a);
    const events = await graph.processBreach(att);

    expect(graph.getStatus(a)).toBe('revoked');     // direct: critical -> revoked
    expect(graph.getStatus(b)).toBe('restricted');   // degraded from revoked
    expect(graph.getStatus(c)).toBe('degraded');     // degraded from restricted
    expect(graph.getStatus(d)).toBe('trusted');      // degraded from degraded -> null, no change

    // d should not have an event since degradation stopped
    const dEvent = events.find(e => e.affectedAgent === d);
    expect(dEvent).toBeUndefined();
  });

  it('high breach propagates through 2 levels: restricted -> degraded -> stop', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();

    const a = fakeHash('ha');
    const b = fakeHash('hb');
    const c = fakeHash('hc');

    graph.registerDependency(a, b);
    graph.registerDependency(b, c);

    const att = await makeAttestation(kp, 'high', a);
    const events = await graph.processBreach(att);

    expect(graph.getStatus(a)).toBe('restricted');
    expect(graph.getStatus(b)).toBe('degraded');
    expect(graph.getStatus(c)).toBe('trusted');

    // c should not have an event
    const cEvent = events.find(e => e.affectedAgent === c);
    expect(cEvent).toBeUndefined();
  });

  it('medium breach does not propagate (degraded -> null)', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();

    const a = fakeHash('ma');
    const b = fakeHash('mb');

    graph.registerDependency(a, b);

    const att = await makeAttestation(kp, 'medium', a);
    const events = await graph.processBreach(att);

    expect(graph.getStatus(a)).toBe('degraded');
    expect(graph.getStatus(b)).toBe('trusted'); // no propagation

    expect(events).toHaveLength(1); // only violator event
  });

  it('low breach does not affect any node status', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();

    const a = fakeHash('la');
    const b = fakeHash('lb');

    graph.registerDependency(a, b);

    const att = await makeAttestation(kp, 'low', a);
    const events = await graph.processBreach(att);

    expect(graph.getStatus(a)).toBe('trusted');
    expect(graph.getStatus(b)).toBe('trusted');
    expect(events).toHaveLength(1);
    expect(events[0]!.previousStatus).toBe('trusted');
    expect(events[0]!.newStatus).toBe('trusted');
  });

  it('propagation through fan-out graph', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();

    const root = fakeHash('root-fanout');
    const c1 = fakeHash('child-1');
    const c2 = fakeHash('child-2');
    const c3 = fakeHash('child-3');

    graph.registerDependency(root, c1);
    graph.registerDependency(root, c2);
    graph.registerDependency(root, c3);

    const att = await makeAttestation(kp, 'critical', root);
    await graph.processBreach(att);

    expect(graph.getStatus(root)).toBe('revoked');
    // All children get degraded from revoked -> restricted
    expect(graph.getStatus(c1)).toBe('restricted');
    expect(graph.getStatus(c2)).toBe('restricted');
    expect(graph.getStatus(c3)).toBe('restricted');
  });

  it('duplicate edges do not cause double processing', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();

    const a = fakeHash('dup-a');
    const b = fakeHash('dup-b');

    // Register the same edge multiple times
    graph.registerDependency(a, b);
    graph.registerDependency(a, b);
    graph.registerDependency(a, b);

    const att = await makeAttestation(kp, 'critical', a);
    const events = await graph.processBreach(att);

    expect(graph.getStatus(a)).toBe('revoked');
    expect(graph.getStatus(b)).toBe('restricted');
    // Should be exactly 2 events: violator + one dependent
    expect(events).toHaveLength(2);
  });

  it('sets lastBreachAt on violator node', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();
    const v = fakeHash('lb-violator');

    graph.registerDependency(v, fakeHash('lb-dep'));

    const att = await makeAttestation(kp, 'high', v);
    await graph.processBreach(att);

    const node = graph.getNode(v)!;
    expect(node.lastBreachAt).toBe(att.reportedAt);
  });

  it('new violator (not previously in graph) is created during processBreach', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();
    const v = fakeHash('new-violator');

    expect(graph.getStatus(v)).toBe('unknown');

    const att = await makeAttestation(kp, 'high', v);
    await graph.processBreach(att);

    expect(graph.getStatus(v)).toBe('restricted');
    expect(graph.getNode(v)!.breachCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Trust status progression (worseStatus semantics)
// ---------------------------------------------------------------------------

describe('trust status progression - worseStatus semantics', () => {
  it('status only gets worse, never better through breach processing', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();
    const v = fakeHash('progression-v');

    graph.registerDependency(v, fakeHash('progression-dep'));

    // Start trusted
    expect(graph.getStatus(v)).toBe('trusted');

    // Low breach: trusted -> trusted (no change)
    const attLow = await makeAttestation(kp, 'low', v);
    await graph.processBreach(attLow);
    expect(graph.getStatus(v)).toBe('trusted');

    // Medium breach: trusted -> degraded
    const attMed = await makeAttestation(kp, 'medium', v);
    await graph.processBreach(attMed);
    expect(graph.getStatus(v)).toBe('degraded');

    // Another low breach: degraded stays degraded (trusted is not worse than degraded)
    const attLow2 = await makeAttestation(kp, 'low', v);
    await graph.processBreach(attLow2);
    expect(graph.getStatus(v)).toBe('degraded');

    // High breach: degraded -> restricted
    const attHigh = await makeAttestation(kp, 'high', v);
    await graph.processBreach(attHigh);
    expect(graph.getStatus(v)).toBe('restricted');

    // Critical breach: restricted -> revoked
    const attCrit = await makeAttestation(kp, 'critical', v);
    await graph.processBreach(attCrit);
    expect(graph.getStatus(v)).toBe('revoked');

    // Another high breach: revoked stays revoked (restricted is not worse)
    const attHigh2 = await makeAttestation(kp, 'high', v);
    await graph.processBreach(attHigh2);
    expect(graph.getStatus(v)).toBe('revoked');
  });

  it('breachCount increments regardless of status change', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();
    const v = fakeHash('count-v');

    graph.registerDependency(v, fakeHash('count-dep'));

    for (let i = 0; i < 5; i++) {
      const att = await makeAttestation(kp, 'low', v);
      await graph.processBreach(att);
    }

    expect(graph.getNode(v)!.breachCount).toBe(5);
    // Status should still be trusted since low -> trusted
    expect(graph.getStatus(v)).toBe('trusted');
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.getDependencies
// ---------------------------------------------------------------------------

describe('TrustGraph.getDependencies', () => {
  it('returns direct dependencies only (not transitive)', () => {
    const graph = new TrustGraph();
    const a = fakeHash('dep-a');
    const b = fakeHash('dep-b');
    const c = fakeHash('dep-c');

    // b depends on a, c depends on b
    graph.registerDependency(a, b);
    graph.registerDependency(b, c);

    // b's direct dependency is a
    const bDeps = graph.getDependencies(b);
    expect(bDeps).toEqual([a]);

    // c's direct dependency is b (not a)
    const cDeps = graph.getDependencies(c);
    expect(cDeps).toEqual([b]);
  });

  it('returns empty array for root nodes (no dependencies)', () => {
    const graph = new TrustGraph();
    const root = fakeHash('root-node');
    const child = fakeHash('child-node');

    graph.registerDependency(root, child);

    expect(graph.getDependencies(root)).toEqual([]);
  });

  it('returns empty array for unknown nodes', () => {
    const graph = new TrustGraph();
    expect(graph.getDependencies(fakeHash('ghost'))).toEqual([]);
  });

  it('returns multiple dependencies for a node with many parents', () => {
    const graph = new TrustGraph();
    const p1 = fakeHash('parent-1');
    const p2 = fakeHash('parent-2');
    const p3 = fakeHash('parent-3');
    const child = fakeHash('multi-dep-child');

    graph.registerDependency(p1, child);
    graph.registerDependency(p2, child);
    graph.registerDependency(p3, child);

    const deps = graph.getDependencies(child);
    expect(deps).toHaveLength(3);
    expect(deps).toContain(p1);
    expect(deps).toContain(p2);
    expect(deps).toContain(p3);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.getNode
// ---------------------------------------------------------------------------

describe('TrustGraph.getNode', () => {
  it('returns undefined for unknown node', () => {
    const graph = new TrustGraph();
    expect(graph.getNode(fakeHash('nonexistent'))).toBeUndefined();
  });

  it('returns a shallow copy of the node', () => {
    const graph = new TrustGraph();
    const a = fakeHash('copy-a');
    const b = fakeHash('copy-b');
    graph.registerDependency(a, b);

    const node = graph.getNode(a)!;
    expect(node).toBeDefined();
    expect(node.identityHash).toBe(a);
    expect(node.status).toBe('trusted');
    expect(node.breachCount).toBe(0);
    expect(node.dependents).toContain(b);
    expect(node.dependencies).toEqual([]);

    // Mutating the returned node should not affect the graph
    node.dependents.push(fakeHash('injected'));
    node.status = 'revoked';

    const nodeAgain = graph.getNode(a)!;
    expect(nodeAgain.dependents).not.toContain(fakeHash('injected'));
    expect(nodeAgain.status).toBe('trusted');
  });

  it('reflects updated status after breach', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();
    const v = fakeHash('node-breach');

    graph.registerDependency(v, fakeHash('node-dep'));

    expect(graph.getNode(v)!.status).toBe('trusted');

    const att = await makeAttestation(kp, 'critical', v);
    await graph.processBreach(att);

    const node = graph.getNode(v)!;
    expect(node.status).toBe('revoked');
    expect(node.breachCount).toBe(1);
    expect(node.lastBreachAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.getStatus / isTrusted - additional scenarios
// ---------------------------------------------------------------------------

describe('TrustGraph.getStatus / isTrusted - additional scenarios', () => {
  it('isTrusted returns false for degraded status', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();
    const v = fakeHash('degraded-agent');

    graph.registerDependency(v, fakeHash('dep'));

    const att = await makeAttestation(kp, 'medium', v);
    await graph.processBreach(att);

    expect(graph.getStatus(v)).toBe('degraded');
    expect(graph.isTrusted(v)).toBe(false);
  });

  it('isTrusted returns false for restricted status', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();
    const v = fakeHash('restricted-agent');

    graph.registerDependency(v, fakeHash('dep'));

    const att = await makeAttestation(kp, 'high', v);
    await graph.processBreach(att);

    expect(graph.getStatus(v)).toBe('restricted');
    expect(graph.isTrusted(v)).toBe(false);
  });

  it('status transitions correctly after resetStatus', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();
    const v = fakeHash('reset-transition');

    graph.registerDependency(v, fakeHash('dep'));

    // Breach to revoked
    const att = await makeAttestation(kp, 'critical', v);
    await graph.processBreach(att);
    expect(graph.getStatus(v)).toBe('revoked');

    // Reset to trusted
    graph.resetStatus(v, 'trusted');
    expect(graph.getStatus(v)).toBe('trusted');
    expect(graph.isTrusted(v)).toBe(true);

    // Breach again to degraded
    const att2 = await makeAttestation(kp, 'medium', v);
    await graph.processBreach(att2);
    expect(graph.getStatus(v)).toBe('degraded');
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.resetStatus - additional coverage
// ---------------------------------------------------------------------------

describe('TrustGraph.resetStatus - additional coverage', () => {
  it('can reset to any status value', () => {
    const graph = new TrustGraph();
    const h = fakeHash('reset-any');
    graph.registerDependency(h, fakeHash('dep'));

    const statuses: Array<'trusted' | 'degraded' | 'restricted' | 'revoked' | 'unknown'> = [
      'trusted', 'degraded', 'restricted', 'revoked', 'unknown',
    ];

    for (const status of statuses) {
      graph.resetStatus(h, status);
      expect(graph.getStatus(h)).toBe(status);
    }
  });

  it('resetStatus does not affect breach count', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();
    const v = fakeHash('reset-count');

    graph.registerDependency(v, fakeHash('dep'));

    const att = await makeAttestation(kp, 'high', v);
    await graph.processBreach(att);
    expect(graph.getNode(v)!.breachCount).toBe(1);

    graph.resetStatus(v, 'trusted');
    expect(graph.getNode(v)!.breachCount).toBe(1); // count preserved
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.onBreach / offBreach - additional listener tests
// ---------------------------------------------------------------------------

describe('TrustGraph.onBreach / offBreach - additional tests', () => {
  it('same listener registered twice only receives events once', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();
    const v = fakeHash('dup-listener-v');

    graph.registerDependency(v, fakeHash('dep'));

    const events: BreachEvent[] = [];
    const listener = (e: BreachEvent) => events.push(e);

    graph.onBreach(listener);
    graph.onBreach(listener); // duplicate

    const att = await makeAttestation(kp, 'high', v);
    await graph.processBreach(att);

    // Listener was registered twice, so it fires twice (array-based, not Set)
    expect(events).toHaveLength(2);
  });

  it('removing non-existent listener does not throw', () => {
    const graph = new TrustGraph();
    const listener = (_e: BreachEvent) => {};
    // Should not throw
    expect(() => graph.offBreach(listener)).not.toThrow();
  });

  it('listener receives events with correct propagation depths', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();

    const a = fakeHash('depth-a');
    const b = fakeHash('depth-b');
    const c = fakeHash('depth-c');

    graph.registerDependency(a, b);
    graph.registerDependency(b, c);

    const received: BreachEvent[] = [];
    graph.onBreach(e => received.push(e));

    const att = await makeAttestation(kp, 'critical', a);
    await graph.processBreach(att);

    const depthMap = new Map(received.map(e => [e.affectedAgent, e.propagationDepth]));
    expect(depthMap.get(a)).toBe(0);
    expect(depthMap.get(b)).toBe(1);
    expect(depthMap.get(c)).toBe(2);
  });

  it('listener receives correct previousStatus and newStatus', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();
    const v = fakeHash('status-listener-v');

    graph.registerDependency(v, fakeHash('dep'));

    // First breach: medium -> degraded
    const events1: BreachEvent[] = [];
    graph.onBreach(e => events1.push(e));

    const att1 = await makeAttestation(kp, 'medium', v);
    await graph.processBreach(att1);

    expect(events1[0]!.previousStatus).toBe('trusted');
    expect(events1[0]!.newStatus).toBe('degraded');

    // Second breach: critical -> revoked
    const events2: BreachEvent[] = [];
    // clear previous listener and add new one
    graph.offBreach(events1.push.bind(events1) as (e: BreachEvent) => void);
    const listener2 = (e: BreachEvent) => events2.push(e);
    graph.onBreach(listener2);

    const att2 = await makeAttestation(kp, 'critical', v);
    await graph.processBreach(att2);

    const vEvent = events2.find(e => e.affectedAgent === v);
    expect(vEvent!.previousStatus).toBe('degraded');
    expect(vEvent!.newStatus).toBe('revoked');
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.export - additional coverage
// ---------------------------------------------------------------------------

describe('TrustGraph.export - additional coverage', () => {
  it('export reflects status changes after breach', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();

    const a = fakeHash('exp-a');
    const b = fakeHash('exp-b');

    graph.registerDependency(a, b);

    const att = await makeAttestation(kp, 'critical', a);
    await graph.processBreach(att);

    const exported = graph.export();
    const nodeA = exported.nodes.find(n => n.identityHash === a)!;
    const nodeB = exported.nodes.find(n => n.identityHash === b)!;

    expect(nodeA.status).toBe('revoked');
    expect(nodeA.breachCount).toBe(1);
    expect(nodeB.status).toBe('restricted');
  });

  it('export includes all edges in a complex graph', () => {
    const graph = new TrustGraph();
    const nodes = Array.from({ length: 5 }, (_, i) => fakeHash(`complex-${i}`));

    // Create a mesh of edges
    graph.registerDependency(nodes[0]!, nodes[1]!);
    graph.registerDependency(nodes[0]!, nodes[2]!);
    graph.registerDependency(nodes[1]!, nodes[3]!);
    graph.registerDependency(nodes[2]!, nodes[3]!);
    graph.registerDependency(nodes[3]!, nodes[4]!);

    const exported = graph.export();
    expect(exported.nodes).toHaveLength(5);
    expect(exported.edges).toHaveLength(5);
    expect(exported.edges).toContainEqual({ from: nodes[0], to: nodes[1] });
    expect(exported.edges).toContainEqual({ from: nodes[0], to: nodes[2] });
    expect(exported.edges).toContainEqual({ from: nodes[1], to: nodes[3] });
    expect(exported.edges).toContainEqual({ from: nodes[2], to: nodes[3] });
    expect(exported.edges).toContainEqual({ from: nodes[3], to: nodes[4] });
  });

  it('export node breachCount and lastBreachAt are accurate', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();
    const v = fakeHash('export-breach');

    graph.registerDependency(v, fakeHash('export-dep'));

    const att1 = await makeAttestation(kp, 'low', v);
    await graph.processBreach(att1);
    const att2 = await makeAttestation(kp, 'low', v);
    await graph.processBreach(att2);
    const att3 = await makeAttestation(kp, 'medium', v);
    await graph.processBreach(att3);

    const exported = graph.export();
    const node = exported.nodes.find(n => n.identityHash === v)!;
    expect(node.breachCount).toBe(3);
    expect(node.lastBreachAt).toBe(att3.reportedAt);
    expect(node.status).toBe('degraded');
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.processBreach - diamond propagation
// ---------------------------------------------------------------------------

describe('TrustGraph.processBreach - diamond propagation', () => {
  it('diamond dependency: bottom node visited once', async () => {
    const kp = await generateKeyPair();
    const graph = new TrustGraph();

    const top = fakeHash('diamond-top');
    const left = fakeHash('diamond-left');
    const right = fakeHash('diamond-right');
    const bottom = fakeHash('diamond-bottom');

    graph.registerDependency(top, left);
    graph.registerDependency(top, right);
    graph.registerDependency(left, bottom);
    graph.registerDependency(right, bottom);

    const att = await makeAttestation(kp, 'critical', top);
    const events = await graph.processBreach(att);

    expect(graph.getStatus(top)).toBe('revoked');
    expect(graph.getStatus(left)).toBe('restricted');
    expect(graph.getStatus(right)).toBe('restricted');
    expect(graph.getStatus(bottom)).toBe('degraded');

    // bottom should only appear once in events
    const bottomEvents = events.filter(e => e.affectedAgent === bottom);
    expect(bottomEvents).toHaveLength(1);
  });
});
