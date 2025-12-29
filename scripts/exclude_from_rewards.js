// scripts\exclude_from_rewards.js
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const net = hre.network.name;

  const mmmPath   = path.join("deployments", `mmm.${net}.json`);
  const pairPath  = path.join("deployments", `pair.${net}.json`);
  const rtPath    = path.join("deployments", `rewardTracker.${net}.json`);

  if (!fs.existsSync(mmmPath))  throw new Error("MMM not found");
  if (!fs.existsSync(pairPath)) throw new Error("PAIR not found");
  if (!fs.existsSync(rtPath))   throw new Error("RewardTracker not found");

  const { mmm }  = readJson(mmmPath);
  const { pair } = readJson(pairPath);
  const { rewardTracker } = readJson(rtPath);

  console.log("MMM:", mmm);
  console.log("PAIR:", pair);
  console.log("Tracker:", rewardTracker);

  const tracker = await hre.ethers.getContractAt(
    "SnapshotRewardTrackerMon",
    rewardTracker
  );

  console.log("Excluding MMM...");
  await (await tracker.excludeFromRewards(mmm, true)).wait();

  console.log("Excluding PAIR...");
  await (await tracker.excludeFromRewards(pair, true)).wait();

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
