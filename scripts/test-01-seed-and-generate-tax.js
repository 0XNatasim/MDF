// scripts/test-01-seed-and-generate-tax.js
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
    throw new Error(`No deployment manifest found for ${hre.network.name}`);
  }

  return JSON.parse(fs.readFileSync(file));
}

async function main() {

  console.log("=== TEST 01: Seed TaxVault ===");

  const [deployer] = await ethers.getSigners();

  const manifest = loadManifest();
  const { MMM, TAX_VAULT } = manifest.contracts;

  console.log("Network:", hre.network.name);
  console.log("TaxVault:", TAX_VAULT);

  const mmm = await ethers.getContractAt(
    "MMMToken",
    MMM,
    deployer
  );

  const amount = ethers.parseUnits("10000", 18);

  console.log("Sending MMM directly to TaxVault (simulated tax)...");
  await (await mmm.transfer(TAX_VAULT, amount)).wait();

  const bal = await mmm.balanceOf(TAX_VAULT);

  console.log("TaxVault MMM balance:", ethers.formatUnits(bal, 18));

  if (bal === 0n) {
    throw new Error("❌ TaxVault empty");
  }

  console.log("✅ TEST 01 COMPLETE");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
