# @nobulex/contracts

Solidity staking/slashing contracts with TypeScript bindings for on-chain covenant enforcement. Includes a covenant registry, stake management, slashing on violation, ABI calldata encoders, and an in-memory contract simulator for testing.

No `ethers.js` dependency -- uses `@nobulex/evm` for ABI encoding.

## Installation

```bash
npm install @nobulex/contracts
```

**Requirements:** Node.js >= 18

**Dependencies:** `@nobulex/core-types`, `@nobulex/crypto`, `@nobulex/evm`

## Quick Usage

```typescript
import {
  ContractSimulator,
  computeSlashAmount,
  DEFAULT_SLASHING_CONFIG,
  encodeStake,
  encodeSubmitViolation,
} from '@nobulex/contracts';

// Use the in-memory simulator for testing
const sim = new ContractSimulator();

// Register a covenant
const reg = await sim.registerCovenant(
  'did:nobulex:agent-1',
  '0xabc123...',
  'ipfs://metadata',
);
console.log(reg.id); // '1'

// Stake on the covenant
const stake = sim.stake('0xStakerAddress', reg.id, 10000n);
console.log(stake.amount); // 10000n

// Submit a violation (slashes the stake)
const { slashAmount, record } = sim.submitViolation(
  '0xStakerAddress',
  reg.id,
  '0xEvidenceHash',
  1,
);
console.log(slashAmount); // 1000n (10% of 10000)

// Encode calldata for on-chain transactions
const calldata = encodeStake(1n);
```

## Solidity Contracts

Three Solidity contracts are included as source strings and compiled ABIs:

### CovenantRegistry

Registers covenant hashes on-chain with agent DID and metadata.

**Functions:** `registerCovenant`, `getCovenant`, `deactivateCovenant`

**Events:** `CovenantRegistered`

### StakeManager

Manages ETH stakes per covenant. Stakers lock funds as a guarantee of covenant compliance.

**Functions:** `stake` (payable), `unstake`, `getStake`

**Events:** `Staked`, `Unstaked`

### SlashingJudge

Accepts violation evidence and slashes the violator's stake with escalating percentages.

**Functions:** `submitViolation`, `getSlashingRecord`

**Events:** `Slashed`

## API Reference

### Classes

#### `ContractSimulator`

In-memory simulator for the covenant staking/slashing contracts. Useful for testing without a blockchain node.

```typescript
const sim = new ContractSimulator(config?: SlashingConfig);
```

**Properties:**

| Property        | Type     | Description                      |
| --------------- | -------- | -------------------------------- |
| `covenantCount` | `number` | Number of registered covenants   |
| `stakeCount`    | `number` | Number of active stakes          |

**Methods:**

| Method | Signature | Description |
| --- | --- | --- |
| `registerCovenant` | `(agentDid, covenantHash, metadataUri?) -> Promise<CovenantRegistration>` | Register a covenant on-chain |
| `getCovenant` | `(id: string) -> CovenantRegistration \| null` | Get a registration by ID |
| `deactivateCovenant` | `(id: string) -> boolean` | Deactivate a covenant |
| `stake` | `(staker, covenantId, amount) -> StakeRecord` | Stake tokens on a covenant |
| `unstake` | `(staker, covenantId) -> StakeRecord \| null` | Unstake tokens (fails if locked) |
| `getStake` | `(staker, covenantId) -> StakeRecord \| null` | Get stake record |
| `submitViolation` | `(violator, covenantId, evidenceHash, violationCount) -> { slashAmount, record }` | Slash a violator's stake |
| `getSlashingRecord` | `(violator, covenantId) -> SlashingRecord \| null` | Get slashing history |

### Calldata Encoder Functions

#### `encodeRegisterCovenant(covenantHash: string, agentDid: string, metadataUri: string): string`

Encode calldata for `CovenantRegistry.registerCovenant()`.

#### `encodeStake(covenantId: bigint): string`

Encode calldata for `StakeManager.stake()`.

