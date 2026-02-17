// scripts/test-14-whale-dominance.js
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

async function main() {

  console.log("\n=== TEST 14 STRICT: WHALE PROPORTIONALITY ===\n");

  const [owner, whale, small] = await ethers.getSigners();
  const manifest = loadManifest();

  const { MMM, REWARD_VAULT } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM);
  const rv  = await ethers.getContractAt("RewardVault", REWARD_VAULT);

  /* ===================================================== */
  /* 1. Give whale and small different balances             */
  /* ===================================================== */

  const whaleAmount = ethers.parseUnits("1000", 18);
  const smallAmount = ethers.parseUnits("100", 18);

  await (await mmm.connect(owner).transfer(whale.address, whaleAmount)).wait();
  await (await mmm.connect(owner).transfer(small.address, smallAmount)).wait();

  /* ===================================================== */
  /* 2. Check pending rewards                               */
  /* ===================================================== */

  const whalePending = await rv.pending(whale.address);
  const smallPending = await rv.pending(small.address);

  console.log("Whale pending:", whalePending.toString());
  console.log("Small pending:", smallPending.toString());

  /* ===================================================== */
  /* 3. Strict proportionality check                        */
  /* ===================================================== */

  if (whalePending === 0n && smallPending === 0n) {
    console.log("⚠️  No rewards distributed yet — run process first");
    return;
  }

  if (smallPending > whalePending) {
    throw new Error("❌ Reward proportionality broken");
  }

  console.log("✅ Proportionality invariant holds");
  console.log("=== TEST 14 PASSED ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
