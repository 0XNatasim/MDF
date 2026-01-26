const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const net = hre.network.name;
  const rtPath = path.join("deployments", `rewardTracker.${net}.json`);
  if (!fs.existsSync(rtPath)) throw new Error(`Missing ${rtPath}`);

  const { rewardTracker } = readJson(rtPath);

  const [owner] = await hre.ethers.getSigners();
  const abi = (await hre.artifacts.readArtifact("SnapshotRewardTrackerMon")).abi;
  const tracker = new hre.ethers.Contract(rewardTracker, abi, owner);

  console.log("Tracker:", rewardTracker);
  console.log("Current minClaimAmount:", hre.ethers.formatEther(await tracker.minClaimAmount()), "MON");

  // Set to 0 for testing
  const tx = await tracker.setMinClaimAmount(0);
  console.log("setMinClaimAmount tx:", tx.hash);
  await tx.wait();

  console.log("New minClaimAmount:", hre.ethers.formatEther(await tracker.minClaimAmount()), "MON");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
