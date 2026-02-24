// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CovenantRegistry
 * @notice On-chain registry for Nobulex covenant hashes.
 * @dev Stores covenant hashes with agent DID metadata.
 */
contract CovenantRegistry {
    struct Covenant {
        bytes32 covenantHash;
        string agentDid;
        uint256 registeredAt;
        bool active;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Covenant) public covenants;
    mapping(bytes32 => uint256) public hashToId;

    event CovenantRegistered(uint256 indexed id, bytes32 indexed covenantHash, string agentDid);
    event CovenantDeactivated(uint256 indexed id);

    /**
     * @notice Register a new covenant on-chain.
     * @param covenantHash SHA-256 hash of the serialized covenant spec.
     * @param agentDid The DID of the agent registering the covenant.
     * @param metadataUri Optional IPFS/HTTP URI for covenant metadata.
     * @return id The unique covenant ID.
     */
    function registerCovenant(
        bytes32 covenantHash,
        string calldata agentDid,
        string calldata metadataUri
    ) external returns (uint256) {
        require(hashToId[covenantHash] == 0, "Covenant already registered");
        uint256 id = nextId++;
        covenants[id] = Covenant(covenantHash, agentDid, block.timestamp, true);
        hashToId[covenantHash] = id;
        emit CovenantRegistered(id, covenantHash, agentDid);
        return id;
    }

    /**
     * @notice Get covenant details by ID.
     */
    function getCovenant(uint256 id) external view returns (
        bytes32 covenantHash,
        string memory agentDid,
        uint256 registeredAt,
        bool active
    ) {
        Covenant storage c = covenants[id];
        return (c.covenantHash, c.agentDid, c.registeredAt, c.active);
    }

    /**
     * @notice Deactivate a covenant.
     */
    function deactivateCovenant(uint256 id) external {
        require(covenants[id].registeredAt > 0, "Covenant does not exist");
        covenants[id].active = false;
        emit CovenantDeactivated(id);
    }

    /**
     * @notice Look up covenant ID by hash.
     */
    function getIdByHash(bytes32 covenantHash) external view returns (uint256) {
        return hashToId[covenantHash];
    }
}
