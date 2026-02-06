// scripts/test-05-tester-buy-and-track.js
const hre = require("hardhat");
const { ethers } = hre;

/**
 * TEST 05: TESTER buys MMM via UI flow (wrap + swap)
 * Then tracks hold requirement and claim eligibility
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

async function main() {
  console.log("\n=== TEST 05: TESTER Buy MMM + Track Eligibility ===\n");

  // Setup provider and TESTER wallet
  const provider = new ethers.JsonRpcProvider(hre.network.config.url);
  const tester = new ethers.Wallet(process.env.TESTER, provider);

  console.log("🧪 TESTER Address:", tester.address);
  console.log("📍 Network:", hre.network.name);
  console.log("");

  // Contract addresses from env
  const MMM_ADDR = process.env.TESTNET_MMM;
  const WMON_ADDR = process.env.TESTNET_WMON;
  const ROUTER_ADDR = process.env.TESTNET_ROUTER;
  const REWARD_VAULT_ADDR = process.env.TESTNET_REWARDVAULT;

  if (!MMM_ADDR || !WMON_ADDR || !ROUTER_ADDR || !REWARD_VAULT_ADDR) {
    throw new Error("❌ Missing TESTNET_* env vars");
  }

  // Load contracts
  const MMM = await ethers.getContractAt("MMMToken", MMM_ADDR, tester);
  const WMON = await ethers.getContractAt("MockERC20", WMON_ADDR, tester);
  const Router = await ethers.getContractAt("MockRouter", ROUTER_ADDR, tester);
  const RewardVault = await ethers.getContractAt("RewardVault", REWARD_VAULT_ADDR, tester);

  /* =======================================================
     STEP 1: Check current status
  ======================================================= */
  console.log("📊 CURRENT STATUS\n");

  const [
    monBalance,
    mmmBalance,
    wmonBalance,
    pendingRewards,
    lastClaimAt,
    minHoldTime,
    cooldown,
    minBalance,
  ] = await Promise.all([
    provider.getBalance(tester.address),
    MMM.balanceOf(tester.address),
    WMON.balanceOf(tester.address),
    RewardVault.pending(tester.address),
    RewardVault.lastClaimAt(tester.address),
    RewardVault.minHoldTimeSec(),
    RewardVault.claimCooldown(),
    RewardVault.minBalance(),
  ]);

  console.log(`   💰 MON Balance: ${ethers.formatEther(monBalance)} MON`);
  console.log(`   💎 MMM Balance: ${ethers.formatUnits(mmmBalance, 18)} MMM`);
  console.log(`   🔄 WMON Balance: ${ethers.formatUnits(wmonBalance, 18)} WMON`);
  console.log(`   🎁 Pending Rewards: ${ethers.formatEther(pendingRewards)} MON`);
  console.log(`   📅 Last Claim: ${lastClaimAt > 0 ? new Date(Number(lastClaimAt) * 1000).toLocaleString() : 'Never'}`);
  console.log("");
  console.log("   📋 Vault Requirements:");
  console.log(`      Min Hold Time: ${formatTime(Number(minHoldTime))}`);
  console.log(`      Claim Cooldown: ${formatTime(Number(cooldown))}`);
  console.log(`      Min Balance: ${ethers.formatUnits(minBalance, 18)} MMM`);
  console.log("");

  // Buy amount
  const BUY_AMOUNT = process.env.BUY_AMOUNT || "1"; // 1 MON default
  const buyAmountWei = ethers.parseEther(BUY_AMOUNT);

  if (monBalance < buyAmountWei) {
    throw new Error(`❌ Insufficient MON. Need ${BUY_AMOUNT} MON, have ${ethers.formatEther(monBalance)} MON`);
  }

  /* =======================================================
     STEP 2: Execute Buy (MON → WMON → MMM)
  ======================================================= */
  console.log("==========================================");
  console.log(`🛒 BUYING ${BUY_AMOUNT} MON WORTH OF MMM\n`);

  const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes
  const path = [WMON_ADDR, MMM_ADDR];

  // Step 2a: Wrap MON → WMON
  console.log("   1️⃣ Wrapping MON → WMON...");
  const wrapTx = await WMON.deposit({ value: buyAmountWei });
  console.log(`      Tx: ${wrapTx.hash}`);
  await wrapTx.wait();
  console.log("      ✅ Wrapped");
  await sleep(1500);

  // Step 2b: Approve WMON to Router
  console.log("\n   2️⃣ Approving WMON to Router...");
  const approveTx = await WMON.approve(ROUTER_ADDR, buyAmountWei);
  console.log(`      Tx: ${approveTx.hash}`);
  await approveTx.wait();
  console.log("      ✅ Approved");
  await sleep(1500);

  // Step 2c: Swap WMON → MMM
  console.log("\n   3️⃣ Swapping WMON → MMM...");
  const minOut = buyAmountWei * 95n / 100n; // 5% slippage tolerance
  const swapTx = await Router.swapExactTokensForTokens(
    buyAmountWei,
    minOut,
    path,
    tester.address,
    deadline
  );
  console.log(`      Tx: ${swapTx.hash}`);
  const receipt = await swapTx.wait();
  console.log("      ✅ Swapped");
  console.log("");

  /* =======================================================
     STEP 3: Check new balances
  ======================================================= */
  console.log("==========================================");
  console.log("📊 POST-BUY STATUS\n");

  const [
    newMmmBalance,
    newPendingRewards,
    lastNonZeroAt,
  ] = await Promise.all([
    MMM.balanceOf(tester.address),
    RewardVault.pending(tester.address),
    MMM.lastNonZeroAt(tester.address),
  ]);

  const mmmReceived = newMmmBalance - mmmBalance;

  console.log(`   ✅ Purchase Complete!`);
  console.log(`   📦 MMM Received: ${ethers.formatUnits(mmmReceived, 18)} MMM`);
  console.log(`   💎 New MMM Balance: ${ethers.formatUnits(newMmmBalance, 18)} MMM`);
  console.log(`   🎁 Pending Rewards: ${ethers.formatEther(newPendingRewards)} MON`);
  console.log(`   ⏰ Hold Start: ${new Date(Number(lastNonZeroAt) * 1000).toLocaleString()}`);
  console.log("");

  /* =======================================================
     STEP 4: Calculate claim eligibility
  ======================================================= */
  console.log("==========================================");
  console.log("⏱️  CLAIM ELIGIBILITY\n");

  const now = Math.floor(Date.now() / 1000);
  const holdStartTs = Number(lastNonZeroAt);
  
  // Hold requirement
  const holdEndTs = holdStartTs + Number(minHoldTime);
  const holdRemaining = Math.max(0, holdEndTs - now);

  // Cooldown requirement
  const lastClaim = Number(lastClaimAt);
  const cooldownEndTs = lastClaim > 0 ? lastClaim + Number(cooldown) : 0;
  const cooldownRemaining = Math.max(0, cooldownEndTs - now);

  // Total wait time
  const totalWaitTime = Math.max(holdRemaining, cooldownRemaining);
  const canClaimTs = now + totalWaitTime;
  const canClaimDate = new Date(canClaimTs * 1000);

  console.log(`   📍 Current Status:`);
  console.log(`      Hold Time Remaining: ${formatTime(holdRemaining)}`);
  
  if (holdRemaining > 0) {
    console.log(`         (Can claim at: ${new Date(holdEndTs * 1000).toLocaleString()})`);
  } else {
    console.log(`         ✅ Hold requirement met!`);
  }

  if (lastClaim > 0) {
    console.log(`      Cooldown Remaining: ${formatTime(cooldownRemaining)}`);
    if (cooldownRemaining > 0) {
      console.log(`         (Can claim at: ${new Date(cooldownEndTs * 1000).toLocaleString()})`);
    } else {
      console.log(`         ✅ Cooldown passed!`);
    }
  }

  console.log("");
  
  if (totalWaitTime > 0) {
    console.log(`   ⚠️  Must wait: ${formatTime(totalWaitTime)}`);
    console.log(`   📅 Can claim at: ${canClaimDate.toLocaleString()}`);
  } else {
    console.log(`   ✅ ELIGIBLE TO CLAIM NOW!`);
  }

  console.log("");

  // Check min balance requirement
  const hasMinBalance = newMmmBalance >= minBalance;
  console.log(`   💎 Balance Requirement: ${hasMinBalance ? '✅' : '❌'}`);
  console.log(`      Have: ${ethers.formatUnits(newMmmBalance, 18)} MMM`);
  console.log(`      Need: ${ethers.formatUnits(minBalance, 18)} MMM`);
  console.log("");

  /* =======================================================
     STEP 5: Summary for UI testing
  ======================================================= */
  console.log("==========================================");
  console.log("📝 NEXT STEPS FOR UI TESTING\n");
  console.log(`   1. Open your UI at http://localhost:3000 (or your URL)`);
  console.log(`   2. Connect wallet: ${tester.address}`);
  console.log(`   3. You should see:`);
  console.log(`      - MMM Balance: ${ethers.formatUnits(newMmmBalance, 18)} MMM`);
  console.log(`      - Hold Timer: ${formatTime(holdRemaining)}`);
  if (lastClaim > 0) {
    console.log(`      - Cooldown Timer: ${formatTime(cooldownRemaining)}`);
  }
  console.log(`   4. Wait until: ${canClaimDate.toLocaleString()}`);
  console.log(`   5. Click "Claim" button in UI`);
  console.log("");

  /* =======================================================
     STEP 6: Optional auto-claim
  ======================================================= */
  if (process.env.AUTO_CLAIM === "true" && totalWaitTime > 0) {
    console.log("==========================================");
    console.log(`⏳ AUTO_CLAIM enabled - waiting ${formatTime(totalWaitTime)}...\n`);
    
    const waitMs = totalWaitTime * 1000 + 5000; // Add 5 seconds buffer
    console.log(`   Sleeping for ${Math.floor(waitMs / 1000)} seconds...`);
    await sleep(waitMs);

    console.log("\n   🎯 Attempting claim...");
    
    try {
      const claimTx = await RewardVault.claim();
      console.log(`   Claim Tx: ${claimTx.hash}`);
      await claimTx.wait();
      
      const finalMonBalance = await provider.getBalance(tester.address);
      const monGained = finalMonBalance - (await provider.getBalance(tester.address));
      
      console.log(`   ✅ Claimed!`);
      console.log(`   💰 MON Gained: ${ethers.formatEther(monGained)} MON`);
    } catch (error) {
      console.log(`   ❌ Claim failed: ${error.message}`);
      console.log(`   💡 Try claiming manually via UI`);
    }
  }

  console.log("\n=== TEST 05 COMPLETE ===\n");
}

main().catch((e) => {
  console.error("\n❌ ERROR:", e.message);
  console.error(e);
  process.exit(1);
});