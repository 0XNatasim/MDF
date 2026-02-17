// scripts/test-02-high-gas.js
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

  console.log("=== TEST 02: Process Tax (HIGH GAS LIMIT) ===\n");

  const [deployer] = await ethers.getSigners();
  console.log("Caller:", deployer.address);
  console.log("Network:", hre.network.name);

  const manifest = loadManifest();
  const {
    MMM,
    TAX_VAULT,
    USDC
  } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM, deployer);
  const taxVault = await ethers.getContractAt("TaxVault", TAX_VAULT, deployer);
  const usdc = await ethers.getContractAt("MockERC20", USDC, deployer);

  const tvAddr = TAX_VAULT;

  const taxBal = await mmm.balanceOf(tvAddr);
  console.log("TaxVault MMM before:", ethers.formatUnits(taxBal, 18));

  if (taxBal === 0n) {
    throw new Error("❌ No MMM in TaxVault");
  }

  const rewardVault = await taxVault.rewardVault();
  const marketingVault = await taxVault.marketingVault();
  const teamVestingVault = await taxVault.teamVestingVault();

  const deadline = Math.floor(Date.now() / 1000) + 600;

  console.log("\nCalling TaxVault.process() with HIGH gas limit...");
  console.log("Gas limit: 5,000,000");

  try {
    const tx = await taxVault.process(
      taxBal,
      0,
      deadline,
      { gasLimit: 5_000_000 }
    );

    console.log("Transaction sent:", tx.hash);
    const receipt = await tx.wait();

    if (receipt.status !== 1) {
      throw new Error("Transaction reverted");
    }

    console.log("\n✓✓✓ SUCCESS ✓✓✓");
    console.log("Gas used:", receipt.gasUsed.toString());

    console.log("\n--- Vault balances after ---");

    const rewardMmm = await mmm.balanceOf(rewardVault);
    const mktUsdc = await usdc.balanceOf(marketingVault);
    const teamUsdc = await usdc.balanceOf(teamVestingVault);

    console.log("RewardVault MMM :", ethers.formatUnits(rewardMmm, 18));
    console.log("Marketing USDC  :", ethers.formatUnits(mktUsdc, 6));
    console.log("TeamVesting USDC:", ethers.formatUnits(teamUsdc, 6));

    const finalMmm  = await mmm.balanceOf(tvAddr);
    const finalUsdc = await usdc.balanceOf(tvAddr);

    console.log("\nTaxVault MMM remaining :", ethers.formatUnits(finalMmm, 18));
    console.log("TaxVault USDC remaining:", ethers.formatUnits(finalUsdc, 6));

    console.log("\n=== TEST 02 COMPLETE ===");

  } catch (error) {

    console.log("\n❌ ERROR");
    console.log(error.message);

    if (error.receipt) {
      console.log("Gas used:", error.receipt.gasUsed?.toString());
    }

    throw error;
  }
}

main().catch(() => {
  console.error("\n=== FAILED ===");
  process.exit(1);
});
