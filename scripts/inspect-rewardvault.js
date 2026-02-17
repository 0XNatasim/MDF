// scripts/inspect-rewardvault.js
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("\n=== INSPECTING REWARDVAULT ABI ===\n");

  const provider = new ethers.JsonRpcProvider(hre.network.config.url);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const RV = await ethers.getContractAt("RewardVault", process.env.TESTNET_REWARDVAULT, deployer);

  console.log("Available functions and state variables:");
  
  const functions = RV.interface.fragments
    .filter(f => f.type === "function")
    .map(f => ({
      name: f.name,
      inputs: f.inputs.map(i => i.type).join(", "),
      outputs: f.outputs?.map(o => o.type).join(", ") || "void",
      stateMutability: f.stateMutability
    }));

  functions.forEach(f => {
    console.log(`- ${f.name}(${f.inputs}) → ${f.outputs} [${f.stateMutability}]`);
  });

  console.log("\nLooking for 'hold' related functions:");
  const holdFuncs = functions.filter(f => f.name.toLowerCase().includes('hold'));
  holdFuncs.forEach(f => {
    console.log(`  ✓ ${f.name}(${f.inputs}) → ${f.outputs}`);
  });

  console.log("\n=== INSPECTION COMPLETE ===");
}

main().catch(console.error);