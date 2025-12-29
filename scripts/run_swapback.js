const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const net = hre.network.name;

  const mmmPath = path.join("deployments", `mmm.${net}.json`);
  const rtPath = path.join("deployments", `rewardTracker.${net}.json`);

  if (!fs.existsSync(mmmPath)) throw new Error(`Missing ${mmmPath}`);
  if (!fs.existsSync(rtPath)) throw new Error(`Missing ${rtPath}`);

  const { mmm } = readJson(mmmPath);
  const { rewardTracker } = readJson(rtPath);

  const [signer] = await hre.ethers.getSigners();

  // IMPORTANT: pull ABI from artifact directly
  const mmmArtifact = await hre.artifacts.readArtifact("MMM");
  const mmmC = new hre.ethers.Contract(mmm, mmmArtifact.abi, signer);

  const trackerBalBefore = await hre.ethers.provider.getBalance(rewardTracker);
  const taxBefore = await mmmC.taxTokens();

  console.log("MMM:", mmm);
  console.log("Tracker:", rewardTracker);
  console.log("taxTokens BEFORE:", taxBefore.toString());
  console.log("Tracker MON BEFORE:", hre.ethers.formatEther(trackerBalBefore));

  if (taxBefore === 0n) {
    console.log("No taxTokens to swap. Do a taxed trade first (sell) then rerun swapback.");
    return;
  }

  // Estimate + buffer
  const est = await mmmC.swapTaxForRewards.estimateGas(0);
  const gasLimit = (est * 130n) / 100n;

  console.log("Estimated gas:", est.toString());
  console.log("Using gasLimit:", gasLimit.toString());

  const tx = await mmmC.swapTaxForRewards(0, { gasLimit });
  console.log("tx:", tx.hash);
  await tx.wait();

  const trackerBalAfter = await hre.ethers.provider.getBalance(rewardTracker);
  const taxAfter = await mmmC.taxTokens();

  console.log("taxTokens AFTER:", taxAfter.toString());
  console.log("Tracker MON AFTER:", hre.ethers.formatEther(trackerBalAfter));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
