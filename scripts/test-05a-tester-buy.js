// scripts/test-05a-tester-buy.js
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

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

async function main() {

  console.log("\n=== TEST 05A: Tester Buy MMM (Direct Transfer) ===\n");

  const [deployer, tester] = await ethers.getSigners();
  const manifest = loadManifest();

  const {
    MMM,
    REWARD_VAULT
  } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM, deployer);
  const rewardVault = await ethers.getContractAt("RewardVault", REWARD_VAULT, tester);

  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployer.address);
  console.log("Tester:", tester.address);
  console.log("");

  const BUY_AMOUNT = "100"; // deterministic for tests
  const buyAmountWei = ethers.parseUnits(BUY_AMOUNT, 18);

  /* ===================================================== */
  /* 1. Safety check                                      */
  /* ===================================================== */

  const deployerBalance = await mmm.balanceOf(deployer.address);

  if (deployerBalance < buyAmountWei) {
    throw new Error(
      `Deployer insufficient MMM. Need ${BUY_AMOUNT}, have ${ethers.formatUnits(deployerBalance, 18)}`
    );
  }

  /* ===================================================== */
  /* 2. Transfer (simulated buy)                          */
  /* ===================================================== */

  console.log(`Transferring ${BUY_AMOUNT} MMM → tester...\n`);

  const tx = await mmm.transfer(tester.address, buyAmountWei);
  await tx.wait();

  console.log("✓ Transfer complete");

  /* ===================================================== */
  /* 3. Status after transfer                             */
  /* ===================================================== */

  const [
    testerBalance,
    pending,
    lastNonZeroAt,
    minHoldTime
  ] = await Promise.all([
    mmm.balanceOf(tester.address),
    rewardVault.pending(tester.address),
    mmm.lastNonZeroAt(tester.address),
    rewardVault.minHoldTimeSec()
  ]);

  const holdEnd = Number(lastNonZeroAt) + Number(minHoldTime);

  console.log("\n--- Post Buy Status ---\n");
  console.log("MMM Balance:", ethers.formatUnits(testerBalance, 18));
  console.log("Pending Rewards:", ethers.formatUnits(pending, 18));
  console.log("Hold Started:", new Date(Number(lastNonZeroAt) * 1000).toLocaleString());
  console.log("Can Claim At:", new Date(holdEnd * 1000).toLocaleString());
  console.log("Hold Duration:", formatTime(Number(minHoldTime)));
  console.log("");

  console.log("=== TEST 05A COMPLETE ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
