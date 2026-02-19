const hre = require("hardhat");
const { ethers } = hre;

async function main() {

  console.log("\n=== ADD LIQUIDITY (DEEPEN POOL) ===\n");

  const [deployer] = await ethers.getSigners();

  const MMM = await ethers.getContractAt(
    "MMMToken",
    process.env.TESTNET_MMM,
    deployer
  );

  const WETH = await ethers.getContractAt(
    "WETH9",
    process.env.TESTNET_WMON,
    deployer
  );

  const ROUTER = new ethers.Contract(
    process.env.TESTNET_ROUTER,
    [
      "function addLiquidityETH(address,uint,uint,uint,address,uint) payable returns (uint,uint,uint)"
    ],
    deployer
  );

  const pairAddr = await MMM.pair();

  console.log("Pair:", pairAddr);
  console.log("Deployer:", deployer.address);

  const amountMMM = ethers.parseUnits("9000", 18);
  const amountMON = ethers.parseEther("9");

  console.log("Adding:");
  console.log("MMM:", ethers.formatUnits(amountMMM, 18));
  console.log("MON:", ethers.formatEther(amountMON));

  // Approve MMM to router
  await (await MMM.approve(process.env.TESTNET_ROUTER, amountMMM)).wait();

  const deadline = Math.floor(Date.now() / 1000) + 1200;

  const tx = await ROUTER.addLiquidityETH(
    process.env.TESTNET_MMM,
    amountMMM,
    0,
    0,
    deployer.address,
    deadline,
    { value: amountMON }
  );

  console.log("Tx sent:", tx.hash);
  await tx.wait();

  console.log("✅ Liquidity Added Successfully\n");

  // Check reserves
  const PAIR = await ethers.getContractAt("UniswapV2Pair", pairAddr);
  const [r0, r1] = await PAIR.getReserves();

  console.log("New reserves:");
  console.log("Reserve0:", r0.toString());
  console.log("Reserve1:", r1.toString());

  console.log("\n=== DONE ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
