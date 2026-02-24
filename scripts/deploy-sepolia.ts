/**
 * Nobulex Covenant Protocol — Sepolia Testnet Deploy Script
 *
 * Deploys all three core contracts:
 *   1. CovenantRegistry  — on-chain covenant hash registry
 *   2. StakeManager       — ETH staking on covenants
 *   3. SlashingJudge      — violation reporting and slashing with escalation
 *
 * Usage:
 *   export DEPLOYER_PRIVATE_KEY="your-private-key-without-0x"
 *   export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_KEY"
 *   npx hardhat run scripts/deploy-sepolia.ts --network sepolia
 *
 * Prerequisites:
 *   npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
 */

import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Nobulex Covenant Protocol — Sepolia Deployment");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.formatEther(balance)} ETH`);
  console.log(`  Network:   ${(await ethers.provider.getNetwork()).name}`);
  console.log(`  Chain ID:  ${(await ethers.provider.getNetwork()).chainId}`);
  console.log("───────────────────────────────────────────────────────────");

  if (balance === 0n) {
    console.error("\n  ERROR: Deployer has no ETH. Get Sepolia ETH from:");
    console.error("    https://sepoliafaucet.com");
    console.error("    https://faucets.chain.link/sepolia");
    process.exit(1);
  }

  // ─── 1. Deploy CovenantRegistry ──────────────────────────────────────────────

  console.log("\n  [1/3] Deploying CovenantRegistry...");
  const RegistryFactory = await ethers.getContractFactory("CovenantRegistry");
  const registry = await RegistryFactory.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`        ✓ CovenantRegistry deployed at: ${registryAddress}`);

  // ─── 2. Deploy StakeManager ──────────────────────────────────────────────────

  const MIN_STAKE = ethers.parseEther("0.01"); // 0.01 ETH minimum stake on testnet

  console.log("\n  [2/3] Deploying StakeManager...");
  console.log(`        Min stake: ${ethers.formatEther(MIN_STAKE)} ETH`);
  const StakeFactory = await ethers.getContractFactory("StakeManager");
  const stakeManager = await StakeFactory.deploy(MIN_STAKE);
  await stakeManager.waitForDeployment();
  const stakeAddress = await stakeManager.getAddress();
  console.log(`        ✓ StakeManager deployed at: ${stakeAddress}`);

  // ─── 3. Deploy SlashingJudge ─────────────────────────────────────────────────

  const BASE_SLASH = 10;       // 10% base slash
  const ESCALATION = 5;        // +5% per incident
  const MAX_SLASH = 50;        // capped at 50%
  const COOLDOWN = 3600;       // 1 hour cooldown

  console.log("\n  [3/3] Deploying SlashingJudge...");
  console.log(`        Base slash:  ${BASE_SLASH}%`);
  console.log(`        Escalation:  +${ESCALATION}% per incident`);
  console.log(`        Max slash:   ${MAX_SLASH}%`);
  console.log(`        Cooldown:    ${COOLDOWN}s`);
  const JudgeFactory = await ethers.getContractFactory("SlashingJudge");
  const judge = await JudgeFactory.deploy(
    stakeAddress,
    BASE_SLASH,
    ESCALATION,
    MAX_SLASH,
    COOLDOWN,
  );
  await judge.waitForDeployment();
  const judgeAddress = await judge.getAddress();
  console.log(`        ✓ SlashingJudge deployed at: ${judgeAddress}`);

  // ─── 4. Link StakeManager → SlashingJudge ────────────────────────────────────

  console.log("\n  [4/4] Linking StakeManager to SlashingJudge...");
  const linkTx = await stakeManager.setSlashingJudge(judgeAddress);
  await linkTx.wait();
  console.log("        ✓ StakeManager.slashingJudge set");

  // ─── Summary ─────────────────────────────────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Deployment Complete!");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  CovenantRegistry:  ${registryAddress}`);
  console.log(`  StakeManager:      ${stakeAddress}`);
  console.log(`  SlashingJudge:     ${judgeAddress}`);
  console.log("───────────────────────────────────────────────────────────");
  console.log("  Verify on Etherscan:");
  console.log(`    https://sepolia.etherscan.io/address/${registryAddress}`);
  console.log(`    https://sepolia.etherscan.io/address/${stakeAddress}`);
  console.log(`    https://sepolia.etherscan.io/address/${judgeAddress}`);
  console.log("═══════════════════════════════════════════════════════════");

  // Write deployment addresses to file for reference
  const fs = await import("fs");
  const deployment = {
    network: "sepolia",
    chainId: 11155111,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      CovenantRegistry: registryAddress,
      StakeManager: stakeAddress,
      SlashingJudge: judgeAddress,
    },
    config: {
      minStake: ethers.formatEther(MIN_STAKE),
      baseSlashPercent: BASE_SLASH,
      escalationPercent: ESCALATION,
      maxSlashPercent: MAX_SLASH,
      cooldownPeriod: COOLDOWN,
    },
  };
  fs.writeFileSync(
    "deployments/sepolia.json",
    JSON.stringify(deployment, null, 2),
  );
  console.log("\n  Addresses saved to deployments/sepolia.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
