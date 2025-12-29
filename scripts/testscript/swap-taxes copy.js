// scripts/test-tax-swap.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  
  const MMM_ADDRESS = "0x27Badfbd4836d392E1E87487C0EE22A1E90dC096";
  const TRACKER_ADDRESS = "0xA926654269071F92c20e0D6D4DAC8A9D1d675854";
  
  const [user] = await ethers.getSigners();
  
  const mmm = new ethers.Contract(MMM_ADDRESS, [
    "function taxTokens() view returns (uint256)",
    "function swapTaxForRewards(uint256)",
    "function rewardTracker() view returns (address)"
  ], user);
  
  console.log("🔄 Testing Tax Swap to Rewards");
  console.log("=".repeat(50));
  
  const taxPool = await mmm.taxTokens();
  const tracker = await mmm.rewardTracker();
  
  console.log(`Current tax pool: ${ethers.formatUnits(taxPool, 18)} MMM`);
  console.log(`Reward tracker: ${tracker}`);
  console.log(`Expected tracker: ${TRACKER_ADDRESS}`);
  
  if (taxPool === 0n) {
    console.log("❌ No tax tokens to swap");
    return;
  }
  
  // Get tracker balance before
  const trackerBalanceBefore = await ethers.provider.getBalance(TRACKER_ADDRESS);
  
  console.log(`\n🔄 Swapping tax tokens to MON rewards...`);
  const swapTx = await mmm.swapTaxForRewards(0); // 0 = swap all
  await swapTx.wait();
  console.log(`Swap tx: ${swapTx.hash}`);
  
  // Get tracker balance after
  const trackerBalanceAfter = await ethers.provider.getBalance(TRACKER_ADDRESS);
  const monReceived = trackerBalanceAfter - trackerBalanceBefore;
  
  console.log(`\n📊 Results:`);
  console.log(`MON sent to tracker: ${ethers.formatEther(monReceived)} MON`);
  console.log(`New tracker balance: ${ethers.formatEther(trackerBalanceAfter)} MON`);
  
  if (monReceived > 0n) {
    console.log("✅ Tax swap successful!");
  } else {
    console.log("⚠️  No MON sent to tracker (swap might have failed or got 0 MON)");
  }
}

main();