// scripts/test-00-init-taxvault-router.js
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

  console.log("=== TEST 00: Init TaxVault Router + Approval ===");

  const [owner] = await ethers.getSigners();

  const manifest = loadManifest();
  const { MMM, ROUTER, TAX_VAULT } = manifest.contracts;

  console.log("Network:", hre.network.name);
  console.log("TaxVault:", TAX_VAULT);
  console.log("Router  :", ROUTER);
  console.log("MMM     :", MMM);

  const taxVault = await ethers.getContractAt("TaxVault", TAX_VAULT, owner);
  const mmm      = await ethers.getContractAt("IERC20", MMM);

  /* -----------------------------------------------------------
     1) Ensure router is set
  ------------------------------------------------------------ */

  const currentRouter = await taxVault.router();

  if (currentRouter.toLowerCase() !== ROUTER.toLowerCase()) {
    console.log("Setting router...");
    await (await taxVault.setRouter(ROUTER)).wait();
    console.log("✓ Router set");
  } else {
    console.log("✓ Router already set");
  }

  /* -----------------------------------------------------------
     2) Ensure router is approved
  ------------------------------------------------------------ */

  const allowance = await mmm.allowance(TAX_VAULT, ROUTER);

  if (allowance === 0n) {
    console.log("Approving router to spend MMM...");
    await (await taxVault.approveRouter()).wait();
    console.log("✓ Router approved");
  } else {
    console.log("✓ Router already approved");
  }

  /* -----------------------------------------------------------
     3) Final sanity check
  ------------------------------------------------------------ */

  const finalAllowance = await mmm.allowance(TAX_VAULT, ROUTER);

  console.log("Final MMM allowance:", finalAllowance.toString());

  if (finalAllowance === 0n) {
    throw new Error("❌ Approval failed");
  }

  console.log("=== TEST 00 COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
