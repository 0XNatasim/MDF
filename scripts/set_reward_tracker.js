const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const net = hre.network.name;

  const mmmPath = path.join("deployments", `mmm.${net}.json`);
  const tPath = path.join("deployments", `rewardTracker.${net}.json`);

  if (!fs.existsSync(mmmPath)) throw new Error(`Missing ${mmmPath}`);
  if (!fs.existsSync(tPath)) throw new Error(`Missing ${tPath}`);

  const { mmm } = readJson(mmmPath);
  const { rewardTracker } = readJson(tPath);

  console.log("MMM:", mmm);
  console.log("RewardTracker:", rewardTracker);

  const mmmC = await hre.ethers.getContractAt("MMM", mmm);
  const tx = await mmmC.setRewardTracker(rewardTracker);
  console.log("setRewardTracker tx:", tx.hash);
  await tx.wait();

  console.log("MMM rewardTracker is now:", await mmmC.rewardTracker());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
