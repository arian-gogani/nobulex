import type { HardhatUserConfig } from "hardhat/config";

/**
 * Nobulex Covenant Protocol — Hardhat Configuration
 *
 * To deploy to Sepolia:
 * 1. Set DEPLOYER_PRIVATE_KEY in your environment (without 0x prefix)
 * 2. Set SEPOLIA_RPC_URL (Infura or Alchemy endpoint)
 * 3. Run: npx hardhat run scripts/deploy-sepolia.ts --network sepolia
 */
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
      chainId: 11155111,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
  },
  paths: {
    sources: "./packages/contracts/solidity",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
