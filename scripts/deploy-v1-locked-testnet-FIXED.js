// scripts/deploy-v1-locked-testnet.js
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  console.log("=== MMM v1 FULL TESTNET DEPLOY ===");
  console.log("Deployer:", deployer.address);
  console.log("ChainId :", net.chainId.toString());
  console.log("");

  /* -----------------------------------------------------------
     1. Deploy Mock WMON
  ------------------------------------------------------------ */
  const MockERC20 = await ethers.getContractFactory("MockERC20");

  const wmon = await MockERC20.deploy(
    "Wrapped MON",
    "WMON",
    18,
    deployer.address
  );
  await wmon.waitForDeployment();
  const WMON = await wmon.getAddress();
  await wmon.mint(deployer.address, ethers.parseUnits("1000000", 18));
  console.log("WMON deployed:", WMON);

  /* -----------------------------------------------------------
     2. Deploy Mock USDC
  ------------------------------------------------------------ */
  const usdc = await MockERC20.deploy(
    "USD Coin",
    "USDC",
    6,
    deployer.address
  );
  await usdc.waitForDeployment();
  const USDC = await usdc.getAddress();
  await usdc.mint(deployer.address, ethers.parseUnits("1000000", 6));
  console.log("USDC deployed:", USDC);

  /* -----------------------------------------------------------
     3. Deploy Mock Router
  ------------------------------------------------------------ */
  const MockRouter = await ethers.getContractFactory("MockRouter");
  const router = await MockRouter.deploy();
  await router.waitForDeployment();
  const ROUTER = await router.getAddress();
  console.log("MockRouter deployed:", ROUTER);

  /* -----------------------------------------------------------
     4. Deploy MMMToken
  ------------------------------------------------------------ */
  const MMMToken = await ethers.getContractFactory("MMMToken");
  const MMM_SUPPLY = ethers.parseUnits("1000000000", 18);

  const mmm = await MMMToken.deploy(
    "Monad Money Machine",
    "MMM",
    MMM_SUPPLY,
    deployer.address
  );
  await mmm.waitForDeployment();
  const MMM = await mmm.getAddress();
  console.log("MMMToken deployed:", MMM);

  /* -----------------------------------------------------------
     5. Deploy TaxVault
     constructor(address mmm, address owner)
  ------------------------------------------------------------ */
  const TaxVault = await ethers.getContractFactory("TaxVault");
  const taxVault = await TaxVault.deploy(
    MMM,
    deployer.address
  );
  await taxVault.waitForDeployment();
  const TAX_VAULT = await taxVault.getAddress();
  console.log("TaxVault deployed:", TAX_VAULT);

  /* -----------------------------------------------------------
     6. Deploy RewardVault
     constructor(address mmm, address taxVault, uint48, uint48, uint256, address)
  ------------------------------------------------------------ */
  const RewardVault = await ethers.getContractFactory("RewardVault");
  const rewardVault = await RewardVault.deploy(
    MMM,
    TAX_VAULT,
    43200,
    43200,
    ethers.parseUnits("1", 18),
    deployer.address
  );
  await rewardVault.waitForDeployment();
  const REWARD_VAULT = await rewardVault.getAddress();
  console.log("RewardVault deployed:", REWARD_VAULT);

  /* -----------------------------------------------------------
     7. Deploy BoostVault (USDC bonus)
  ------------------------------------------------------------ */
  const BoostVault = await ethers.getContractFactory("BoostVault");
  const boostVault = await BoostVault.deploy(
    USDC,
    deployer.address
  );
  await boostVault.waitForDeployment();
  const BOOST_VAULT = await boostVault.getAddress();
  console.log("BoostVault deployed:", BOOST_VAULT);

  /* -----------------------------------------------------------
     8. Deploy SwapVault
  ------------------------------------------------------------ */
  const SwapVault = await ethers.getContractFactory("SwapVault");
  const swapVault = await SwapVault.deploy(
    MMM,
    WMON,
    deployer.address
  );
  await swapVault.waitForDeployment();
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
      process.env.CLAIMER
    ]
  );
  await marketingVault.waitForDeployment();
  const MARKETING_VAULT = await marketingVault.getAddress();
  console.log("MarketingVault deployed:", MARKETING_VAULT);

  /* -----------------------------------------------------------
     10. TeamVestingVault (ALREADY DEPLOYED)
  ------------------------------------------------------------ */
  const TEAM_VAULT = process.env.TESTNET_TEAM_VESTING_MULTISIG;
  if (!TEAM_VAULT) throw new Error("Missing TESTNET_TEAM_VESTING_MULTISIG");

  console.log("Using existing TeamVestingVault:", TEAM_VAULT);

  /* -----------------------------------------------------------
     11. Wiring (LOCKED)
  ------------------------------------------------------------ */
  await taxVault.setRewardVaultOnce(REWARD_VAULT);
  await taxVault.setBoostVaultOnce(BOOST_VAULT);
  await taxVault.setSwapVaultOnce(SWAP_VAULT);
  await taxVault.setMarketingVaultOnce(MARKETING_VAULT);
  await taxVault.setTeamVestingVaultOnce(TEAM_VAULT);

  await swapVault.setRouterOnce(ROUTER);
  await swapVault.setTaxVaultOnce(TAX_VAULT);

  await boostVault.setRewardVaultOnce(REWARD_VAULT);
  await mmm.setTaxVaultOnce(TAX_VAULT);

  console.log("✓ Wiring complete");

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
  fs.writeFileSync(
    path.join(outDir, "latest.json"),
    JSON.stringify(manifest, null, 2)
  );

  console.log("=== TESTNET DEPLOY COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
