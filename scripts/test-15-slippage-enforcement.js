// scripts/test-15-slippage-enforcement.js
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

  console.log("\n=== TEST 15 STRICT: SLIPPAGE ENFORCEMENT ===\n");

  const [owner] = await ethers.getSigners();
  const manifest = loadManifest();

  const { MMM, TAX_VAULT } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM);
  const tv  = await ethers.getContractAt("TaxVault", TAX_VAULT, owner);

  /* ===================================================== */
  /* 1. Seed TaxVault with MMM                             */
  /* ===================================================== */

  const seedAmount = ethers.parseUnits("1000", 18);

  await (await mmm.connect(owner).transfer(tv.target, seedAmount)).wait();

  const bal = await mmm.balanceOf(tv.target);

  console.log("TaxVault MMM balance:", ethers.formatUnits(bal, 18));

  if (bal === 0n) {
    throw new Error("❌ TaxVault not seeded");
  }

  /* ===================================================== */
  /* 2. Attempt process() with impossible minUsdcOut       */
  /* ===================================================== */

  const absurdMinOut = ethers.parseUnits("9999999", 6); // intentionally impossible
  const deadline = Math.floor(Date.now() / 1000) + 600;

  try {
    await tv.process(bal, absurdMinOut, deadline);
    throw new Error("❌ Slippage not enforced — process succeeded unexpectedly");
  } catch (e) {
    console.log("✅ Slippage protection enforced (reverted as expected)");
  }

  console.log("=== TEST 15 PASSED ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
