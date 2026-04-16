import { describe, it, expect } from 'vitest';
import { toAgentCardExtension } from './index';
import type { ProofOfBehavior } from '@nobulex/sdk';

function makeProof(overrides: Partial<ProofOfBehavior> = {}): ProofOfBehavior {
  return {
    agentDid: 'did:nobulex:abc123',
    didDocument: {
      id: 'did:nobulex:abc123',
      verificationMethod: [
        {
          id: 'did:nobulex:abc123#key-1',
          type: 'Ed25519VerificationKey2020',
          controller: 'did:nobulex:abc123',
          publicKeyHex: 'deadbeef1234',
        },
      ],
      authentication: ['did:nobulex:abc123#key-1'],
      assertionMethod: ['did:nobulex:abc123#key-1'],
    },
    covenant: { name: 'TestCov', statements: [], permits: [], denies: [], obligations: [], limits: [] },
    covenantHash: 'aabbccdd' as string,
    covenantSignature: 'sig-covenant',
    actionLog: {
      agentDid: 'did:nobulex:abc123',
      entries: [
        { action: 'read', outcome: 'success', hash: 'h1', previousHash: '', timestamp: '2026-01-01T00:00:00Z', params: {} },
        { action: 'write', outcome: 'success', hash: 'h2', previousHash: 'h1', timestamp: '2026-01-01T00:01:00Z', params: {} },
        { action: 'delete', outcome: 'blocked', hash: 'h3', previousHash: 'h2', timestamp: '2026-01-01T00:02:00Z', params: {} },
      ],
    },
    generatedAt: '2026-01-01T00:05:00Z',
    proofSignature: 'sig-proof',
    ...overrides,
  } as ProofOfBehavior;
}

describe('toAgentCardExtension', () => {
  it('returns the correct extension shape', () => {
    const ext = toAgentCardExtension(makeProof());
    expect(ext.name).toBe('nobulex-behavioral-evidence');
    expect(ext.version).toBe('1.0');
    expect(ext.identity).toBeDefined();
    expect(ext.behavior).toBeDefined();
  });

  it('maps identity fields from the DID document', () => {
    const ext = toAgentCardExtension(makeProof());
    expect(ext.identity.did).toBe('did:nobulex:abc123');
    expect(ext.identity.publicKeyHex).toBe('deadbeef1234');
    expect(ext.identity.verificationMethod).toBe('did:nobulex:abc123#key-1');
  });

  it('computes complianceRate from action outcomes', () => {
    const ext = toAgentCardExtension(makeProof());
    // 2 success + 1 blocked out of 3 total => (3-1)/3 = 0.6667
    expect(ext.behavior.complianceRate).toBeCloseTo(0.6667, 3);
    expect(ext.behavior.actionCount).toBe(3);
  });

  it('handles a fully compliant log', () => {
    const proof = makeProof({
      actionLog: {
        agentDid: 'did:nobulex:abc123',
        entries: [
          { action: 'read', outcome: 'success', hash: 'h1', previousHash: '', timestamp: '', params: {} },
        ],
      },
    } as Partial<ProofOfBehavior>);
    const ext = toAgentCardExtension(proof);
    expect(ext.behavior.complianceRate).toBe(1);
  });

  it('handles an empty action log', () => {
    const proof = makeProof({
      actionLog: { agentDid: 'did:nobulex:abc123', entries: [] },
    } as Partial<ProofOfBehavior>);
    const ext = toAgentCardExtension(proof);
    expect(ext.behavior.complianceRate).toBe(1);
    expect(ext.behavior.actionCount).toBe(0);
  });

  it('includes audience and taskClass when present', () => {
    const ext = toAgentCardExtension(makeProof({ audience: 'did:example:verifier', taskClass: 'payments' }));
    expect(ext.behavior.audience).toBe('did:example:verifier');
    expect(ext.behavior.taskClass).toBe('payments');
  });

  it('omits audience and taskClass when absent', () => {
    const ext = toAgentCardExtension(makeProof());
    expect(ext.behavior.audience).toBeUndefined();
    expect(ext.behavior.taskClass).toBeUndefined();
  });

  it('throws on null/undefined proof', () => {
    expect(() => toAgentCardExtension(null as unknown as ProofOfBehavior)).toThrow('proof is required');
    expect(() => toAgentCardExtension(undefined as unknown as ProofOfBehavior)).toThrow('proof is required');
  });

  it('throws when proof is missing required fields', () => {
    expect(() => toAgentCardExtension({} as ProofOfBehavior)).toThrow('missing required fields');
  });

  it('falls back gracefully when DID document has no verification methods', () => {
    const proof = makeProof({
      didDocument: { id: 'did:nobulex:abc123', verificationMethod: [], authentication: [], assertionMethod: [] },
    } as Partial<ProofOfBehavior>);
    const ext = toAgentCardExtension(proof);
    expect(ext.identity.publicKeyHex).toBe('');
    expect(ext.identity.verificationMethod).toBe('did:nobulex:abc123#key-1');
  });

  it('copies covenantHash and proofSignature verbatim', () => {
    const ext = toAgentCardExtension(makeProof());
    expect(ext.behavior.covenantHash).toBe('aabbccdd');
    expect(ext.behavior.proofSignature).toBe('sig-proof');
    expect(ext.behavior.generatedAt).toBe('2026-01-01T00:05:00Z');
  });
});
