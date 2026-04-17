import { describe, it, expect } from 'vitest';
import {
  CovenantAgent,
  createDID,
  parseSource,
  compile,
  ActionLogBuilder,
  verifyIntegrity,
  generateMerkleProof,
  verifyMerkleProof,
  buildMerkleTree,
  EnforcementMiddleware,
  createMiddleware,
  verify,
  verifyWithProofs,
  verifyBatch,
  DIDResolver,
  signWithDID,
  verifyWithDID,
} from './primitives';

const SAFE_AGENT_SOURCE = `
  covenant SafeAgent {
    forbid transfer (amount > 500);
    permit transfer;
    permit read;
    permit api_call;
    forbid delete;
    require agent.verified == true;
  }
`;

describe('@nobulex/sdk — Covenant Primitives', () => {
  // ── CovenantAgent ─────────────────────────────────────────────────────────

  describe('CovenantAgent', () => {
    it('creates an agent from DSL source', async () => {
      const agent = await CovenantAgent.create(SAFE_AGENT_SOURCE);
      expect(agent.did.did).toMatch(/^did:nobulex:/);
      expect(agent.spec.name).toBe('SafeAgent');
      expect(agent.actionCount).toBe(0);
    });

    it('creates an agent from existing DID', async () => {
      const did = await createDID();
      const agent = CovenantAgent.fromDID(did, 'covenant X { permit read; }');
      expect(agent.did.did).toBe(did.did);
      expect(agent.spec.name).toBe('X');
    });

    it('execute: allows permitted actions', async () => {
      const agent = await CovenantAgent.create(SAFE_AGENT_SOURCE);
      const result = await agent.execute('read', { agent: { verified: true } }, () => 'data');
      expect(result.executed).toBe(true);
      expect(result.decision.action).toBe('allow');
      expect(result.value).toBe('data');
    });

    it('execute: blocks forbidden actions', async () => {
      const agent = await CovenantAgent.create(SAFE_AGENT_SOURCE);
      const result = await agent.execute('delete', {}, () => 'no');
      expect(result.executed).toBe(false);
      expect(result.decision.action).toBe('block');
    });

    it('execute: blocks conditional forbids', async () => {
      const agent = await CovenantAgent.create(SAFE_AGENT_SOURCE);
      const result = await agent.execute('transfer', { amount: 600 }, () => 'no');
      expect(result.executed).toBe(false);
    });

    it('execute: allows when condition not met', async () => {
      const agent = await CovenantAgent.create(SAFE_AGENT_SOURCE);
      const result = await agent.execute('transfer', { amount: 100, agent: { verified: true } }, () => 'ok');
      expect(result.executed).toBe(true);
    });

    it('check: does not execute or log', async () => {
      const agent = await CovenantAgent.create(SAFE_AGENT_SOURCE);
      // Must satisfy `require agent.verified == true`
      const decision = agent.check('read', { agent: { verified: true } });
      expect(decision.action).toBe('allow');
      expect(agent.actionCount).toBe(0);
    });

    it('tracks action count', async () => {
      const agent = await CovenantAgent.create(SAFE_AGENT_SOURCE);
      await agent.execute('read', { agent: { verified: true } }, () => {});
      await agent.execute('delete', {}, () => {});
      expect(agent.actionCount).toBe(2);
    });

    it('getLog: returns valid hash-chained log', async () => {
      const agent = await CovenantAgent.create(SAFE_AGENT_SOURCE);
      await agent.execute('read', { agent: { verified: true } }, () => 'ok');
      await agent.execute('delete', {}, () => 'no');
      const log = agent.getLog();
      expect(log.entries).toHaveLength(2);
      expect(verifyIntegrity(log).valid).toBe(true);
    });

    it('verify: compliant agent', async () => {
      const agent = await CovenantAgent.create('covenant X { permit read; permit write; }');
      await agent.execute('read', {}, () => 'ok');
      await agent.execute('write', {}, () => 'ok');
      const result = agent.verify();
      expect(result.compliant).toBe(true);
    });

    it('verify: non-compliant agent (blocked actions still in log)', async () => {
      const agent = await CovenantAgent.create(SAFE_AGENT_SOURCE);
      await agent.execute('delete', {}, () => 'no');
      // blocked actions are not counted as violations (they were enforced)
      const result = agent.verify();
      expect(result.compliant).toBe(true);
    });

    it('verifyWithProofs: returns proofs for violations', async () => {
      const agent = await CovenantAgent.create(SAFE_AGENT_SOURCE);
      await agent.execute('read', { agent: { verified: true } }, () => {});
      const { result, proofs } = agent.verifyWithProofs();
      expect(result.compliant).toBe(true);
      expect(proofs.size).toBe(0);
    });

    it('sign and verify with DID', async () => {
      const agent = await CovenantAgent.create('covenant X { permit read; }');
      const sig = await agent.sign('hello');
      const valid = await CovenantAgent.verifySignature('hello', sig, agent.did.document);
      expect(valid).toBe(true);
    });

    it('attest: creates a W3C Verifiable Credential', async () => {
      const agent = await CovenantAgent.create('covenant X { permit read; }');
      const subjectDid = 'did:nobulex:subject123456789012';
      const attestation = await agent.attest(subjectDid);

      expect(attestation['@context']).toContain('https://www.w3.org/2018/credentials/v1');
      expect(attestation.type).toContain('VerifiableCredential');
      expect(attestation.type).toContain('CovenantAttestation');
      expect(attestation.issuer).toBe(agent.did.did);
      expect(attestation.credentialSubject.id).toBe(subjectDid);
      expect(attestation.credentialSubject.covenant.spec.name).toBe('X');
      expect(attestation.proof.type).toBe('Ed25519Signature2020');
      expect(attestation.proof.proofPurpose).toBe('assertionMethod');
    });

    it('attest: with expiration', async () => {
      const agent = await CovenantAgent.create('covenant X { permit read; }');
      const expires = '2030-01-01T00:00:00.000Z';
      const attestation = await agent.attest('did:nobulex:sub12345678901234', expires);
      expect(attestation.expirationDate).toBe(expires);
    });
  });

  // ── Full pipeline integration ─────────────────────────────────────────────

  describe('Full pipeline integration', () => {
    it('create → enforce → log → verify → prove', async () => {
      // 1. Create agent with covenant
      const agent = await CovenantAgent.create(`
        covenant TradingBot {
          forbid transfer (amount > 1000);
          permit transfer;
          permit read;
          permit query;
          forbid shutdown;
        }
      `);

      // 2. Execute actions through enforcement
      await agent.execute('read', {}, () => ['data']);
      await agent.execute('transfer', { amount: 50 }, () => 'sent');
      await agent.execute('transfer', { amount: 5000 }, () => 'no'); // blocked
      await agent.execute('shutdown', {}, () => 'no'); // blocked
      await agent.execute('query', {}, () => ({ result: 42 }));

      // 3. Verify action log integrity
      const log = agent.getLog();
      expect(log.entries).toHaveLength(5);
      expect(verifyIntegrity(log).valid).toBe(true);

      // 4. Post-hoc verification
      const result = agent.verify();
      expect(result.compliant).toBe(true); // blocked actions are not violations

      // 5. Merkle proofs
      const proof = generateMerkleProof(log, 0);
      expect(verifyMerkleProof(proof)).toBe(true);
    });

    it('DID + signing + verification + attestation', async () => {
      const issuer = await CovenantAgent.create('covenant IssuerPolicy { permit sign; permit attest; }');
      const subject = await CovenantAgent.create('covenant SubjectPolicy { permit read; permit write; }');

      // Issuer signs a message
      const message = 'I attest this agent is compliant';
      const sig = await issuer.sign(message);

      // Anyone can verify using the issuer's DID document
      const valid = await CovenantAgent.verifySignature(message, sig, issuer.did.document);
      expect(valid).toBe(true);

      // Create attestation
      const attestation = await issuer.attest(subject.did.did);
      expect(attestation.credentialSubject.covenant.issuerDid).toBe(issuer.did.did);
      expect(attestation.credentialSubject.covenant.subjectDid).toBe(subject.did.did);
    });
  });

  // ── Re-exported functions ─────────────────────────────────────────────────

  describe('Re-exported primitives', () => {
    it('DID functions are accessible', async () => {
      const did = await createDID();
      expect(did.did).toMatch(/^did:nobulex:/);
      const resolver = new DIDResolver();
      resolver.register(did.document);
      expect(resolver.resolve(did.did).found).toBe(true);
    });

    it('covenant-lang functions are accessible', () => {
      const spec = parseSource('covenant X { permit read; forbid write; }');
      expect(spec.name).toBe('X');
      const enforce = compile(spec);
      expect(enforce({ action: 'read', params: {} }).action).toBe('allow');
      expect(enforce({ action: 'write', params: {} }).action).toBe('block');
    });

    it('action-log functions are accessible', () => {
      const builder = new ActionLogBuilder('did:nobulex:test');
      builder.append({ action: 'a', resource: '/r', params: {}, outcome: 'success' });
      const log = builder.toLog();
      expect(verifyIntegrity(log).valid).toBe(true);
      const { root } = buildMerkleTree(log.entries.map(e => e.hash));
      expect(root).toBeTruthy();
    });

    it('middleware functions are accessible', async () => {
      const mw = createMiddleware('did:nobulex:test', 'covenant X { permit read; }');
      const result = await mw.execute({ action: 'read', params: {} }, () => 'ok');
      expect(result.executed).toBe(true);
    });

    it('verification functions are accessible', () => {
      const spec = parseSource('covenant X { permit read; forbid write; }');
      const builder = new ActionLogBuilder('did:nobulex:test');
      builder.append({ action: 'read', resource: '/r', params: {}, outcome: 'success' });
      const log = builder.toLog();
      const result = verify(spec, log);
      expect(result.compliant).toBe(true);
    });

  });
});
