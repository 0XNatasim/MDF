// scripts/test-02-high-gas.js
const hre = require("hardhat");
const { ethers } = hre;

async function getContract(name, address, signer) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new ethers.Contract(address, artifact.abi, signer);
}

async function main() {
  console.log("=== TEST 02: Process Tax (HIGH GAS LIMIT) ===\n");

  const rpcUrl   = hre.network.config.url;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log("Caller (deployer):", deployer.address);

  const MMM      = await getContract("MMMToken",  process.env.TESTNET_MMM,      deployer);
  const TaxVault = await getContract("TaxVault",  process.env.TESTNET_TAXVAULT, deployer);
  const USDC     = await getContract("MockERC20", process.env.TESTNET_USDC,     deployer);

  const tvAddr = TaxVault.target;

  console.log("TaxVault address:", tvAddr);

  // Get balance
  const taxBal = await MMM.balanceOf(tvAddr);
  console.log("TaxVault MMM before:", ethers.formatUnits(taxBal, 18));

  if (taxBal === 0n) {
    throw new Error("❌ No MMM in TaxVault");
  }

  // Get vaults
  const [rewardVault, marketingVault, teamVestingVault] = await Promise.all([
    TaxVault.rewardVault(),
    TaxVault.marketingVault(),
    TaxVault.teamVestingVault()
  ]);

  const deadline = Math.floor(Date.now() / 1000) + 600;

  console.log("\nCalling TaxVault.process() with HIGH gas limit...");
  console.log("Gas limit: 5,000,000");
  
  try {
    const tx = await TaxVault.process(
      taxBal,
      0,
      deadline,
      {
        gasLimit: 5000000  // 5 million gas - much higher!
      }
    );

    console.log("Transaction sent:", tx.hash);
    console.log("Waiting for confirmation...");
    
    const receipt = await tx.wait(1);
    
    if (receipt.status === 1) {
      console.log("\n✓✓✓ SUCCESS! ✓✓✓");
      console.log("Transaction hash:", receipt.hash);
      console.log("Gas used:", receipt.gasUsed.toString());
      
      // Check balances after
      console.log("\n--- Vault balances after ---");
      const rewardMmm = await MMM.balanceOf(rewardVault);
      const mktUsdc = await USDC.balanceOf(marketingVault);
      const teamUsdc = await USDC.balanceOf(teamVestingVault);
      
      console.log("  RewardVault MMM: ", ethers.formatUnits(rewardMmm, 18));
      console.log("  Marketing USDC:  ", ethers.formatUnits(mktUsdc, 6));
      console.log("  TeamVesting USDC:", ethers.formatUnits(teamUsdc, 6));
      
      const finalMmm  = await MMM.balanceOf(tvAddr);
      const finalUsdc = await USDC.balanceOf(tvAddr);
      
      console.log("\nTaxVault MMM remaining: ", ethers.formatUnits(finalMmm, 18));
      console.log("TaxVault USDC remaining:", ethers.formatUnits(finalUsdc, 6));
      
      console.log("\n=== TEST 02 COMPLETE ===");
    } else {
      console.log("\n❌ Transaction reverted");
      console.log("Status:", receipt.status);
      console.log("Gas used:", receipt.gasUsed.toString());
    }
    
  } catch (error) {
    console.log("\n❌ ERROR");
    console.log("Message:", error.message);
    
    if (error.receipt) {
      console.log("\nReceipt details:");
      console.log("  Status:", error.receipt.status);
      console.log("  Gas used:", error.receipt.gasUsed?.toString());
      console.log("  Gas limit was: 5,000,000");
      
      if (error.receipt.gasUsed?.toString() === "5000000") {
        console.log("\n❌ STILL OUT OF GAS!");
        console.log("The transaction needs more than 5 million gas.");
        console.log("This suggests there might be an infinite loop or");
        console.log("a very expensive operation in the contract.");
      }
    }
    
    throw error;
  }
}

main().catch((e) => {
  console.error("\n=== FAILED ===");
  process.exit(1);
});
