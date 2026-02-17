// scripts/test-16-router-failure.js
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

  console.log("\n=== TEST 16 STRICT: ROUTER FAILURE ATOMICITY ===\n");

  const [owner] = await ethers.getSigners();
  const manifest = loadManifest();

  const { MMM, TAX_VAULT } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM);
  const tv  = await ethers.getContractAt("TaxVault", TAX_VAULT, owner);

  const originalRouter = await tv.router();

  console.log("Original Router:", originalRouter);

  /* ===================================================== */
  /* 1. Ensure vault has balance                           */
  /* ===================================================== */

  let bal = await mmm.balanceOf(tv.target);

  if (bal === 0n) {
    console.log("Seeding 500 MMM...");
    await (await mmm.connect(owner)
      .transfer(tv.target, ethers.parseUnits("500", 18))).wait();
    bal = await mmm.balanceOf(tv.target);
  }

  console.log("Vault balance before:", ethers.formatUnits(bal, 18));

  /* ===================================================== */
  /* 2. Set invalid router                                 */
  /* ===================================================== */

  const badRouter = "0x1111111111111111111111111111111111111111";

  await (await tv.setRouter(badRouter)).wait();

  console.log("Router temporarily set to invalid address");

  /* ===================================================== */
  /* 3. Attempt process()                                  */
  /* ===================================================== */

  const deadline = Math.floor(Date.now() / 1000) + 600;

  let reverted = false;

  try {
    await tv.process(bal, 0, deadline);
  } catch {
    reverted = true;
    console.log("Process reverted as expected.");
  }

  const balAfter = await mmm.balanceOf(tv.target);

  console.log("Vault balance after attempt:", ethers.formatUnits(balAfter, 18));

  if (!reverted)
    throw new Error("❌ process() did not revert");

  if (balAfter !== bal)
    throw new Error("❌ Atomicity broken — vault balance changed");

  console.log("✅ Atomicity confirmed — state unchanged");

  /* ===================================================== */
  /* 4. Restore original router                            */
  /* ===================================================== */

  await (await tv.setRouter(originalRouter)).wait();

  console.log("Router restored.");

  console.log("=== TEST 16 PASSED ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
