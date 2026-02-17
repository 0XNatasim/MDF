// scripts/diagnose-balance-increase.js
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("\n=== DIAGNOSING BALANCE INCREASE ===\n");

  const provider = new ethers.JsonRpcProvider(hre.network.config.url);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const fresh = new ethers.Wallet(process.env.FRESH_PRIVATE_KEY, provider);

  const MMM = await ethers.getContractAt("MMMToken", process.env.TESTNET_MMM, deployer);

  console.log("=== Initial State ===");
  const freshBal1 = await MMM.balanceOf(fresh.address);
  const deployerBal1 = await MMM.balanceOf(deployer.address);
  console.log("Fresh balance:", ethers.formatUnits(freshBal1, 18));
  console.log("Deployer balance:", ethers.formatUnits(deployerBal1, 18));

  console.log("\n=== Step 1: Deployer sends 100 MMM to Fresh ===");
  const sendAmount = ethers.parseUnits("100", 18);
  const tx1 = await MMM.transfer(fresh.address, sendAmount);
  const receipt1 = await tx1.wait();
  
  const freshBal2 = await MMM.balanceOf(fresh.address);
  const deployerBal2 = await MMM.balanceOf(deployer.address);
  
  console.log("Fresh balance after buy:", ethers.formatUnits(freshBal2, 18));
  console.log("Fresh received:", ethers.formatUnits(freshBal2 - freshBal1, 18));
  console.log("Deployer balance after send:", ethers.formatUnits(deployerBal2, 18));
  console.log("Deployer sent:", ethers.formatUnits(deployerBal1 - deployerBal2, 18));
  
  console.log("\n=== Step 2: Fresh sells 50 MMM back to Deployer ===");
  const sellAmount = ethers.parseUnits("50", 18);
  const tx2 = await MMM.connect(fresh).transfer(deployer.address, sellAmount);
  const receipt2 = await tx2.wait();
  
  const freshBal3 = await MMM.balanceOf(fresh.address);
  const deployerBal3 = await MMM.balanceOf(deployer.address);
  
  console.log("Fresh balance after sell:", ethers.formatUnits(freshBal3, 18));
  console.log("Fresh change:", ethers.formatUnits(freshBal3 - freshBal2, 18), "(should be -50)");
  console.log("Deployer balance after receive:", ethers.formatUnits(deployerBal3, 18));
  console.log("Deployer change:", ethers.formatUnits(deployerBal3 - deployerBal2, 18), "(should be ~47.5 if 5% tax)");

  console.log("\n=== Analysis ===");
  const freshLost = freshBal2 - freshBal3;
  const deployerGained = deployerBal3 - deployerBal2;
  const taxAmount = freshLost - deployerGained;
  
  console.log("Fresh lost:", ethers.formatUnits(freshLost, 18));
  console.log("Deployer gained:", ethers.formatUnits(deployerGained, 18));
  console.log("Tax/burned:", ethers.formatUnits(taxAmount, 18));
  
  if (taxAmount > 0) {
    const taxPercent = (Number(taxAmount) / Number(freshLost)) * 100;
    console.log("Tax rate:", taxPercent.toFixed(2), "%");
  }

  // Check if there's a TaxVault
  try {
    const TV = await ethers.getContractAt("TaxVault", process.env.TESTNET_TAXVAULT, deployer);
    const tvBal = await MMM.balanceOf(TV.target);
    console.log("\nTaxVault balance:", ethers.formatUnits(tvBal, 18), "MMM");
  } catch {
    console.log("\nTaxVault not accessible or doesn't exist");
  }

  console.log("\n=== DIAGNOSIS COMPLETE ===");
}

main().catch(console.error);