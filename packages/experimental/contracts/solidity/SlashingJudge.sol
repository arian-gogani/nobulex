// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StakeManager.sol";

/**
 * @title SlashingJudge
 * @notice Handles covenant violation reports and slashes stakes.
 * @dev Computes slash amounts with escalation and cooldown periods.
 */
contract SlashingJudge {
    struct SlashRecord {
        uint256 totalSlashed;
        uint256 incidentCount;
        uint256 lastSlashedAt;
    }

    StakeManager public stakeManager;
    uint256 public baseSlashPercent;
    uint256 public escalationPercent;
    uint256 public maxSlashPercent;
    uint256 public cooldownPeriod;

    mapping(address => mapping(uint256 => SlashRecord)) public records;

    event ViolationReported(
        address indexed violator,
        uint256 indexed covenantId,
        bytes32 evidenceHash,
        uint256 slashAmount
    );

    constructor(
        address _stakeManager,
        uint256 _baseSlashPercent,
        uint256 _escalationPercent,
        uint256 _maxSlashPercent,
        uint256 _cooldownPeriod
    ) {
        stakeManager = StakeManager(_stakeManager);
        baseSlashPercent = _baseSlashPercent;
        escalationPercent = _escalationPercent;
        maxSlashPercent = _maxSlashPercent;
        cooldownPeriod = _cooldownPeriod;
    }

    /**
     * @notice Submit a covenant violation and slash the violator's stake.
     * @param covenantId The covenant that was violated.
     * @param violator The address of the violating agent.
     * @param evidenceHash Hash of the violation evidence (Merkle root).
     * @param violationCount Number of violations in this report.
     * @return slashAmount The amount slashed.
     */
    function submitViolation(
        uint256 covenantId,
        address violator,
        bytes32 evidenceHash,
        uint256 violationCount
    ) external returns (uint256) {
        require(violationCount > 0, "No violations");

        SlashRecord storage r = records[violator][covenantId];
        require(
            r.lastSlashedAt == 0 || block.timestamp >= r.lastSlashedAt + cooldownPeriod,
            "Cooldown not elapsed"
        );

        (uint256 stakeAmount,,) = stakeManager.getStake(violator, covenantId);
        require(stakeAmount > 0, "No stake found");

        // Compute slash percentage with escalation
        uint256 percent = baseSlashPercent + escalationPercent * r.incidentCount;
        if (percent > maxSlashPercent) {
            percent = maxSlashPercent;
        }
        uint256 slashAmount = (stakeAmount * percent) / 100;

        // Lock and slash
        stakeManager.lockStake(violator, covenantId);
        stakeManager.slash(violator, covenantId, slashAmount);

        // Update record
        r.totalSlashed += slashAmount;
        r.incidentCount++;
        r.lastSlashedAt = block.timestamp;

        emit ViolationReported(violator, covenantId, evidenceHash, slashAmount);
        return slashAmount;
    }

    /**
     * @notice Get slashing record for an address and covenant.
     */
    function getSlashingRecord(address violator, uint256 covenantId) external view returns (
        uint256 totalSlashed,
        uint256 incidentCount,
        uint256 lastSlashedAt
    ) {
        SlashRecord storage r = records[violator][covenantId];
        return (r.totalSlashed, r.incidentCount, r.lastSlashedAt);
    }
}
