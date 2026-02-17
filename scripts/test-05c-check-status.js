// scripts/test-05c-check-status.js
const hre = require("hardhat");
const { ethers, network } = hre;
const fs = require("fs");
const path = require("path");

function loadManifest() {
  const file = path.join(
    "deployments",
    hre.network.name,
    "latest.json"
  );

  if (!fs.existsSync(file)) {
    throw new Error(`No deployment manifest for ${hre.network.name}`);
  }

  return JSON.parse(fs.readFileSync(file));
}

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

function formatDate(ts) {
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19);
}

async function getBlockTime() {
  const block = await ethers.provider.getBlock("latest");
  return Number(block.timestamp);
}

async function main() {

  console.log("\n=== TEST 05C: STATUS CHECK (AUTO TIME ADVANCE) ===\n");

  const [ , tester ] = await ethers.getSigners();
  const manifest = loadManifest();

  const { MMM, REWARD_VAULT } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM);
  const rv  = await ethers.getContractAt("RewardVault", REWARD_VAULT);

  async function computeState() {

    const now = await getBlockTime();

    const [
      nativeBal,
      mmmBalRaw,
      pendingRaw,
      lastClaimRaw,
      minHoldRaw,
      cooldownRaw,
      minBalanceRaw,
      lastNonZeroAt
    ] = await Promise.all([
      ethers.provider.getBalance(tester.address),
      mmm.balanceOf(tester.address),
      rv.pending(tester.address),
      rv.lastClaimAt(tester.address),
      rv.minHoldTimeSec(),
      rv.claimCooldown(),
      rv.minBalance(),
      mmm.lastNonZeroAt(tester.address)
    ]);

    const mmmBal = mmmBalRaw;
    const pending = pendingRaw;
    const lastClaimAt = Number(lastClaimRaw);
    const minHoldSec = Number(minHoldRaw);
    const cooldownSec = Number(cooldownRaw);
    const minBalance = minBalanceRaw;

    let holdRemaining = 0;
    if (lastClaimAt === 0 && minHoldSec > 0) {
      const holdEnd = Number(lastNonZeroAt) + minHoldSec;
      holdRemaining = Math.max(0, holdEnd - now);
    }

    let cooldownRemaining = 0;
    if (lastClaimAt > 0) {
      const cooldownEnd = lastClaimAt + cooldownSec;
      cooldownRemaining = Math.max(0, cooldownEnd - now);
    }

    return {
      now,
      nativeBal,
      mmmBal,
      pending,
      lastClaimAt,
      minHoldSec,
      cooldownSec,
      minBalance,
      holdRemaining,
      cooldownRemaining
    };
  }

  let state = await computeState();

  console.log("🕒 BLOCK TIME :", formatDate(state.now));
  console.log("");

  /* ===================================================== */
  /* AUTO ADVANCE IF NEEDED                                */
  /* ===================================================== */

  const totalWait = Math.max(
    state.holdRemaining,
    state.cooldownRemaining
  );

  if (hre.network.name === "localhost" && totalWait > 0) {

    console.log(`⏩ Auto advancing time by ${totalWait + 1}s...`);

    await network.provider.send("evm_increaseTime", [totalWait + 1]);
    await network.provider.send("evm_mine");

    state = await computeState();

    console.log("🕒 NEW BLOCK TIME :", formatDate(state.now));
    console.log("");
  }

  /* ===================================================== */
  /* DISPLAY FINAL STATE                                   */
  /* ===================================================== */

  console.log("Network:", hre.network.name);
  console.log("Wallet :", tester.address);
  console.log("");

  console.log("💰 BALANCES");
  console.log("Native :", ethers.formatEther(state.nativeBal));
  console.log("MMM    :", ethers.formatUnits(state.mmmBal, 18));
  console.log("");

  console.log("🎁 REWARDS");
  console.log("Pending MMM :", ethers.formatUnits(state.pending, 18));
  console.log("");

  console.log("⏱️  TIMERS");
  console.log(
    "Hold     :",
    state.holdRemaining === 0
      ? "✅ Met"
      : `❌ ${formatTime(state.holdRemaining)} remaining`
  );
  console.log(
    "Cooldown :",
    state.cooldownRemaining === 0
      ? "✅ Met"
      : `❌ ${formatTime(state.cooldownRemaining)} remaining`
  );
  console.log("");

  const hasMinBalance = state.mmmBal >= state.minBalance;
  const hasRewards = state.pending > 0n;
  const holdMet = state.holdRemaining === 0;
  const cooldownMet = state.cooldownRemaining === 0;

  console.log("==========================================");
  console.log("ELIGIBILITY\n");

  console.log("Hold       :", holdMet ? "✅" : "❌");
  console.log("Cooldown   :", cooldownMet ? "✅" : "❌");
  console.log("MinBalance :", hasMinBalance ? "✅" : "❌");
  console.log("Rewards    :", hasRewards ? "✅" : "⚠️ None");
  console.log("");

  const canClaim =
    hasMinBalance &&
    hasRewards &&
    holdMet &&
    cooldownMet;

  if (canClaim) {
    console.log("🎉 READY TO CLAIM");
  } else {
    console.log("❌ NOT ELIGIBLE");
  }

  console.log("==========================================\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
