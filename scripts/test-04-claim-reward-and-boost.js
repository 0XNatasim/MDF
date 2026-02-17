// scripts/test-04-claim-reward-and-boost.js
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

  console.log("=== TEST 04: Claim Reward + Boost ===\n");

  const provider = ethers.provider;
  const [ , user ] = await ethers.getSigners(); // second signer = test user

  const manifest = loadManifest();
  const {
    MMM,
    REWARD_VAULT,
    USDC
  } = manifest.contracts;

  const mmm         = await ethers.getContractAt("MMMToken", MMM, user);
  const rewardVault = await ethers.getContractAt("RewardVault", REWARD_VAULT, user);
  const usdc        = await ethers.getContractAt("MockERC20", USDC, user);

  console.log("Network:", hre.network.name);
  console.log("User:", user.address);

  /* -------------------------------------------------- */
  /* 1. Check pending reward                           */
  /* -------------------------------------------------- */

  const pending = await rewardVault.pending(user.address);
  console.log("Pending MMM reward:", ethers.formatUnits(pending, 18));

  if (pending === 0n) {
    console.log("❌ No rewards pending.");
    console.log("Possible reasons:");
    console.log("- Hold time not met");
    console.log("- process() not executed");
    console.log("- No emission notified");
    return;
  }

  /* -------------------------------------------------- */
  /* 2. Claim                                          */
  /* -------------------------------------------------- */

  const beforeMMM  = await mmm.balanceOf(user.address);
  const beforeUSDC = await usdc.balanceOf(user.address);

  try {
    const tx = await rewardVault.claim();
    await tx.wait();
    console.log("✓ Reward claimed");
  } catch (err) {
    console.log("❌ Claim reverted:", err.shortMessage || err.message);
    return;
  }

  /* -------------------------------------------------- */
  /* 3. Verify balances                                */
  /* -------------------------------------------------- */

  const afterMMM  = await mmm.balanceOf(user.address);
  const afterUSDC = await usdc.balanceOf(user.address);

  const gainedMMM  = afterMMM  - beforeMMM;
  const gainedUSDC = afterUSDC - beforeUSDC;

  console.log("MMM gained:", ethers.formatUnits(gainedMMM, 18));
  console.log("USDC boost gained:", ethers.formatUnits(gainedUSDC, 6));

  console.log("\n=== TEST 04 COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
