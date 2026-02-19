const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("\n=== CHECK PAIR RESERVES ===\n");

  const provider = new ethers.JsonRpcProvider(hre.network.config.url);
  const [deployer] = await ethers.getSigners();

  const Factory = await ethers.getContractAt(
    "UniswapV2Factory",
    process.env.TESTNET_Factory,
    deployer
  );

  const pairAddr = await Factory.getPair(
    process.env.TESTNET_WMON,
    process.env.TESTNET_MMM
  );
  console.log("Pair address:", pairAddr);

  if (pairAddr === ethers.ZeroAddress) {
    console.log("❌ Pair does not exist — liquidity was never seeded.");
    return;
  }

  const Pair = await ethers.getContractAt("UniswapV2Pair", pairAddr, deployer);

  const [token0, token1, reserves] = await Promise.all([
    Pair.token0(),
    Pair.token1(),
    Pair.getReserves(),
  ]);

  console.log("Token0:", token0);
  console.log("Token1:", token1);
  console.log("Reserve0:", ethers.formatEther(reserves[0]));
  console.log("Reserve1:", ethers.formatEther(reserves[1]));

  const mmmIsToken0 = token0.toLowerCase() === process.env.TESTNET_MMM.toLowerCase();
  const mmmReserve  = mmmIsToken0 ? reserves[0] : reserves[1];
  const wmonReserve = mmmIsToken0 ? reserves[1] : reserves[0];

  console.log("\nMMM  reserve:", ethers.formatUnits(mmmReserve, 18));
  console.log("WMON reserve:", ethers.formatEther(wmonReserve));

  if (mmmReserve === 0n || wmonReserve === 0n) {
    console.log("\n❌ One or both reserves are 0 — swap will revert.");
  } else {
    console.log("\n✅ Reserves look good — swap should work with gasLimit override.");
  }

  console.log("\n=== DONE ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
