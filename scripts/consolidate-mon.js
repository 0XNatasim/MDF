// scripts/consolidate-mon.js
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("=== CONSOLIDATE MON TO SINGLE ADDRESS ===\n");

  const rpcUrl = hre.network.config.url;
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // All wallet private keys from .env
  const walletKeys = {
    DEPLOYER: process.env.DEPLOYER_PRIVATE_KEY,
    OWNER: process.env.OWNER_PRIVATE_KEY,
    DOPTESTNET: process.env.PRIVATE_KEY,
    TESTER: process.env.TESTER_PRIVATE_KEY,
    CLAIMER: process.env.CLAIMER_PRIVATE_KEY,
    FRESH_WALLET: process.env.FRESH_WALLET_PRIVATE_KEY,
    FRESH2_WALLET: process.env.FRESH2_WALLET_PRIVATE_KEY,
    FRESH3_WALLET: process.env.FRESH3_WALLET_PRIVATE_KEY,
  };

  // Choose the recipient (the wallet that will receive all MON)
  // Using DOPTESTNET since that's what you're using for the tests
  const RECIPIENT_KEY = "DOPTESTNET";
  const recipientWallet = new ethers.Wallet(walletKeys[RECIPIENT_KEY], provider);
  
  console.log("Recipient wallet:", RECIPIENT_KEY);
  console.log("Recipient address:", recipientWallet.address);
  console.log();

  // Get current gas price
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice;
  console.log("Current gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");
  console.log();

  let totalConsolidated = 0n;
  let totalGasCost = 0n;

  console.log("=== Consolidating MON ===\n");

  for (const [name, privateKey] of Object.entries(walletKeys)) {
    // Skip the recipient wallet
    if (name === RECIPIENT_KEY) {
      console.log(`⏭️  Skipping ${name} (recipient wallet)`);
      continue;
    }

    // Skip if private key is not set
    if (!privateKey) {
      console.log(`⏭️  Skipping ${name} (no private key in .env)`);
      continue;
    }

    try {
      const wallet = new ethers.Wallet(privateKey, provider);
      const balance = await provider.getBalance(wallet.address);

      console.log(`\n${name} (${wallet.address})`);
      console.log(`  Balance: ${ethers.formatEther(balance)} MON`);

      if (balance === 0n) {
        console.log(`  ⏭️  Skipping (zero balance)`);
        continue;
      }

      // Calculate gas cost for a simple transfer (21,000 gas)
      const gasLimit = 21000n;
      const gasCost = gasLimit * gasPrice;

      console.log(`  Gas cost: ${ethers.formatEther(gasCost)} MON`);

      // Amount to send = balance - gas cost
      const amountToSend = balance - gasCost;

      if (amountToSend <= 0n) {
        console.log(`  ⚠️  Balance too low to cover gas (${ethers.formatEther(balance)} MON)`);
        continue;
      }

      console.log(`  Sending: ${ethers.formatEther(amountToSend)} MON`);

      // Send the transaction
      const tx = await wallet.sendTransaction({
        to: recipientWallet.address,
        value: amountToSend,
        gasLimit: gasLimit,
        gasPrice: gasPrice,
      });

      console.log(`  Tx sent: ${tx.hash}`);
      console.log(`  Waiting for confirmation...`);

      const receipt = await tx.wait();

      if (receipt.status === 1) {
        const actualGasCost = receipt.gasUsed * receipt.gasPrice;
        totalConsolidated += amountToSend;
        totalGasCost += actualGasCost;
        console.log(`  ✓ Success! Gas used: ${ethers.formatEther(actualGasCost)} MON`);
      } else {
        console.log(`  ❌ Transaction failed`);
      }

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }

  console.log("\n=== CONSOLIDATION COMPLETE ===\n");

  // Check recipient's final balance
  const finalBalance = await provider.getBalance(recipientWallet.address);
  
  console.log("Summary:");
  console.log(`  Total consolidated: ${ethers.formatEther(totalConsolidated)} MON`);
  console.log(`  Total gas cost:     ${ethers.formatEther(totalGasCost)} MON`);
  console.log();
  console.log(`Recipient (${RECIPIENT_KEY}) final balance: ${ethers.formatEther(finalBalance)} MON`);
  console.log();
  console.log("You can now run your tests with this wallet!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
