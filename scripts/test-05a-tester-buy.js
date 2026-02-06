// scripts/test-05a-tester-buy.js
const hre = require("hardhat");
const { ethers } = hre;

/**
 * Simple buy script: TESTER buys MMM
 * Works with MockRouter that mints tokens directly
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

async function main() {
  console.log("\n=== TESTER: Buy MMM (Direct Transfer) ===\n");

  // Setup
  const provider = new ethers.JsonRpcProvider(hre.network.config.url);
  const tester = new ethers.Wallet(process.env.TESTER_PRIVATE_KEY, provider);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const MMM = await ethers.getContractAt("MMMToken", process.env.TESTNET_MMM, deployer);
  const RewardVault = await ethers.getContractAt("RewardVault", process.env.TESTNET_REWARDVAULT, tester);

  console.log("Tester Wallet:", tester.address);
  console.log("Deployer Wallet:", deployer.address);

  // Buy amount
  const BUY_AMOUNT = process.env.BUY_AMOUNT || "100";
  const buyAmountWei = ethers.parseUnits(BUY_AMOUNT, 18);

  console.log(`\nTransfer Amount: ${BUY_AMOUNT} MMM\n`);

  // Check deployer balance
  const deployerBalance = await MMM.balanceOf(deployer.address);
  if (deployerBalance < buyAmountWei) {
    throw new Error(`Deployer has insufficient MMM. Need ${BUY_AMOUNT}, have ${ethers.formatUnits(deployerBalance, 18)}`);
  }

  /* =======================================================
     Execute Transfer (simulates buy)
  ======================================================= */
  console.log("Transferring MMM from deployer → tester...");
  console.log("(This simulates a buy and triggers hold timer)\n");

  const tx = await MMM.transfer(tester.address, buyAmountWei);
  console.log(`Tx: ${tx.hash}`);
  await tx.wait();
  console.log("✅ Transferred\n");

  /* =======================================================
     Show Status
  ======================================================= */
  const [mmmBalance, pending, lastNonZeroAt, minHoldTime] = await Promise.all([
    MMM.balanceOf(tester.address),
    RewardVault.pending(tester.address),
    MMM.lastNonZeroAt(tester.address),
    RewardVault.minHoldTimeSec(),
  ]);

  console.log("==========================================");
  console.log("✅ TRANSFER COMPLETE\n");
  console.log(`MMM Balance: ${ethers.formatUnits(mmmBalance, 18)} MMM`);
  console.log(`Pending Rewards: ${ethers.formatEther(pending)} MON`);
  console.log(`Hold Started: ${new Date(Number(lastNonZeroAt) * 1000).toLocaleString()}`);
  
  const canClaimAt = Number(lastNonZeroAt) + Number(minHoldTime);
  console.log(`Can Claim At: ${new Date(canClaimAt * 1000).toLocaleString()}`);
  console.log(`Wait Time: ${formatTime(Number(minHoldTime))}\n`);

  console.log("Next Steps:");
  console.log("1. Open UI and connect with TESTER wallet");
  console.log("2. Watch the hold timer count down");
  console.log("3. After timer expires, click Claim button");
  console.log("==========================================\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});