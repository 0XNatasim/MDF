const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // -------------------------------------------------
  // 1️⃣ Deploy Factory
  // -------------------------------------------------
  const Factory = await ethers.getContractFactory(
    "contracts/uniswap/core/UniswapV2Factory.sol:UniswapV2Factory"
  );

  const factory = await Factory.deploy(deployer.address);
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  console.log("Factory deployed at:", factoryAddress);

  // -------------------------------------------------
  // 2️⃣ Deploy WETH (if needed)
  // -------------------------------------------------
  const WETH = await ethers.getContractFactory("WETH9");
  const weth = await WETH.deploy();
  await weth.waitForDeployment();

  const wethAddress = await weth.getAddress();
  console.log("WETH deployed at:", wethAddress);

  // -------------------------------------------------
  // 3️⃣ Deploy Router
  // -------------------------------------------------
  const Router = await ethers.getContractFactory(
    "contracts/uniswap/periphery/UniswapV2Router02.sol:UniswapV2Router02"
  );

  const router = await Router.deploy(factoryAddress, wethAddress);
  await router.waitForDeployment();

  const routerAddress = await router.getAddress();
  console.log("Router deployed at:", routerAddress);

  console.log("\n==== DONE ====");
  console.log("Factory:", factoryAddress);
  console.log("Router :", routerAddress);
  console.log("WETH   :", wethAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
