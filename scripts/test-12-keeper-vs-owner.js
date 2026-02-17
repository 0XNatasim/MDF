// scripts/test-12-keeper-vs-owner.js
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

function loadManifest() {
  const file = path.join("deployments", hre.network.name, "latest.json");
  if (!fs.existsSync(file)) {
    throw new Error(`No deployment manifest for ${hre.network.name}`);
  }
  return JSON.parse(fs.readFileSync(file));
}

async function main() {

  console.log("\n=== TEST 12 STRICT: AUTHORIZATION (FIXED) ===\n");

  const [owner, keeper, random] = await ethers.getSigners();
  const manifest = loadManifest();

  const { MMM, TAX_VAULT } = manifest.contracts;

  const tv  = await ethers.getContractAt("TaxVault", TAX_VAULT, owner);
  const mmm = await ethers.getContractAt("MMMToken", MMM, owner);

  /* ===================================================== */
  /* 1. Set keeper                                         */
  /* ===================================================== */

  await (await tv.setKeeper(keeper.address)).wait();
  console.log("✓ Keeper set");

  /* ===================================================== */
  /* 2. Owner can process                                  */
  /* ===================================================== */

  await (await mmm.transfer(TAX_VAULT, ethers.parseUnits("500", 18))).wait();
  let bal = await mmm.balanceOf(TAX_VAULT);

  await (await tv.process(
    bal,
    0,
    Math.floor(Date.now() / 1000) + 600
  )).wait();

  console.log("✓ Owner process OK");

  /* ===================================================== */
  /* 3. Keeper can process                                 */
  /* ===================================================== */

  await (await mmm.transfer(TAX_VAULT, ethers.parseUnits("500", 18))).wait();
  bal = await mmm.balanceOf(TAX_VAULT);

  await (await tv.connect(keeper).process(
    bal,
    0,
    Math.floor(Date.now() / 1000) + 600
  )).wait();

  console.log("✓ Keeper process OK");

  /* ===================================================== */
  /* 4. Random must fail                                   */
  /* ===================================================== */

  let reverted = false;

  try {
    await tv.connect(random).process(
      0,
      0,
      Math.floor(Date.now() / 1000) + 600
    );
  } catch {
    reverted = true;
  }

  if (!reverted) {
    throw new Error("❌ Random wallet bypassed auth");
  }

  console.log("✓ Random correctly blocked");
  console.log("=== TEST 12 PASSED ===\n");
}

main().catch(console.error);
