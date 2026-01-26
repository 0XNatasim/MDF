const hre = require("hardhat");

async function main() {
  const Pair = await hre.ethers.getContractFactory("MockPair");
  const pair = await Pair.deploy();
  await pair.waitForDeployment();

  console.log("MockPair:", await pair.getAddress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
