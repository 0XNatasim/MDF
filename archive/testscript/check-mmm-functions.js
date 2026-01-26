// scripts/check-mmm-functions.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  
  const MMM_ADDRESS = "0x27Badfbd4836d392E1E87487C0EE22A1E90dC096";
  
  // Common ERC20 functions
  const commonFunctions = [
    // ERC20 basics
    "function approve(address,uint256) returns (bool)",
    "function transfer(address,uint256) returns (bool)",
    "function transferFrom(address,address,uint256) returns (bool)",
    
    // Tax functions from your original MMM.sol
    "function swapTaxForMONAndSendToRewards(uint256)",
    "function swapTaxForRewards(uint256)",
    "function swapTaxTokens(uint256)",
    
    // Owner functions
    "function setExcludedFromFees(address,bool)",
    "function setPair(address,bool)",
    "function setTaxes(uint256,uint256)",
    
    // View functions
    "function taxTokens() view returns (uint256)",
    "function buyTaxBps() view returns (uint256)",
    "function sellTaxBps() view returns (uint256)",
    "function ammPairs(address) view returns (bool)",
    "function isExcludedFromFees(address) view returns (bool)",
    "function owner() view returns (address)",
    "function router() view returns (address)",
    "function wmon() view returns (address)",
    "function rewardTracker() view returns (address)"
  ];
  
  const [user] = await ethers.getSigners();
  
  console.log("🔍 Checking MMM Contract Functions");
  console.log("=".repeat(50));
  
  // Test each function
  for (const funcSig of commonFunctions) {
    const funcName = funcSig.split('(')[0];
    
    try {
      const mmm = new ethers.Contract(MMM_ADDRESS, [funcSig], ethers.provider);
      
      // Try to call view functions
      if (funcSig.includes(" view ")) {
        if (funcName === "ammPairs" || funcName === "isExcludedFromFees") {
          await mmm[funcName](user.address);
        } else if (funcName === "taxTokens" || funcName === "buyTaxBps" || 
                   funcName === "sellTaxBps" || funcName === "owner" ||
                   funcName === "router" || funcName === "wmon" || 
                   funcName === "rewardTracker") {
          await mmm[funcName]();
        }
        console.log(`✅ ${funcSig}`);
      } else {
        console.log(`⚠️  ${funcSig} (needs write test)`);
      }
    } catch (error) {
      console.log(`❌ ${funcSig} - ${error.message}`);
    }
  }
  
  // Now let's find the correct swap function
  console.log("\n🔄 Finding Swap Function...");
  
  const possibleSwapFunctions = [
    "swapTaxForMONAndSendToRewards",
    "swapTaxForRewards", 
    "swapTaxTokens",
    "manualSwapForRewards",
    "swapAndSendRewards"
  ];
  
  for (const funcName of possibleSwapFunctions) {
    try {
      const mmm = new ethers.Contract(MMM_ADDRESS, [
        `function ${funcName}(uint256)`
      ], ethers.provider);
      
      // Try to estimate gas (won't execute)
      await mmm[funcName].staticCall(0);
      console.log(`✅ Found swap function: ${funcName}`);
      
      // Test with user as signer
      const mmmWithSigner = new ethers.Contract(MMM_ADDRESS, [
        `function ${funcName}(uint256)`
      ], user);
      
      console.log(`Trying to call ${funcName}(0)...`);
      const tx = await mmmWithSigner[funcName](0, { gasLimit: 500000 });
      console.log(`✅ Success! Tx: ${tx.hash}`);
      break;
      
    } catch (error) {
      console.log(`❌ ${funcName}: ${error.message}`);
    }
  }
}

main();