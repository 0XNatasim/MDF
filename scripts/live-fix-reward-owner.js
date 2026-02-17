const hre = require("hardhat");
const { ethers } = hre;

function mustEnv(name) {
  if (!process.env[name]) {
    throw new Error(`Missing env var: ${name}`);
  }
  return process.env[name];
}

async function main() {

  console.log("=== LIVE FIX: RewardVault Ownership ===\n");

  const REWARDVAULT_ADDR = mustEnv("TESTNET_REWARDVAULT");
  const TAXVAULT_ADDR    = mustEnv("TESTNET_TAXVAULT");

  const [signer] = await ethers.getSigners();

  const RewardVault = await ethers.getContractAt(
    "RewardVault",
    REWARDVAULT_ADDR,
    signer
  );

  const currentOwner = await RewardVault.owner();

  console.log("Current RewardVault owner:", currentOwner);
  console.log("Expected new owner (TaxVault):", TAXVAULT_ADDR);
  console.log("");

  if (currentOwner.toLowerCase() === TAXVAULT_ADDR.toLowerCase()) {
    console.log("Already owned by TaxVault. Nothing to do.");
    return;
  }

  console.log("Transferring ownership...\n");

  const tx = await RewardVault.transferOwnership(TAXVAULT_ADDR);
  await tx.wait();

  const newOwner = await RewardVault.owner();

  console.log("New RewardVault owner:", newOwner);

  if (newOwner.toLowerCase() !== TAXVAULT_ADDR.toLowerCase()) {
    throw new Error("Ownership transfer failed.");
  }

  console.log("\n✅ Ownership successfully transferred to TaxVault.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
