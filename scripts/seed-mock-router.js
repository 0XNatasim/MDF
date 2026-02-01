// scripts/seed-mock-router.js
// Usage: npx hardhat run --network monadTestnet scripts/seed-mock-router.js
//
// The MockRouter pays out tokenOut 1:1 on swaps, but only up to its own balance.
// TaxVault swaps MMM→USDC, so the router needs to be pre-funded with USDC.
// This script mints USDC to the deployer (we own the MockERC20) and calls
// router.fund() to transfer it in.
//
// Run AFTER deploy, BEFORE test-02.

const hre = require("hardhat");
const { ethers } = hre;

async function getContract(name, address, signer) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new ethers.Contract(address, artifact.abi, signer);
}

async function main() {
  console.log("=== Seed MockRouter with USDC ===\n");

  const rpcUrl   = hre.network.config.url;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const USDC   = await getContract("MockERC20",   process.env.TESTNET_USDC,   deployer);
  const Router = await getContract("MockRouter",  process.env.TESTNET_ROUTER, deployer);

  // How much USDC to seed — 1M should be more than enough for any test run.
  // USDC is 6 decimals.
  const seedAmount = ethers.parseUnits("1000000", 6);

  // 1) Mint USDC to deployer (we deployed MockERC20 so we are the minter)
  console.log("Minting", ethers.formatUnits(seedAmount, 6), "USDC to deployer...");
  await (await USDC.mint(deployer.address, seedAmount)).wait();
  console.log("✓ Minted");

  // 2) Approve router to pull from deployer
  console.log("Approving router...");
  await (await USDC.approve(Router.target, seedAmount)).wait();
  console.log("✓ Approved");

  // 3) Call router.fund() — pulls USDC from deployer into router
  console.log("Funding router...");
  await (await Router.fund(USDC.target, seedAmount)).wait();
  console.log("✓ Funded");

  // 4) Verify
  const routerBal = await USDC.balanceOf(Router.target);
  console.log("\nMockRouter USDC balance:", ethers.formatUnits(routerBal, 6));
  console.log("\n=== SEED COMPLETE — safe to run test-02 ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});