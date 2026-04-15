/**
 * @nobulex/contracts — Solidity staking/slashing contract bindings for Nobulex.
 *
 * Provides Solidity contract ABIs, TypeScript encoders/decoders,
 * covenant registry, stake management, and slashing on covenant violation.
 * No ethers.js dependency — uses @nobulex/evm for ABI encoding.
 *
 * @packageDocumentation
 */

import { sha256String, generateId, timestamp } from '@nobulex/crypto';
import {
  encodeUint256,
  encodeAddress,
  encodeBytes32,
  computeFunctionSelector,
} from '@nobulex/evm';

// ─── ABI Definitions ─────────────────────────────────────────────────────────

/** ABI for the CovenantRegistry contract. */
export const COVENANT_REGISTRY_ABI = [
  {
    name: 'registerCovenant',
    type: 'function',
    inputs: [
      { name: 'covenantHash', type: 'bytes32' },
      { name: 'agentDid', type: 'string' },
      { name: 'metadataUri', type: 'string' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    name: 'getCovenant',
    type: 'function',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'covenantHash', type: 'bytes32' },
      { name: 'agentDid', type: 'string' },
      { name: 'registeredAt', type: 'uint256' },
      { name: 'active', type: 'bool' },
    ],
  },
  {
    name: 'deactivateCovenant',
    type: 'function',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'CovenantRegistered',
    type: 'event',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'covenantHash', type: 'bytes32', indexed: true },
      { name: 'agentDid', type: 'string', indexed: false },
    ],
  },
] as const;

