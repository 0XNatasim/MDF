const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const net = hre.network.name;
  const [signer] = await hre.ethers.getSigners();

  const mmmPath   = path.join("deployments", `mmm.${net}.json`);
  const pairPath  = path.join("deployments", `pair.${net}.json`);
  const rtPath    = path.join("deployments", `rewardTracker.${net}.json`);

  if (!fs.existsSync(mmmPath))  throw new Error("MMM not found");
  if (!fs.existsSync(pairPath)) throw new Error("PAIR not found");
  if (!fs.existsSync(rtPath))   throw new Error("RewardTracker not found");

  const { mmm }  = readJson(mmmPath);
  const { pair } = readJson(pairPath);
  const { rewardTracker } = readJson(rtPath);

  const dev = signer.address;

  console.log("Network:", net);
  console.log("MMM:    ", mmm);
  console.log("PAIR:   ", pair);
  console.log("Tracker:", rewardTracker);
  console.log("DEV:    ", dev);

  const tracker = await hre.ethers.getContractAt(
    "SnapshotRewardTrackerMon",
    rewardTracker,
    signer
  );

  console.log("\nExcluding from rewards:");

  console.log("• MMM");
  await (await tracker.excludeFromRewards(mmm, true)).wait();

  console.log("• PAIR");
  await (await tracker.excludeFromRewards(pair, true)).wait();

  console.log("• DEV WALLET");
  await (await tracker.excludeFromRewards(dev, true)).wait();

  console.log("\n✅ All exclusions applied successfully.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
