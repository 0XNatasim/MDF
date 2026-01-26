// scripts/check-withdrawable.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  const [user] = await ethers.getSigners();
  console.log("Checking rewards for:", user.address);

  const TRACKER_ADDR = "0xD1c7AFF5D89363eFaC6Fa40d7D534f39Efc2cEc6";

  const tracker = await ethers.getContractAt("SnapshotDividendTrackerMon", TRACKER_ADDR);

  const amount = await tracker.withdrawable(user.address);
  console.log("Withdrawable MON:", ethers.formatEther(amount), "MON");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
