// scripts/test-03-verify-working.js
const hre = require("hardhat");
const { ethers } = hre;

async function getContract(name, address, signer) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new ethers.Contract(address, artifact.abi, signer);
}

async function main() {
  console.log("=== TEST 03: Verify Process() Works + Find Real Gas Requirement ===\n");

  const rpcUrl   = hre.network.config.url;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log("Deployer:", deployer.address);

  const MMM      = await getContract("MMMToken",  process.env.TESTNET_MMM,      deployer);
  const TaxVault = await getContract("TaxVault",  process.env.TESTNET_TAXVAULT, deployer);
  const USDC     = await getContract("MockERC20", process.env.TESTNET_USDC,     deployer);

  const tvAddr = TaxVault.target;

  // Step 1: Check current state
  console.log("\n=== Current State ===");
  const taxBal = await MMM.balanceOf(tvAddr);
  console.log("TaxVault MMM:", ethers.formatUnits(taxBal, 18));

  if (taxBal === 0n) {
    console.log("\n✓ TaxVault is empty (previous test succeeded!)");
    console.log("\nNeed to add more MMM to test again.");
    console.log("Run: npx hardhat run scripts/test-01-seed-and-generate-tax.js --network monadTestnet");
    return;
  }

  // Step 2: Verify tax exemptions
  console.log("\n=== Verify Tax Exemptions ===");
  const tvExempt = await MMM.isTaxExempt(tvAddr);
  const routerExempt = await MMM.isTaxExempt(process.env.TESTNET_ROUTER);
  console.log("TaxVault exempt:", tvExempt ? "✓" : "❌");
  console.log("Router exempt:  ", routerExempt ? "✓" : "❌");

  if (!tvExempt || !routerExempt) {
    console.log("\n❌ Not exempt! Run:");
    console.log("npx hardhat run scripts/FIX-exclude-from-tax.js --network monadTestnet");
    return;
  }

  // Step 3: Estimate gas
  console.log("\n=== Gas Estimation ===");
  const deadline = Math.floor(Date.now() / 1000) + 600;

  let gasEstimate;
  try {
    gasEstimate = await TaxVault.process.estimateGas(taxBal, 0, deadline);
    console.log("Estimated gas:", gasEstimate.toString());

    if (gasEstimate > 1000000n) {
      console.log("⚠️  Gas estimate is HIGH:", gasEstimate.toString());
      console.log("This might indicate there's still an issue.");
    } else {
      console.log("✓ Gas estimate looks reasonable");
    }
  } catch (err) {
    console.log("❌ Gas estimation failed:", err.message);
    return;
  }

  // Step 4: Check balance
  const balance = await provider.getBalance(deployer.address);
  const gasPrice = (await provider.getFeeData()).gasPrice;
  const estimatedCost = gasEstimate * gasPrice * 12n / 10n; // +20%

  console.log("\n=== Balance Check ===");
  console.log("MON balance:   ", ethers.formatEther(balance));
  console.log("Estimated cost:", ethers.formatEther(estimatedCost));

  if (balance < estimatedCost) {
    console.log("❌ Insufficient MON!");
    console.log("Run consolidation script first:");
    console.log("npx hardhat run scripts/consolidate-mon.js --network monadTestnet");
    return;
  }

  // Step 5: Execute
  console.log("\n=== Executing process() ===");
  const gasLimit = gasEstimate * 12n / 10n;
  console.log("Using gas limit:", gasLimit.toString(), "(estimate + 20%)");

  const tx = await TaxVault.process(taxBal, 0, deadline, { gasLimit });

  console.log("Tx sent:", tx.hash);
  const receipt = await tx.wait();

  console.log("\n=== Results ===");
  console.log("Status:   ", receipt.status === 1 ? "✓ Success" : "❌ Failed");
  console.log("Gas used: ", receipt.gasUsed.toString());
  console.log("Gas limit:", gasLimit.toString());
  console.log("Efficiency:", ((Number(receipt.gasUsed) / Number(gasLimit)) * 100).toFixed(1) + "%");

  // Step 6: Verify balances
  console.log("\n=== Final Balances ===");
  
  const [rewardVault, marketingVault, teamVestingVault] = await Promise.all([
    TaxVault.rewardVault(),
    TaxVault.marketingVault(),
    TaxVault.teamVestingVault()
  ]);

  const rewardMmm = await MMM.balanceOf(rewardVault);
  const mktUsdc = await USDC.balanceOf(marketingVault);
  const teamUsdc = await USDC.balanceOf(teamVestingVault);
  const finalTvMmm = await MMM.balanceOf(tvAddr);
  const finalTvUsdc = await USDC.balanceOf(tvAddr);

  console.log("RewardVault MMM: ", ethers.formatUnits(rewardMmm, 18));
  console.log("Marketing USDC:  ", ethers.formatUnits(mktUsdc, 6));
  console.log("TeamVesting USDC:", ethers.formatUnits(teamUsdc, 6));
  console.log("TaxVault MMM:    ", ethers.formatUnits(finalTvMmm, 18));
  console.log("TaxVault USDC:   ", ethers.formatUnits(finalTvUsdc, 6));

  console.log("\n✓✓✓ TEST COMPLETE ✓✓✓");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
