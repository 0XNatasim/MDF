// scripts/test-02-process-tax-and-vaults.js
const hre = require("hardhat");
const { ethers } = hre;

// ─── Bypass ethers.getContractAt (binds HardhatEthersSigner, ignores your wallet)
async function getContract(name, address, signer) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new ethers.Contract(address, artifact.abi, signer);
}

async function main() {
  console.log("=== TEST 02: Process Tax ===\n");

  // ─── Raw provider + wallet — same pattern as test-01
  const rpcUrl   = hre.network.config.url;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log("Caller (deployer):", deployer.address);

  const MMM      = await getContract("MMMToken",  process.env.TESTNET_MMM,      deployer);
  const TaxVault = await getContract("TaxVault",  process.env.TESTNET_TAXVAULT, deployer);

  // ─── Sanity checks before calling process()
  const tvOwner = await TaxVault.owner();
  console.log("TaxVault owner:  ", tvOwner);
  if (tvOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      "❌ Caller is not the TaxVault owner.\n" +
      "   Caller: " + deployer.address + "\n" +
      "   Owner:  " + tvOwner + "\n" +
      "   PRIVATE_KEY must be the key that deployed TaxVault (DOPTESTNET)."
    );
  }

  const RewardVaultAddr    = process.env.TESTNET_REWARDVAULT;
  const BoostVaultAddr     = process.env.TESTNET_BOOSTVAULT;
  const SwapVaultAddr      = process.env.TESTNET_SWAPVAULT;
  const MarketingVaultAddr = process.env.TESTNET_MARKETINGVAULT;
  const TeamVaultAddr      = process.env.TESTNET_TEAMVESTINGVAULT;

  /* -----------------------------------------------------------
     1) Check tax balance
  ------------------------------------------------------------ */
  const taxBal = await MMM.balanceOf(TaxVault.target);
  console.log("\nTaxVault MMM before process:", ethers.formatUnits(taxBal, 18));

  if (taxBal === 0n) {
    throw new Error("❌ No tax to process — run test-01 first");
  }

  /* -----------------------------------------------------------
     2) Process tax
  ------------------------------------------------------------ */
  const deadline = Math.floor(Date.now() / 1000) + 600;

  console.log("\nCalling TaxVault.process()...");
  const tx = await TaxVault.process(
    taxBal,
    0,          // min USDC out (testnet)
    deadline
  );
  await tx.wait();

  console.log("✓ TaxVault.process executed");

  /* -----------------------------------------------------------
     3) Verify balances
  ------------------------------------------------------------ */
  console.log("\n--- Vault balances after process ---\n");

  const logBal = async (label, token, addr, decimals = 18) => {
    const bal = await token.balanceOf(addr);
    console.log(`  ${label}:`, ethers.formatUnits(bal, decimals));
  };

  await logBal("RewardVault MMM",     MMM, RewardVaultAddr);
  await logBal("SwapVault MMM",       MMM, SwapVaultAddr);

  const USDC = await getContract("MockERC20", process.env.TESTNET_USDC, deployer);
  await logBal("BoostVault USDC",     USDC, BoostVaultAddr,     6);
  await logBal("MarketingVault USDC", USDC, MarketingVaultAddr, 6);
  await logBal("TeamVault USDC",      USDC, TeamVaultAddr,      6);

  console.log("\n=== TEST 02 COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});