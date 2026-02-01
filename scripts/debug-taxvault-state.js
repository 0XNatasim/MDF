const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const TAX_VAULT = process.env.TESTNET_TAXVAULT;
  if (!TAX_VAULT) throw new Error("Missing TESTNET_TAXVAULT");

  const taxVault = await ethers.getContractAt("TaxVault", TAX_VAULT);

  console.log("=== TaxVault Debug ===");

  console.log("owner():", await taxVault.owner());
  console.log("keeper():", await taxVault.keeper());

  console.log("rewardVault:", await taxVault.rewardVault());
  console.log("boostVault:", await taxVault.boostVault());
  console.log("swapVault:", await taxVault.swapVault());
  console.log("marketingVault:", await taxVault.marketingVault());
  console.log("teamVestingVault:", await taxVault.teamVestingVault());

  console.log("router:", await taxVault.router());

  console.log("Splits (bps):");
  console.log(" reward:", (await taxVault.bpsReward()).toString());
  console.log(" boost :", (await taxVault.bpsBoost()).toString());
  console.log(" liq   :", (await taxVault.bpsLiq()).toString());
  console.log(" burn  :", (await taxVault.bpsBurn()).toString());
  console.log(" mkt   :", (await taxVault.bpsMarketing()).toString());
  console.log(" team  :", (await taxVault.bpsTeam()).toString());
}

main().catch(console.error);
