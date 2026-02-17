// scripts/test-05b-tester-claim.js
const hre = require("hardhat");
const { ethers } = hre;
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

async function main() {

  console.log("\n=== TEST 05B: TESTER CLAIM (STRICT) ===\n");

  const [ , tester ] = await ethers.getSigners();
  const manifest = loadManifest();

  const {
    MMM,
    REWARD_VAULT
  } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM);
  const rv  = await ethers.getContractAt("RewardVault", REWARD_VAULT, tester);

  console.log("Network:", hre.network.name);
  console.log("Tester:", tester.address, "\n");

  /* ===================================================== */
  /* 1. Read on-chain state                               */
  /* ===================================================== */

  const block = await ethers.provider.getBlock("latest");
  const now = Number(block.timestamp);

  const [
    mmmBalRaw,
    pendingRaw,
    lastClaimRaw,
    minHoldRaw,
    cooldownRaw,
    minBalanceRaw,
    lastNonZeroAt
  ] = await Promise.all([
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

  console.log("📊 STATUS");
  console.log("MMM balance :", ethers.formatUnits(mmmBal, 18));
  console.log("Pending     :", ethers.formatUnits(pending, 18));
  console.log("Last claim  :", lastClaimAt > 0 ? new Date(lastClaimAt * 1000).toLocaleString() : "Never");
  console.log("");

  /* ===================================================== */
  /* 2. Eligibility checks                                */
  /* ===================================================== */

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

  console.log("⏱️  ELIGIBILITY");
  console.log(
    "Hold     :",
    holdRemaining === 0 ? "✅ OK" : `❌ ${formatTime(holdRemaining)} remaining`
  );
  console.log(
    "Cooldown :",
    cooldownRemaining === 0 ? "✅ OK" : `❌ ${formatTime(cooldownRemaining)} remaining`
  );
  console.log(
    "Min bal  :",
    mmmBal >= minBalance ? "✅ OK" : `❌ Need ${ethers.formatUnits(minBalance,18)} MMM`
  );
  console.log("");

  if (mmmBal < minBalance) {
    console.log("❌ Cannot claim: insufficient balance\n");
    return;
  }

  if (pending === 0n) {
    console.log("⚠️  Nothing to claim\n");
    return;
  }

  if (holdRemaining > 0 || cooldownRemaining > 0) {
    const wait = Math.max(holdRemaining, cooldownRemaining);
    console.log(`❌ Not eligible yet. Wait ${formatTime(wait)}\n`);
    return;
  }

  /* ===================================================== */
  /* 3. Execute claim                                     */
  /* ===================================================== */

  console.log("✅ ELIGIBLE — CLAIMING\n");

  const beforeMMM = await mmm.balanceOf(tester.address);

  const tx = await rv.claim();
  console.log("Tx:", tx.hash);

  await tx.wait();

  const afterMMM = await mmm.balanceOf(tester.address);

  const gained = afterMMM - beforeMMM;

  console.log("\n==================================");
  console.log("🎉 CLAIM COMPLETE");
  console.log("MMM gained :", ethers.formatUnits(gained, 18));
  console.log("==================================\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
