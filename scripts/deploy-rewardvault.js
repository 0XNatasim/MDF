// scripts/deploy-rewardvault.js
const hre = require("hardhat");
const { ethers } = hre;

function mustEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

async function main() {
  const MMMToken = mustEnv("MMMToken");
  const TaxVault = mustEnv("TaxVault");

  // You control these numbers. Match what you expect your v1 should be.
  // Your chain shows claimCooldown = 43200 already (12h).
  const MIN_HOLD_SEC = 12 * 60 * 60; // 12h (example) - set to your intended v1 value
  const COOLDOWN_SEC = 12 * 60 * 60; // 12h
  const MIN_BALANCE  = ethers.parseUnits("1", 18); // 1 MMM

  const [deployer] = await ethers.getSigners();

  console.log("=== Deploy RewardVault (monadTestnet) ===");
  console.log("Deployer:", deployer.address);
  console.log("MMMToken :", MMMToken);
  console.log("TaxVault :", TaxVault);
  console.log("Params  : minHold=", MIN_HOLD_SEC, " cooldown=", COOLDOWN_SEC, " minBal=", MIN_BALANCE.toString());
  console.log("");

  const RewardVault = await ethers.getContractFactory("RewardVault");
  const rv = await RewardVault.deploy(
    MMMToken,
    TaxVault,
    MIN_HOLD_SEC,
    COOLDOWN_SEC,
    MIN_BALANCE,
    deployer.address
  );

  await rv.waitForDeployment();
  const addr = await rv.getAddress();

  console.log("RewardVault deployed at:", addr);

  // --- Sanity checks: these MUST NOT revert ---
  console.log("\n[Sanity]");
  console.log("rv.mmm()           :", await rv.mmm());
  console.log("rv.taxVault()      :", await rv.taxVault());
  console.log("rv.minHoldTimeSec():", (await rv.minHoldTimeSec()).toString());
  console.log("rv.claimCooldown() :", (await rv.claimCooldown()).toString());
  console.log("rv.minBalance()    :", (await rv.minBalance()).toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
