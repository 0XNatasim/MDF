/**
 * deploy-step2.js
 * ─────────────────────────────────────────────────────────────
 * Prerequisite: deploy-step1.js has been run AND you have:
 *   1. Updated UniswapV2Library.sol with the new INIT_CODE_HASH
 *   2. Run: npx hardhat compile
 *   3. Added TESTNET_WMON, TESTNET_USDC, TESTNET_FACTORY to .env
 *
 * Deploys: Router, MMM, TaxVault, RewardVault, MarketingVault,
 *          TeamVestingVault, BoostNFT, Pair, liquidity, launch.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-step2.js --network monadTestnet
 * ─────────────────────────────────────────────────────────────
 */
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("================================================");
  console.log("STEP 2 — FULL MMM DEPLOY");
  console.log("Deployer:", deployer.address);
  console.log("================================================\n");

  /* ── Load step-1 addresses from .env ─────────────────────── */
  const WETH_ADDR    = process.env.TESTNET_WMON;
  const USDC_ADDR    = process.env.TESTNET_USDC;
  const FACTORY_ADDR = process.env.TESTNET_FACTORY;

  if (!WETH_ADDR || !USDC_ADDR || !FACTORY_ADDR) {
    throw new Error(
      "Missing env vars: TESTNET_WMON, TESTNET_USDC, TESTNET_FACTORY\n" +
      "Run deploy-step1.js first and add those to your .env."
    );
  }

  console.log("Using from Step 1:");
  console.log("  WMON:   ", WETH_ADDR);
  console.log("  USDC:   ", USDC_ADDR);
  console.log("  Factory:", FACTORY_ADDR);

  /* ── Multisig owners ──────────────────────────────────────── */
  const MULTISIG_OWNERS = [
    deployer.address,
    process.env.TESTNET_MULTISIG_2 || deployer.address,
    process.env.TESTNET_MULTISIG_3 || deployer.address,
  ];
  const unique = new Set(MULTISIG_OWNERS);
  if (unique.size !== 3) {
    throw new Error(
      "MULTISIG owners must be 3 unique addresses. Set TESTNET_MULTISIG_2 and TESTNET_MULTISIG_3 in .env"
    );
  }

  /* ── Contract handles for already-deployed contracts ─────── */
  const weth    = await ethers.getContractAt("WETH9",            WETH_ADDR,    deployer);
  const factory = await ethers.getContractAt("UniswapV2Factory", FACTORY_ADDR, deployer);

  /* ============================================================
     VERIFY the hash was updated correctly before spending gas
  ============================================================ */
  console.log("\nVerifying INIT_CODE_HASH is correct in compiled Router...");

  const Pair = await ethers.getContractFactory("UniswapV2Pair");
  const realHash       = ethers.keccak256(Pair.bytecode);
  const realHashNoPrefix = realHash.slice(2).toLowerCase();

  const Router = await ethers.getContractFactory("UniswapV2Router02");
  const routerBytecodeCheck = Router.bytecode.toLowerCase();

  if (!routerBytecodeCheck.includes(realHashNoPrefix)) {
    console.error("\n❌ STOP — UniswapV2Library.sol has NOT been updated correctly.");
    console.error("   The compiled Router bytecode does not contain the real hash:");
    console.error(`   ${realHash}`);
    console.error("\n   Steps to fix:");
    console.error("   1. Open UniswapV2Library.sol");
    console.error("   2. Find the hardcoded hex'...' hash line");
    console.error(`   3. Replace it with: hex'${realHashNoPrefix}'`);
    console.error("   4. Run: npx hardhat compile");
    console.error("   5. Re-run this script.");
    process.exit(1);
  }
  console.log("✅ Router bytecode contains the correct INIT_CODE_HASH ✓");
  console.log(`   Hash: ${realHash}\n`);

  /* ============================================================
     1. Deploy Router
  ============================================================ */
  const router = await Router.deploy(FACTORY_ADDR, WETH_ADDR);
  await router.waitForDeployment();
  const ROUTER_ADDR = await router.getAddress();
  console.log("Router deployed:        ", ROUTER_ADDR);

  /* ============================================================
     2. Deploy MMM Token
  ============================================================ */
  const MMM = await ethers.getContractFactory("MMMToken");
  const initialSupply = ethers.parseUnits("1000000000", 18); // 1B
  const mmm = await MMM.deploy(
    "Monad Money Machine",
    "MMM",
    initialSupply,
    deployer.address
  );
  await mmm.waitForDeployment();
  const MMM_ADDR = await mmm.getAddress();
  console.log("MMM deployed:           ", MMM_ADDR);

  /* ============================================================
     3. Deploy TaxVault
  ============================================================ */
  const TaxVault = await ethers.getContractFactory("TaxVault");
  const taxVault = await TaxVault.deploy(
    MMM_ADDR,
    USDC_ADDR,
    WETH_ADDR,
    deployer.address
  );
  await taxVault.waitForDeployment();
  const TAXVAULT_ADDR = await taxVault.getAddress();
  console.log("TaxVault deployed:      ", TAXVAULT_ADDR);

  /* ============================================================
     4. Deploy RewardVault
  ============================================================ */
  const RewardVault = await ethers.getContractFactory("RewardVault");
  const rewardVault = await RewardVault.deploy(
    MMM_ADDR,
    60 * 60,   /* 7 * 24 * 3600 */
    15 * 60,   /* 24 * 3600 */
    ethers.parseUnits("1000", 18),
    deployer.address
  );
  await rewardVault.waitForDeployment();
  const REWARDVAULT_ADDR = await rewardVault.getAddress();
  console.log("RewardVault deployed:   ", REWARDVAULT_ADDR);

  /* ============================================================
     5. Deploy MarketingVault
  ============================================================ */
  const MarketingVault = await ethers.getContractFactory("MarketingVault");
  const marketingVault = await MarketingVault.deploy(USDC_ADDR, MULTISIG_OWNERS);
  await marketingVault.waitForDeployment();
  const MARKETINGVAULT_ADDR = await marketingVault.getAddress();
  console.log("MarketingVault deployed:", MARKETINGVAULT_ADDR);

  /* ============================================================
     6. Deploy TeamVestingVault
  ============================================================ */
  const TeamVestingVault = await ethers.getContractFactory("TeamVestingVault");
  const teamVestingVault = await TeamVestingVault.deploy(USDC_ADDR, MULTISIG_OWNERS);
  await teamVestingVault.waitForDeployment();
  const TEAMVESTINGVAULT_ADDR = await teamVestingVault.getAddress();
  console.log("TeamVestingVault deployed:", TEAMVESTINGVAULT_ADDR);

  /* ============================================================
     7. Deploy BoostNFT
  ============================================================ */
  const BoostNFT = await ethers.getContractFactory("BoostNFT");
  const boostNFT = await BoostNFT.deploy(deployer.address);
  await boostNFT.waitForDeployment();
  const BOOSTNFT_ADDR = await boostNFT.getAddress();
  console.log("BoostNFT deployed:      ", BOOSTNFT_ADDR);

  /* ============================================================
     8. Create MMM / WMON Pair
  ============================================================ */
  await (await factory.createPair(MMM_ADDR, WETH_ADDR)).wait();
  const PAIR_ADDR = await factory.getPair(MMM_ADDR, WETH_ADDR);
  console.log("Pair created:           ", PAIR_ADDR);

  /* ============================================================
     9. Wire MMM Token
  ============================================================ */
  await (await mmm.setPair(PAIR_ADDR)).wait();
  await (await mmm.setRouter(ROUTER_ADDR)).wait();
  await (await mmm.setTaxVaultOnce(TAXVAULT_ADDR)).wait();
  console.log("MMM wired (pair, router, taxVault).");

  /* ============================================================
     10. Tax Exemptions
  ============================================================ */
  await (await mmm.setTaxExempt(deployer.address,    true)).wait();
  await (await mmm.setTaxExempt(TAXVAULT_ADDR,       true)).wait();
  await (await mmm.setTaxExempt(ROUTER_ADDR,         true)).wait();
  await (await mmm.setTaxExempt(REWARDVAULT_ADDR,    true)).wait();
  console.log("Tax exemptions configured.");

  /* ============================================================
     11. Wire TaxVault
  ============================================================ */
  await (await taxVault.setRouter(ROUTER_ADDR)).wait();
  await (await taxVault.approveRouter()).wait();
  await (await taxVault.wireOnce(
    REWARDVAULT_ADDR,
    MARKETINGVAULT_ADDR,
    TEAMVESTINGVAULT_ADDR
  )).wait();
  console.log("TaxVault wired.");

  /* ============================================================
     12. Wire RewardVault
  ============================================================ */
  await (await rewardVault.setBoostNFT(BOOSTNFT_ADDR)).wait();
  console.log("RewardVault: BoostNFT set.");

  await (await rewardVault.addExcludedRewardAddress(PAIR_ADDR)).wait();
  await (await rewardVault.addExcludedRewardAddress(TAXVAULT_ADDR)).wait();
  await (await rewardVault.addExcludedRewardAddress(deployer.address)).wait();
  console.log("RewardVault: exclusions set.");

  await (await rewardVault.transferOwnership(TAXVAULT_ADDR)).wait();
  console.log("RewardVault: ownership transferred to TaxVault.");

  /* ============================================================
     13. Add Initial Liquidity (manual seed, bypasses router)
  ============================================================ */
  const amountMMM = ethers.parseUnits("10000", 18);
  const amountETH = ethers.parseEther("10");

  const pair = await ethers.getContractAt("UniswapV2Pair", PAIR_ADDR);

  await (await mmm.transfer(PAIR_ADDR, amountMMM)).wait();
  await (await weth.deposit({ value: amountETH })).wait();
  await (await weth.transfer(PAIR_ADDR, amountETH)).wait();
  await (await pair.mint(deployer.address, { gasLimit: 300000 })).wait();
  console.log("Liquidity seeded: 10000 MMM + 10 WMON.");

  /* ============================================================
     13.5. Verify getAmountsOut end-to-end (liquidity now exists)
  ============================================================ */
  console.log("\nVerifying router getAmountsOut end-to-end...");
  const ROUTER_ABI = ["function getAmountsOut(uint256,address[]) view returns (uint256[])"];
  const routerView = new ethers.Contract(ROUTER_ADDR, ROUTER_ABI, deployer);
  try {
    const amounts = await routerView.getAmountsOut(
      ethers.parseEther("1"),
      [WETH_ADDR, MMM_ADDR]
    );
    console.log("✅ getAmountsOut: 1 WMON →", ethers.formatUnits(amounts[1], 18), "MMM");
    console.log("   Router + pair + INIT_CODE_HASH all wired correctly ✓\n");
  } catch (e) {
    console.error("❌ getAmountsOut failed:", e.message);
    process.exit(1);
  }

  /* ============================================================
     14. Launch Token
  ============================================================ */
  await (await mmm.launch()).wait();
  console.log("Token launched. 🚀");

  /* ============================================================
     SUMMARY
  ============================================================ */
  console.log("\n================================================");
  console.log("✅ DEPLOY COMPLETE");
  console.log("================================================");
  console.log("\nCopy these into your .env:\n");
  console.log(`TESTNET_WMON=${WETH_ADDR}`);
  console.log(`TESTNET_USDC=${USDC_ADDR}`);
  console.log(`TESTNET_FACTORY=${FACTORY_ADDR}`);
  console.log(`TESTNET_ROUTER=${ROUTER_ADDR}`);
  console.log(`TESTNET_MMM=${MMM_ADDR}`);
  console.log(`TESTNET_PAIR=${PAIR_ADDR}`);
  console.log(`TESTNET_TAX_VAULT=${TAXVAULT_ADDR}`);
  console.log(`TESTNET_REWARD_VAULT=${REWARDVAULT_ADDR}`);
  console.log(`TESTNET_MARKETING_VAULT=${MARKETINGVAULT_ADDR}`);
  console.log(`TESTNET_TEAM_VAULT=${TEAMVESTINGVAULT_ADDR}`);
  console.log(`TESTNET_BOOST_NFT=${BOOSTNFT_ADDR}`);
  console.log("\n================================================");
  console.log("\nCopy these into your App.js:\n");
  console.log("\n================================================");
  console.log(`  mmmToken: "${MMM_ADDR}",`);
  console.log(`  rewardVault: "${REWARDVAULT_ADDR}",`);
  console.log(`  taxVault: "${TAXVAULT_ADDR}",`);
  console.log(`  router: "${ROUTER_ADDR}",`);
  console.log(`  pair: "${PAIR_ADDR}",`);
  console.log(`  wmon: "${WETH_ADDR}",`);
  console.log(`  tracker: "${ROUTER_ADDR}",`);
  console.log(`  boostNFT: "${BOOSTNFT_ADDR}",`);



  


  console.log("\n================================================");
  console.log("⚠️  POST-DEPLOY CHECKLIST:");
  console.log("1. Update .env with all addresses above.");
  console.log("2. Set TESTNET_MULTISIG_2 and TESTNET_MULTISIG_3 for");
  console.log("   proper 2-of-3 multisig on Marketing/TeamVesting vaults.");
  console.log("3. RewardVault ownership → TaxVault ✓ (done)");
  console.log("4. Test a buy: npx hardhat run scripts/test_buy.js --network monadTestnet");
  console.log("================================================\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});