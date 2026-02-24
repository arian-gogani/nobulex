import { describe, it, expect } from 'vitest';
import {
  COVENANT_REGISTRY_ABI,
  STAKE_MANAGER_ABI,
  SLASHING_JUDGE_ABI,
  COVENANT_REGISTRY_SOL,
  STAKE_MANAGER_SOL,
  SLASHING_JUDGE_SOL,
  DEFAULT_SLASHING_CONFIG,
  computeSlashAmount,
  isCooldownElapsed,
  encodeRegisterCovenant,
  encodeStake,
  encodeUnstake,
  encodeSubmitViolation,
  ContractSimulator,
} from './index';
import type {
  CovenantRegistration,
  StakeRecord,
  SlashingRecord,
  SlashingConfig,
} from './index';

describe('@nobulex/contracts', () => {

  // ── ABI Definitions ───────────────────────────────────────────────────────

  describe('ABI definitions', () => {
    it('CovenantRegistry ABI has expected functions', () => {
      const names = COVENANT_REGISTRY_ABI.map(e => e.name);
      expect(names).toContain('registerCovenant');
      expect(names).toContain('getCovenant');
      expect(names).toContain('deactivateCovenant');
      expect(names).toContain('CovenantRegistered');
    });

    it('StakeManager ABI has expected functions', () => {
      const names = STAKE_MANAGER_ABI.map(e => e.name);
      expect(names).toContain('stake');
      expect(names).toContain('unstake');
      expect(names).toContain('getStake');
      expect(names).toContain('Staked');
      expect(names).toContain('Unstaked');
    });

    it('SlashingJudge ABI has expected functions', () => {
      const names = SLASHING_JUDGE_ABI.map(e => e.name);
      expect(names).toContain('submitViolation');
      expect(names).toContain('getSlashingRecord');
      expect(names).toContain('Slashed');
    });
  });

  // ── Solidity Source ────────────────────────────────────────────────────────

  describe('Solidity source', () => {
    it('CovenantRegistry source is valid Solidity', () => {
      expect(COVENANT_REGISTRY_SOL).toContain('pragma solidity');
      expect(COVENANT_REGISTRY_SOL).toContain('contract CovenantRegistry');
      expect(COVENANT_REGISTRY_SOL).toContain('registerCovenant');
    });

    it('StakeManager source is valid Solidity', () => {
      expect(STAKE_MANAGER_SOL).toContain('contract StakeManager');
      expect(STAKE_MANAGER_SOL).toContain('function stake');
    });

    it('SlashingJudge source is valid Solidity', () => {
      expect(SLASHING_JUDGE_SOL).toContain('contract SlashingJudge');
      expect(SLASHING_JUDGE_SOL).toContain('submitViolation');
    });
  });

  // ── Calldata Encoders ─────────────────────────────────────────────────────

  describe('Calldata encoders', () => {
    it('encodeRegisterCovenant returns hex string', () => {
      const calldata = encodeRegisterCovenant(
        'a'.repeat(64),
        'did:nobulex:agent1',
        'ipfs://Qm...',
      );
      expect(calldata).toBeTruthy();
      expect(typeof calldata).toBe('string');
      // Should start with 8 char selector
      expect(calldata.length).toBeGreaterThan(8);
    });

    it('encodeStake returns hex string', () => {
      const calldata = encodeStake(1n);
      expect(calldata).toBeTruthy();
      expect(calldata.length).toBe(8 + 64); // selector + uint256
    });

    it('encodeUnstake returns hex string', () => {
      const calldata = encodeUnstake(42n);
      expect(calldata).toBeTruthy();
      expect(calldata.length).toBe(8 + 64);
    });

    it('encodeSubmitViolation returns hex string', () => {
      const calldata = encodeSubmitViolation(
        1n,
        '0x' + 'ab'.repeat(20),
        'ff'.repeat(32),
        3n,
      );
      expect(calldata).toBeTruthy();
      // selector(8) + uint256(64) + address(64) + bytes32(64) + uint256(64)
      expect(calldata.length).toBe(8 + 64 * 4);
    });
  });

  // ── Slashing Calculator ───────────────────────────────────────────────────

  describe('computeSlashAmount', () => {
    it('first violation: base percent', () => {
      const amount = computeSlashAmount(10000n, 0);
      // 10% of 10000 = 1000
      expect(amount).toBe(1000n);
    });

    it('escalates with incidents', () => {
      // 10% + 5% * 2 = 20% of 10000 = 2000
      const amount = computeSlashAmount(10000n, 2);
      expect(amount).toBe(2000n);
    });

    it('caps at max slash percent', () => {
      // 10% + 5% * 100 = 510% -> capped at 50% of 10000 = 5000
      const amount = computeSlashAmount(10000n, 100);
      expect(amount).toBe(5000n);
    });

    it('custom config', () => {
      const config: SlashingConfig = {
        baseSlashPercent: 20,
        escalationPercent: 10,
        maxSlashPercent: 80,
        minStake: 100n,
        cooldownSec: 60,
      };
      // 20% + 10% * 1 = 30% of 1000 = 300
      expect(computeSlashAmount(1000n, 1, config)).toBe(300n);
    });
  });

  describe('isCooldownElapsed', () => {
    it('returns true when cooldown has passed', () => {
      const pastTime = new Date(Date.now() - 7200_000).toISOString(); // 2 hours ago
      expect(isCooldownElapsed(pastTime)).toBe(true);
    });

    it('returns false when cooldown has not passed', () => {
      const recentTime = new Date(Date.now() - 100).toISOString(); // 0.1 seconds ago
      expect(isCooldownElapsed(recentTime)).toBe(false);
    });
  });

  // ── Default Config ─────────────────────────────────────────────────────────

  describe('DEFAULT_SLASHING_CONFIG', () => {
    it('has reasonable defaults', () => {
      expect(DEFAULT_SLASHING_CONFIG.baseSlashPercent).toBe(10);
      expect(DEFAULT_SLASHING_CONFIG.escalationPercent).toBe(5);
      expect(DEFAULT_SLASHING_CONFIG.maxSlashPercent).toBe(50);
      expect(DEFAULT_SLASHING_CONFIG.minStake).toBe(1000n);
      expect(DEFAULT_SLASHING_CONFIG.cooldownSec).toBe(3600);
    });
  });

  // ── ContractSimulator ─────────────────────────────────────────────────────

  describe('ContractSimulator', () => {
    it('register and get covenant', async () => {
      const sim = new ContractSimulator();
      const reg = await sim.registerCovenant('did:nobulex:agent1', 'hash123', 'ipfs://meta');
      expect(reg.id).toBe('1');
      expect(reg.covenantHash).toBe('hash123');
      expect(reg.agentDid).toBe('did:nobulex:agent1');
      expect(reg.active).toBe(true);

      const fetched = sim.getCovenant('1');
      expect(fetched).toEqual(reg);
    });

    it('auto-increments covenant IDs', async () => {
      const sim = new ContractSimulator();
      const r1 = await sim.registerCovenant('did:nobulex:a', 'h1');
      const r2 = await sim.registerCovenant('did:nobulex:b', 'h2');
      expect(r1.id).toBe('1');
      expect(r2.id).toBe('2');
      expect(sim.covenantCount).toBe(2);
    });

    it('deactivate covenant', async () => {
      const sim = new ContractSimulator();
      await sim.registerCovenant('did:nobulex:a', 'h');
      expect(sim.deactivateCovenant('1')).toBe(true);
      expect(sim.getCovenant('1')!.active).toBe(false);
    });

    it('deactivate non-existent returns false', () => {
      const sim = new ContractSimulator();
      expect(sim.deactivateCovenant('999')).toBe(false);
    });

    it('getCovenant returns null for unknown', () => {
      const sim = new ContractSimulator();
      expect(sim.getCovenant('999')).toBeNull();
    });

    it('stake tokens', () => {
      const sim = new ContractSimulator();
      const record = sim.stake('0xAlice', '1', 5000n);
      expect(record.staker).toBe('0xAlice');
      expect(record.covenantId).toBe('1');
      expect(record.amount).toBe(5000n);
      expect(record.locked).toBe(false);
    });

    it('stake accumulates', () => {
      const sim = new ContractSimulator();
      sim.stake('0xAlice', '1', 5000n);
      const record = sim.stake('0xAlice', '1', 3000n);
      expect(record.amount).toBe(8000n);
    });

    it('stake below minimum throws', () => {
      const sim = new ContractSimulator();
      expect(() => sim.stake('0xAlice', '1', 100n)).toThrow('below minimum');
    });

    it('unstake returns tokens', () => {
      const sim = new ContractSimulator();
      sim.stake('0xAlice', '1', 5000n);
      const record = sim.unstake('0xAlice', '1');
      expect(record).not.toBeNull();
      expect(record!.amount).toBe(5000n);
      expect(sim.getStake('0xAlice', '1')).toBeNull();
    });

    it('unstake unknown returns null', () => {
      const sim = new ContractSimulator();
      expect(sim.unstake('0xAlice', '1')).toBeNull();
    });

    it('getStake returns null for unknown', () => {
      const sim = new ContractSimulator();
      expect(sim.getStake('0xAlice', '1')).toBeNull();
    });

    it('submit violation slashes stake', () => {
      const sim = new ContractSimulator();
      sim.stake('0xBob', '1', 10000n);
      const { slashAmount, record } = sim.submitViolation('0xBob', '1', 'evidence_hash', 1);
      // 10% of 10000 = 1000
      expect(slashAmount).toBe(1000n);
      expect(record.incidentCount).toBe(1);
      expect(record.totalSlashed).toBe(1000n);

      // Stake should be reduced
      const stake = sim.getStake('0xBob', '1');
      expect(stake!.amount).toBe(9000n);
    });

    it('submit violation with no stake throws', () => {
      const sim = new ContractSimulator();
      expect(() => sim.submitViolation('0xBob', '1', 'hash', 1)).toThrow('No stake found');
    });

    it('escalation increases slash amount', () => {
      const config: SlashingConfig = {
        ...DEFAULT_SLASHING_CONFIG,
        cooldownSec: 0, // no cooldown for testing
      };
      const sim = new ContractSimulator(config);
      sim.stake('0xBob', '1', 10000n);

      // First: 10% = 1000
      const r1 = sim.submitViolation('0xBob', '1', 'ev1', 1);
      expect(r1.slashAmount).toBe(1000n);

      // Second: 15% of 9000 = 1350
      const r2 = sim.submitViolation('0xBob', '1', 'ev2', 1);
      expect(r2.slashAmount).toBe(1350n);
      expect(r2.record.incidentCount).toBe(2);
    });

    it('getSlashingRecord returns null for unknown', () => {
      const sim = new ContractSimulator();
      expect(sim.getSlashingRecord('0xBob', '1')).toBeNull();
    });

    it('stakeCount tracks active stakes', () => {
      const sim = new ContractSimulator();
      expect(sim.stakeCount).toBe(0);
      sim.stake('0xA', '1', 5000n);
      sim.stake('0xB', '2', 5000n);
      expect(sim.stakeCount).toBe(2);
      sim.unstake('0xA', '1');
      expect(sim.stakeCount).toBe(1);
    });
  });

  // ── Full Pipeline ──────────────────────────────────────────────────────────

  describe('Full pipeline: register → stake → violate → slash', () => {
    it('end-to-end staking/slashing flow', async () => {
      const config: SlashingConfig = { ...DEFAULT_SLASHING_CONFIG, cooldownSec: 0 };
      const sim = new ContractSimulator(config);

      // 1. Register covenant
      const cov = await sim.registerCovenant('did:nobulex:agent1', 'covenant_hash_abc');
      expect(cov.active).toBe(true);

      // 2. Stake on covenant
      sim.stake('0xAgent1', cov.id, 10000n);
      const stake = sim.getStake('0xAgent1', cov.id);
      expect(stake!.amount).toBe(10000n);

      // 3. Agent violates covenant
      const v1 = sim.submitViolation('0xAgent1', cov.id, 'merkle_root_abc', 3);
      expect(v1.slashAmount).toBe(1000n); // 10%

      // 4. Second violation — escalated
      const v2 = sim.submitViolation('0xAgent1', cov.id, 'merkle_root_def', 2);
      expect(v2.slashAmount).toBeGreaterThan(v1.slashAmount); // escalated

      // 5. Check final state
      const finalStake = sim.getStake('0xAgent1', cov.id);
      expect(finalStake!.amount).toBeLessThan(10000n);

      const slashRecord = sim.getSlashingRecord('0xAgent1', cov.id);
      expect(slashRecord!.incidentCount).toBe(2);
    });
  });
});