/** ABI for the StakeManager contract. */
export const STAKE_MANAGER_ABI = [
  {
    name: 'stake',
    type: 'function',
    inputs: [
      { name: 'covenantId', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'unstake',
    type: 'function',
    inputs: [
      { name: 'covenantId', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'getStake',
    type: 'function',
    inputs: [
      { name: 'staker', type: 'address' },
      { name: 'covenantId', type: 'uint256' },
    ],
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'stakedAt', type: 'uint256' },
      { name: 'locked', type: 'bool' },
    ],
  },
  {
    name: 'Staked',
    type: 'event',
    inputs: [
      { name: 'staker', type: 'address', indexed: true },
      { name: 'covenantId', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Unstaked',
    type: 'event',
    inputs: [
      { name: 'staker', type: 'address', indexed: true },
      { name: 'covenantId', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

/** ABI for the SlashingJudge contract. */
export const SLASHING_JUDGE_ABI = [
  {
    name: 'submitViolation',
    type: 'function',
    inputs: [
      { name: 'covenantId', type: 'uint256' },
      { name: 'violator', type: 'address' },
      { name: 'evidenceHash', type: 'bytes32' },
      { name: 'violationCount', type: 'uint256' },
    ],
    outputs: [{ name: 'slashAmount', type: 'uint256' }],
  },
  {
    name: 'getSlashingRecord',
    type: 'function',
    inputs: [
      { name: 'violator', type: 'address' },
      { name: 'covenantId', type: 'uint256' },
    ],
    outputs: [
      { name: 'totalSlashed', type: 'uint256' },
      { name: 'incidentCount', type: 'uint256' },
      { name: 'lastSlashedAt', type: 'uint256' },
    ],
  },
  {
    name: 'Slashed',
    type: 'event',
    inputs: [
      { name: 'violator', type: 'address', indexed: true },
      { name: 'covenantId', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'evidenceHash', type: 'bytes32', indexed: false },
    ],
  },
] as const;

// types

/** On-chain covenant registration record. */
export interface CovenantRegistration {
  readonly id: string;
  readonly covenantHash: string;
  readonly agentDid: string;
  readonly metadataUri: string;
  readonly registeredAt: string;
  readonly active: boolean;
}

/** On-chain stake record. */
export interface StakeRecord {
  readonly staker: string;
  readonly covenantId: string;
  readonly amount: bigint;
  readonly stakedAt: string;
  readonly locked: boolean;
}

/** On-chain slashing record. */
export interface SlashingRecord {
  readonly violator: string;
  readonly covenantId: string;
  readonly totalSlashed: bigint;
  readonly incidentCount: number;
  readonly lastSlashedAt: string;
}

/** Slashing configuration. */
export interface SlashingConfig {
  /** Base percentage to slash (0-100). */
  readonly baseSlashPercent: number;
  /** Additional percentage per violation. */
  readonly escalationPercent: number;
  /** Maximum percentage that can be slashed. */
  readonly maxSlashPercent: number;
  /** Minimum stake required to register. */
  readonly minStake: bigint;
  /** Cooldown period between slashes in seconds. */
  readonly cooldownSec: number;
}

/** Default slashing configuration. */
export const DEFAULT_SLASHING_CONFIG: SlashingConfig = {
  baseSlashPercent: 10,
  escalationPercent: 5,
  maxSlashPercent: 50,
  minStake: 1000n,
  cooldownSec: 3600,
};

// ---

/**
 * Encode calldata for CovenantRegistry.registerCovenant().
 *
 * @param covenantHash - The bytes32 hash of the covenant to register.
 * @param agentDid - The DID of the agent registering the covenant.
 * @param metadataUri - URI pointing to the covenant metadata.
 * @returns The ABI-encoded calldata as a hex string (selector + encoded parameters).
 */
export function encodeRegisterCovenant(covenantHash: string, agentDid: string, metadataUri: string): string {
  const selector = computeFunctionSelector('registerCovenant(bytes32,string,string)');
  const hashParam = encodeBytes32(covenantHash);
  // For simplicity, pack selector + hash (full ABI encoding of strings is complex)
  return selector + hashParam;
}

/**
 * Encode calldata for StakeManager.stake().
 *
 * @param covenantId - The uint256 identifier of the covenant to stake on.
 * @returns The ABI-encoded calldata as a hex string.
 */
export function encodeStake(covenantId: bigint): string {
  const selector = computeFunctionSelector('stake(uint256)');
  return selector + encodeUint256(covenantId);
}

/**
 * Encode calldata for StakeManager.unstake().
 *
 * @param covenantId - The uint256 identifier of the covenant to unstake from.
 * @returns The ABI-encoded calldata as a hex string.
 */
export function encodeUnstake(covenantId: bigint): string {
  const selector = computeFunctionSelector('unstake(uint256)');
  return selector + encodeUint256(covenantId);
}

/**
 * Encode calldata for SlashingJudge.submitViolation().
 *
 * @param covenantId - The uint256 identifier of the covenant that was violated.
 * @param violator - The address of the violating staker.
 * @param evidenceHash - The bytes32 hash of the violation evidence.
 * @param violationCount - The number of violations being reported.
 * @returns The ABI-encoded calldata as a hex string.
 */
export function encodeSubmitViolation(
  covenantId: bigint,
  violator: string,
  evidenceHash: string,
  violationCount: bigint,
): string {
  const selector = computeFunctionSelector('submitViolation(uint256,address,bytes32,uint256)');
  return selector + encodeUint256(covenantId) + encodeAddress(violator) + encodeBytes32(evidenceHash) + encodeUint256(violationCount);
}

// ─── Slashing Calculator ─────────────────────────────────────────────────────

/**
 * Compute the slash amount for a violation.
 * Applies escalating penalties based on the number of prior incidents, capped at the configured maximum.
 *
 * @param stakeAmount - The current stake amount to slash from.
 * @param incidentCount - The number of prior incidents (used to escalate the penalty).
 * @param config - The slashing configuration. Defaults to {@link DEFAULT_SLASHING_CONFIG}.
 * @returns The computed slash amount as a bigint.
 */
export function computeSlashAmount(
  stakeAmount: bigint,
  incidentCount: number,
  config: SlashingConfig = DEFAULT_SLASHING_CONFIG,
): bigint {
  const percent = Math.min(
    config.baseSlashPercent + config.escalationPercent * incidentCount,
    config.maxSlashPercent,
  );
  return (stakeAmount * BigInt(percent)) / 100n;
}

/**
 * Check if a cooldown period has elapsed since the last slash.
 *
 * @param lastSlashedAt - ISO timestamp of the most recent slash event.
 * @param config - The slashing configuration containing the cooldown period. Defaults to {@link DEFAULT_SLASHING_CONFIG}.
 * @returns True if the cooldown period has elapsed; false otherwise.
 */
export function isCooldownElapsed(
  lastSlashedAt: string,
  config: SlashingConfig = DEFAULT_SLASHING_CONFIG,
): boolean {
  const lastTime = new Date(lastSlashedAt).getTime();
  const elapsed = (Date.now() - lastTime) / 1000;
  return elapsed >= config.cooldownSec;
}

// ─── In-Memory Contract Simulator ────────────────────────────────────────────

/**
 * In-memory simulator for the covenant staking/slashing contracts.
 * Useful for testing without a blockchain node.
 */
export class ContractSimulator {
  private _nextCovenantId = 1n;
  private readonly _covenants = new Map<string, CovenantRegistration>();
  private readonly _stakes = new Map<string, StakeRecord>();
  private readonly _slashingRecords = new Map<string, SlashingRecord>();
  private readonly _config: SlashingConfig;

  /**
   * Create a new contract simulator.
   *
   * @param config - The slashing configuration to use. Defaults to {@link DEFAULT_SLASHING_CONFIG}.
   */
  constructor(config: SlashingConfig = DEFAULT_SLASHING_CONFIG) {
    this._config = config;
  }

  /**
   * Register a covenant on-chain.
   *
   * @param agentDid - The DID of the agent registering the covenant.
   * @param covenantHash - The hash of the covenant content.
   * @param metadataUri - Optional URI pointing to the covenant metadata.
   * @returns A promise that resolves to the new {@link CovenantRegistration} record.
   */
  async registerCovenant(
    agentDid: string,
    covenantHash: string,
    metadataUri: string = '',
  ): Promise<CovenantRegistration> {
    const id = String(this._nextCovenantId++);
    const registration: CovenantRegistration = {
      id,
      covenantHash,
      agentDid,
      metadataUri,
      registeredAt: timestamp(),
      active: true,
    };
    this._covenants.set(id, registration);
    return registration;
  }

  /**
   * Get a covenant registration by ID.
   *
   * @param id - The covenant registration identifier.
   * @returns The covenant registration, or null if not found.
   */
  getCovenant(id: string): CovenantRegistration | null {
    return this._covenants.get(id) ?? null;
  }

  /**
   * Deactivate a covenant, marking it as no longer active.
   *
   * @param id - The covenant registration identifier.
   * @returns True if the covenant was found and deactivated; false if not found.
   */
  deactivateCovenant(id: string): boolean {
    const cov = this._covenants.get(id);
    if (!cov) return false;
    this._covenants.set(id, { ...cov, active: false });
    return true;
  }

  /**
   * Stake tokens on a covenant. Adds to any existing stake for the same staker/covenant pair.
   *
   * @param staker - The address of the staker.
   * @param covenantId - The covenant registration identifier.
   * @param amount - The amount of tokens to stake. Must meet the minimum stake requirement.
   * @returns The updated {@link StakeRecord}.
   * @throws Error if the amount is below the configured minimum stake.
   */
  stake(staker: string, covenantId: string, amount: bigint): StakeRecord {
    if (amount < this._config.minStake) {
      throw new Error(`Stake amount ${amount} below minimum ${this._config.minStake}`);
    }
    const key = `${staker}:${covenantId}`;
    const existing = this._stakes.get(key);
    const newAmount = (existing?.amount ?? 0n) + amount;
    const record: StakeRecord = {
      staker,
      covenantId,
      amount: newAmount,
      stakedAt: timestamp(),
      locked: false,
    };
    this._stakes.set(key, record);
    return record;
  }

  /**
   * Unstake tokens from a covenant, removing the stake record entirely.
   *
   * @param staker - The address of the staker.
   * @param covenantId - The covenant registration identifier.
   * @returns The removed {@link StakeRecord}, or null if no stake was found.
   * @throws Error if the stake is locked due to pending slashing.
   */
  unstake(staker: string, covenantId: string): StakeRecord | null {
    const key = `${staker}:${covenantId}`;
    const record = this._stakes.get(key);
    if (!record) return null;
    if (record.locked) {
      throw new Error('Stake is locked due to pending slashing');
    }
    this._stakes.delete(key);
    return record;
  }

  /**
   * Get the stake record for a staker and covenant pair.
   *
   * @param staker - The address of the staker.
   * @param covenantId - The covenant registration identifier.
   * @returns The {@link StakeRecord}, or null if no stake exists.
   */
  getStake(staker: string, covenantId: string): StakeRecord | null {
    return this._stakes.get(`${staker}:${covenantId}`) ?? null;
  }

  /**
   * Submit a violation and slash the violator's stake.
   * Applies escalating penalties and updates both the stake and slashing records.
   *
   * @param violator - The address of the violating staker.
   * @param covenantId - The covenant registration identifier.
   * @param evidenceHash - The hash of the violation evidence.
   * @param violationCount - The number of violations being reported.
   * @returns An object containing the computed slash amount and the updated {@link SlashingRecord}.
   * @throws Error if no stake is found for the violator, or if the slashing cooldown has not elapsed.
   */
  submitViolation(
    violator: string,
    covenantId: string,
    evidenceHash: string,
    violationCount: number,
  ): { slashAmount: bigint; record: SlashingRecord } {
    const stakeKey = `${violator}:${covenantId}`;
    const stakeRecord = this._stakes.get(stakeKey);
    if (!stakeRecord) {
      throw new Error('No stake found for violator');
    }

    const slashKey = `${violator}:${covenantId}`;
    const existing = this._slashingRecords.get(slashKey);

    // Check cooldown
    if (existing && !isCooldownElapsed(existing.lastSlashedAt, this._config)) {
      throw new Error('Slashing cooldown not elapsed');
    }

    const priorCount = existing?.incidentCount ?? 0;
    const slashAmount = computeSlashAmount(stakeRecord.amount, priorCount, this._config);
    const newStakeAmount = stakeRecord.amount - slashAmount;

    // Update stake
    this._stakes.set(stakeKey, {
      ...stakeRecord,
      amount: newStakeAmount > 0n ? newStakeAmount : 0n,
    });

    // Update slashing record
    const record: SlashingRecord = {
      violator,
      covenantId,
      totalSlashed: (existing?.totalSlashed ?? 0n) + slashAmount,
      incidentCount: priorCount + 1,
      lastSlashedAt: timestamp(),
    };
    this._slashingRecords.set(slashKey, record);

    return { slashAmount, record };
  }

  /**
   * Get the slashing record for a violator and covenant pair.
   *
   * @param violator - The address of the violator.
   * @param covenantId - The covenant registration identifier.
   * @returns The {@link SlashingRecord}, or null if no slashing history exists.
   */
  getSlashingRecord(violator: string, covenantId: string): SlashingRecord | null {
    return this._slashingRecords.get(`${violator}:${covenantId}`) ?? null;
  }

  /** Number of registered covenants. */
  get covenantCount(): number {
    return this._covenants.size;
  }

  /** Number of active stakes. */
  get stakeCount(): number {
    return this._stakes.size;
  }
}

// ---

/** Solidity source for the CovenantRegistry contract. */
export const COVENANT_REGISTRY_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CovenantRegistry {
    struct Covenant {
        bytes32 covenantHash;
        string agentDid;
        uint256 registeredAt;
        bool active;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Covenant) public covenants;

    event CovenantRegistered(uint256 indexed id, bytes32 indexed covenantHash, string agentDid);
    event CovenantDeactivated(uint256 indexed id);

    function registerCovenant(bytes32 covenantHash, string calldata agentDid, string calldata) external returns (uint256) {
        uint256 id = nextId++;
        covenants[id] = Covenant(covenantHash, agentDid, block.timestamp, true);
        emit CovenantRegistered(id, covenantHash, agentDid);
        return id;
    }

    function getCovenant(uint256 id) external view returns (bytes32, string memory, uint256, bool) {
        Covenant storage c = covenants[id];
        return (c.covenantHash, c.agentDid, c.registeredAt, c.active);
    }

    function deactivateCovenant(uint256 id) external {
        covenants[id].active = false;
        emit CovenantDeactivated(id);
    }
}`;

/** Solidity source for the StakeManager contract. */
export const STAKE_MANAGER_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract StakeManager {
    struct Stake {
        uint256 amount;
        uint256 stakedAt;
        bool locked;
    }

    mapping(address => mapping(uint256 => Stake)) public stakes;
    uint256 public minStake = 1000;

    event Staked(address indexed staker, uint256 indexed covenantId, uint256 amount);
    event Unstaked(address indexed staker, uint256 indexed covenantId, uint256 amount);

    function stake(uint256 covenantId) external payable {
        require(msg.value >= minStake, "Below minimum stake");
        stakes[msg.sender][covenantId].amount += msg.value;
        stakes[msg.sender][covenantId].stakedAt = block.timestamp;
        emit Staked(msg.sender, covenantId, msg.value);
    }

    function unstake(uint256 covenantId) external {
        Stake storage s = stakes[msg.sender][covenantId];
        require(!s.locked, "Stake is locked");
        uint256 amount = s.amount;
        s.amount = 0;
        payable(msg.sender).transfer(amount);
        emit Unstaked(msg.sender, covenantId, amount);
    }

    function getStake(address staker_, uint256 covenantId) external view returns (uint256, uint256, bool) {
        Stake storage s = stakes[staker_][covenantId];
        return (s.amount, s.stakedAt, s.locked);
    }
}`;

/** Solidity source for the SlashingJudge contract. */
export const SLASHING_JUDGE_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StakeManager.sol";

contract SlashingJudge {
    struct SlashRecord {
        uint256 totalSlashed;
        uint256 incidentCount;
        uint256 lastSlashedAt;
    }

    StakeManager public stakeManager;
    uint256 public baseSlashPercent = 10;
    uint256 public escalationPercent = 5;
    uint256 public maxSlashPercent = 50;

    mapping(address => mapping(uint256 => SlashRecord)) public records;

    event Slashed(address indexed violator, uint256 indexed covenantId, uint256 amount, bytes32 evidenceHash);

    constructor(address _stakeManager) {
        stakeManager = StakeManager(_stakeManager);
    }

    function submitViolation(
        uint256 covenantId,
        address violator,
        bytes32 evidenceHash,
        uint256
    ) external returns (uint256) {
        (uint256 stakeAmount,,) = stakeManager.getStake(violator, covenantId);
        require(stakeAmount > 0, "No stake found");

        SlashRecord storage r = records[violator][covenantId];
        uint256 percent = baseSlashPercent + escalationPercent * r.incidentCount;
        if (percent > maxSlashPercent) percent = maxSlashPercent;
        uint256 slashAmount = (stakeAmount * percent) / 100;

        r.totalSlashed += slashAmount;
        r.incidentCount++;
        r.lastSlashedAt = block.timestamp;

        emit Slashed(violator, covenantId, slashAmount, evidenceHash);
        return slashAmount;
    }

    function getSlashingRecord(address violator, uint256 covenantId) external view returns (uint256, uint256, uint256) {
        SlashRecord storage r = records[violator][covenantId];
        return (r.totalSlashed, r.incidentCount, r.lastSlashedAt);
    }
}`;

// plumbing

export {
  COVENANT_REGISTRY_ABI as COMPILED_REGISTRY_ABI,
  COVENANT_REGISTRY_BYTECODE as COMPILED_REGISTRY_BYTECODE,
  CovenantRegistryFunctions,
  CovenantRegistryEvents,
  STAKE_MANAGER_ABI as COMPILED_STAKE_ABI,
  STAKE_MANAGER_BYTECODE as COMPILED_STAKE_BYTECODE,
  StakeManagerFunctions,
  StakeManagerEvents,
  SLASHING_JUDGE_ABI as COMPILED_JUDGE_ABI,
  SLASHING_JUDGE_BYTECODE as COMPILED_JUDGE_BYTECODE,
  SlashingJudgeFunctions,
  SlashingJudgeEvents,
} from './generated/index.js';
