// scripts/deploy-new-mmm-simple.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  
  // Configuration - UPDATE THESE BASED ON YOUR NEEDS
  const INITIAL_SUPPLY = ethers.parseEther("1000000000"); // 1B MMM
  const ROUTER_ADDRESS = "0xfb8e1c3b833f9e67a71c859a132cf783b645e436";
  const WMON_ADDRESS = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
  
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MON");
  
  console.log("\n🚀 Deploying MMM Ecosystem...");
  console.log("=".repeat(60));
  
  // Option A: Use your original MMM.sol and taxes.sol
  console.log("\n📦 Option A: Using your original contracts...");
  
  // 1. Deploy MMM Token (your original)
  console.log("\n1. Deploying MMM Token...");
  const MMM = await ethers.getContractFactory("MMM");
  const mmm = await MMM.deploy(
    INITIAL_SUPPLY,
    ROUTER_ADDRESS,
    WMON_ADDRESS
  );
  await mmm.waitForDeployment();
  const mmmAddress = await mmm.getAddress();
  console.log("✅ MMM deployed to:", mmmAddress);
  
  // 2. Deploy Reward Tracker (your taxes.sol - check the contract name)
  console.log("\n2. Deploying Reward Tracker...");
  
  // First, check what contract name is in taxes.sol
  // If it's called "SnapshotDividendTrackerMon", use that:
  try {
    const Tracker = await ethers.getContractFactory("SnapshotDividendTrackerMon");
    const tracker = await Tracker.deploy(mmmAddress);
    await tracker.waitForDeployment();
    const trackerAddress = await tracker.getAddress();
    console.log("✅ Reward Tracker deployed to:", trackerAddress);
    
    // 3. Configure MMM with tracker
    console.log("\n3. Configuring MMM with tracker...");
    const setTrackerTx = await mmm.setRewardTracker(trackerAddress);
    await setTrackerTx.wait();
    console.log("✅ Tracker set in MMM");
    
  } catch (error) {
    console.log("❌ Error deploying tracker:", error.message);
    console.log("Trying alternative contract name...");
    
    // Try different contract names
    const possibleNames = [
      "Taxes",
      "RewardTracker", 
      "SnapshotRewardTracker",
      "DividendTracker"
    ];
    
    for (const name of possibleNames) {
      try {
        const Tracker = await ethers.getContractFactory(name);
        const tracker = await Tracker.deploy(mmmAddress);
        await tracker.waitForDeployment();
        const trackerAddress = await tracker.getAddress();
        console.log(`✅ ${name} deployed to:`, trackerAddress);
        
        const setTrackerTx = await mmm.setRewardTracker(trackerAddress);
        await setTrackerTx.wait();
        console.log("✅ Tracker set in MMM");
        break;
      } catch (e) {
        // Try next name
      }
    }
  }
  
  // 4. Configure initial settings
  console.log("\n4. Configuring initial settings...");
  
  // Set taxes (5% buy, 5% sell)
  try {
    const setTaxesTx = await mmm.setTaxes(500, 500);
    await setTaxesTx.wait();
    console.log("✅ Taxes set: 5% buy, 5% sell");
  } catch (error) {
    console.log("⚠️ Could not set taxes:", error.message);
  }
  
  // Get auto-created pair
  try {
    const pairs = await mmm.getPairs();
    if (pairs && pairs.length > 0) {
      console.log("✅ Auto-created pair:", pairs[0]);
      
      // Set it as AMM pair
      const setPairTx = await mmm.setPair(pairs[0], true);
      await setPairTx.wait();
      console.log("✅ Pair set as AMM pair");
    }
  } catch (error) {
    console.log("⚠️ Could not get/set pair:", error.message);
  }
  
  // Exclude deployer and router from fees
  try {
    const excludeDeployerTx = await mmm.setExcludedFromFees(deployer.address, true);
    await excludeDeployerTx.wait();
    console.log("✅ Deployer excluded from fees");
    
    const excludeRouterTx = await mmm.setExcludedFromFees(ROUTER_ADDRESS, true);
    await excludeRouterTx.wait();
    console.log("✅ Router excluded from fees");
  } catch (error) {
    console.log("⚠️ Could not exclude from fees:", error.message);
  }
  
  // 5. Verify deployment
  console.log("\n5. Verifying deployment...");
  
  const [name, symbol, decimals, totalSupply, taxTokens] = await Promise.all([
    mmm.name(),
    mmm.symbol(),
    mmm.decimals(),
    mmm.totalSupply(),
    mmm.taxTokens()
  ]);
  
  console.log(`✅ Token: ${name} (${symbol})`);
  console.log(`✅ Decimals: ${decimals}`);
  console.log(`✅ Total Supply: ${ethers.formatUnits(totalSupply, decimals)}`);
  console.log(`✅ Tax Pool: ${ethers.formatUnits(taxTokens, decimals)} ${symbol}`);
  
  console.log("\n" + "=".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("\n📋 Contract Addresses:");
  console.log(`MMM Token: ${mmmAddress}`);
  console.log(`Reward Tracker: ${trackerAddress || "Check deployment"}`);
  console.log("\n🎯 Next: Add liquidity and test taxes!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});