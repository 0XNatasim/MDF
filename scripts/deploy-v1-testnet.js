// scripts/deploy-v1-locked-testnet.js
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {

  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  console.log("=== MMM v1 FULL DEPLOY ===");
  console.log("Network :", hre.network.name);
  console.log("Deployer:", deployer.address);
  console.log("ChainId :", net.chainId.toString());
  console.log("");

  // --------------------------------------------------
  // 1. Deploy Mock WMON
  // --------------------------------------------------

  const MockERC20 = await ethers.getContractFactory("MockERC20");

  const wmon = await MockERC20.deploy(
    "Wrapped MON",
    "WMON",
    18,
    deployer.address
  );
  await wmon.waitForDeployment();
  const WMON = await wmon.getAddress();

  await (await wmon.mint(deployer.address, ethers.parseUnits("1000000", 18))).wait();

  console.log("WMON deployed:", WMON);
  await sleep(500);

  // --------------------------------------------------
  // 2. Deploy Mock USDC
  // --------------------------------------------------

  const usdc = await MockERC20.deploy(
    "USD Coin",
    "USDC",
    6,
    deployer.address
  );
  await usdc.waitForDeployment();
  const USDC = await usdc.getAddress();

  await (await usdc.mint(deployer.address, ethers.parseUnits("1000000", 6))).wait();

  console.log("USDC deployed:", USDC);
  await sleep(500);

  // --------------------------------------------------
  // 3. Deploy MMMToken
  // --------------------------------------------------

  const MMM_SUPPLY = ethers.parseUnits("1000000000", 18);

  const MMMToken = await ethers.getContractFactory("MMMToken");
  const mmm = await MMMToken.deploy(
    "Monad Money Machine",
    "MMM",
    MMM_SUPPLY,
    deployer.address
  );
  await mmm.waitForDeployment();
  const MMM = await mmm.getAddress();

  console.log("MMMToken deployed:", MMM);
  await sleep(500);

  // --------------------------------------------------
  // 4. Deploy MockRouter
  // --------------------------------------------------

  const MockRouter = await ethers.getContractFactory("MockRouter");
  const router = await MockRouter.deploy(MMM, WMON, USDC);
  await router.waitForDeployment();
  const ROUTER = await router.getAddress();

  console.log("MockRouter deployed:", ROUTER);
  await sleep(500);

  // --------------------------------------------------
  // Transfer ownership to router
  // --------------------------------------------------

  console.log("\n=== TRANSFERRING TOKEN OWNERSHIP TO ROUTER ===");

  await (await usdc.transferOwnership(ROUTER)).wait();
  console.log("✓ USDC ownership → Router");

  await (await wmon.transferOwnership(ROUTER)).wait();
  console.log("✓ WMON ownership → Router");

  console.log("=== OWNERSHIP TRANSFER COMPLETE ===\n");
  await sleep(500);

  // --------------------------------------------------
  // 5. Deploy TaxVault
  // --------------------------------------------------

  const TaxVault = await ethers.getContractFactory("TaxVault");
  const taxVault = await TaxVault.deploy(
    MMM,
    USDC,
    WMON,
    deployer.address
  );
  await taxVault.waitForDeployment();
  const TAX_VAULT = await taxVault.getAddress();

  console.log("TaxVault deployed:", TAX_VAULT);
  await sleep(500);

  // --------------------------------------------------
  // 6. Deploy RewardVault
  // --------------------------------------------------

  const RewardVault = await ethers.getContractFactory("RewardVault");

  // 🔥 TEST PARAMETERS
  const MIN_BALANCE = ethers.parseUnits("1", 18);
  const MIN_HOLD = 30;       // 30 seconds
  const COOLDOWN = 10;       // 10 seconds

  const rewardVault = await RewardVault.deploy(
    MMM,
    MIN_HOLD,
    COOLDOWN,
    MIN_BALANCE,
    deployer.address
  );

  await rewardVault.waitForDeployment();
  const REWARD_VAULT = await rewardVault.getAddress();

  console.log("RewardVault deployed:", REWARD_VAULT);
  await sleep(500);

  // --------------------------------------------------
  // 7. Deploy SwapVault
  // --------------------------------------------------

  const SwapVault = await ethers.getContractFactory("SwapVault");

  const swapVault = await SwapVault.deploy(
    MMM,
    WMON,
    deployer.address
  );

  await swapVault.waitForDeployment();
  const SWAP_VAULT = await swapVault.getAddress();

  console.log("SwapVault deployed:", SWAP_VAULT);
  await sleep(500);

  // --------------------------------------------------
  // 8. Deploy MarketingVault (multisig)
  // --------------------------------------------------

  if (!process.env.DOPTESTNET || !process.env.TESTER || !process.env.CLAIMER) {
    throw new Error("Missing multisig env vars (DOPTESTNET / TESTER / CLAIMER)");
  }

  const MarketingVault = await ethers.getContractFactory("MarketingVault");

  const marketingVault = await MarketingVault.deploy(
    USDC,
    [
      process.env.DOPTESTNET,
      process.env.TESTER,
      process.env.CLAIMER
    ]
  );

  await marketingVault.waitForDeployment();
  const MARKETING_VAULT = await marketingVault.getAddress();

  console.log("MarketingVault deployed:", MARKETING_VAULT);
  await sleep(500);

  // --------------------------------------------------
  // 9. Team Vault (fallback if not set)
  // --------------------------------------------------

  let TEAM_VAULT = process.env.TESTNET_TEAM_VESTING_MULTISIG;

  if (!TEAM_VAULT) {
    TEAM_VAULT = deployer.address; // safe fallback for localhost
    console.log("⚠️ Using deployer as TEAM_VAULT (no env provided)");
  } else {
    console.log("Using existing TeamVestingVault:", TEAM_VAULT);
  }

  await sleep(500);

  // --------------------------------------------------
  // 10. WIRING
  // --------------------------------------------------

  console.log("\n=== WIRING CONTRACTS ===");

  await (await taxVault.wireOnce(
    REWARD_VAULT,
    SWAP_VAULT,
    MARKETING_VAULT,
    TEAM_VAULT
  )).wait();
  console.log("✓ TaxVault.wireOnce");

  await (await taxVault.setRouter(ROUTER)).wait();
  console.log("✓ TaxVault.setRouter");

  await (await swapVault.setRouterOnce(ROUTER)).wait();
  await (await swapVault.setTaxVaultOnce(TAX_VAULT)).wait();
  console.log("✓ SwapVault wired");

  await (await mmm.setTaxVaultOnce(TAX_VAULT)).wait();
  console.log("✓ MMMToken.setTaxVaultOnce");

  console.log("\n=== WIRING COMPLETE ===");

  // --------------------------------------------------
  // Exemptions
  // --------------------------------------------------
  await (await mmm.setTaxExempt(TAX_VAULT, true)).wait();
  await (await mmm.setTaxExempt(ROUTER, true)).wait();
  console.log("✓ Tax exemptions set");

  await rewardVault.transferOwnership(TAX_VAULT);
  console.log("✓ RewardVault ownership → TaxVault");

  // --------------------------------------------------
  // launch
  // --------------------------------------------------
  const launchTx = await mmm.launch();
  await launchTx.wait();
  console.log("✓ Trading launched");


  const alreadyLaunched = await mmm.launched();

  if (!alreadyLaunched) {
    const launchTx = await mmm.launch();
    await launchTx.wait();
    console.log("✓ Trading launched");
  } else {
    console.log("✓ Trading already launched");
  }





  // --------------------------------------------------
  // 11. Manifest
  // --------------------------------------------------

  const manifest = {
    network: hre.network.name,
    chainId: Number(net.chainId),
    deployer: deployer.address,
    contracts: {
      MMM,
      WMON,
      USDC,
      ROUTER,
      TAX_VAULT,
      REWARD_VAULT,
      SWAP_VAULT,
      MARKETING_VAULT,
      TEAM_VAULT
    },
    timestamp: new Date().toISOString()
  };

  const outDir = path.join("deployments", hre.network.name);
  fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, "latest.json");
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

  console.log("\nManifest written:", outPath);
  console.log("\n=== DEPLOY COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
