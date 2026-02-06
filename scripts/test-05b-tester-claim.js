// scripts/test-05b-tester-claim.js
const hre = require("hardhat");
const { ethers } = hre;

/**
 * TEST 05b — Tester claims rewards from RewardVault
 * Preconditions:
 *  - minBalance met
 *  - hold time elapsed
 *  - cooldown elapsed
 *  - pending > 0
 */

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

async function main() {
  console.log("\n=== TEST 05b: TESTER CLAIM ===\n");

  /* ---------------------------------------------
     Setup
  --------------------------------------------- */
  const provider = new ethers.JsonRpcProvider(
    hre.network.config.url
  );

  const tester = new ethers.Wallet(
    process.env.TESTER_PRIVATE_KEY,
    provider
  );

  const MMM = await ethers.getContractAt(
    "MMMToken",
    process.env.TESTNET_MMM,
    provider
  );

  const RV = await ethers.getContractAt(
    "RewardVault",
    process.env.TESTNET_REWARDVAULT,
    tester
  );

  console.log("Tester:", tester.address, "\n");

  /* ---------------------------------------------
     Read on-chain state
  --------------------------------------------- */
  const [
    mmmBalRaw,
    pendingRaw,
    lastClaimRaw,
    minHoldRaw,
    cooldownRaw,
    minBalanceRaw,
  ] = await Promise.all([
    MMM.balanceOf(tester.address),
    RV.pending(tester.address),
    RV.lastClaimAt(tester.address),
    RV.minHoldTimeSec(),
    RV.claimCooldown(),
    RV.minBalance(),
  ]);

  const now = Math.floor(Date.now() / 1000);

  const mmmBal = Number(ethers.formatEther(mmmBalRaw));
  const pending = pendingRaw;
  const lastClaimAt = Number(lastClaimRaw);
  const minHoldSec = Number(minHoldRaw);
  const cooldownSec = Number(cooldownRaw);
  const minBalance = Number(ethers.formatEther(minBalanceRaw));

  console.log("📊 STATUS");
  console.log(`MMM balance : ${mmmBal} MMM`);
  console.log(`Pending     : ${ethers.formatEther(pending)} MON`);
  console.log(`Last claim  : ${lastClaimAt > 0 ? new Date(lastClaimAt * 1000).toLocaleString() : "Never"}`);
  console.log("");

  /* ---------------------------------------------
     Eligibility checks
  --------------------------------------------- */

  // HOLD: only applies before first claim
  let holdRemaining = 0;
  if (lastClaimAt === 0 && minHoldSec > 0) {
    holdRemaining = minHoldSec;
  }

  // COOLDOWN
  let cooldownRemaining = 0;
  if (lastClaimAt > 0) {
    cooldownRemaining = Math.max(
      0,
      lastClaimAt + cooldownSec - now
    );
  }

  console.log("⏱️  ELIGIBILITY");
  console.log(
    `Hold     : ${
      holdRemaining === 0 ? "✅ OK" : `❌ ${formatTime(holdRemaining)} remaining`
    }`
  );
  console.log(
    `Cooldown : ${
      cooldownRemaining === 0 ? "✅ OK" : `❌ ${formatTime(cooldownRemaining)} remaining`
    }`
  );
  console.log(
    `Min bal  : ${
      mmmBal >= minBalance ? "✅ OK" : `❌ Need ${minBalance} MMM`
    }`
  );
  console.log("");

  if (mmmBal < minBalance) {
    console.log("❌ Cannot claim: insufficient MMM balance\n");
    process.exit(0);
  }

  if (pending === 0n) {
    console.log("⚠️  Nothing to claim\n");
    process.exit(0);
  }

  if (holdRemaining > 0 || cooldownRemaining > 0) {
    const wait = Math.max(holdRemaining, cooldownRemaining);
    console.log(`❌ Not eligible yet. Wait ${formatTime(wait)}\n`);
    process.exit(0);
  }

  /* ---------------------------------------------
     Execute claim
  --------------------------------------------- */
  console.log("✅ ELIGIBLE — CLAIMING\n");

  const monBefore = await provider.getBalance(tester.address);

  const tx = await RV.claim({ gasLimit: 300000n });
  console.log("Tx:", tx.hash);

  const receipt = await tx.wait();

  const monAfter = await provider.getBalance(tester.address);
  const gasCost = receipt.gasUsed * receipt.gasPrice;
  const net = monAfter - monBefore + gasCost;

  console.log("\n==================================");
  console.log("🎉 CLAIM COMPLETE");
  console.log(`MON gained : ${ethers.formatEther(net)} MON`);
  console.log(`Gas used  : ${ethers.formatEther(gasCost)} MON`);
  console.log("==================================\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
