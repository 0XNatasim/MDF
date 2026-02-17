// scripts/debug-rewardvault-state.js
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("\n=== REWARDVAULT STATE DEBUG ===\n");

  const provider = new ethers.JsonRpcProvider(hre.network.config.url);
  const fresh = new ethers.Wallet(process.env.FRESH_PRIVATE_KEY, provider);

  const RV = await ethers.getContractAt("RewardVault", process.env.TESTNET_REWARDVAULT, fresh);
  const MMM = await ethers.getContractAt("MMMToken", process.env.TESTNET_MMM, fresh);

  console.log("=== Contract Configuration ===");
  console.log("MMM Token:", await RV.mmm());
  console.log("BoostNFT:", await RV.boostNFT());
  console.log("Owner:", await RV.owner());
  
  console.log("\n=== Global Parameters ===");
  const minHoldTime = await RV.minHoldTimeSec();
  const minBalance = await RV.minBalance();
  const claimCooldown = await RV.claimCooldown();
  const accRewardPerToken = await RV.accRewardPerToken();
  const eligibleSupply = await RV.eligibleSupply();
  const totalDistributed = await RV.totalDistributed();
  
  console.log("Min Hold Time:", minHoldTime.toString(), "seconds (", (Number(minHoldTime) / 3600).toFixed(2), "hours )");
  console.log("Min Balance:", ethers.formatUnits(minBalance, 18), "MMM");
  console.log("Claim Cooldown:", claimCooldown.toString(), "seconds (", (Number(claimCooldown) / 3600).toFixed(2), "hours )");
  console.log("Acc Reward Per Token:", accRewardPerToken.toString());
  console.log("Eligible Supply:", ethers.formatUnits(eligibleSupply, 18), "MMM");
  console.log("Total Distributed:", ethers.formatUnits(totalDistributed, 18), "MMM");

  console.log("\n=== Fresh Wallet State ===");
  console.log("Address:", fresh.address);
  
  const mmmBalance = await MMM.balanceOf(fresh.address);
  console.log("MMM Balance:", ethers.formatUnits(mmmBalance, 18));
  
  const isExcluded = await RV.isExcludedReward(fresh.address);
  console.log("Is Excluded from Rewards:", isExcluded);
  
  const lastClaimAt = await RV.lastClaimAt(fresh.address);
  console.log("Last Claim At:", lastClaimAt.toString(), "(timestamp)");
  if (lastClaimAt > 0) {
    const date = new Date(Number(lastClaimAt) * 1000);
    console.log("  └─>", date.toISOString());
  }
  
  const rewardDebt = await RV.rewardDebt(fresh.address);
  console.log("Reward Debt:", ethers.formatUnits(rewardDebt, 18));
  
  const pending = await RV.pending(fresh.address);
  console.log("Pending Rewards:", ethers.formatUnits(pending, 18), "MMM");

  console.log("\n=== Eligibility Check ===");
  const hasMinBalance = mmmBalance >= minBalance;
  console.log("Has Min Balance:", hasMinBalance, "(needs", ethers.formatUnits(minBalance, 18), ", has", ethers.formatUnits(mmmBalance, 18), ")");
  
  const now = Math.floor(Date.now() / 1000);
  const timeSinceLastClaim = now - Number(lastClaimAt);
  const cooldownElapsed = timeSinceLastClaim >= Number(claimCooldown);
  console.log("Cooldown Elapsed:", cooldownElapsed, "(", timeSinceLastClaim, "sec since last claim, needs", claimCooldown.toString(), "sec )");
  
  console.log("\n=== Can Claim? ===");
  if (!hasMinBalance) {
    console.log("❌ No - Balance too low");
  } else if (isExcluded) {
    console.log("❌ No - Address excluded from rewards");
  } else if (!cooldownElapsed && lastClaimAt > 0) {
    console.log("❌ No - Cooldown not elapsed (", (Number(claimCooldown) - timeSinceLastClaim), "sec remaining )");
  } else if (pending == 0n) {
    console.log("⚠️  Maybe - No pending rewards");
  } else {
    console.log("✅ Potentially yes - all checks passed (but hold time may not be met)");
  }

  console.log("\n=== DEBUG COMPLETE ===");
}

main().catch(console.error);