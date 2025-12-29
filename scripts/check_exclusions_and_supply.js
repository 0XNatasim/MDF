const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function fmt18(x) {
  return Number(hre.ethers.formatUnits(x, 18)).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

async function main() {
  const net = hre.network.name;

  const mmmPath  = path.join("deployments", `mmm.${net}.json`);
  const pairPath = path.join("deployments", `pair.${net}.json`);
  const rtPath   = path.join("deployments", `rewardTracker.${net}.json`);
  const routerPath = path.join("deployments", `router.${net}.json`); // if you save it

  if (!fs.existsSync(mmmPath)) throw new Error("MMM deployment not found");
  if (!fs.existsSync(pairPath)) throw new Error("PAIR deployment not found");
  if (!fs.existsSync(rtPath)) throw new Error("RewardTracker deployment not found");

  const { mmm } = readJson(mmmPath);
  const { pair } = readJson(pairPath);
  const { rewardTracker } = readJson(rtPath);

  let router = null;
  if (fs.existsSync(routerPath)) {
    const r = readJson(routerPath);
    router = r.router || r.UniswapV2Router02 || r.patchedRouter || null;
  }

  const MMM = await hre.ethers.getContractAt("MMM", mmm);
  const Tracker = await hre.ethers.getContractAt("SnapshotRewardTrackerMon", rewardTracker);

  const wmon = await MMM.wmon();
  const routerInMMM = await MMM.router();

  const totalSupply = await MMM.totalSupply();
  const eligibleSupply = await Tracker.eligibleSupply();

  const addresses = [
    ["MMM Token", mmm],
    ["PAIR", pair],
    ["RewardTracker", rewardTracker],
    ["Router (MMM.router())", routerInMMM],
    ["WMON (MMM.wmon())", wmon],
  ];

  if (router) addresses.push(["Router (deployments/router.*.json)", router]);

  console.log("Network:", net);
  console.log("---- Addresses ----");
  for (const [label, addr] of addresses) console.log(label + ":", addr);

  console.log("\n---- Exclusion status (Tracker.isExcludedFromRewards) ----");
  for (const [label, addr] of addresses) {
    const ex = await Tracker.isExcludedFromRewards(addr);
    console.log(`${label}: ${ex}`);
  }

  console.log("\n---- Balances ----");
  // balances in MMM for each address
  for (const [label, addr] of addresses) {
    const bal = await MMM.balanceOf(addr);
    console.log(`${label} MMM balance: ${fmt18(bal)} MMM`);
  }

  const taxTokens = await MMM.taxTokens?.().catch(() => null);
  if (taxTokens !== null) {
    console.log("\nMMM.taxTokens():", fmt18(taxTokens), "MMM");
  } else {
    console.log("\nMMM.taxTokens(): (not available in ABI)");
  }

  console.log("\n---- Supply sanity ----");
  console.log("MMM.totalSupply():", fmt18(totalSupply), "MMM");
  console.log("Tracker.eligibleSupply():", fmt18(eligibleSupply), "MMM");

  // Compute expected eligible supply = totalSupply - balances(excluded addresses)
  // NOTE: If you exclude additional wallets, add them here.
  const excludedCandidates = [
    ["MMM Token", mmm],
    ["PAIR", pair],
    ["RewardTracker", rewardTracker],
  ];

  let excludedSum = 0n;
  for (const [, addr] of excludedCandidates) {
    const ex = await Tracker.isExcludedFromRewards(addr);
    if (ex) excludedSum += await MMM.balanceOf(addr);
  }

  const expected = totalSupply - excludedSum;
  console.log("Excluded-sum (MMM+PAIR+Tracker if excluded):", fmt18(excludedSum), "MMM");
  console.log("Expected eligibleSupply (approx):", fmt18(expected), "MMM");
  console.log("Delta (eligible - expected):", fmt18(eligibleSupply - expected), "MMM");

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
