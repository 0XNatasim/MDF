// scripts/check-network.js
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const net = await ethers.provider.getNetwork();
  const block = await ethers.provider.getBlock("latest");

  console.log("=== NETWORK CHECK ===");
  console.log("hre.network.name:", hre.network.name);
  console.log("chainId:", net.chainId.toString());
  console.log("latest block:", block.number);
  console.log("timestamp:", block.timestamp);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
