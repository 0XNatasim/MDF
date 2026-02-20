/**
 * deploy-step1.js
 * ─────────────────────────────────────────────────────────────
 * Deploys: WMON, USDC, Factory
 * Then prints the REAL INIT_CODE_HASH you must paste into
 * UniswapV2Library.sol before running deploy-step2.js
 *
 * Usage:
 *   npx hardhat run scripts/deploy-step1.js --network monadTestnet
 * ─────────────────────────────────────────────────────────────
 */
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("================================================");
  console.log("STEP 1 — WMON + USDC + FACTORY");
  console.log("Deployer:", deployer.address);
  console.log("================================================\n");

  /* ── 1. Deploy WMON ───────────────────────────────────────── */
  const WETH = await ethers.getContractFactory("WETH9");
  const weth = await WETH.deploy();
  await weth.waitForDeployment();
  const WETH_ADDR = await weth.getAddress();
  console.log("WMON deployed:   ", WETH_ADDR);

  /* ── 2. Deploy USDC ───────────────────────────────────────── */
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6, deployer.address);
  await usdc.waitForDeployment();
  const USDC_ADDR = await usdc.getAddress();
  console.log("USDC deployed:   ", USDC_ADDR);
  await (await usdc.mint(deployer.address, ethers.parseUnits("1000000", 6))).wait();
  console.log("USDC minted to deployer.");

  /* ── 3. Deploy Factory ────────────────────────────────────── */
  const Factory = await ethers.getContractFactory("UniswapV2Factory");
  const factory = await Factory.deploy(deployer.address);
  await factory.waitForDeployment();
  const FACTORY_ADDR = await factory.getAddress();
  console.log("Factory deployed:", FACTORY_ADDR);

  /* ── 4. Compute the real INIT_CODE_HASH ───────────────────── */
  const Pair = await ethers.getContractFactory("UniswapV2Pair");
  const realHash = ethers.keccak256(Pair.bytecode);
  const realHashNoPrefix = realHash.slice(2); // no 0x

  /* ── DONE — print instructions ────────────────────────────── */
  console.log("\n════════════════════════════════════════════════════");
  console.log("  ✅ STEP 1 COMPLETE");
  console.log("════════════════════════════════════════════════════");
  console.log("\n📋 Copy these into your .env now:\n");
  console.log(`  TESTNET_WMON=${WETH_ADDR}`);
  console.log(`  TESTNET_USDC=${USDC_ADDR}`);
  console.log(`  TESTNET_FACTORY=${FACTORY_ADDR}`);
  console.log("\n════════════════════════════════════════════════════");
  console.log("  ⚠️  BEFORE running deploy-step2.js you MUST:");
  console.log("════════════════════════════════════════════════════");
  console.log("\n  1. Open UniswapV2Library.sol (usually at:");
  console.log("     contracts/uniswap/periphery/libraries/UniswapV2Library.sol)");
  console.log("\n  2. Find this line (the hardcoded hash):");
  console.log("     hex'96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f'");
  console.log("\n  3. Replace the hex string with your real hash:");
  console.log(`     hex'${realHashNoPrefix}'`);
  console.log("\n     Full line should look like:");
  console.log(`     hex'${realHashNoPrefix}' // init code hash`);
  console.log("\n  4. Save the file, then recompile:");
  console.log("     npx hardhat compile");
  console.log("\n  5. Then run:");
  console.log("     npx hardhat run scripts/deploy-step2.js --network monadTestnet");
  console.log("\n════════════════════════════════════════════════════");
  console.log(`  REAL INIT_CODE_HASH (with 0x):    ${realHash}`);
  console.log(`  REAL INIT_CODE_HASH (no 0x):      ${realHashNoPrefix}`);
  console.log("════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});