// scripts/FIX-exclude-from-tax.js
const hre = require("hardhat");
const { ethers } = hre;

async function getContract(name, address, signer) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new ethers.Contract(address, artifact.abi, signer);
}

async function main() {
  console.log("=== FIX: Exclude TaxVault, Router, and DEAD from Tax ===\n");

  const rpcUrl   = hre.network.config.url;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const MMM      = await getContract("MMMToken",  process.env.TESTNET_MMM,      deployer);
  const TaxVault = await getContract("TaxVault",  process.env.TESTNET_TAXVAULT, deployer);
  const Router   = await getContract("MockRouter", process.env.TESTNET_ROUTER,  deployer);

  const DEAD = "0x000000000000000000000000000000000000dEaD";

  console.log("Addresses:");
  console.log("  MMM:      ", MMM.target);
  console.log("  TaxVault: ", TaxVault.target);
  console.log("  Router:   ", Router.target);
  console.log("  DEAD:     ", DEAD);
  console.log();

  // Get all vaults too
  const [rewardVault, swapVault, marketingVault, teamVestingVault] = await Promise.all([
    TaxVault.rewardVault(),
    TaxVault.swapVault(),
    TaxVault.marketingVault(),
    TaxVault.teamVestingVault()
  ]);

  console.log("Vaults:");
  console.log("  Reward:    ", rewardVault);
  console.log("  Swap:      ", swapVault);
  console.log("  Marketing: ", marketingVault);
  console.log("  TeamVest:  ", teamVestingVault);
  console.log();

  // Addresses to exclude
  const toExclude = [
    { name: "TaxVault",      address: TaxVault.target },
    { name: "Router",        address: Router.target },
    { name: "DEAD",          address: DEAD },
    { name: "RewardVault",   address: rewardVault },
    { name: "SwapVault",     address: swapVault },
    { name: "MarketingVault", address: marketingVault },
    { name: "TeamVestingVault", address: teamVestingVault }
  ];

  console.log("Checking current tax exemption status...\n");

  let needsUpdate = false;

  for (const item of toExclude) {
    if (item.address === ethers.ZeroAddress) {
      console.log(`⚠️  ${item.name}: Not set (zero address)`);
      continue;
    }

    const isExempt = await MMM.isTaxExempt(item.address);
    console.log(`${item.name}: ${isExempt ? "✓ Exempt" : "❌ NOT exempt"}`);

    if (!isExempt) {
      needsUpdate = true;
    }
  }

  if (!needsUpdate) {
    console.log("\n✓ All addresses already exempt from tax!");
    return;
  }

  console.log("\n=== Excluding addresses from tax ===\n");

  for (const item of toExclude) {
    if (item.address === ethers.ZeroAddress) continue;

    const isExempt = await MMM.isTaxExempt(item.address);
    
    if (!isExempt) {
      console.log(`Excluding ${item.name}...`);
      
      try {
        const tx = await MMM.setTaxExempt(item.address, true);
        await tx.wait();
        console.log(`✓ ${item.name} excluded`);
      } catch (err) {
        console.log(`❌ Failed to exclude ${item.name}:`, err.message);
      }
    }
  }

  console.log("\n=== Verification ===\n");

  for (const item of toExclude) {
    if (item.address === ethers.ZeroAddress) continue;

    const isExempt = await MMM.isTaxExempt(item.address);
    console.log(`${item.name}: ${isExempt ? "✓" : "❌"}`);
  }

  console.log("\n=== FIX COMPLETE ===");
  console.log("\nNow try running the process test again:");
  console.log("npx hardhat run scripts/test-02-high-gas.js --network monadTestnet");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
