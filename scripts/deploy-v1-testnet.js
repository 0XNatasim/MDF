// scripts/deploy-v1-locked-testnet.js
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

// ------------------------------------------------------------
// RPC throttle helper (Monad testnet protection)
// ------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  console.log("=== MMM v1 FULL TESTNET DEPLOY ===");
  console.log("Deployer:", deployer.address);
  console.log("ChainId :", net.chainId.toString());
  console.log("");

  /* -----------------------------------------------------------
     1. Mock WMON
  ------------------------------------------------------------ */
  const MockERC20 = await ethers.getContractFactory("MockERC20");

  const wmon = await MockERC20.deploy(
    "Wrapped MON",
    "WMON",
    18,
    deployer.address
  );
  await wmon.waitForDeployment();
  await sleep(1500);

  const WMON = await wmon.getAddress();
  await wmon.mint(deployer.address, ethers.parseUnits("1000000", 18));
  await sleep(1500);

  console.log("WMON deployed:", WMON);

  /* -----------------------------------------------------------
     2. Mock USDC
  ------------------------------------------------------------ */
  const usdc = await MockERC20.deploy(
    "USD Coin",
    "USDC",
    6,
    deployer.address
  );
  await usdc.waitForDeployment();
  await sleep(1500);

  const USDC = await usdc.getAddress();
  await usdc.mint(deployer.address, ethers.parseUnits("1000000", 6));
  await sleep(1500);

  console.log("USDC deployed:", USDC);

  /* -----------------------------------------------------------
     3. MMMToken
  ------------------------------------------------------------ */
  const MMM_SUPPLY = ethers.parseUnits("1000000000", 18);

  const MMMToken = await ethers.getContractFactory("MMMToken");
  const mmm = await MMMToken.deploy(
    "Monad Money Machine",
    "MMM",
    MMM_SUPPLY,
    deployer.address
  );
  await mmm.waitForDeployment();
  await sleep(1500);

  const MMM = await mmm.getAddress();
  console.log("MMMToken deployed:", MMM);


  /* -----------------------------------------------------------
     4. Mock Router
  ------------------------------------------------------------ */
  const MockRouter = await ethers.getContractFactory("MockRouter");
  const router = await MockRouter.deploy(MMM, WMON, USDC);
  await router.waitForDeployment();
  await sleep(1500);

  const ROUTER = await router.getAddress();
  console.log("MockRouter deployed:", ROUTER);

  /* -----------------------------------------------------------
     5. TaxVault
  ------------------------------------------------------------ */
  const TaxVault = await ethers.getContractFactory("TaxVault");
  const taxVault = await TaxVault.deploy(
    MMM,
    USDC,
    WMON,
    deployer.address
  );
  await taxVault.waitForDeployment();
  await sleep(1500);

  const TAX_VAULT = await taxVault.getAddress();
  console.log("TaxVault deployed:", TAX_VAULT);

  /* -----------------------------------------------------------
     6. RewardVault
  ------------------------------------------------------------ */
  const RewardVault = await ethers.getContractFactory("RewardVault");
  const rewardVault = await RewardVault.deploy(
    MMM,
    43200,
    43200,
    ethers.parseUnits("1", 18),
    deployer.address
  );
  await rewardVault.waitForDeployment();
  await sleep(1500);

  const REWARD_VAULT = await rewardVault.getAddress();
  console.log("RewardVault deployed:", REWARD_VAULT);

  /* -----------------------------------------------------------
     7. BoostVault (USDC)
  ------------------------------------------------------------ */
  const BoostVault = await ethers.getContractFactory("BoostVault");
  const boostVault = await BoostVault.deploy(
    USDC,
    deployer.address
  );
  await boostVault.waitForDeployment();
  await sleep(1500);

  const BOOST_VAULT = await boostVault.getAddress();
  console.log("BoostVault deployed:", BOOST_VAULT);

  /* -----------------------------------------------------------
     8. SwapVault (MMM / WMON)
  ------------------------------------------------------------ */
  const SwapVault = await ethers.getContractFactory("SwapVault");
  const swapVault = await SwapVault.deploy(
    MMM,
    WMON,
    deployer.address
  );
  await swapVault.waitForDeployment();
  await sleep(1500);

  const SWAP_VAULT = await swapVault.getAddress();
  console.log("SwapVault deployed:", SWAP_VAULT);

  /* -----------------------------------------------------------
     9. MarketingVault (2-of-3 multisig)
  ------------------------------------------------------------ */
  if (!process.env.DOPTESTNET || !process.env.TESTER || !process.env.CLAIMER) {
    throw new Error("Missing multisig env vars");
  }

  const MarketingVault = await ethers.getContractFactory("MarketingVault");
  const marketingVault = await MarketingVault.deploy(
    USDC,
    [
      process.env.DOPTESTNET,
      process.env.TESTER,
      process.env.CLAIMER,
    ]
  );
  await marketingVault.waitForDeployment();
  await sleep(1500);

  const MARKETING_VAULT = await marketingVault.getAddress();
  console.log("MarketingVault deployed:", MARKETING_VAULT);

  /* -----------------------------------------------------------
     10. TeamVestingVault (already deployed)
  ------------------------------------------------------------ */
  const TEAM_VAULT = process.env.TESTNET_TEAM_VESTING_MULTISIG;
  if (!TEAM_VAULT) throw new Error("Missing TESTNET_TEAM_VESTING_MULTISIG");
  console.log("Using existing TeamVestingVault:", TEAM_VAULT);

  /* -----------------------------------------------------------
     11. WIRING (CORRECT WAY)
  ------------------------------------------------------------ */
  console.log("\n=== WIRING CONTRACTS ===");

  await taxVault.wireOnce(
    REWARD_VAULT,
    BOOST_VAULT,
    SWAP_VAULT,
    MARKETING_VAULT,
    TEAM_VAULT
  );
  await sleep(1500);
  console.log("✓ TaxVault.wireOnce");

  await taxVault.setRouter(ROUTER);
  await sleep(1500);
  console.log("✓ TaxVault.setRouter");

  await swapVault.setRouter(ROUTER);
  await sleep(1500);
  await swapVault.setTaxVault(TAX_VAULT);
  await sleep(1500);
  console.log("✓ SwapVault wired");

  await boostVault.setRewardVaultOnce(REWARD_VAULT);
  await sleep(1500);
  console.log("✓ BoostVault.setRewardVaultOnce");

  await mmm.setTaxVaultOnce(TAX_VAULT);
  await sleep(1500);
  console.log("✓ MMMToken.setTaxVaultOnce");

  console.log("\n=== WIRING COMPLETE ===");

  /* -----------------------------------------------------------
     12. Manifest
  ------------------------------------------------------------ */
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
      BOOST_VAULT,
      SWAP_VAULT,
      MARKETING_VAULT,
      TEAM_VAULT,
    },
    timestamp: new Date().toISOString(),
  };

  const outDir = path.join("deployments", hre.network.name);
  fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, "latest.json");
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

  console.log("\nManifest written:", outPath);
  console.log("\n=== TESTNET DEPLOY COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
