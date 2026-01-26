// scripts/fix-amm-pair.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;

  const MMM_ADDRESS = "0x08e3e7677DdBf2B4C7b45407e665E7726d4823dc";
  const POOL_ADDR = "0xaeA0fACAC4bf26465DF5C3a2d711375c44b42B5d"; // Your pool
  const ROUTER_ADDR = "0xfb8e1c3b833f9e67a71c859a132cf783b645e436";

  const [user] = await ethers.getSigners();
  console.log("Wallet:", user.address);

  // MMM ABI with needed functions
  const MMM_ABI = [
    "function owner() view returns (address)",
    "function setPair(address pair, bool enabled) external",
    "function ammPairs(address) view returns (bool)",
    "function setExcludedFromFees(address account, bool excluded) external",
    "function isExcludedFromFees(address) view returns (bool)",
    "function buyTaxBps() view returns (uint256)",
    "function sellTaxBps() view returns (uint256)",
    "function taxTokens() view returns (uint256)"
  ];

  const mmm = new ethers.Contract(MMM_ADDRESS, MMM_ABI, user);

  console.log("🔧 Setting AMM Pair for Tax Collection");
  console.log("=".repeat(50));

  // Check owner
  const owner = await mmm.owner();
  if (owner.toLowerCase() !== user.address.toLowerCase()) {
    console.log("❌ You are NOT the contract owner!");
    console.log("Only owner can set AMM pairs.");
    return;
  }
  console.log("✅ You are the contract owner");

  // 1. Check current AMM pair status
  console.log("\n🔍 Checking current AMM pair status:");
  console.log("-".repeat(30));
  
  const isPair = await mmm.ammPairs(POOL_ADDR);
  console.log(`Pool (${POOL_ADDR}): ${isPair ? "✅ Already AMM pair" : "❌ NOT an AMM pair"}`);

  const isRouterExcluded = await mmm.isExcludedFromFees(ROUTER_ADDR);
  console.log(`Router excluded from fees: ${isRouterExcluded ? "✅ Yes" : "❌ No"}`);

  // 2. Set pool as AMM pair
  console.log("\n🔄 Setting pool as AMM pair...");
  if (!isPair) {
    try {
      const tx = await mmm.setPair(POOL_ADDR, true);
      console.log(`Setting pool as AMM pair... tx: ${tx.hash}`);
      await tx.wait();
      console.log("✅ Pool set as AMM pair!");
      
      // Verify
      const verified = await mmm.ammPairs(POOL_ADDR);
      console.log(`Verified: ${verified ? "✅ Success" : "❌ Failed"}`);
    } catch (error) {
      console.log("❌ Failed to set AMM pair:", error.message);
    }
  } else {
    console.log("✅ Pool already set as AMM pair");
  }

  // 3. Exclude router from fees (optional but recommended)
  console.log("\n🔄 Excluding router from fees...");
  if (!isRouterExcluded) {
    try {
      const tx = await mmm.setExcludedFromFees(ROUTER_ADDR, true);
      console.log(`Excluding router from fees... tx: ${tx.hash}`);
      await tx.wait();
      console.log("✅ Router excluded from fees!");
    } catch (error) {
      console.log("❌ Failed to exclude router:", error.message);
    }
  } else {
    console.log("✅ Router already excluded from fees");
  }

  // 4. Check tax settings
  console.log("\n📊 Tax Configuration:");
  console.log("-".repeat(30));
  
  try {
    const [buyTax, sellTax, taxPool] = await Promise.all([
      mmm.buyTaxBps(),
      mmm.sellTaxBps(),
      mmm.taxTokens()
    ]);
    
    console.log(`Buy Tax: ${buyTax / 100}% (${buyTax} bps)`);
    console.log(`Sell Tax: ${sellTax / 100}% (${sellTax} bps)`);
    console.log(`Accumulated Tax Pool: ${ethers.formatUnits(taxPool, 18)} MMM`);
    
    if (buyTax > 0 && sellTax > 0) {
      console.log("✅ Taxes are enabled");
    } else {
      console.log("⚠️  Warning: Taxes are set to 0%");
    }
  } catch (error) {
    console.log("Error reading tax settings:", error.message);
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ AMM Pair configuration complete!");
  console.log("\n🎯 Now test your buy again:");
  console.log("npx hardhat run scripts/buy-mmm-with-tax.js --network monadTestnet");
  console.log("\nThe tax should now be collected!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});