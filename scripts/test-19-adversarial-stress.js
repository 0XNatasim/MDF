// scripts/test-19-adversarial-stress.js
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

function loadManifest() {
  const file = path.join("deployments", hre.network.name, "latest.json");
  return JSON.parse(fs.readFileSync(file));
}

async function main() {

  console.log("\n=== TEST 19 STRICT: ADVERSARIAL STRESS (FIXED) ===\n");

  const [owner, w1, w2, w3] = await ethers.getSigners();
  const manifest = loadManifest();

  const { MMM, REWARD_VAULT } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM);
  const rv  = await ethers.getContractAt("RewardVault", REWARD_VAULT);

  const users = [w1.address, w2.address, w3.address];

  /* ===================================================== */
  /* RUN MULTI-CYCLE RANDOMIZED INTERACTION               */
  /* ===================================================== */

  for (let i = 0; i < 5; i++) {

    console.log(`--- CYCLE ${i + 1} ---`);

    if (i % 2 === 0) {
      await mmm.connect(owner).transfer(w2.address, ethers.parseUnits("50",18));
      console.log("Partial transfer to w2");
    }

    try {
      await rv.connect(w1).claim();
      console.log("Claim attempt by w1");
    } catch {}

  }

  /* ===================================================== */
  /* ACCOUNTING INVARIANT                                 */
  /* ===================================================== */

  const totalDistributed = await rv.totalDistributed();
  const totalClaimed     = await rv.totalClaimed();

  let sumPending = 0n;

  for (const u of users) {
    sumPending += await rv.pending(u);
  }

  console.log("\n=== INVARIANT CHECK ===");
  console.log("Total Distributed:", ethers.formatUnits(totalDistributed,18));
  console.log("Total Claimed:    ", ethers.formatUnits(totalClaimed,18));
  console.log("Sum Pending:      ", ethers.formatUnits(sumPending,18));

  /* ---------- CORE INVARIANT ---------- */

  if (totalClaimed > totalDistributed)
    throw new Error("❌ Claimed exceeds distributed");

  const remaining = totalDistributed - totalClaimed;

  const tolerance = BigInt(users.length); // rounding margin

  if (sumPending > remaining + tolerance)
    throw new Error("❌ Pending exceeds distributable remainder");

  console.log("Remaining distributable:",
    ethers.formatUnits(remaining,18));

  console.log("Tolerance (wei):", tolerance.toString());

  console.log("Difference:",
    ethers.formatUnits(remaining - sumPending,18));

  console.log("✅ Accounting invariant holds");
  console.log("=== TEST 19 PASSED ===");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
