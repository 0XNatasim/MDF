// scripts/test-06-buy-sell-claim.js
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

  console.log("\n=== TEST 06 STRICT: BUY → SELL → CLAIM BLOCK ===\n");

  const [deployer, fresh] = await ethers.getSigners();
  const manifest = loadManifest();

  const { MMM, REWARD_VAULT } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM);
  const rv  = await ethers.getContractAt("RewardVault", REWARD_VAULT, fresh);

  const buyAmount = ethers.parseUnits("500", 18);

  /* ===================================================== */
  /* 1. BUY (transfer from deployer)                      */
  /* ===================================================== */

  const balBefore = await mmm.balanceOf(fresh.address);

  const txBuy = await mmm.connect(deployer).transfer(
    fresh.address,
    buyAmount
  );
  await txBuy.wait();

  const balAfterBuy = await mmm.balanceOf(fresh.address);

  if (balAfterBuy <= balBefore) {
    throw new Error("❌ BUY invariant failed");
  }

  console.log("✓ Buy executed");

  /* ===================================================== */
  /* 2. SELL (full balance back to deployer)              */
  /* ===================================================== */

  const txSell = await mmm.connect(fresh).transfer(
    deployer.address,
    balAfterBuy
  );
  await txSell.wait();

  console.log("✓ Sell executed");

  /* ===================================================== */
  /* 3. CLAIM MUST FAIL                                   */
  /* ===================================================== */

  let reverted = false;

  try {
    await rv.claim();
  } catch (err) {
    reverted = true;
  }

  if (!reverted) {
    throw new Error("❌ Claim should have reverted after sell");
  }

  console.log("✅ Claim correctly blocked after full sell");
  console.log("=== TEST 06 PASSED ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
