// scripts/status_tester_rewards.js
// Prints tester's MMM balance and claimable MON (earned), plus tracker health stats.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function readDeployment(name, networkName) {
  // tries deployments/<name>.<network>.json
  const p = path.join(__dirname, "..", "deployments", `${name}.${networkName}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const networkName = hre.network.name; // e.g. monadTestnet
  const [signer] = await hre.ethers.getSigners();

  // Prefer deployments files if you have them; otherwise fall back to env vars.
  const mmmDep = readDeployment("mmm", networkName);
  const trDep = readDeployment("rewardTracker", networkName);
  const pairDep = readDeployment("pair", networkName);
  const wmonDep = readDeployment("wmon", networkName);
  const facDep = readDeployment("factory", networkName);
  const rPatchedDep = readDeployment("router_patched", networkName);

  const MMM = process.env.MMM || (mmmDep && (mmmDep.address || mmmDep.MMM)) || "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16";
  const TRACKER = process.env.REWARD_TRACKER || (trDep && (trDep.address || trDep.rewardTracker)) || "0x5B870DAa512DB9DADEbD53d55045BAE798B4B86B";
  const TESTER = process.env.TESTER || "0x22BC7a72000faE48a67520c056C0944d9a675412";

  console.log("Network:", networkName);
  console.log("Signer:", await signer.getAddress());
  console.log("MMM:", MMM);
  console.log("Tracker:", TRACKER);
  console.log("Tester:", TESTER);

  if (wmonDep?.address) console.log("WMON:", wmonDep.address);
  if (facDep?.address) console.log("Factory:", facDep.address);
  if (rPatchedDep?.address) console.log("PatchedRouter:", rPatchedDep.address);
  if (pairDep?.address) console.log("Pair:", pairDep.address);

  // Minimal ABIs (we only call view methods)
  const MMM_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function rewardTracker() view returns (address)",
    "function router() view returns (address)",
    "function wmon() view returns (address)",
  ];

  const TRACKER_ABI = [
    "function earned(address) view returns (uint256)",
    "function withdrawable(address) view returns (uint256)",
    "function eligibleSupply() view returns (uint256)",
    "function rewardPerTokenStored() view returns (uint256)",
    "function minClaimAmount() view returns (uint256)",
    "function isExcludedFromRewards(address) view returns (bool)",
  ];

  const mmm = await hre.ethers.getContractAt(MMM_ABI, MMM);
  const tr = await hre.ethers.getContractAt(TRACKER_ABI, TRACKER);

  const [sym, dec] = await Promise.all([mmm.symbol(), mmm.decimals()]);
  const testerMMM = await mmm.balanceOf(TESTER);

  // earned/withdrawable should match in your tracker, but we print both
  const [earned, withdrawable] = await Promise.all([tr.earned(TESTER), tr.withdrawable(TESTER)]);

  const [testerExcluded, minClaim, eligSupply, rpt] = await Promise.all([
    tr.isExcludedFromRewards(TESTER),
    tr.minClaimAmount(),
    tr.eligibleSupply(),
    tr.rewardPerTokenStored(),
  ]);

  const trackerBal = await hre.ethers.provider.getBalance(TRACKER);
  const testerMon = await hre.ethers.provider.getBalance(TESTER);

  console.log("\n--- Tester balances ---");
  console.log(`Tester MON:      ${hre.ethers.formatEther(testerMon)} MON`);
  console.log(`Tester ${sym}:   ${hre.ethers.formatUnits(testerMMM, dec)} ${sym}`);
  console.log(`Tester excluded: ${testerExcluded}`);

  console.log("\n--- Claimable ---");
  console.log(`earned(tester):      ${hre.ethers.formatEther(earned)} MON`);
  console.log(`withdrawable(tester):${hre.ethers.formatEther(withdrawable)} MON`);
  console.log(`minClaimAmount:      ${hre.ethers.formatEther(minClaim)} MON`);

  console.log("\n--- Tracker stats ---");
  console.log(`Tracker MON balance: ${hre.ethers.formatEther(trackerBal)} MON`);
  console.log(`eligibleSupply:      ${hre.ethers.formatUnits(eligSupply, dec)} ${sym}`);
  console.log(`rewardPerTokenStored:${rpt.toString()} (scaled 1e18)`);

  // Quick “should I claim?” helper
  if (earned === 0n) {
    console.log("\nDecision: earned is 0 -> do NOT claim.");
  } else if (earned < minClaim) {
    console.log("\nDecision: earned < minClaimAmount -> do NOT claim.");
  } else {
    console.log("\nDecision: eligible to claim (but still consider gas vs reward).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


// npx hardhat run scripts/status_tester_rewards.js --network monadTestnet
