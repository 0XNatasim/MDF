const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const net = hre.network.name;

  const mmmPath = path.join("deployments", `mmm.${net}.json`);
  const rtPath  = path.join("deployments", `rewardTracker.${net}.json`);

  if (!fs.existsSync(mmmPath)) throw new Error(`Missing ${mmmPath}`);
  if (!fs.existsSync(rtPath)) throw new Error(`Missing ${rtPath}`);

  const { mmm } = readJson(mmmPath);
  const { rewardTracker } = readJson(rtPath);

  if (!process.env.TESTER_PRIVATE_KEY) {
    throw new Error("Missing TESTER_PRIVATE_KEY in .env");
  }

  const tester = new hre.ethers.Wallet(process.env.TESTER_PRIVATE_KEY, hre.ethers.provider);

  const mmmAbi = (await hre.artifacts.readArtifact("MMM")).abi;
  const trAbi  = (await hre.artifacts.readArtifact("SnapshotRewardTrackerMon")).abi;

  const mmmC = new hre.ethers.Contract(mmm, mmmAbi, tester);
  const trC  = new hre.ethers.Contract(rewardTracker, trAbi, tester);

  console.log("Network:", net);
  console.log("MMM:", mmm);
  console.log("Tracker:", rewardTracker);
  console.log("Tester:", tester.address);

  const testerMonBefore = await hre.ethers.provider.getBalance(tester.address);
  const trackerMonBefore = await hre.ethers.provider.getBalance(rewardTracker);
  console.log("Tester MON BEFORE:", hre.ethers.formatEther(testerMonBefore));
  console.log("Tracker MON BEFORE:", hre.ethers.formatEther(trackerMonBefore));

  const excluded = await trC.isExcludedFromRewards(tester.address);
  console.log("Tester excluded?:", excluded);

  const balMMM = await mmmC.balanceOf(tester.address);
  console.log("Tester MMM balance:", balMMM.toString());

  const earned = await trC.earned(tester.address);
  console.log("earned(tester):", hre.ethers.formatEther(earned), "MON");

  const minClaim = await trC.minClaimAmount();
  console.log("minClaimAmount:", hre.ethers.formatEther(minClaim), "MON");

  console.log("Calling claim()...");
  const tx = await trC.claim({ gasLimit: 500_000 });
  console.log("claim tx:", tx.hash);
  await tx.wait();

  const testerMonAfter = await hre.ethers.provider.getBalance(tester.address);
  const trackerMonAfter = await hre.ethers.provider.getBalance(rewardTracker);

  console.log("Tester MON AFTER:", hre.ethers.formatEther(testerMonAfter));
  console.log("Tracker MON AFTER:", hre.ethers.formatEther(trackerMonAfter));

  const earnedAfter = await trC.earned(tester.address);
  console.log("earned(tester) AFTER:", hre.ethers.formatEther(earnedAfter), "MON");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
