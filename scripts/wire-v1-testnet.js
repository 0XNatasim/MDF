// scripts/wire-v1-testnet.js
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("=== MMM v1 TESTNET WIRING ONLY ===");
  console.log("Deployer:", deployer.address);
  console.log("");

  // --------------------------------------------------
  // LOAD FROM ENV (NO DEPLOY)
  // --------------------------------------------------

  const TAX_VAULT        = process.env.TESTNET_TAXVAULT;
  const REWARD_VAULT     = process.env.TESTNET_REWARDVAULT;
  const SWAP_VAULT       = process.env.TESTNET_SWAPVAULT;
  const MARKETING_VAULT  = process.env.TESTNET_MARKETINGVAULT;
  const TEAM_VAULT       = process.env.TESTNET_TEAM_VESTING_MULTISIG;
  const ROUTER           = process.env.TESTNET_ROUTER;
  const MMM              = process.env.TESTNET_MMM;

  if (
    !TAX_VAULT ||
    !REWARD_VAULT ||
    !SWAP_VAULT ||
    !MARKETING_VAULT ||
    !TEAM_VAULT ||
    !ROUTER ||
    !MMM
  ) {
    throw new Error("Missing TESTNET_* env vars");
  }

  const taxVault = await ethers.getContractAt("TaxVault", TAX_VAULT, deployer);
  const swapVault = await ethers.getContractAt("SwapVault", SWAP_VAULT, deployer);
  const mmm = await ethers.getContractAt("MMMToken", MMM, deployer);

  // --------------------------------------------------
  // 1. TaxVault wiring
  // --------------------------------------------------

  console.log("Wiring TaxVault...");

  const currentReward = await taxVault.rewardVault();
  if (currentReward === ethers.ZeroAddress) {
    const tx = await taxVault.wireOnce(
      REWARD_VAULT,
      SWAP_VAULT,
      MARKETING_VAULT,
      TEAM_VAULT
    );
    await tx.wait();
    console.log("✓ TaxVault.wireOnce");
  } else {
    console.log("✓ TaxVault already wired");
  }

  const currentRouter = await taxVault.router();
  if (currentRouter === ethers.ZeroAddress) {
    const tx = await taxVault.setRouter(ROUTER);
    await tx.wait();
    console.log("✓ TaxVault.setRouter");
  } else {
    console.log("✓ TaxVault router already set");
  }

  // --------------------------------------------------
  // 2. SwapVault wiring
  // --------------------------------------------------

  console.log("Wiring SwapVault...");

  const swapRouter = await swapVault.router();
  if (swapRouter === ethers.ZeroAddress) {
    const tx = await swapVault.setRouterOnce(ROUTER);
    await tx.wait();
    console.log("✓ SwapVault.setRouterOnce");
  } else {
    console.log("✓ SwapVault router already set");
  }

  const swapTax = await swapVault.taxVault();
  if (swapTax === ethers.ZeroAddress) {
    const tx = await swapVault.setTaxVaultOnce(TAX_VAULT);
    await tx.wait();
    console.log("✓ SwapVault.setTaxVault");
  } else {
    console.log("✓ SwapVault taxVault already set");
  }

  // --------------------------------------------------
  // 3. MMM wiring
  // --------------------------------------------------

  console.log("Wiring MMMToken...");

  const currentTax = await mmm.taxVault();
  if (currentTax === ethers.ZeroAddress) {
    const tx = await mmm.setTaxVaultOnce(TAX_VAULT);
    await tx.wait();
    console.log("✓ MMMToken.setTaxVaultOnce");
  } else {
    console.log("✓ MMMToken already wired");
  }

  console.log("");
  console.log("=== WIRING COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
