// scripts/fix-tax-issue.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;

  const MMM_ADDRESS = "0x08e3e7677DdBf2B4C7b45407e665E7726d4823dc";
  const ROUTER_ADDR = "0xfb8e1c3b833f9e67a71c859a132cf783b645e436";
  const POOL_ADDR = "0xaeA0fACAC4bf26465DF5C3a2d711375c44b42B5d";

  const [user] = await ethers.getSigners();
  console.log("Wallet:", user.address);

  // Try different ABIs for tax functions
  const MMM_ABI = [
    // Owner functions
    "function owner() view returns (address)",
    
    // Tax management functions (try common variations)
    "function excludeFromTax(address) external",
    "function excludeFromFee(address) external",
    "function excludeAccount(address) external",
    "function setExcludedFromFee(address,bool) external",
    "function setIsExcludedFromFee(address,bool) external",
    
    // Check functions
    "function isExcludedFromTax(address) view returns (bool)",
    "function isExcludedFromFee(address) view returns (bool)",
    "function isExcluded(address) view returns (bool)",
    
    // Tax info
    "function taxBuy() view returns (uint256)",
    "function taxSell() view returns (uint256)",
    "function taxTokens() view returns (uint256)"
  ];

  const mmm = new ethers.Contract(MMM_ADDRESS, MMM_ABI, user);

  console.log("🔧 Fixing Tax Issue for Uniswap");
  console.log("=".repeat(50));

  // Check owner
  try {
    const owner = await mmm.owner();
    console.log(`Contract Owner: ${owner}`);
    console.log(`Your Wallet: ${user.address}`);
    
    if (owner.toLowerCase() !== user.address.toLowerCase()) {
      console.log("❌ You are NOT the contract owner!");
      console.log("You need the owner to fix tax exclusions.");
      console.log("\nContact the contract owner to:");
      console.log("1. Exclude the router address from tax");
      console.log("2. Exclude the pool address from tax");
      return;
    }
    console.log("✅ You ARE the contract owner!");
  } catch (error) {
    console.log("❌ Could not get owner:", error.message);
    return;
  }

  // Try to exclude router
  console.log("\n🔄 Attempting to exclude router from tax...");
  try {
    // First check if already excluded
    let isExcluded = false;
    try {
      isExcluded = await mmm.isExcludedFromTax(ROUTER_ADDR);
    } catch (e) {
      try {
        isExcluded = await mmm.isExcludedFromFee(ROUTER_ADDR);
      } catch (e2) {
        try {
          isExcluded = await mmm.isExcluded(ROUTER_ADDR);
        } catch (e3) {
          console.log("Could not check exclusion status");
        }
      }
    }
    
    if (isExcluded) {
      console.log("✅ Router already excluded from tax");
    } else {
      // Try different exclusion functions
      let success = false;
      
      try {
        const tx = await mmm.excludeFromTax(ROUTER_ADDR);
        await tx.wait();
        console.log("✅ Router excluded using excludeFromTax()");
        console.log(`Tx: ${tx.hash}`);
        success = true;
      } catch (e1) {
        try {
          const tx = await mmm.excludeFromFee(ROUTER_ADDR);
          await tx.wait();
          console.log("✅ Router excluded using excludeFromFee()");
          console.log(`Tx: ${tx.hash}`);
          success = true;
        } catch (e2) {
          try {
            const tx = await mmm.excludeAccount(ROUTER_ADDR);
            await tx.wait();
            console.log("✅ Router excluded using excludeAccount()");
            console.log(`Tx: ${tx.hash}`);
            success = true;
          } catch (e3) {
            try {
              const tx = await mmm.setExcludedFromFee(ROUTER_ADDR, true);
              await tx.wait();
              console.log("✅ Router excluded using setExcludedFromFee()");
              console.log(`Tx: ${tx.hash}`);
              success = true;
            } catch (e4) {
              console.log("❌ All exclusion methods failed");
              console.log("The contract might have different function names");
            }
          }
        }
      }
    }
  } catch (error) {
    console.log("Error:", error.message);
  }

  // Try to exclude pool
  console.log("\n🔄 Attempting to exclude pool from tax...");
  try {
    let isExcluded = false;
    try {
      isExcluded = await mmm.isExcludedFromTax(POOL_ADDR);
    } catch (e) {
      try {
        isExcluded = await mmm.isExcludedFromFee(POOL_ADDR);
      } catch (e2) {
        try {
          isExcluded = await mmm.isExcluded(POOL_ADDR);
        } catch (e3) {
          console.log("Could not check exclusion status");
        }
      }
    }
    
    if (isExcluded) {
      console.log("✅ Pool already excluded from tax");
    } else {
      let success = false;
      
      try {
        const tx = await mmm.excludeFromTax(POOL_ADDR);
        await tx.wait();
        console.log("✅ Pool excluded using excludeFromTax()");
        console.log(`Tx: ${tx.hash}`);
        success = true;
      } catch (e1) {
        try {
          const tx = await mmm.excludeFromFee(POOL_ADDR);
          await tx.wait();
          console.log("✅ Pool excluded using excludeFromFee()");
          console.log(`Tx: ${tx.hash}`);
          success = true;
        } catch (e2) {
          try {
            const tx = await mmm.excludeAccount(POOL_ADDR);
            await tx.wait();
            console.log("✅ Pool excluded using excludeAccount()");
            console.log(`Tx: ${tx.hash}`);
            success = true;
          } catch (e3) {
            try {
              const tx = await mmm.setExcludedFromFee(POOL_ADDR, true);
              await tx.wait();
              console.log("✅ Pool excluded using setExcludedFromFee()");
              console.log(`Tx: ${tx.hash}`);
              success = true;
            } catch (e4) {
              console.log("❌ All exclusion methods failed");
            }
          }
        }
      }
    }
  } catch (error) {
    console.log("Error:", error.message);
  }

  // Verify tax settings
  console.log("\n🔍 Verifying Tax Settings:");
  console.log("-".repeat(30));
  
  try {
    const taxBuy = await mmm.taxBuy();
    const taxSell = await mmm.taxSell();
    const taxPool = await mmm.taxTokens();
    
    console.log(`Buy Tax: ${taxBuy}%`);
    console.log(`Sell Tax: ${taxSell}%`);
    console.log(`Tax Pool: ${ethers.formatUnits(taxPool, 18)} MMM`);
  } catch (error) {
    console.log("Could not read tax settings:", error.message);
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ Fix attempt complete!");
  console.log("\n🎯 Now test your buy again:");
  console.log("npx hardhat run scripts/buy-mmm-with-tax.js --network monadTestnet");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});