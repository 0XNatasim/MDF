// scripts/test-03-verify-working.js
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

  console.log("=== TEST 03: Verify Process() Works + Gas Requirement ===\n");

  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;

  const manifest = loadManifest();
  const {
    MMM,
    TAX_VAULT,
    USDC,
    ROUTER
  } = manifest.contracts;

  const mmm      = await ethers.getContractAt("MMMToken", MMM, deployer);
  const taxVault = await ethers.getContractAt("TaxVault", TAX_VAULT, deployer);
  const usdc     = await ethers.getContractAt("MockERC20", USDC, deployer);

  const tvAddr = TAX_VAULT;

  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployer.address);

  /* -------------------------------------------------- */
  /* 1. Current State                                  */
  /* -------------------------------------------------- */

  console.log("\n=== Current State ===");

  const taxBal = await mmm.balanceOf(tvAddr);
  console.log("TaxVault MMM:", ethers.formatUnits(taxBal, 18));

  if (taxBal === 0n) {
    console.log("\n✓ TaxVault is empty.");
    console.log("Run test-01 to seed tax first.");
    return;
  }

  /* -------------------------------------------------- */
  /* 2. Verify Tax Exemptions                          */
  /* -------------------------------------------------- */

  console.log("\n=== Verify Tax Exemptions ===");

  const tvExempt     = await mmm.isTaxExempt(tvAddr);
  const routerExempt = await mmm.isTaxExempt(ROUTER);

  console.log("TaxVault exempt:", tvExempt ? "✓" : "❌");
  console.log("Router exempt:  ", routerExempt ? "✓" : "❌");

  if (!tvExempt || !routerExempt) {
    console.log("\n❌ Exemptions missing.");
    return;
  }

  /* -------------------------------------------------- */
  /* 3. Gas Estimation                                 */
  /* -------------------------------------------------- */

  console.log("\n=== Gas Estimation ===");

  const deadline = Math.floor(Date.now() / 1000) + 600;

  let gasEstimate;
  try {
    gasEstimate = await taxVault.process.estimateGas(
      taxBal,
      0,
      deadline
    );
    console.log("Estimated gas:", gasEstimate.toString());
  } catch (err) {
    console.log("❌ Gas estimation failed:", err.message);
    return;
  }

  /* -------------------------------------------------- */
  /* 4. Balance Check                                  */
  /* -------------------------------------------------- */

  console.log("\n=== Balance Check ===");

  const balance  = await provider.getBalance(deployer.address);
  const feeData  = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 0n;

  const estimatedCost = gasEstimate * gasPrice * 12n / 10n;

  console.log("Native balance: ", ethers.formatEther(balance));
  console.log("Estimated cost: ", ethers.formatEther(estimatedCost));

  if (balance < estimatedCost) {
    console.log("❌ Insufficient native token for gas.");
    return;
  }

  /* -------------------------------------------------- */
  /* 5. Execute process()                              */
  /* -------------------------------------------------- */

  console.log("\n=== Executing process() ===");

  const gasLimit = gasEstimate * 12n / 10n;

  const tx = await taxVault.process(
    taxBal,
    0,
    deadline,
    { gasLimit }
  );

  console.log("Tx sent:", tx.hash);

  const receipt = await tx.wait();

  console.log("\n=== Results ===");
  console.log("Status:", receipt.status === 1 ? "✓ Success" : "❌ Failed");
  console.log("Gas used:", receipt.gasUsed.toString());
  console.log("Gas limit:", gasLimit.toString());

  /* -------------------------------------------------- */
  /* 6. Final Balances                                 */
  /* -------------------------------------------------- */

  console.log("\n=== Final Balances ===");

  const [
    rewardVault,
    marketingVault,
    teamVestingVault
  ] = await Promise.all([
    taxVault.rewardVault(),
    taxVault.marketingVault(),
    taxVault.teamVestingVault()
  ]);

  const rewardMmm = await mmm.balanceOf(rewardVault);
  const mktUsdc   = await usdc.balanceOf(marketingVault);
  const teamUsdc  = await usdc.balanceOf(teamVestingVault);
  const finalMmm  = await mmm.balanceOf(tvAddr);
  const finalUsdc = await usdc.balanceOf(tvAddr);

  console.log("RewardVault MMM: ", ethers.formatUnits(rewardMmm, 18));
  console.log("Marketing USDC:  ", ethers.formatUnits(mktUsdc, 6));
  console.log("TeamVesting USDC:", ethers.formatUnits(teamUsdc, 6));
  console.log("TaxVault MMM:    ", ethers.formatUnits(finalMmm, 18));
  console.log("TaxVault USDC:   ", ethers.formatUnits(finalUsdc, 6));

  console.log("\n✓✓✓ TEST COMPLETE ✓✓✓");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
