import { describe, it, expect } from 'vitest';
import type {
  DIDDocument,
  DIDVerificationMethod,
  DIDKeyPair,
  CovenantEffect,
  ComparisonOperator,
  CovenantCondition,
  CovenantRequirement,
  CovenantStatement,
  CovenantSpec,
  SignedCovenant,
  VCProof,
  CovenantAttestation,
  ActionLogEntry,
  ActionLog,
  Violation,
  VerificationResult,
  MerkleProofNode,
  MerkleProof,
  EnforcementAction,
  EnforcementDecision,
  StakeConfig,
  SlashEvent,
  HexString,
  ISOTimestamp,
} from './index';

describe('@nobulex/core-types', () => {
  // ── 1. Identity (DID) ────────────────────────────────────────────────────

  describe('Identity (DID) types', () => {
    it('DIDVerificationMethod is structurally valid', () => {
      const vm: DIDVerificationMethod = {
        id: 'did:nobulex:abc123#key-1',
        type: 'Ed25519VerificationKey2020',
        controller: 'did:nobulex:abc123',
        publicKeyHex: 'aabbccdd',
      };
      expect(vm.id).toBe('did:nobulex:abc123#key-1');
      expect(vm.type).toBe('Ed25519VerificationKey2020');
      expect(vm.controller).toBe('did:nobulex:abc123');
      expect(vm.publicKeyHex).toBe('aabbccdd');
    });

    it('DIDDocument is structurally valid', () => {
      const doc: DIDDocument = {
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: 'did:nobulex:agent-1',
        controller: 'did:nobulex:agent-1',
        verificationMethod: [
          {
            id: 'did:nobulex:agent-1#key-1',
            type: 'Ed25519VerificationKey2020',
            controller: 'did:nobulex:agent-1',
            publicKeyHex: 'aabb',
          },
        ],
        authentication: ['did:nobulex:agent-1#key-1'],
        assertionMethod: ['did:nobulex:agent-1#key-1'],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
      };
      expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
      expect(doc.id).toMatch(/^did:nobulex:/);
      expect(doc.verificationMethod).toHaveLength(1);
      expect(doc.authentication).toHaveLength(1);
    });

    it('DIDKeyPair is structurally valid', () => {
      const kp: DIDKeyPair = {
        did: 'did:nobulex:agent-1',
        privateKey: new Uint8Array(32),
        publicKey: new Uint8Array(32),
        publicKeyHex: '00'.repeat(32),
      };
      expect(kp.did).toMatch(/^did:nobulex:/);
      expect(kp.privateKey).toHaveLength(32);
      expect(kp.publicKey).toHaveLength(32);
    });
  });

  // ── 2. Covenant (Behavioral Spec) ────────────────────────────────────────

  describe('Covenant types', () => {
    it('CovenantEffect accepts permit and forbid', () => {
      const effects: CovenantEffect[] = ['permit', 'forbid'];
      expect(effects).toContain('permit');
      expect(effects).toContain('forbid');
    });

    it('ComparisonOperator accepts all operators', () => {
      const ops: ComparisonOperator[] = ['>', '<', '>=', '<=', '==', '!='];
      expect(ops).toHaveLength(6);
    });

    it('CovenantCondition is structurally valid', () => {
      const cond: CovenantCondition = {
        field: 'amount',
        operator: '>',
        value: 500,
      };
      expect(cond.field).toBe('amount');
      expect(cond.operator).toBe('>');
      expect(cond.value).toBe(500);
    });

    it('CovenantStatement with conditions', () => {
      const stmt: CovenantStatement = {
        effect: 'forbid',
        action: 'transfer',
        conditions: [{ field: 'amount', operator: '>', value: 500 }],
      };
      expect(stmt.effect).toBe('forbid');
      expect(stmt.action).toBe('transfer');
      expect(stmt.conditions).toHaveLength(1);
    });

    it('CovenantSpec contains statements and requirements', () => {
      const spec: CovenantSpec = {
        name: 'SafeTransfer',
        statements: [
          { effect: 'forbid', action: 'transfer', conditions: [{ field: 'amount', operator: '>', value: 500 }] },
          { effect: 'permit', action: 'api_call', conditions: [] },
        ],
        requirements: [
          { field: 'counterparty.compliance_score', operator: '>=', value: 0.9 },
        ],
      };
      expect(spec.name).toBe('SafeTransfer');
      expect(spec.statements).toHaveLength(2);
      expect(spec.requirements).toHaveLength(1);
    });

    it('SignedCovenant is structurally valid', () => {
      const covenant: SignedCovenant = {
        id: 'cov_abc123',
        spec: {
          name: 'Test',
          statements: [],
          requirements: [],
        },
        issuerDid: 'did:nobulex:issuer',
        subjectDid: 'did:nobulex:agent',
        issuedAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2026-01-01T00:00:00.000Z',
        signature: 'aabb',
        nonce: 'ccdd',
      };
      expect(covenant.id).toBe('cov_abc123');
      expect(covenant.issuerDid).toMatch(/^did:nobulex:/);
      expect(covenant.subjectDid).toMatch(/^did:nobulex:/);
      expect(covenant.signature).toBeTruthy();
      expect(covenant.nonce).toBeTruthy();
    });
  });

  // ── 3. Attestation (Verifiable Credential) ───────────────────────────────

  describe('Attestation types', () => {
    it('VCProof is structurally valid', () => {
      const proof: VCProof = {
        type: 'Ed25519Signature2020',
        created: '2025-01-01T00:00:00.000Z',
        verificationMethod: 'did:nobulex:issuer#key-1',
        proofPurpose: 'assertionMethod',
        proofValue: 'signatureHex',
      };
      expect(proof.type).toBe('Ed25519Signature2020');
      expect(proof.proofPurpose).toBe('assertionMethod');
    });

    it('CovenantAttestation is structurally valid', () => {
      const attestation: CovenantAttestation = {
        '@context': [
          'https://www.w3.org/2018/credentials/v1',
          'https://nobulex.com/credentials/v1',
        ],
        type: ['VerifiableCredential', 'CovenantAttestation'],
        id: 'urn:uuid:test',
        issuer: 'did:nobulex:issuer',
        issuanceDate: '2025-01-01T00:00:00.000Z',
        expirationDate: null,
        credentialSubject: {
          id: 'did:nobulex:agent',
          covenant: {
            id: 'cov_1',
            spec: { name: 'Test', statements: [], requirements: [] },
            issuerDid: 'did:nobulex:issuer',
            subjectDid: 'did:nobulex:agent',
            issuedAt: '2025-01-01T00:00:00.000Z',
            expiresAt: null,
            signature: 'sig',
            nonce: 'nonce',
          },
        },
        proof: {
          type: 'Ed25519Signature2020',
          created: '2025-01-01T00:00:00.000Z',
          verificationMethod: 'did:nobulex:issuer#key-1',
          proofPurpose: 'assertionMethod',
          proofValue: 'proof-sig',
        },
      };
      expect(attestation.type).toContain('VerifiableCredential');
      expect(attestation.type).toContain('CovenantAttestation');
      expect(attestation.credentialSubject.covenant.id).toBe('cov_1');
    });
  });

  // ── 4. Action Log ────────────────────────────────────────────────────────

  describe('ActionLog types', () => {
    it('ActionLogEntry is structurally valid', () => {
      const entry: ActionLogEntry = {
        index: 0,
        timestamp: '2025-01-01T00:00:00.000Z',
        agentDid: 'did:nobulex:agent',
        action: 'transfer',
        resource: '/accounts/123',
        params: { amount: 100 },
        outcome: 'success',
        previousHash: null,
        hash: 'abcdef1234567890',
      };
      expect(entry.index).toBe(0);
      expect(entry.previousHash).toBeNull();
      expect(entry.hash).toBeTruthy();
      expect(entry.outcome).toBe('success');
    });

    it('ActionLogEntry outcomes', () => {
      const outcomes: ActionLogEntry['outcome'][] = ['success', 'failure', 'blocked'];
      expect(outcomes).toHaveLength(3);
    });

    it('ActionLog is structurally valid', () => {
      const log: ActionLog = {
        agentDid: 'did:nobulex:agent',
        entries: [],
        rootHash: null,
        headHash: null,
        length: 0,
      };
      expect(log.agentDid).toMatch(/^did:nobulex:/);
      expect(log.entries).toHaveLength(0);
      expect(log.length).toBe(0);
    });
  });

  // ── 5. Verification ──────────────────────────────────────────────────────

  describe('Verification types', () => {
    it('Violation is structurally valid', () => {
      const violation: Violation = {
        entryIndex: 3,
        action: 'transfer',
        resource: '/accounts/123',
        rule: { effect: 'forbid', action: 'transfer', conditions: [{ field: 'amount', operator: '>', value: 500 }] },
        reason: 'Action forbidden by covenant: amount > 500',
        timestamp: '2025-01-01T00:00:00.000Z',
      };
      expect(violation.entryIndex).toBe(3);
      expect(violation.reason).toContain('forbidden');
    });

    it('VerificationResult is structurally valid', () => {
      const result: VerificationResult = {
        compliant: true,
        covenantId: 'cov_1',
        agentDid: 'did:nobulex:agent',
        totalActions: 100,
        violations: [],
        checkedAt: '2025-01-01T00:00:00.000Z',
        merkleRoot: null,
      };
      expect(result.compliant).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.totalActions).toBe(100);
    });

    it('MerkleProof is structurally valid', () => {
      const proof: MerkleProof = {
        entryIndex: 5,
        entryHash: 'aabb',
        proof: [
          { hash: 'ccdd', direction: 'left' },
          { hash: 'eeff', direction: 'right' },
        ],
        root: '1122',
      };
      expect(proof.proof).toHaveLength(2);
      expect(proof.proof[0]!.direction).toBe('left');
    });

    it('MerkleProofNode directions are left or right', () => {
      const nodes: MerkleProofNode[] = [
        { hash: 'a', direction: 'left' },
        { hash: 'b', direction: 'right' },
      ];
      expect(nodes.every(n => n.direction === 'left' || n.direction === 'right')).toBe(true);
    });
  });

  // ── 6. Enforcement ───────────────────────────────────────────────────────

  describe('Enforcement types', () => {
    it('EnforcementAction values', () => {
      const actions: EnforcementAction[] = ['block', 'allow', 'flag'];
      expect(actions).toHaveLength(3);
    });

    it('EnforcementDecision is structurally valid', () => {
      const decision: EnforcementDecision = {
        action: 'block',
        matchedRule: { effect: 'forbid', action: 'transfer', conditions: [] },
        reason: 'Forbidden by covenant',
        timestamp: '2025-01-01T00:00:00.000Z',
      };
      expect(decision.action).toBe('block');
      expect(decision.matchedRule).not.toBeNull();
    });

    it('EnforcementDecision with no matched rule', () => {
      const decision: EnforcementDecision = {
        action: 'allow',
        matchedRule: null,
        reason: 'No matching rule, default allow',
        timestamp: '2025-01-01T00:00:00.000Z',
      };
      expect(decision.matchedRule).toBeNull();
    });

    it('StakeConfig is structurally valid', () => {
      const config: StakeConfig = {
        stakedAmount: 1000n,
        slashPercentage: 10,
        slashRecipient: '0xabc',
        minStake: 100n,
      };
      expect(config.stakedAmount).toBe(1000n);
      expect(config.slashPercentage).toBe(10);
    });

    it('SlashEvent is structurally valid', () => {
      const event: SlashEvent = {
        covenantId: 'cov_1',
        agentDid: 'did:nobulex:agent',
        violationCount: 3,
        slashedAmount: 100n,
        timestamp: '2025-01-01T00:00:00.000Z',
        proof: null,
      };
      expect(event.slashedAmount).toBe(100n);
      expect(event.proof).toBeNull();
    });
  });

  // ── Utility types ────────────────────────────────────────────────────────

  describe('Utility types', () => {
    it('HexString is a string alias', () => {
      const hex: HexString = 'aabbccdd';
      expect(typeof hex).toBe('string');
    });

    it('ISOTimestamp is a string alias', () => {
      const ts: ISOTimestamp = '2025-01-01T00:00:00.000Z';
      expect(typeof ts).toBe('string');
    });
  });
});
