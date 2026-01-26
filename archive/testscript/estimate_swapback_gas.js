const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const net = hre.network.name;

  const mmmPath = path.join("deployments", `mmm.${net}.json`);
  if (!fs.existsSync(mmmPath)) throw new Error(`Missing ${mmmPath}`);

  const { mmm } = readJson(mmmPath);
  const mmmC = await hre.ethers.getContractAt("MMM", mmm);

  const latest = await hre.ethers.provider.getBlock("latest");
  console.log("Latest block gasLimit:", latest.gasLimit.toString());

  const tax = await mmmC.taxTokens();
  console.log("taxTokens:", tax.toString());

  try {
    const est = await mmmC.swapTaxForRewards.estimateGas(0);
    console.log("estimateGas swapTaxForRewards(0):", est.toString());
  } catch (e) {
    console.log("estimateGas failed:", e.shortMessage || e.message);
  }

  // Try staticCall to capture a revert reason if it exists (won't help for OOG)
  try {
    await mmmC.swapTaxForRewards.staticCall(0, { gasLimit: 20_000_000 });
    console.log("staticCall: OK");
  } catch (e) {
    console.log("staticCall reverted:", e.shortMessage || e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