#### `encodeUnstake(covenantId: bigint): string`

Encode calldata for `StakeManager.unstake()`.

#### `encodeSubmitViolation(covenantId: bigint, violator: string, evidenceHash: string, violationCount: bigint): string`

Encode calldata for `SlashingJudge.submitViolation()`.

### Slashing Functions

#### `computeSlashAmount(stakeAmount: bigint, incidentCount: number, config?: SlashingConfig): bigint`

Compute the slash amount for a violation. Uses escalating percentages:

```
slashPercent = min(baseSlashPercent + escalationPercent * incidentCount, maxSlashPercent)
slashAmount = stakeAmount * slashPercent / 100
```

#### `isCooldownElapsed(lastSlashedAt: string, config?: SlashingConfig): boolean`

Check if enough time has passed since the last slash to allow another.

### Interfaces

#### `CovenantRegistration`

| Field          | Type      | Description                 |
| -------------- | --------- | --------------------------- |
| `id`           | `string`  | Registration ID             |
| `covenantHash` | `string`  | Hash of the covenant spec   |
| `agentDid`     | `string`  | Agent's DID                 |
| `metadataUri`  | `string`  | URI to covenant metadata    |
| `registeredAt` | `string`  | ISO 8601 timestamp          |
| `active`       | `boolean` | Whether the covenant is active |

#### `StakeRecord`

| Field        | Type      | Description              |
| ------------ | --------- | ------------------------ |
| `staker`     | `string`  | Staker address           |
| `covenantId` | `string`  | Covenant registration ID |
| `amount`     | `bigint`  | Staked amount            |
| `stakedAt`   | `string`  | ISO 8601 timestamp       |
| `locked`     | `boolean` | Whether stake is locked  |

#### `SlashingRecord`

| Field           | Type     | Description             |
| --------------- | -------- | ----------------------- |
| `violator`      | `string` | Violator address        |
| `covenantId`    | `string` | Covenant ID             |
| `totalSlashed`  | `bigint` | Total amount slashed    |
| `incidentCount` | `number` | Number of incidents     |
| `lastSlashedAt` | `string` | ISO 8601 timestamp      |

#### `SlashingConfig`

| Field               | Type     | Default | Description                        |
| ------------------- | -------- | ------- | ---------------------------------- |
| `baseSlashPercent`  | `number` | `10`    | Base percentage to slash (0-100)   |
| `escalationPercent` | `number` | `5`     | Additional percent per violation   |
| `maxSlashPercent`   | `number` | `50`    | Maximum percentage that can be slashed |
| `minStake`          | `bigint` | `1000n` | Minimum stake required             |
| `cooldownSec`       | `number` | `3600`  | Cooldown between slashes (seconds) |

### Constants

#### `DEFAULT_SLASHING_CONFIG`

Default slashing configuration (see table above for values).

#### ABI Constants

- `COVENANT_REGISTRY_ABI` -- ABI array for the CovenantRegistry contract.
- `STAKE_MANAGER_ABI` -- ABI array for the StakeManager contract.
- `SLASHING_JUDGE_ABI` -- ABI array for the SlashingJudge contract.

#### Solidity Source Constants

- `COVENANT_REGISTRY_SOL` -- Solidity source for CovenantRegistry.
- `STAKE_MANAGER_SOL` -- Solidity source for StakeManager.
- `SLASHING_JUDGE_SOL` -- Solidity source for SlashingJudge.

#### Compiled Contract Re-exports

- `COMPILED_REGISTRY_ABI`, `COMPILED_REGISTRY_BYTECODE`
- `COMPILED_STAKE_ABI`, `COMPILED_STAKE_BYTECODE`
- `COMPILED_JUDGE_ABI`, `COMPILED_JUDGE_BYTECODE`
- `CovenantRegistryFunctions`, `CovenantRegistryEvents`
- `StakeManagerFunctions`, `StakeManagerEvents`
- `SlashingJudgeFunctions`, `SlashingJudgeEvents`

## License

MIT
