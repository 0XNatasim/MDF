// scripts/claim-cli.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  const [user] = await ethers.getSigners();
  console.log("Claiming as:", user.address);

  const TRACKER_ADDR = "0xD1c7AFF5D89363eFaC6Fa40d7D534f39Efc2cEc6";

  const tracker = await ethers.getContractAt("SnapshotDividendTrackerMon", TRACKER_ADDR);

  const tx = await tracker.claim();
  console.log("Claim tx:", tx.hash);
  await tx.wait();

  console.log("Claim successful ✅");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
