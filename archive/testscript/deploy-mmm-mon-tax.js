// scripts/deploy-mmm-mon-tax.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();

  console.log("Deployer:", deployer.address);

  // 🟣 Monad testnet router + wMON
  const ROUTER = "0xfb8e1c3b833f9e67a71c859a132cf783b645e436";      // UniswapV2-style router
  const WMON   = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";      // wMON on Monad testnet

  // 📦 Deploy MMM
  const MMM = await ethers.getContractFactory("MMM");
  const supply = ethers.parseUnits("1000000000", 18n); // 1B MMM with 18 decimals
  const mmm = await MMM.deploy(supply, ROUTER, WMON);
  await mmm.waitForDeployment();

  const mmmAddress = await mmm.getAddress();
  console.log("MMM deployed at:", mmmAddress);

  // 📦 Deploy snapshot tracker
  const Tracker = await ethers.getContractFactory("SnapshotDividendTrackerMon");
  const tracker = await Tracker.deploy(mmmAddress);
  await tracker.waitForDeployment();

  const trackerAddress = await tracker.getAddress();
  console.log("Snapshot tracker deployed at:", trackerAddress);

  // Wire tracker into MMM
  const tx = await mmm.setRewardTracker(trackerAddress);
  console.log("setRewardTracker tx:", tx.hash);
  await tx.wait();
  console.log("Reward tracker set in MMM ✅");

  console.log("\n==== SAVE THESE ====");
  console.log("MMM:", mmmAddress);
  console.log("Tracker:", trackerAddress);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
