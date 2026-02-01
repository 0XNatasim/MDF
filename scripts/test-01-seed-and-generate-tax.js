// scripts/test-01-seed-and-generate-tax.js
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("=== TEST 01: Seed TaxVault ===");

  const [deployer] = await ethers.getSigners();

  const MMM = await ethers.getContractAt(
    "MMMToken",
    process.env.TESTNET_MMM,
    deployer
  );

  const TAX_VAULT = process.env.TESTNET_TAXVAULT;

  const amount = ethers.parseUnits("10000", 18);

  console.log("Sending MMM directly to TaxVault (simulated tax)");
  await (await MMM.transfer(TAX_VAULT, amount)).wait();

  const bal = await MMM.balanceOf(TAX_VAULT);
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
