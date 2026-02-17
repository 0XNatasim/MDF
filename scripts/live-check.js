const hre = require("hardhat");
const { ethers } = hre;

function mustEnv(name) {
  if (!process.env[name]) {
    throw new Error(`Missing env var: ${name}`);
  }
  return process.env[name];
}

async function main() {

  console.log("=== LIVE STATE CHECK ===\n");

  const MMM_ADDR          = mustEnv("TESTNET_MMM");
  const TAXVAULT_ADDR     = mustEnv("TESTNET_TAXVAULT");
  const REWARDVAULT_ADDR  = mustEnv("TESTNET_REWARDVAULT");
  const SWAPVAULT_ADDR    = mustEnv("TESTNET_SWAPVAULT");
  const MKT_ADDR          = mustEnv("TESTNET_MARKETINGVAULT");
  const TEAM_ADDR         = mustEnv("TESTNET_TEAMVESTINGVAULT");

  const MMM         = await ethers.getContractAt("MMMToken", MMM_ADDR);
  const TaxVault    = await ethers.getContractAt("TaxVault", TAXVAULT_ADDR);
  const RewardVault = await ethers.getContractAt("RewardVault", REWARDVAULT_ADDR);

  console.log("MMM:");
  console.log("  owner:", await MMM.owner());
  console.log("  taxVault:", await MMM.taxVault());
  console.log("  pair:", await MMM.pair());
  console.log("  launched:", await MMM.launched());
  console.log("  tradingEnabled:", await MMM.tradingEnabled());
  console.log("");

  console.log("TaxVault:");
  console.log("  owner:", await TaxVault.owner());
  console.log("  rewardVault:", await TaxVault.rewardVault());
  console.log("  swapVault:", await TaxVault.swapVault());
  console.log("  marketingVault:", await TaxVault.marketingVault());
  console.log("  teamVestingVault:", await TaxVault.teamVestingVault());
  console.log("  router:", await TaxVault.router());
  console.log("  processingEnabled:", await TaxVault.processingEnabled());
  console.log("");

  console.log("RewardVault:");
  console.log("  owner:", await RewardVault.owner());
  console.log("  minHoldTime:", await RewardVault.minHoldTimeSec());
  console.log("  cooldown:", await RewardVault.claimCooldown());
  console.log("  minBalance:", (await RewardVault.minBalance()).toString());
  console.log("");

  console.log("=== CHECK COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
