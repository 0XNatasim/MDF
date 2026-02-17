// scripts/test-18-accrual-drift.js
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

  console.log("\n=== TEST 18 STRICT: ACCRUAL DRIFT INVARIANT ===\n");

  const manifest = loadManifest();
  const { REWARD_VAULT } = manifest.contracts;

  const rv = await ethers.getContractAt("RewardVault", REWARD_VAULT);

  const signers = await ethers.getSigners();

  /* ===================================================== */
  /* 1. Sum pending for active signers                     */
  /* ===================================================== */

  let sumPending = 0n;

  for (const s of signers.slice(0, 5)) {
    const p = await rv.pending(s.address);
    sumPending += p;
  }

  /* ===================================================== */
  /* 2. Read totalDistributed                              */
  /* ===================================================== */

  const totalDistributed = await rv.totalDistributed();

  console.log("Sum pending:       ", sumPending.toString());
  console.log("Total distributed: ", totalDistributed.toString());

  /* ===================================================== */
  /* 3. Invariant                                          */
  /* ===================================================== */

  if (sumPending > totalDistributed) {
    throw new Error(
      "❌ Drift detected — pending exceeds totalDistributed"
    );
  }

  console.log("✅ No accrual overflow drift detected");
  console.log("=== TEST 18 PASSED ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
