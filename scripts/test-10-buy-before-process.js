// scripts/test-10-buy-before-process.js
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

  console.log("\n=== TEST 10 STRICT: BUY BEFORE PROCESS ===\n");

  const [owner, fresh] = await ethers.getSigners();
  const manifest = loadManifest();

  const { MMM, TAX_VAULT } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM);
  const tv  = await ethers.getContractAt("TaxVault", TAX_VAULT);

  /* ===================================================== */
  /* 1. Simulate BUY (transfer to fresh user)             */
  /* ===================================================== */

  const buyAmount = ethers.parseUnits("200", 18);

  await (await mmm.connect(owner).transfer(
    fresh.address,
    buyAmount
  )).wait();

  const freshBal = await mmm.balanceOf(fresh.address);

  if (freshBal < buyAmount) {
    throw new Error("❌ Buy simulation failed");
  }

  console.log("✓ Buy simulated");

  /* ===================================================== */
  /* 2. Add tax to TaxVault                               */
  /* ===================================================== */

  const taxAmount = ethers.parseUnits("500", 18);

  await (await mmm.connect(owner).transfer(
    TAX_VAULT,
    taxAmount
  )).wait();

  const balBeforeProcess = await mmm.balanceOf(TAX_VAULT);

  if (balBeforeProcess === 0n) {
    throw new Error("❌ TaxVault not funded");
  }

  console.log("✓ TaxVault funded:", ethers.formatUnits(balBeforeProcess, 18));

  /* ===================================================== */
  /* 3. Process                                            */
  /* ===================================================== */

  const deadline = Math.floor(Date.now() / 1000) + 600;

  await (await tv.connect(owner).process(
    balBeforeProcess,
    0,
    deadline
  )).wait();

  /* ===================================================== */
  /* 4. Invariant: TaxVault must be empty                  */
  /* ===================================================== */

  const balAfterProcess = await mmm.balanceOf(TAX_VAULT);

  if (balAfterProcess !== 0n) {
    throw new Error("❌ Invariant failed: TaxVault not emptied");
  }

  console.log("✅ Process after buy working");
  console.log("=== TEST 10 PASSED ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
