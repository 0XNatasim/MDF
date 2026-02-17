// scripts/test-11-claim-spam.js
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

  console.log("\n=== TEST 11 STRICT: CLAIM SPAM ===\n");

  const [, fresh] = await ethers.getSigners();
  const manifest = loadManifest();

  const { REWARD_VAULT } = manifest.contracts;

  const rv = await ethers.getContractAt(
    "RewardVault",
    REWARD_VAULT,
    fresh
  );

  /* ===================================================== */
  /* 1. Check pending                                      */
  /* ===================================================== */

  const pending = await rv.pending(fresh.address);

  if (pending === 0n) {
    console.log("No rewards to claim — skipping.");
    console.log("=== TEST 11 SKIPPED ===");
    return;
  }

  /* ===================================================== */
  /* 2. First claim                                        */
  /* ===================================================== */

  await (await rv.claim()).wait();

  const lastClaim1 = await rv.lastClaimAt(fresh.address);

  if (lastClaim1 === 0n) {
    throw new Error("❌ lastClaimAt not updated on first claim");
  }

  console.log("✓ First claim executed");

  /* ===================================================== */
  /* 3. Attempt immediate second claim                     */
  /* ===================================================== */

  let reverted = false;

  try {
    await rv.claim();
  } catch {
    reverted = true;
  }

  if (!reverted) {
    throw new Error("❌ Cooldown failed — second claim succeeded");
  }

  /* ===================================================== */
  /* 4. Verify invariant: lastClaimAt unchanged            */
  /* ===================================================== */

  const lastClaim2 = await rv.lastClaimAt(fresh.address);

  if (lastClaim1 !== lastClaim2) {
    throw new Error("❌ Invariant failed: lastClaimAt mutated after revert");
  }

  console.log("✅ Cooldown invariant enforced");
  console.log("=== TEST 11 PASSED ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
