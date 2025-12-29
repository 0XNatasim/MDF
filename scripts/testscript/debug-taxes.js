// scripts/debug-tax-swap.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  
  const MMM_ADDRESS = "0x27Badfbd4836d392E1E87487C0EE22A1E90dC096";
  const ROUTER_ADDR = "0xfb8e1c3b833f9e67a71c859a132cf783b645e436";
  const WMON_ADDRESS = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
  const TRACKER_ADDRESS = "0xA926654269071F92c20e0D6D4DAC8A9D1d675854";
  
  const [user] = await ethers.getSigners();
  
  const mmm = new ethers.Contract(MMM_ADDRESS, [
    // Tax info
    "function taxTokens() view returns (uint256)",
    "function rewardTracker() view returns (address)",
    
    // Router and token info
    "function router() view returns (address)",
    "function wmon() view returns (address)",
    
    // Approval check
    "function allowance(address,address) view returns (uint256)",
    
    // Swap function
    "function swapTaxForRewards(uint256)",
    
    // Check if we can call it
    "function owner() view returns (address)"
  ], user);
  
  console.log("🔍 Debugging Tax Swap Issue");
  console.log("=".repeat(50));
  
  // Check all prerequisites
  const [
    taxPool,
    tracker,
    routerAddress,
    wmonAddress,
    allowance,
    owner,
    userAddress
  ] = await Promise.all([
    mmm.taxTokens(),
    mmm.rewardTracker(),
    mmm.router(),
    mmm.wmon(),
    mmm.allowance(MMM_ADDRESS, ROUTER_ADDR),
    mmm.owner(),
    user.address
  ]);
  
  console.log("📊 Current State:");
  console.log(`Tax pool: ${ethers.formatUnits(taxPool, 18)} MMM`);
  console.log(`Reward tracker: ${tracker}`);
  console.log(`Expected tracker: ${TRACKER_ADDRESS}`);
  console.log(`Router address: ${routerAddress}`);
  console.log(`Expected router: ${ROUTER_ADDR}`);
  console.log(`wMON address: ${wmonAddress}`);
  console.log(`Expected wMON: ${WMON_ADDRESS}`);
  console.log(`MMM allowance to router: ${ethers.formatUnits(allowance, 18)}`);
  console.log(`Contract owner: ${owner}`);
  console.log(`Your address: ${userAddress}`);
  
  console.log("\n✅ Prerequisites Check:");
  console.log("-".repeat(30));
  
  // Check 1: Is tax pool > 0?
  const check1 = taxPool > 0n;
  console.log(`1. Tax pool > 0: ${check1 ? "✅ Yes" : "❌ No"}`);
  
  // Check 2: Is tracker set?
  const check2 = tracker !== ethers.ZeroAddress;
  console.log(`2. Tracker set: ${check2 ? "✅ Yes" : "❌ No"}`);
  
  // Check 3: Is tracker correct?
  const check3 = tracker.toLowerCase() === TRACKER_ADDRESS.toLowerCase();
  console.log(`3. Tracker matches: ${check3 ? "✅ Yes" : "❌ No"}`);
  
  // Check 4: Is router correct?
  const check4 = routerAddress.toLowerCase() === ROUTER_ADDR.toLowerCase();
  console.log(`4. Router matches: ${check4 ? "✅ Yes" : "❌ No"}`);
  
  // Check 5: Is wMON correct?
  const check5 = wmonAddress.toLowerCase() === WMON_ADDRESS.toLowerCase();
  console.log(`5. wMON matches: ${check5 ? "✅ Yes" : "❌ No"}`);
  
  // Check 6: Are you the owner?
  const check6 = owner.toLowerCase() === userAddress.toLowerCase();
  console.log(`6. You are owner: ${check6 ? "✅ Yes" : "❌ No"}`);
  
  // Check 7: Does MMM have allowance to router?
  const check7 = allowance >= taxPool;
  console.log(`7. Sufficient allowance: ${check7 ? "✅ Yes" : "❌ No"} (${ethers.formatUnits(allowance, 18)} MMM)`);
  
  // Check router balance and liquidity
  console.log("\n🔍 Checking Router/Pool State:");
  console.log("-".repeat(30));
  
  const router = new ethers.Contract(ROUTER_ADDR, [
    "function WETH() view returns (address)",
    "function getAmountsOut(uint256,address[]) view returns (uint256[])"
  ], ethers.provider);
  
  const weth = await router.WETH();
  console.log(`Router WETH: ${weth}`);
  console.log(`Matches wMON: ${weth.toLowerCase() === WMON_ADDRESS.toLowerCase() ? "✅" : "❌"}`);
  
  // Try to estimate swap
  try {
    const amounts = await router.getAmountsOut(
      taxPool,
      [MMM_ADDRESS, WMON_ADDRESS]
    );
    console.log(`Estimated swap: ${ethers.formatUnits(taxPool, 18)} MMM → ${ethers.formatEther(amounts[1])} MON`);
    
    if (amounts[1] === 0n) {
      console.log("⚠️  Warning: Swap would return 0 MON (no liquidity or price issue)");
    }
  } catch (error) {
    console.log(`❌ Cannot estimate swap: ${error.message}`);
  }
  
  // Check MMM contract MON balance
  const contractMON = await ethers.provider.getBalance(MMM_ADDRESS);
  console.log(`MMM contract MON balance: ${ethers.formatEther(contractMON)} MON`);
  
  // Possible issues and fixes
  console.log("\n🔧 Possible Issues & Solutions:");
  console.log("-".repeat(30));
  
  if (!check6) {
    console.log("❌ You are NOT the contract owner!");
    console.log("Only owner can call swapTaxForRewards");
    console.log(`Owner: ${owner}`);
    console.log(`You: ${userAddress}`);
    return;
  }
  
  if (!check7) {
    console.log("❌ MMM contract needs allowance to spend its own tokens!");
    console.log("The contract needs to approve the router");
    console.log("Try calling _approve(address(this), router, taxPool) first");
  }
  
  if (taxPool < ethers.parseEther("100")) {
    console.log("⚠️  Tax pool is very small (427 MMM)");
    console.log("Swap might fail due to minimum output or liquidity");
  }
  
  // Try a manual approval first
  console.log("\n🔄 Attempting manual approval...");
  
  const mmmWithSigner = mmm.connect(user);
  try {
    // First, try to approve router
    console.log("Approving router to spend MMM...");
    const approveTx = await mmmWithSigner.approve(ROUTER_ADDR, taxPool);
    await approveTx.wait();
    console.log("✅ Approval successful");
    
    // Now try swap
    console.log("\n🔄 Trying swap again...");
    const swapTx = await mmmWithSigner.swapTaxForRewards(0);
    await swapTx.wait();
    console.log("✅ Swap successful!");
    
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    
    // Try with smaller amount
    console.log("\n🔄 Trying with smaller amount (100 MMM)...");
    try {
      const smallAmount = ethers.parseEther("100");
      const swapTx = await mmmWithSigner.swapTaxForRewards(smallAmount);
      await swapTx.wait();
      console.log("✅ Swap with 100 MMM successful!");
    } catch (error2) {
      console.log(`❌ Still failing: ${error2.message}`);
      
      // Check if the function exists and has correct parameters
      console.log("\n🔍 Checking function signature...");
      console.log("The swapTaxForRewards function might need:");
      console.log("1. Different parameters");
      console.log("2. More gas");
      console.log("3. Minimum output parameter");
    }
  }
}

main();