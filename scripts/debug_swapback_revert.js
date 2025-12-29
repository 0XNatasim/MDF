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
  const routerPath = path.join("deployments", `router_patched.${net}.json`);
  const wmonPath = path.join("deployments", `wmon.${net}.json`);
  const pairPath = path.join("deployments", `pair.${net}.json`);

  const { mmm } = readJson(mmmPath);
  const { rewardTracker } = readJson(rtPath);
  const { router } = readJson(routerPath);
  const { wmon } = readJson(wmonPath);
  const { pair } = readJson(pairPath);

  const [owner] = await hre.ethers.getSigners();

  const mmmAbi = (await hre.artifacts.readArtifact("MMM")).abi;
  const mmmC = new hre.ethers.Contract(mmm, mmmAbi, owner);

  console.log("MMM:", mmm);
  console.log("Router(patched):", router);
  console.log("WMON:", wmon);
  console.log("PAIR:", pair);
  console.log("Tracker:", rewardTracker);

  const tax = await mmmC.taxTokens();
  console.log("taxTokens:", tax.toString());

  // Basic sanity
  console.log("mmm.router():", await mmmC.router());
  console.log("mmm.wmon():", await mmmC.wmon());
  console.log("mmm.rewardTracker():", await mmmC.rewardTracker());

  // Check balances / allowance MMM -> router
  const mmmbal = await mmmC.balanceOf(mmm);
  console.log("MMM contract MMM balance:", mmmbal.toString());

  // If your MMM has a public swapping flag, print it; if not, skip
  // (optional) console.log("swapping():", await mmmC.swapping());

  // 1) Static call swapTaxForRewards to extract revert (does not spend gas)
  console.log("\nStatic calling swapTaxForRewards(0) to capture revert reason...");
  try {
    await mmmC.swapTaxForRewards.staticCall(0);
    console.log("staticCall OK (unexpected) - should now send tx");
  } catch (e) {
    console.log("staticCall reverted.");
    console.log("shortMessage:", e.shortMessage || "");
    console.log("reason:", e.reason || "");
    console.log("data:", e.data || "");
    // If node provides errorName / args
    console.log("errorName:", e.errorName || "");
    console.log("errorArgs:", e.errorArgs || "");
    return;
  }

  // 2) If staticCall succeeds, estimate gas
  console.log("\nEstimating gas...");
  const est = await mmmC.swapTaxForRewards.estimateGas(0);
  console.log("estimateGas:", est.toString());

  // 3) Send with buffer
  const gasLimit = (est * 130n) / 100n;
  const tx = await mmmC.swapTaxForRewards(0, { gasLimit });
  console.log("tx:", tx.hash);
  await tx.wait();
  console.log("swapback tx confirmed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
