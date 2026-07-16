import { describe, it, expect } from 'vitest';
import { verify, proveViolation, verifyWithProofs, verifyBatch } from './index';
import { parseSource } from '../covenant-lang/index';
import { ActionLogBuilder, verifyMerkleProof } from '../action-log/index';
import type { CovenantSpec } from '../types/index';

function makeLog(actions: { action: string; params: Record<string, unknown>; outcome?: 'success' | 'failure' | 'blocked' }[]) {
  const builder = new ActionLogBuilder('did:nobulex:agent-1');
  for (const a of actions) {
    builder.append({
      action: a.action,
      resource: '*',
      params: a.params,
      outcome: a.outcome ?? 'success',
    });
  }
  return builder.toLog();
}

const SPEC: CovenantSpec = parseSource(`covenant SafeTransfer {
  forbid transfer (amount > 500);
  permit transfer;
  permit read;
  forbid delete;
}`);

describe('@nobulex/verification', () => {
  // ── verify() ──────────────────────────────────────────────────────────────

  describe('verify()', () => {
    it('returns compliant for clean log', () => {
      const log = makeLog([
        { action: 'read', params: {} },
        { action: 'transfer', params: { amount: 100 } },
      ]);
      const result = verify(SPEC, log);
      expect(result.compliant).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.covenantId).toBe('SafeTransfer');
      expect(result.agentDid).toBe('did:nobulex:agent-1');
      expect(result.totalActions).toBe(2);
    });

    it('detects forbidden action (forbid delete)', () => {
      const log = makeLog([
        { action: 'read', params: {} },
        { action: 'delete', params: {} },
      ]);
      const result = verify(SPEC, log);
      expect(result.compliant).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.action).toBe('delete');
      expect(result.violations[0]!.entryIndex).toBe(1);
    });

    it('detects conditional forbid (amount > 500)', () => {
      const log = makeLog([
        { action: 'transfer', params: { amount: 600 } },
      ]);
      const result = verify(SPEC, log);
      expect(result.compliant).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.reason).toContain('forbidden');
    });

    it('does not flag allowed transfers', () => {
      const log = makeLog([
        { action: 'transfer', params: { amount: 100 } },
        { action: 'transfer', params: { amount: 500 } },
      ]);
      const result = verify(SPEC, log);
      expect(result.compliant).toBe(true);
    });

    it('does not flag blocked entries', () => {
      const log = makeLog([
        { action: 'delete', params: {}, outcome: 'blocked' },
        { action: 'read', params: {} },
      ]);
      const result = verify(SPEC, log);
      // 'blocked' entries are skipped, they were already enforced
      expect(result.compliant).toBe(true);
    });

    it('detects unknown actions (default deny)', () => {
      const log = makeLog([
        { action: 'shutdown', params: {} },
      ]);
      const result = verify(SPEC, log);
      expect(result.compliant).toBe(false);
      expect(result.violations[0]!.reason).toContain('default deny');
    });

    it('detects multiple violations', () => {
      const log = makeLog([
        { action: 'delete', params: {} },
        { action: 'transfer', params: { amount: 9999 } },
        { action: 'read', params: {} },
        { action: 'shutdown', params: {} },
      ]);
      const result = verify(SPEC, log);
      expect(result.compliant).toBe(false);
      expect(result.violations).toHaveLength(3);
    });

    it('includes merkleRoot when proofs enabled', () => {
      const log = makeLog([{ action: 'read', params: {} }]);
      const result = verify(SPEC, log, { includeMerkleProofs: true });
      expect(result.merkleRoot).toBeTruthy();
    });

    it('omits merkleRoot when proofs disabled', () => {
      const log = makeLog([{ action: 'read', params: {} }]);
      const result = verify(SPEC, log, { includeMerkleProofs: false });
      expect(result.merkleRoot).toBeNull();
    });

    it('handles empty log', () => {
      const log = new ActionLogBuilder('did:nobulex:agent-1').toLog();
      const result = verify(SPEC, log);
      expect(result.compliant).toBe(true);
      expect(result.totalActions).toBe(0);
    });

    it('detects tampered log when integrity check enabled', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      builder.append({ action: 'read', resource: '/a', params: {}, outcome: 'success' });
      const log = builder.toLog();
      const tampered = {
        ...log,
        entries: [{ ...log.entries[0]!, hash: 'tampered' }],
        headHash: 'tampered',
      };
      const result = verify(SPEC, tampered, { verifyLogIntegrity: true });
      expect(result.compliant).toBe(false);
      expect(result.violations[0]!.reason).toContain('integrity');
    });

    it('skips integrity check when disabled', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      builder.append({ action: 'read', resource: '/a', params: {}, outcome: 'success' });
      const log = builder.toLog();
      const tampered = {
        ...log,
        entries: [{ ...log.entries[0]!, hash: 'tampered' }],
        headHash: 'tampered',
      };
      const result = verify(SPEC, tampered, { verifyLogIntegrity: false });
      // Won't detect hash tampering, but will still evaluate rules
      expect(result.compliant).toBe(true);
    });

    it('includes checkedAt timestamp', () => {
      const log = makeLog([{ action: 'read', params: {} }]);
      const result = verify(SPEC, log);
      expect(result.checkedAt).toBeTruthy();
      expect(new Date(result.checkedAt).getTime()).not.toBeNaN();
    });
  });

  // ── proveViolation() ──────────────────────────────────────────────────────

  describe('proveViolation()', () => {
    it('generates valid Merkle proof for a violation', () => {
      const log = makeLog([
        { action: 'read', params: {} },
        { action: 'delete', params: {} },
        { action: 'read', params: {} },
      ]);
      const result = verify(SPEC, log);
      expect(result.violations).toHaveLength(1);
      const proof = proveViolation(log, result.violations[0]!);
      expect(proof.entryIndex).toBe(1);
      expect(verifyMerkleProof(proof)).toBe(true);
    });
  });

  // ── verifyWithProofs() ────────────────────────────────────────────────────

  describe('verifyWithProofs()', () => {
    it('returns verification result with Merkle proofs', () => {
      const log = makeLog([
        { action: 'read', params: {} },
        { action: 'delete', params: {} },
        { action: 'transfer', params: { amount: 9999 } },
      ]);
      const { result, proofs } = verifyWithProofs(SPEC, log);
      expect(result.compliant).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(proofs.size).toBe(2);

      for (const [idx, proof] of proofs) {
        expect(proof.entryIndex).toBe(idx);
        expect(verifyMerkleProof(proof)).toBe(true);
      }
    });

    it('no proofs for clean log', () => {
      const log = makeLog([{ action: 'read', params: {} }]);
      const { result, proofs } = verifyWithProofs(SPEC, log);
      expect(result.compliant).toBe(true);
      expect(proofs.size).toBe(0);
    });
  });

  // ── verifyBatch() ─────────────────────────────────────────────────────────

  describe('verifyBatch()', () => {
    it('verifies multiple covenants against one log', () => {
      const spec1 = parseSource('covenant Strict { forbid transfer; permit read; }');
      const spec2 = parseSource('covenant Permissive { permit transfer; permit read; }');

      const log = makeLog([
        { action: 'read', params: {} },
        { action: 'transfer', params: { amount: 100 } },
      ]);

      const results = verifyBatch([spec1, spec2], log);
      expect(results.size).toBe(2);
      expect(results.get('Strict')!.compliant).toBe(false);
      expect(results.get('Permissive')!.compliant).toBe(true);
    });

    it('handles empty specs array', () => {
      const log = makeLog([{ action: 'read', params: {} }]);
      const results = verifyBatch([], log);
      expect(results.size).toBe(0);
    });
  });

  // ── Determinism ───────────────────────────────────────────────────────────

  describe('Determinism', () => {
    it('same inputs produce same violations', () => {
      const log = makeLog([
        { action: 'delete', params: {} },
        { action: 'read', params: {} },
        { action: 'transfer', params: { amount: 9999 } },
      ]);
      const r1 = verify(SPEC, log);
      const r2 = verify(SPEC, log);
      expect(r1.compliant).toBe(r2.compliant);
      expect(r1.violations.length).toBe(r2.violations.length);
      for (let i = 0; i < r1.violations.length; i++) {
        expect(r1.violations[i]!.entryIndex).toBe(r2.violations[i]!.entryIndex);
        expect(r1.violations[i]!.action).toBe(r2.violations[i]!.action);
        expect(r1.violations[i]!.reason).toBe(r2.violations[i]!.reason);
      }
    });
  });
});
