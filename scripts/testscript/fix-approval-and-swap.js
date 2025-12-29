// scripts/fix-approval-and-swap.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  
  const MMM_ADDRESS = "0x27Badfbd4836d392E1E87487C0EE22A1E90dC096";
  const ROUTER_ADDR = "0xfb8e1c3b833f9e67a71c859a132cf783b645e436";
  const TRACKER_ADDRESS = "0xA926654269071F92c20e0D6D4DAC8A9D1d675854";
  
  const [user] = await ethers.getSigners();
  
  console.log("🔧 Fixing Approval & Testing Swap");
  console.log("=".repeat(50));
  
  // First, let's check if we can call approve directly
  const mmm = new ethers.Contract(MMM_ADDRESS, [
    // Basic ERC20
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    
    // Tax info
    "function taxTokens() view returns (uint256)",
    
    // Try different swap functions
    "function swapTaxForMONAndSendToRewards(uint256 tokenAmount)",
    "function swapTaxForRewards(uint256 amount)",
    
    // For debugging
    "function owner() view returns (address)"
  ], user);
  
  const [taxPool, owner, currentAllowance] = await Promise.all([
    mmm.taxTokens(),
    mmm.owner(),
    mmm.allowance(MMM_ADDRESS, ROUTER_ADDR)
  ]);
  
  console.log(`Tax pool: ${ethers.formatUnits(taxPool, 18)} MMM`);
  console.log(`Contract owner: ${owner}`);
  console.log(`Your address: ${user.address}`);
  console.log(`Current allowance: ${ethers.formatUnits(currentAllowance, 18)} MMM`);
  console.log(`You are owner: ${owner.toLowerCase() === user.address.toLowerCase()}`);
  
  if (owner.toLowerCase() !== user.address.toLowerCase()) {
    console.log("❌ You are not the owner!");
    return;
  }
  
  if (taxPool === 0n) {
    console.log("❌ No tax tokens");
    return;
  }
  
  // Step 1: Fix approval (contract needs to approve router to spend its own tokens)
  console.log("\n1. 📝 Fixing Approval...");
  
  // The MMM contract needs to approve the router to spend MMM tokens
  // But we're calling from user, not from contract. We need the contract to call approve.
  // Let's try calling approve from user (as owner) - this approves user's tokens, not contract's
  
  console.log("Approving router from user (not contract)...");
  try {
    const approveTx = await mmm.approve(ROUTER_ADDR, taxPool);
    await approveTx.wait();
    console.log("✅ User approved router (but this is user's allowance, not contract's)");
  } catch (error) {
    console.log(`❌ Approve failed: ${error.message}`);
  }
  
  // Check new allowance
  const newAllowance = await mmm.allowance(MMM_ADDRESS, ROUTER_ADDR);
  console.log(`Contract's allowance to router: ${ethers.formatUnits(newAllowance, 18)} MMM`);
  
  // Step 2: Try swap with different approaches
  console.log("\n2. 🔄 Trying Swap Functions...");
  
  // Check tracker balance before
  const trackerBalanceBefore = await ethers.provider.getBalance(TRACKER_ADDRESS);
  console.log(`Tracker balance before: ${ethers.formatEther(trackerBalanceBefore)} MON`);
  
  // Try swapTaxForMONAndSendToRewards with exact amount
  console.log("\n🔄 Trying swapTaxForMONAndSendToRewards(taxPool)...");
  try {
    const tx = await mmm.swapTaxForMONAndSendToRewards(taxPool, {
      gasLimit: 1500000  // Higher gas limit
    });
    console.log(`Tx submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log("✅ Transaction successful!");
    
    // Check results
    const trackerBalanceAfter = await ethers.provider.getBalance(TRACKER_ADDRESS);
    const monReceived = trackerBalanceAfter - trackerBalanceBefore;
    console.log(`MON sent to tracker: ${ethers.formatEther(monReceived)} MON`);
    
  } catch (error) {
    console.log(`❌ swapTaxForMONAndSendToRewards failed: ${error.message}`);
    
    // Try with 0 (swap all)
    console.log("\n🔄 Trying swapTaxForMONAndSendToRewards(0)...");
    try {
      const tx = await mmm.swapTaxForMONAndSendToRewards(0, {
        gasLimit: 1500000
      });
      console.log(`Tx submitted: ${tx.hash}`);
      await tx.wait();
      console.log("✅ Success with 0!");
    } catch (error2) {
      console.log(`❌ Failed with 0: ${error2.message}`);
      
      // Try alternative function name
      console.log("\n🔄 Trying swapTaxForRewards(taxPool)...");
      try {
        const tx = await mmm.swapTaxForRewards(taxPool, {
          gasLimit: 1500000
        });
        console.log(`Tx submitted: ${tx.hash}`);
        await tx.wait();
        console.log("✅ swapTaxForRewards worked!");
      } catch (error3) {
        console.log(`❌ swapTaxForRewards failed: ${error3.message}`);
        
        // The issue might be in the contract's swap logic
        console.log("\n🔍 The contract's swap function has internal issues:");
        console.log("1. It needs _approve(address(this), router, amount)");
        console.log("2. It might need MMM balance in contract (it does: taxPool)");
        console.log("3. Router might not have enough MON liquidity");
        
        // Check router liquidity
        console.log("\n💰 Checking Router Liquidity...");
        const router = new ethers.Contract(ROUTER_ADDR, [
          "function getAmountsOut(uint256,address[]) view returns (uint256[])"
        ], ethers.provider);
        
        try {
          const amounts = await router.getAmountsOut(
            taxPool,
            [MMM_ADDRESS, "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701"]
          );
          console.log(`Estimated: ${ethers.formatUnits(taxPool, 18)} MMM → ${ethers.formatEther(amounts[1])} MON`);
          
          if (amounts[1] === 0n) {
            console.log("⚠️  Swap would return 0 MON! Not enough liquidity.");
          }
        } catch (e) {
          console.log("Could not estimate swap");
        }
      }
    }
  }
  
  // Step 3: Manual workaround if swap fails
  console.log("\n3. 🛠️ Manual Workaround (if swap fails)...");
  
  // Since the contract swap might not work, we can manually:
  // 1. Transfer tax tokens to user
  // 2. Swap manually
  // 3. Send MON to tracker
  
  const mmmBasic = new ethers.Contract(MMM_ADDRESS, [
    "function transfer(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)"
  ], user);
  
  console.log("Option: Transfer tax tokens to user and swap manually");
  console.log(`await mmm.transfer(user.address, taxPool)`);
  console.log(`Then swap MMM → MON manually`);
  console.log(`Then send MON to tracker: ${TRACKER_ADDRESS}`);
}

main();