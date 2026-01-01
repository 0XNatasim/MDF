const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const net = hre.network.name;

  const mmmPath = path.join("deployments", `mmm.${net}.json`);
  const rpPath  = path.join("deployments", `router_patched.${net}.json`);
  const wPath   = path.join("deployments", `wmon.${net}.json`);
  const rtPath  = path.join("deployments", `rewardTracker.${net}.json`);

  const { mmm } = readJson(mmmPath);
  const { router: patchedRouter } = readJson(rpPath);
  const { wmon } = readJson(wPath);
  const { rewardTracker } = readJson(rtPath);

  const mmmC = await hre.ethers.getContractAt("MMM", mmm);

  console.log("MMM:", mmm);
  console.log("MMM.router():", await mmmC.router());
  console.log("Patched router:", patchedRouter);
  console.log("MMM.wmon():", await mmmC.wmon());
  console.log("WMON deployed:", wmon);
  console.log("MMM.rewardTracker():", await mmmC.rewardTracker());
  console.log("Tracker deployed:", rewardTracker);
  console.log("MMM.taxTokens():", (await mmmC.taxTokens()).toString());

  // If router supports factory/WETH, print them
  try {
    const r = await hre.ethers.getContractAt("Router", patchedRouter);
    console.log("patched.router.factory():", await r.factory());
    console.log("patched.router.WETH():", await r.WETH());
  } catch (e) {
    console.log("Could not read patched router factory/WETH:", e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
