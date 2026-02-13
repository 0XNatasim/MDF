// scripts/minimal-process-test.js
const hre = require("hardhat");
const { ethers } = hre;

async function getContract(name, address, signer) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new ethers.Contract(address, artifact.abi, signer);
}

async function main() {
  console.log("=== MINIMAL PROCESS TEST ===\n");

  const rpcUrl   = hre.network.config.url;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const MMM      = await getContract("MMMToken",  process.env.TESTNET_MMM,      deployer);
  const TaxVault = await getContract("TaxVault",  process.env.TESTNET_TAXVAULT, deployer);

  const taxBal = await MMM.balanceOf(TaxVault.target);
  console.log("TaxVault MMM balance:", ethers.formatUnits(taxBal, 18));

  if (taxBal === 0n) {
    console.log("❌ No MMM in TaxVault");
    return;
  }

  const deadline = Math.floor(Date.now() / 1000) + 600;

  console.log("\nAttempting to estimate gas for process()...");
  console.log("Parameters:");
  console.log("  mmmAmount: ", ethers.formatUnits(taxBal, 18));
  console.log("  minUsdcOut:", 0);
  console.log("  deadline:  ", deadline);

  try {
    const gasEstimate = await TaxVault.process.estimateGas(
      taxBal,
      0,
      deadline
    );
    console.log("\n✓ Gas estimate succeeded:", gasEstimate.toString());
    
    console.log("\nSending transaction with gas limit:", Number(gasEstimate) * 2);
    const tx = await TaxVault.process(
      taxBal,
      0,
      deadline,
      { gasLimit: Number(gasEstimate) * 2 }
    );
    
    console.log("Transaction sent:", tx.hash);
    console.log("Waiting for confirmation...");
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log("\n✓✓✓ SUCCESS! ✓✓✓");
      console.log("Transaction hash:", receipt.hash);
      console.log("Gas used:", receipt.gasUsed.toString());
    } else {
      console.log("\n❌ Transaction reverted");
      console.log("Receipt:", JSON.stringify(receipt, null, 2));
    }
    
  } catch (error) {
    console.log("\n❌ ERROR OCCURRED");
    console.log("Error type:", error.code);
    console.log("Error message:", error.message);
    
    if (error.data) {
      console.log("\nError data:", error.data);
      
      // Try to decode custom error
      const errorData = error.data;
      if (typeof errorData === 'string' && errorData.startsWith('0x')) {
        const selector = errorData.slice(0, 10);
        console.log("Error selector:", selector);
        
        // Map known error selectors
        const knownErrors = {
          '0xd92e233d': 'ZeroAddress()',
          '0x12f1f923': 'SafeERC20FailedOperation(address) or similar',
          // Add more as needed
        };
        
        if (knownErrors[selector]) {
          console.log("Decoded error:", knownErrors[selector]);
        }
      }
    }
    
    if (error.transaction) {
      console.log("\nTransaction details:");
      console.log("  To:", error.transaction.to);
      console.log("  From:", error.transaction.from);
      console.log("  Data:", error.transaction.data || "(empty)");
    }
    
    if (error.receipt) {
      console.log("\nReceipt details:");
      console.log("  Status:", error.receipt.status);
      console.log("  Gas used:", error.receipt.gasUsed?.toString());
      console.log("  Block:", error.receipt.blockNumber);
      
      if (error.receipt.logs && error.receipt.logs.length > 0) {
        console.log("  Logs:", error.receipt.logs);
      } else {
        console.log("  No logs emitted (this is unusual for a revert)");
      }
    }
    
    throw error;
  }
}

main().catch((e) => {
  console.error("\n=== SCRIPT FAILED ===");
  process.exit(1);
});
