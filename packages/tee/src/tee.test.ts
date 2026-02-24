import { describe, it, expect } from 'vitest';
import {
  generateQuote,
  generateEndorsements,
  verifyAttestation,
  bindEnclaveToDID,
  verifyBinding,
  isBindingExpired,
  TEERegistry,
  generateReportData,
  createEvidence,
  DEFAULT_ENCLAVE_POLICY,
  SGX,
  TDX,
  SEV_SNP,
  platformName,
} from './index';
import type {
  TEEPlatform,
  AttestationQuote,
  AttestationEvidence,
  EnclavePolicy,
} from './index';

describe('@nobulex/tee', () => {

  // ── Quote Generation ──────────────────────────────────────────────────────

  describe('generateQuote', () => {
    it('generates a valid SGX quote', async () => {
      const quote = await generateQuote('sgx', 'test-report-data');
      expect(quote.id).toMatch(/^quote_/);
      expect(quote.platform).toBe('sgx');
      expect(quote.reportData).toBe('test-report-data');
      expect(quote.measurement).toBeTruthy();
      expect(quote.signerMeasurement).toBeTruthy();
      expect(quote.rawQuote).toBeTruthy();
      expect(quote.debugMode).toBe(false);
      expect(quote.securityVersion).toBe(1);
    });

    it('generates a TDX quote', async () => {
      const quote = await generateQuote('tdx', 'tdx-data');
      expect(quote.platform).toBe('tdx');
    });

    it('generates a SEV-SNP quote', async () => {
      const quote = await generateQuote('sev-snp', 'snp-data');
      expect(quote.platform).toBe('sev-snp');
    });

    it('accepts custom options', async () => {
      const quote = await generateQuote('sgx', 'data', {
        measurement: 'custom-measurement-hash',
        signerMeasurement: 'custom-signer-hash',
        productId: 42,
        securityVersion: 3,
        debugMode: true,
      });
      expect(quote.measurement).toBe('custom-measurement-hash');
      expect(quote.signerMeasurement).toBe('custom-signer-hash');
      expect(quote.productId).toBe(42);
      expect(quote.securityVersion).toBe(3);
      expect(quote.debugMode).toBe(true);
    });

    it('generates unique quotes', async () => {
      const q1 = await generateQuote('sgx', 'data');
      const q2 = await generateQuote('sgx', 'data');
      expect(q1.id).not.toBe(q2.id);
      expect(q1.rawQuote).not.toBe(q2.rawQuote);
    });
  });

  // ── Endorsements ──────────────────────────────────────────────────────────

  describe('generateEndorsements', () => {
    it('generates valid endorsements', () => {
      const endorsements = generateEndorsements();
      expect(endorsements.certificateChain).toHaveLength(3);
      expect(endorsements.tcbInfo.tcbLevel).toBe(3);
      expect(endorsements.tcbInfo.status).toBe('UpToDate');
      expect(endorsements.tcbInfo.advisoryIds).toHaveLength(0);
    });

    it('respects custom TCB level', () => {
      const endorsements = generateEndorsements(5);
      expect(endorsements.tcbInfo.tcbLevel).toBe(5);
    });

    it('sets expiry in the future', () => {
      const endorsements = generateEndorsements(3, 3600);
      const expiresAt = new Date(endorsements.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThan(Date.now());
    });
  });

  // ── Attestation Verification ──────────────────────────────────────────────

  describe('verifyAttestation', () => {
    async function makeEvidence(overrides: Partial<{
      debugMode: boolean;
      securityVersion: number;
      measurement: string;
      signerMeasurement: string;
      tcbLevel: number;
      tcbStatus: 'UpToDate' | 'Revoked';
      endorsementExpired: boolean;
    }> = {}): Promise<AttestationEvidence> {
      const quote = await generateQuote('sgx', 'test', {
        debugMode: overrides.debugMode,
        securityVersion: overrides.securityVersion,
        measurement: overrides.measurement,
        signerMeasurement: overrides.signerMeasurement,
      });
      const endorsements = generateEndorsements(
        overrides.tcbLevel ?? 3,
        overrides.endorsementExpired ? -1 : 86400,
      );
      if (overrides.tcbStatus === 'Revoked') {
        return {
          quote,
          endorsements: {
            ...endorsements,
            tcbInfo: { ...endorsements.tcbInfo, status: 'Revoked' },
          },
          securityLevel: 'simulated',
        };
      }
      return createEvidence(quote, endorsements, 'simulated');
    }

    it('valid attestation passes', async () => {
      const evidence = await makeEvidence();
      const result = verifyAttestation(evidence);
      expect(result.valid).toBe(true);
      expect(result.status).toBe('valid');
      expect(result.errors).toHaveLength(0);
    });

    it('rejects debug enclaves by default', async () => {
      const evidence = await makeEvidence({ debugMode: true });
      const result = verifyAttestation(evidence);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Debug enclaves are not allowed by policy');
    });

    it('allows debug enclaves when policy permits', async () => {
      const evidence = await makeEvidence({ debugMode: true });
      const policy: EnclavePolicy = { ...DEFAULT_ENCLAVE_POLICY, allowDebug: true };
      const result = verifyAttestation(evidence, policy);
      expect(result.valid).toBe(true);
    });

    it('rejects low security version', async () => {
      const evidence = await makeEvidence({ securityVersion: 0 });
      const policy: EnclavePolicy = { ...DEFAULT_ENCLAVE_POLICY, minSecurityVersion: 2 };
      const result = verifyAttestation(evidence, policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Security version'))).toBe(true);
    });

    it('rejects non-whitelisted measurement', async () => {
      const evidence = await makeEvidence({ measurement: 'bad-measurement' });
      const policy: EnclavePolicy = {
        ...DEFAULT_ENCLAVE_POLICY,
        allowedMeasurements: ['good-measurement'],
      };
      const result = verifyAttestation(evidence, policy);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Enclave measurement not in allowed list');
    });

    it('accepts whitelisted measurement', async () => {
      const evidence = await makeEvidence({ measurement: 'good-measurement' });
      const policy: EnclavePolicy = {
        ...DEFAULT_ENCLAVE_POLICY,
        allowedMeasurements: ['good-measurement'],
      };
      const result = verifyAttestation(evidence, policy);
      expect(result.valid).toBe(true);
    });

    it('rejects non-whitelisted signer', async () => {
      const evidence = await makeEvidence({ signerMeasurement: 'bad-signer' });
      const policy: EnclavePolicy = {
        ...DEFAULT_ENCLAVE_POLICY,
        allowedSigners: ['good-signer'],
      };
      const result = verifyAttestation(evidence, policy);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Signer measurement not in allowed list');
    });

    it('rejects revoked TCB', async () => {
      const evidence = await makeEvidence({ tcbStatus: 'Revoked' });
      const result = verifyAttestation(evidence);
      expect(result.valid).toBe(false);
      expect(result.status).toBe('revoked');
    });

    it('rejects expired endorsements', async () => {
      const evidence = await makeEvidence({ endorsementExpired: true });
      const result = verifyAttestation(evidence);
      expect(result.valid).toBe(false);
      expect(result.status).toBe('expired');
    });

    it('rejects low TCB level', async () => {
      const evidence = await makeEvidence({ tcbLevel: 0 });
      const policy: EnclavePolicy = { ...DEFAULT_ENCLAVE_POLICY, minTcbLevel: 2 };
      const result = verifyAttestation(evidence, policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('TCB level'))).toBe(true);
    });

    it('returns platform and security level in result', async () => {
      const evidence = await makeEvidence();
      const result = verifyAttestation(evidence);
      expect(result.platform).toBe('sgx');
      expect(result.securityLevel).toBe('simulated');
      expect(result.verifiedAt).toBeTruthy();
    });
  });

  // ── TEE ↔ DID Binding ──────────────────────────────────────────────────────

  describe('bindEnclaveToDID / verifyBinding', () => {
    it('creates and verifies a binding', async () => {
      const quote = await generateQuote('sgx', 'did-binding');
      const identity = await bindEnclaveToDID('did:nobulex:agent123', quote);

      expect(identity.did).toBe('did:nobulex:agent123');
      expect(identity.measurement).toBe(quote.measurement);
      expect(identity.signerMeasurement).toBe(quote.signerMeasurement);
      expect(identity.platform).toBe('sgx');
      expect(identity.bindingProof).toBeTruthy();
      expect(identity.createdAt).toBeTruthy();
      expect(identity.expiresAt).toBeNull();

      const valid = await verifyBinding(identity);
      expect(valid).toBe(true);
    });

    it('detects tampered binding', async () => {
      const quote = await generateQuote('sgx', 'did-binding');
      const identity = await bindEnclaveToDID('did:nobulex:agent123', quote);

      // Tamper with the DID
      const tampered = { ...identity, did: 'did:nobulex:hacker' };
      const valid = await verifyBinding(tampered);
      expect(valid).toBe(false);
    });

    it('supports expiry', async () => {
      const quote = await generateQuote('sgx', 'data');
      const past = new Date(Date.now() - 1000).toISOString();
      const identity = await bindEnclaveToDID('did:nobulex:agent', quote, past);
      expect(identity.expiresAt).toBe(past);
      expect(isBindingExpired(identity)).toBe(true);
    });

    it('non-expired binding', async () => {
      const quote = await generateQuote('sgx', 'data');
      const future = new Date(Date.now() + 86400_000).toISOString();
      const identity = await bindEnclaveToDID('did:nobulex:agent', quote, future);
      expect(isBindingExpired(identity)).toBe(false);
    });

    it('null expiry never expires', async () => {
      const quote = await generateQuote('sgx', 'data');
      const identity = await bindEnclaveToDID('did:nobulex:agent', quote, null);
      expect(isBindingExpired(identity)).toBe(false);
    });
  });

  // ── TEERegistry ────────────────────────────────────────────────────────────

  describe('TEERegistry', () => {
    it('register and resolve', async () => {
      const registry = new TEERegistry();
      const quote = await generateQuote('sgx', 'data');
      const identity = await bindEnclaveToDID('did:nobulex:agent1', quote);

      registry.register(identity);
      expect(registry.size).toBe(1);
      expect(registry.resolve('did:nobulex:agent1')).toBe(identity);
      expect(registry.resolve('did:nobulex:unknown')).toBeNull();
    });

    it('register evidence and retrieve', async () => {
      const registry = new TEERegistry();
      const quote = await generateQuote('sgx', 'data');
      const endorsements = generateEndorsements();
      const evidence = createEvidence(quote, endorsements);

      registry.registerEvidence(evidence);
      expect(registry.getEvidence(quote.id)).toBe(evidence);
      expect(registry.getEvidence('unknown')).toBeNull();
    });

    it('isValid for non-expired binding', async () => {
      const registry = new TEERegistry();
      const quote = await generateQuote('sgx', 'data');
      const future = new Date(Date.now() + 86400_000).toISOString();
      const identity = await bindEnclaveToDID('did:nobulex:agent', quote, future);

      registry.register(identity);
      expect(registry.isValid('did:nobulex:agent')).toBe(true);
    });

    it('isValid false for expired binding', async () => {
      const registry = new TEERegistry();
      const quote = await generateQuote('sgx', 'data');
      const past = new Date(Date.now() - 1000).toISOString();
      const identity = await bindEnclaveToDID('did:nobulex:agent', quote, past);

      registry.register(identity);
      expect(registry.isValid('did:nobulex:agent')).toBe(false);
    });

    it('isValid false for unknown DID', () => {
      const registry = new TEERegistry();
      expect(registry.isValid('did:nobulex:unknown')).toBe(false);
    });

    it('revoke removes binding', async () => {
      const registry = new TEERegistry();
      const quote = await generateQuote('sgx', 'data');
      const identity = await bindEnclaveToDID('did:nobulex:agent', quote);

      registry.register(identity);
      expect(registry.size).toBe(1);
      expect(registry.revoke('did:nobulex:agent')).toBe(true);
      expect(registry.size).toBe(0);
      expect(registry.resolve('did:nobulex:agent')).toBeNull();
    });

    it('revoke returns false for unknown', () => {
      const registry = new TEERegistry();
      expect(registry.revoke('did:nobulex:unknown')).toBe(false);
    });

    it('dids returns all registered DIDs', async () => {
      const registry = new TEERegistry();
      const q1 = await generateQuote('sgx', 'd1');
      const q2 = await generateQuote('tdx', 'd2');
      const i1 = await bindEnclaveToDID('did:nobulex:a', q1);
      const i2 = await bindEnclaveToDID('did:nobulex:b', q2);

      registry.register(i1);
      registry.register(i2);
      expect(registry.dids.sort()).toEqual(['did:nobulex:a', 'did:nobulex:b']);
    });
  });

  // ── Report Data ────────────────────────────────────────────────────────────

  describe('generateReportData', () => {
    it('generates deterministic report data with same nonce', async () => {
      const r1 = await generateReportData('did:nobulex:a', 'pubkey123', 'nonce1');
      const r2 = await generateReportData('did:nobulex:a', 'pubkey123', 'nonce1');
      expect(r1).toBe(r2);
    });

    it('generates different data with different nonce', async () => {
      const r1 = await generateReportData('did:nobulex:a', 'pubkey123', 'nonce1');
      const r2 = await generateReportData('did:nobulex:a', 'pubkey123', 'nonce2');
      expect(r1).not.toBe(r2);
    });

    it('generates different data for different DIDs', async () => {
      const r1 = await generateReportData('did:nobulex:a', 'pk', 'n');
      const r2 = await generateReportData('did:nobulex:b', 'pk', 'n');
      expect(r1).not.toBe(r2);
    });
  });

  // ── createEvidence ─────────────────────────────────────────────────────────

  describe('createEvidence', () => {
    it('bundles quote and endorsements', async () => {
      const quote = await generateQuote('tdx', 'data');
      const endorsements = generateEndorsements();
      const evidence = createEvidence(quote, endorsements, 'hardware');
      expect(evidence.quote).toBe(quote);
      expect(evidence.endorsements).toBe(endorsements);
      expect(evidence.securityLevel).toBe('hardware');
    });

    it('defaults to simulated', async () => {
      const quote = await generateQuote('sgx', 'data');
      const endorsements = generateEndorsements();
      const evidence = createEvidence(quote, endorsements);
      expect(evidence.securityLevel).toBe('simulated');
    });
  });

  // ── Platform Constants ─────────────────────────────────────────────────────

  describe('Platform constants', () => {
    it('SGX constants', () => {
      expect(SGX.PLATFORM).toBe('sgx');
      expect(SGX.MAX_REPORT_DATA_SIZE).toBe(64);
    });

    it('TDX constants', () => {
      expect(TDX.PLATFORM).toBe('tdx');
    });

    it('SEV_SNP constants', () => {
      expect(SEV_SNP.PLATFORM).toBe('sev-snp');
    });

    it('platformName returns display names', () => {
      expect(platformName('sgx')).toBe('Intel SGX');
      expect(platformName('tdx')).toBe('Intel TDX');
      expect(platformName('sev-snp')).toBe('AMD SEV-SNP');
    });
  });

  // ── Full Pipeline ──────────────────────────────────────────────────────────

  describe('Full pipeline: generate → verify → bind', () => {
    it('end-to-end TEE attestation flow', async () => {
      // 1. Agent generates DID report data
      const did = 'did:nobulex:tee-agent-001';
      const reportData = await generateReportData(did, 'abcdef1234567890');

      // 2. TEE generates attestation quote
      const quote = await generateQuote('sgx', reportData, {
        securityVersion: 2,
      });

      // 3. Platform provides endorsements
      const endorsements = generateEndorsements(3);

      // 4. Bundle into evidence
      const evidence = createEvidence(quote, endorsements, 'hardware');

      // 5. Verify attestation
      const result = verifyAttestation(evidence);
      expect(result.valid).toBe(true);
      expect(result.platform).toBe('sgx');
      expect(result.securityLevel).toBe('hardware');

      // 6. Bind enclave to DID
      const identity = await bindEnclaveToDID(did, quote);

      // 7. Verify binding
      const bindingValid = await verifyBinding(identity);
      expect(bindingValid).toBe(true);

      // 8. Register in TEE registry
      const registry = new TEERegistry();
      registry.register(identity);
      registry.registerEvidence(evidence);

      expect(registry.isValid(did)).toBe(true);
      expect(registry.getEvidence(quote.id)).toBe(evidence);
    });
  });
});
