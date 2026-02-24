// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title StakeManager
 * @notice Manages staking for Nobulex covenants.
 * @dev Agents stake ETH on their covenants. Stakes can be slashed on violation.
 */
contract StakeManager {
    struct Stake {
        uint256 amount;
        uint256 stakedAt;
        bool locked;
    }

    uint256 public minStake;
    address public slashingJudge;

    mapping(address => mapping(uint256 => Stake)) public stakes;

    event Staked(address indexed staker, uint256 indexed covenantId, uint256 amount);
    event Unstaked(address indexed staker, uint256 indexed covenantId, uint256 amount);
    event StakeLocked(address indexed staker, uint256 indexed covenantId);
    event StakeSlashed(address indexed staker, uint256 indexed covenantId, uint256 amount);

    constructor(uint256 _minStake) {
        minStake = _minStake;
    }

    modifier onlyJudge() {
        require(msg.sender == slashingJudge, "Only slashing judge");
        _;
    }

    /**
     * @notice Set the slashing judge address.
     */
    function setSlashingJudge(address _judge) external {
        require(slashingJudge == address(0), "Judge already set");
        slashingJudge = _judge;
    }

    /**
     * @notice Stake ETH on a covenant.
     */
    function stake(uint256 covenantId) external payable {
        require(msg.value >= minStake, "Below minimum stake");
        stakes[msg.sender][covenantId].amount += msg.value;
        stakes[msg.sender][covenantId].stakedAt = block.timestamp;
        emit Staked(msg.sender, covenantId, msg.value);
    }

    /**
     * @notice Unstake ETH from a covenant.
     */
    function unstake(uint256 covenantId) external {
        Stake storage s = stakes[msg.sender][covenantId];
        require(!s.locked, "Stake is locked");
        require(s.amount > 0, "No stake");
        uint256 amount = s.amount;
        s.amount = 0;
        payable(msg.sender).transfer(amount);
        emit Unstaked(msg.sender, covenantId, amount);
    }

    /**
     * @notice Get stake details.
     */
    function getStake(address staker, uint256 covenantId) external view returns (
        uint256 amount,
        uint256 stakedAt,
        bool locked
    ) {
        Stake storage s = stakes[staker][covenantId];
        return (s.amount, s.stakedAt, s.locked);
    }

    /**
     * @notice Lock a stake (called by slashing judge before slashing).
     */
    function lockStake(address staker, uint256 covenantId) external onlyJudge {
        stakes[staker][covenantId].locked = true;
        emit StakeLocked(staker, covenantId);
    }

    /**
     * @notice Slash a portion of a stake (called by slashing judge).
     * @return slashedAmount The amount slashed.
     */
    function slash(address staker, uint256 covenantId, uint256 amount) external onlyJudge returns (uint256) {
        Stake storage s = stakes[staker][covenantId];
        uint256 actual = amount > s.amount ? s.amount : amount;
        s.amount -= actual;
        s.locked = false;
        emit StakeSlashed(staker, covenantId, actual);
        return actual;
    }
}
