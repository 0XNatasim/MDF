// scripts/deploy_liquidity_remover.js
// Deploys the LiquidityRemover helper contract
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying LiquidityRemover with account:", deployer.address);

  const LiquidityRemover = await hre.ethers.getContractFactory("LiquidityRemover");
  const remover = await LiquidityRemover.deploy();

  await remover.waitForDeployment();
  const address = await remover.getAddress();

  console.log("LiquidityRemover deployed to:", address);
  console.log("You can now use this address in remove_liquidity_and_withdraw_mon.js");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

