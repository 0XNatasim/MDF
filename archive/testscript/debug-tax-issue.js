// scripts/debug-tax-issue.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  
  const MMM_ADDRESS = "0x27Badfbd4836d392E1E87487C0EE22A1E90dC096";
  const ROUTER_ADDR = "0xfb8e1c3b833f9e67a71c859a132cf783b645e436";
  const POOL_ADDRESS = "0x2B8dB008429b5320fb435289D4902c297Fb9f70e";
  
  const [user] = await ethers.getSigners();
  
  const mmm = new ethers.Contract(MMM_ADDRESS, [
    "function ammPairs(address) view returns (bool)",
    "function buyTaxBps() view returns (uint256)",
    "function sellTaxBps() view returns (uint256)",
    "function isExcludedFromFees(address) view returns (bool)",
    "function taxTokens() view returns (uint256)",
    "function router() view returns (address)",
    "function rewardTracker() view returns (address)"
  ], user);
  
  console.log("🔍 Debugging Tax Issue");
  console.log("=".repeat(50));
  
  const [
    isPair,
    buyTax,
    sellTax,
    isRouterExcluded,
    isUserExcluded,
    isPoolExcluded,
    taxPool,
    routerAddress,
    trackerAddress
  ] = await Promise.all([
    mmm.ammPairs(POOL_ADDRESS),
    mmm.buyTaxBps(),
    mmm.sellTaxBps(),
    mmm.isExcludedFromFees(ROUTER_ADDR),
    mmm.isExcludedFromFees(user.address),
    mmm.isExcludedFromFees(POOL_ADDRESS),
    mmm.taxTokens(),
    mmm.router(),
    mmm.rewardTracker()
  ]);
  
  console.log("\n📊 Contract Configuration:");
  console.log("-".repeat(30));
  console.log(`Pool is AMM pair: ${isPair ? "✅ Yes" : "❌ No"}`);
  console.log(`Buy Tax: ${Number(buyTax) / 100}% (${buyTax} bps)`);
  console.log(`Sell Tax: ${Number(sellTax) / 100}% (${sellTax} bps)`);
  console.log(`Router excluded: ${isRouterExcluded ? "✅ Yes" : "❌ No"}`);
  console.log(`Your wallet excluded: ${isUserExcluded ? "✅ Yes" : "❌ No"}`);
  console.log(`Pool excluded: ${isPoolExcluded ? "✅ Yes" : "❌ No"}`);
  console.log(`Tax pool: ${ethers.formatUnits(taxPool, 18)} MMM`);
  console.log(`Router address: ${routerAddress}`);
  console.log(`Tracker address: ${trackerAddress}`);
  
  // Check what addresses should be excluded
  console.log("\n🔧 Required Exclusions for Tax to Work:");
  console.log("-".repeat(30));
  console.log("1. Router MUST be excluded (for transfers to work)");
  console.log("2. Pool SHOULD NOT be excluded (to collect tax)");
  console.log("3. Your wallet SHOULD NOT be excluded (to test tax)");
  
  if (!isRouterExcluded) {
    console.log("\n❌ PROBLEM: Router is NOT excluded!");
    console.log("This will break tax collection because router transfers won't be taxed.");
    console.log("\nFix it:");
    console.log(`await mmm.setExcludedFromFees("${ROUTER_ADDR}", true);`);
  }
  
  if (isPoolExcluded) {
    console.log("\n❌ PROBLEM: Pool IS excluded!");
    console.log("Tax won't be collected on pool transfers.");
    console.log("\nFix it:");
    console.log(`await mmm.setExcludedFromFees("${POOL_ADDRESS}", false);`);
  }
  
  if (isUserExcluded) {
    console.log("\n⚠️  WARNING: Your wallet IS excluded!");
    console.log("You won't pay taxes for testing. Remove exclusion:");
    console.log(`await mmm.setExcludedFromFees("${user.address}", false);`);
  }
  
  // Let's trace what happens during a swap
  console.log("\n🔄 Understanding Swap Flow:");
  console.log("-".repeat(30));
  console.log("When you BUY MMM from pool:");
  console.log("1. User sends wMON to Router");
  console.log("2. Router sends wMON to Pool");
  console.log("3. Pool sends MMM to User");
  console.log("");
  console.log("Tax should apply when: Pool → User (buy)");
  console.log("From = Pool, To = User");
  console.log("isBuy = ammPairs[Pool] && !ammPairs[User] = true && false = true ✓");
  
  // Let's check the _update function logic
  console.log("\n🧠 Tax Logic Check:");
  console.log("-".repeat(30));
  console.log("In _update function:");
  console.log("if (isExcludedFromFees[from] || isExcludedFromFees[to]) {");
  console.log("  // NO TAX");
  console.log("}");
  console.log("");
  console.log(`From (Pool): ${POOL_ADDRESS}`);
  console.log(`To (User): ${user.address}`);
  console.log(`Pool excluded: ${isPoolExcluded ? "YES → NO TAX" : "NO → TAX POSSIBLE"}`);
  console.log(`User excluded: ${isUserExcluded ? "YES → NO TAX" : "NO → TAX POSSIBLE"}`);
}

main();