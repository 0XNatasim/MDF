// scripts/test-05c-check-status.js
const hre = require("hardhat");
const { ethers } = hre;

/**
 * TEST 05c — Status checker for RewardVault eligibility
 * Safe to run anytime
 */

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

async function main() {
  console.log("\n=== TEST 05c: STATUS CHECK ===\n");

  /* ---------------------------------------------
     Setup
  --------------------------------------------- */
  const provider = new ethers.JsonRpcProvider(
    hre.network.config.url
  );

  const tester = new ethers.Wallet(
    process.env.TESTER_PRIVATE_KEY,
    provider
  );

  const MMM = await ethers.getContractAt(
    "MMMToken",
    process.env.TESTNET_MMM,
    provider
  );

  const RV = await ethers.getContractAt(
    "RewardVault",
    process.env.TESTNET_REWARDVAULT,
    provider
  );

  console.log(`📍 Wallet: ${tester.address}\n`);

  /* ---------------------------------------------
     Fetch on-chain data
  --------------------------------------------- */
  const [
    monBalRaw,
    mmmBalRaw,
    pendingRaw,
    lastClaimRaw,
    minHoldRaw,
    cooldownRaw,
    minBalanceRaw,
  ] = await Promise.all([
    provider.getBalance(tester.address),
    MMM.balanceOf(tester.address),
    RV.pending(tester.address),
    RV.lastClaimAt(tester.address),
    RV.minHoldTimeSec(),
    RV.claimCooldown(),
    RV.minBalance(),
  ]);

  const now = Math.floor(Date.now() / 1000);

  const monBal = Number(ethers.formatEther(monBalRaw));
  const mmmBal = Number(ethers.formatEther(mmmBalRaw));
  const pending = pendingRaw;

  const lastClaimAt = Number(lastClaimRaw);
  const minHoldSec = Number(minHoldRaw);
  const cooldownSec = Number(cooldownRaw);
  const minBalance = Number(ethers.formatEther(minBalanceRaw));

  /* ---------------------------------------------
     Display balances
  --------------------------------------------- */
  console.log("💰 BALANCES");
  console.log(`MON : ${monBal}`);
  console.log(`MMM : ${mmmBal}`);
  console.log("");

  /* ---------------------------------------------
     Rewards
  --------------------------------------------- */
  console.log("🎁 REWARDS");
  console.log(`Pending : ${ethers.formatEther(pending)} MON`);
  console.log("");

  /* ---------------------------------------------
     Timers (RewardVault v1 logic)
  --------------------------------------------- */

  // HOLD: only before first claim
  let holdRemaining = 0;
  if (lastClaimAt === 0 && minHoldSec > 0) {
    holdRemaining = minHoldSec;
  }

  // COOLDOWN
  let cooldownRemaining = 0;
  if (lastClaimAt > 0) {
    cooldownRemaining = Math.max(
      0,
      lastClaimAt + cooldownSec - now
    );
  }

  const totalWait = Math.max(holdRemaining, cooldownRemaining);

  console.log("⏱️  TIMERS");
  console.log(
    `Hold     : ${
      holdRemaining === 0
        ? "✅ Met"
        : `❌ ${formatTime(holdRemaining)} remaining`
    }`
  );
  console.log(
    `Cooldown : ${
      cooldownRemaining === 0
        ? "✅ Met"
        : `❌ ${formatTime(cooldownRemaining)} remaining`
    }`
  );
  console.log("");

  /* ---------------------------------------------
     Requirements
  --------------------------------------------- */
  console.log("📋 REQUIREMENTS");
  console.log(`Min Hold Time : ${formatTime(minHoldSec)}`);
  console.log(`Cooldown      : ${formatTime(cooldownSec)}`);
  console.log(`Min Balance   : ${minBalance} MMM`);
  console.log("");

  /* ---------------------------------------------
     Eligibility
  --------------------------------------------- */
  const hasMinBalance = mmmBal >= minBalance;
  const hasRewards = pending > 0n;
  const holdMet = holdRemaining === 0;
  const cooldownMet = cooldownRemaining === 0;

  console.log("==========================================");
  console.log("✅ ELIGIBILITY\n");

  console.log(`Hold       : ${holdMet ? "✅" : "❌"}`);
  console.log(`Cooldown   : ${cooldownMet ? "✅" : "❌"}`);
  console.log(`MinBalance : ${hasMinBalance ? "✅" : "❌"}`);
  console.log(`Rewards    : ${hasRewards ? "✅" : "⚠️ None"}`);
  console.log("");

  const canClaim =
    hasMinBalance &&
    hasRewards &&
    holdMet &&
    cooldownMet;

  if (canClaim) {
    console.log("🎉 READY TO CLAIM");
    console.log("Run:");
    console.log("npx hardhat run scripts/test-05b-tester-claim.js --network monadTestnet");
  } else if (totalWait > 0) {
    console.log(`⏳ Wait ${formatTime(totalWait)}`);
    console.log(`Claimable at: ${new Date((now + totalWait) * 1000).toLocaleString()}`);
  } else if (!hasMinBalance) {
    console.log(`❌ Need ${minBalance - mmmBal} more MMM`);
  } else if (!hasRewards) {
    console.log("⚠️  No rewards pending (run tax processing first)");
  }

  console.log("==========================================\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
