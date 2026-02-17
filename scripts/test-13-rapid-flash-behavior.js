// scripts/test-13-rapid-flash-behavior.js
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

  console.log("\n=== TEST 13 STRICT: FLASH BEHAVIOR ===\n");

  const [owner, fresh] = await ethers.getSigners();
  const manifest = loadManifest();

  const { MMM, REWARD_VAULT } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM);
  const rv  = await ethers.getContractAt("RewardVault", REWARD_VAULT);

  const amount = ethers.parseUnits("200", 18);

  /* ===================================================== */
  /* 1. Flash in                                            */
  /* ===================================================== */

  await (await mmm.connect(owner).transfer(fresh.address, amount)).wait();

  /* ===================================================== */
  /* 2. Flash out immediately                               */
  /* ===================================================== */

  await (await mmm.connect(fresh).transfer(owner.address, amount)).wait();

  /* ===================================================== */
  /* 3. Check pending rewards                               */
  /* ===================================================== */

  const pending = await rv.pending(fresh.address);

  if (pending !== 0n) {
    throw new Error("❌ Flash reward exploit detected");
  }

  console.log("✅ No flash reward exploit");
  console.log("=== TEST 13 PASSED ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
