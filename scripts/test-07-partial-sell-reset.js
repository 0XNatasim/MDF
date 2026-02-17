// scripts/test-07-partial-sell-reset.js
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

  console.log("\n=== TEST 07 STRICT: PARTIAL SELL RESET ===\n");

  const [deployer, fresh] = await ethers.getSigners();
  const manifest = loadManifest();

  const { MMM, REWARD_VAULT } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM);
  const rv  = await ethers.getContractAt("RewardVault", REWARD_VAULT, fresh);

  const buyAmount = ethers.parseUnits("400", 18);

  /* ===================================================== */
  /* 1. BUY                                                */
  /* ===================================================== */

  await (await mmm.connect(deployer).transfer(
    fresh.address,
    buyAmount
  )).wait();

  console.log("✓ Buy executed");

  const balAfterBuy = await mmm.balanceOf(fresh.address);

  if (balAfterBuy < buyAmount) {
    throw new Error("❌ Buy invariant failed");
  }

  /* ===================================================== */
  /* 2. PARTIAL SELL                                       */
  /* ===================================================== */

  const sellAmount = balAfterBuy / 2n;

  await (await mmm.connect(fresh).transfer(
    deployer.address,
    sellAmount
  )).wait();

  console.log("✓ Partial sell executed");

  const balAfterSell = await mmm.balanceOf(fresh.address);

  if (balAfterSell !== balAfterBuy - sellAmount) {
    throw new Error("❌ Partial sell invariant failed");
  }

  /* ===================================================== */
  /* 3. CLAIM MUST FAIL (hold reset)                       */
  /* ===================================================== */

  let reverted = false;

  try {
    await rv.claim();
  } catch {
    reverted = true;
  }

  if (!reverted) {
    throw new Error("❌ Hold reset failed — claim succeeded");
  }

  console.log("✅ Hold reset working after partial sell");
  console.log("=== TEST 07 PASSED ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
