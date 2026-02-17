// scripts/test-09-dust-holder.js
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

  console.log("\n=== TEST 09 STRICT: DUST HOLDER (SOFT THRESHOLD MODEL) ===\n");

  const [owner] = await ethers.getSigners();
  const dust = ethers.Wallet.createRandom().connect(ethers.provider);

  // Fund dust wallet for gas
  await owner.sendTransaction({
    to: dust.address,
    value: ethers.parseEther("1")
  });

  const manifest = loadManifest();
  const { MMM, TAX_VAULT, REWARD_VAULT } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM, owner);
  const tv  = await ethers.getContractAt("TaxVault", TAX_VAULT, owner);
  const rv  = await ethers.getContractAt("RewardVault", REWARD_VAULT);

  /* ===================================================== */
  /* 1. CREATE EMISSION                                   */
  /* ===================================================== */

  const seedAmount = ethers.parseUnits("1000", 18);
  await (await mmm.transfer(TAX_VAULT, seedAmount)).wait();

  const deadline = Math.floor(Date.now() / 1000) + 600;
  await (await tv.process(seedAmount, 0, deadline)).wait();

  console.log("✓ Emissions created");

  /* ===================================================== */
  /* 2. FUND DUST BELOW MIN BALANCE                       */
  /* ===================================================== */

  const minBalance = await rv.minBalance();
  const dustAmount = minBalance > 1n ? minBalance - 1n : 1n;

  await (await mmm.transfer(dust.address, dustAmount)).wait();

  const dustBal = await mmm.balanceOf(dust.address);

  if (dustBal >= minBalance) {
    throw new Error("❌ Dust balance accidentally >= minBalance");
  }

  console.log("✓ Dust funded below minBalance");

  /* ===================================================== */
  /* 3. VERIFY ACCRUAL (ALLOWED)                          */
  /* ===================================================== */

  const pending = await rv.pending(dust.address);

  if (pending === 0n) {
    console.log("⚠️ Dust has zero accrual (acceptable but unexpected)");
  } else {
    console.log("✓ Dust accrues (expected under soft-threshold model)");
  }

  /* ===================================================== */
  /* 4. CLAIM MUST FAIL                                    */
  /* ===================================================== */

  let reverted = false;

  try {
    await rv.connect(dust).claim();
  } catch {
    reverted = true;
  }

  if (!reverted) {
    throw new Error("❌ Dust wallet was able to claim below minBalance");
  }

  console.log("✓ Claim correctly blocked for dust wallet");

  console.log("\n=== TEST 09 PASSED (SOFT MODEL CONFIRMED) ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
