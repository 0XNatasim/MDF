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

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

async function main() {

  console.log("\n=== TEST 05: BUY MMM (SIMULATED) ===\n");

  const [owner, tester] = await ethers.getSigners();
  const manifest = loadManifest();

  const { MMM, REWARD_VAULT } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM, owner);
  const rv  = await ethers.getContractAt("RewardVault", REWARD_VAULT);

  const BUY_AMOUNT = ethers.parseUnits("100", 18);

  /* ===================================================== */
  /* 1. Simulate Buy (transfer from owner)                */
  /* ===================================================== */

  await (await mmm.transfer(tester.address, BUY_AMOUNT)).wait();
  console.log("✓ Simulated buy via direct transfer");

  /* ===================================================== */
  /* 2. Status                                            */
  /* ===================================================== */

  const [
    balance,
    pending,
    lastNonZeroAt,
    minHold
  ] = await Promise.all([
    mmm.balanceOf(tester.address),
    rv.pending(tester.address),
    mmm.lastNonZeroAt(tester.address),
    rv.minHoldTimeSec()
  ]);

  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const holdRemaining =
    Math.max(0, Number(lastNonZeroAt) + Number(minHold) - now);

  console.log("MMM Balance :", ethers.formatUnits(balance, 18));
  console.log("Pending     :", ethers.formatUnits(pending, 18));
  console.log("Hold Remain :", formatTime(holdRemaining));
  console.log("");

  console.log("=== TEST 05 PASSED ===\n");
}

main().catch(console.error);
