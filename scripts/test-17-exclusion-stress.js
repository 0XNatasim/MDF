// scripts/test-17-exclusion-stress.js
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

  console.log("\n=== TEST 17 STRICT: EXCLUSION INVARIANT ===\n");

  const [owner, user] = await ethers.getSigners();
  const manifest = loadManifest();

  const { MMM, REWARD_VAULT } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM);
  const rv  = await ethers.getContractAt("RewardVault", REWARD_VAULT, owner);

  /* ===================================================== */
  /* 1. Give user balance                                  */
  /* ===================================================== */

  await (await mmm.connect(owner)
    .transfer(user.address, ethers.parseUnits("100", 18))).wait();

  console.log("User funded with 100 MMM");

  /* ===================================================== */
  /* 2. Exclude user                                       */
  /* ===================================================== */

  await (await rv.setRewardExcluded(user.address, true)).wait();

  console.log("User excluded from rewards");

  /* ===================================================== */
  /* 3. Validate pending() == 0                            */
  /* ===================================================== */

  const pending = await rv.pending(user.address);

  if (pending !== 0n)
    throw new Error("❌ Excluded wallet still accrues rewards");

  console.log("Pending rewards = 0 as expected");

  /* ===================================================== */
  /* 4. Validate claim() reverts                           */
  /* ===================================================== */

  const rvAsUser = rv.connect(user);

  let reverted = false;

  try {
    await rvAsUser.claim();
  } catch {
    reverted = true;
  }

  if (!reverted)
    throw new Error("❌ Excluded wallet successfully claimed");

  console.log("Claim correctly reverted");

  console.log("✅ Exclusion invariant enforced");
  console.log("=== TEST 17 PASSED ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
