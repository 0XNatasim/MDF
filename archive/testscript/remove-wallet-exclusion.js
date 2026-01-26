// scripts/remove-wallet-exclusion.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  
  const MMM_ADDRESS = "0x27Badfbd4836d392E1E87487C0EE22A1E90dC096";
  const POOL_ADDRESS = "0x2B8dB008429b5320fb435289D4902c297Fb9f70e";
  
  const [user] = await ethers.getSigners();
  
  const mmm = new ethers.Contract(MMM_ADDRESS, [
    "function setExcludedFromFees(address, bool) external",
    "function isExcludedFromFees(address) view returns (bool)",
    "function taxTokens() view returns (uint256)"
  ], user);
  
  console.log("🔧 Removing Wallet Exclusion for Testing");
  console.log("=".repeat(50));
  
  console.log(`Your wallet: ${user.address}`);
  
  const isExcluded = await mmm.isExcludedFromFees(user.address);
  console.log(`Currently excluded: ${isExcluded ? "✅ Yes" : "❌ No"}`);
  
  if (isExcluded) {
    console.log("\n🔄 Removing exclusion...");
    const tx = await mmm.setExcludedFromFees(user.address, false);
    await tx.wait();
    console.log("✅ Wallet NO LONGER excluded from fees!");
    console.log(`Tx hash: ${tx.hash}`);
    
    // Verify
    const nowExcluded = await mmm.isExcludedFromFees(user.address);
    console.log(`Now excluded: ${nowExcluded ? "❌ Still excluded (error)" : "✅ Not excluded (good)"}`);
  } else {
    console.log("\n✅ Wallet already not excluded!");
  }
  
  console.log("\n🎯 Now test buy again:");
  console.log("npx hardhat run scripts/buy-mmm-fixed.js --network monadTestnet");
  console.log("\nTax should now be collected! 🎉");
}

main();
