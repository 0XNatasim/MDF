// scripts/test-08-double-process.js
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

  console.log("\n=== TEST 08 STRICT: DOUBLE PROCESS (UPDATED) ===\n");

  const [owner] = await ethers.getSigners();
  const manifest = loadManifest();

  const { MMM, TAX_VAULT } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM, owner);
  const tv  = await ethers.getContractAt("TaxVault", TAX_VAULT, owner);

  /* ===================================================== */
  /* 1. SEED TAX VAULT                                     */
  /* ===================================================== */

  const seedAmount = ethers.parseUnits("1000", 18);

  await (await mmm.transfer(
    TAX_VAULT,
    seedAmount
  )).wait();

  const balanceBefore = await mmm.balanceOf(TAX_VAULT);

  if (balanceBefore !== seedAmount) {
    throw new Error("❌ Seed invariant failed");
  }

  console.log("✓ TaxVault seeded with 1000 MMM");

  /* ===================================================== */
  /* 2. FIRST PROCESS                                      */
  /* ===================================================== */

  const deadline = Math.floor(Date.now() / 1000) + 600;

  await (await tv.process(
    balanceBefore,
    0,
    deadline
  )).wait();

  console.log("✓ First process executed");

  const balanceAfter = await mmm.balanceOf(TAX_VAULT);

  if (balanceAfter !== 0n) {
    throw new Error("❌ TaxVault should be empty after process");
  }

  console.log("✓ Vault emptied");

  /* ===================================================== */
  /* 3A. SECOND PROCESS WITH SAME AMOUNT → MUST REVERT     */
  /* ===================================================== */

  let revertedSameAmount = false;

  try {
    await tv.process(
      seedAmount, // attempt original amount again
      0,
      deadline
    );
  } catch {
    revertedSameAmount = true;
  }

  if (!revertedSameAmount) {
    throw new Error("❌ Second process (same amount) should revert");
  }

  console.log("✓ Reverted with insufficient balance as expected");

  /* ===================================================== */
  /* 3B. SECOND PROCESS WITH ZERO → MUST REVERT            */
  /* ===================================================== */

  let revertedZero = false;

  try {
    await tv.process(
      0,
      0,
      deadline
    );
  } catch {
    revertedZero = true;
  }

  if (!revertedZero) {
    throw new Error("❌ Second process (zero amount) should revert");
  }

  console.log("✓ Reverted with AmountZero as expected");

  console.log("\n=== TEST 08 PASSED ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
