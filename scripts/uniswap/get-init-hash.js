const hre = require("hardhat");
const { keccak256, toUtf8Bytes } = require("ethers");

async function main() {
  const artifact = await hre.artifacts.readArtifact("UniswapV2Pair");

  const bytecode = artifact.bytecode;

  const hash = hre.ethers.keccak256(bytecode);

  console.log("\n=== UniswapV2Pair INIT CODE HASH ===\n");
  console.log(hash);
  console.log("\nCopy this into UniswapV2Library.sol\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
