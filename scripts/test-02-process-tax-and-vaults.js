// scripts/test-02-process-tax-and-vaults.js
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

  console.log("=== TEST 02: Process Tax (MANIFEST VERSION) ===\n");

  const [deployer] = await ethers.getSigners();
  console.log("Caller:", deployer.address);
  console.log("Network:", hre.network.name);

  const manifest = loadManifest();
  const {
    MMM,
    TAX_VAULT,
    USDC,
    WMON,
    ROUTER
  } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM, deployer);
  const taxVault = await ethers.getContractAt("TaxVault", TAX_VAULT, deployer);
  const usdc = await ethers.getContractAt("MockERC20", USDC, deployer);
  const wmon = await ethers.getContractAt("MockERC20", WMON, deployer);
  const router = await ethers.getContractAt("MockRouter", ROUTER, deployer);

  console.log("TaxVault:", TAX_VAULT);
  console.log("Router:", ROUTER);

  /* ------------------------------------------------------------
     Verify Router owns USDC + WMON
  ------------------------------------------------------------ */

  console.log("\n=== Checking Router Ownership ===");

  const usdcOwner = await usdc.owner();
  const wmonOwner = await wmon.owner();

  if (usdcOwner.toLowerCase() !== ROUTER.toLowerCase()) {
    console.log("Transferring USDC ownership to Router...");
    await (await usdc.transferOwnership(ROUTER)).wait();
    console.log("✓ USDC ownership transferred");
  } else {
    console.log("✓ Router owns USDC");
  }

  if (wmonOwner.toLowerCase() !== ROUTER.toLowerCase()) {
    console.log("Transferring WMON ownership to Router...");
    await (await wmon.transferOwnership(ROUTER)).wait();
    console.log("✓ WMON ownership transferred");
  } else {
    console.log("✓ Router owns WMON");
  }

  /* ------------------------------------------------------------
     Pre-flight
  ------------------------------------------------------------ */

  console.log("\n=== Pre-flight Checks ===");

  const tvOwner = await taxVault.owner();
  if (tvOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error("❌ Caller is not TaxVault owner");
  }
  console.log("✓ Caller is TaxVault owner");

  const onChainRouter = await taxVault.router();
  if (onChainRouter === ethers.ZeroAddress) {
    console.log("Setting router...");
    await (await taxVault.setRouter(ROUTER)).wait();
    console.log("✓ Router set");
  } else {
    console.log("✓ Router already set");
  }

  const allowance = await mmm.allowance(TAX_VAULT, ROUTER);
  if (allowance === 0n) {
    console.log("Approving router...");
    await (await taxVault.approveRouter()).wait();
    console.log("✓ Router approved");
  } else {
    console.log("✓ Router already approved");
  }

  const [
    rewardVault,
    swapVault,
    marketingVault,
    teamVestingVault
  ] = await Promise.all([
    taxVault.rewardVault(),
    taxVault.swapVault(),
    taxVault.marketingVault(),
    taxVault.teamVestingVault()
  ]);

  if (
    rewardVault      === ethers.ZeroAddress ||
    swapVault        === ethers.ZeroAddress ||
    marketingVault   === ethers.ZeroAddress ||
    teamVestingVault === ethers.ZeroAddress
  ) {
    throw new Error("❌ TaxVault not fully wired");
  }

  console.log("✓ All vaults wired");

  const processingEnabled = await taxVault.processingEnabled();
  if (!processingEnabled) {
    throw new Error("❌ Processing disabled");
  }

  console.log("✓ Processing enabled");

  /* ------------------------------------------------------------
     Tax Balance
  ------------------------------------------------------------ */

  const taxBal = await mmm.balanceOf(TAX_VAULT);
  console.log("\nTaxVault MMM before:", ethers.formatUnits(taxBal, 18));

  if (taxBal === 0n) {
    throw new Error("❌ No MMM in TaxVault – run test-01 first");
  }

  /* ------------------------------------------------------------
     PROCESS
  ------------------------------------------------------------ */

  const deadline = Math.floor(Date.now() / 1000) + 600;

  console.log("\nCalling TaxVault.process()...");

  const tx = await taxVault.process(
    taxBal,
    0,
    deadline,
    { gasLimit: 1_000_000 }
  );

  const receipt = await tx.wait();
  console.log("✓ process() executed:", receipt.hash);

  /* ------------------------------------------------------------
     Post balances
  ------------------------------------------------------------ */

  const logBal = async (label, token, addr, decimals = 18) => {
    const bal = await token.balanceOf(addr);
    console.log(`${label}: ${ethers.formatUnits(bal, decimals)}`);
  };

  console.log("\n--- Vault balances after ---");

  await logBal("RewardVault MMM",  mmm,  rewardVault);
  await logBal("Marketing USDC",   usdc, marketingVault,   6);
  await logBal("TeamVesting USDC", usdc, teamVestingVault, 6);

  const finalMmm  = await mmm.balanceOf(TAX_VAULT);
  const finalUsdc = await usdc.balanceOf(TAX_VAULT);

  console.log("\nTaxVault MMM remaining :", ethers.formatUnits(finalMmm, 18));
  console.log("TaxVault USDC remaining:", ethers.formatUnits(finalUsdc, 6));

  console.log("\n=== TEST 02 COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
