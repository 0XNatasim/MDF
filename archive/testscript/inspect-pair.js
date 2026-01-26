const hre = require("hardhat");

async function main() {
  const { ethers } = hre;

  const PAIR_ADDR = "0xca3CADD2724465B7ec6bd80edFB31E6Ffd41FF2E";

  const PAIR_ABI = [
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
  ];

  const pair = new ethers.Contract(PAIR_ADDR, PAIR_ABI, ethers.provider);

  const t0 = await pair.token0();
  const t1 = await pair.token1();

  console.log("token0:", t0);
  console.log("token1:", t1);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
