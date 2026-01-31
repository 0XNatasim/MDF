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
  console.log("ChainId :", net.chainId);
  console.log("");

  /* -----------------------------------------------------------
     1. Deploy Mock WMON (ERC20)
  ------------------------------------------------------------ */
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const wmon = await MockERC20.deploy(
    "Wrapped MON",
    "WMON",
    deployer.address
  );
  await wmon.waitForDeployment();

  const WMON = await wmon.getAddress();
  console.log("WMON deployed:", WMON);

  /* -----------------------------------------------------------
     2. Deploy Mock Router
  ------------------------------------------------------------ */
  const MockRouter = await ethers.getContractFactory("MockRouter");
  const router = await MockRouter.deploy(WMON);
  await router.waitForDeployment();

  const ROUTER = await router.getAddress();
  console.log("MockRouter deployed:", ROUTER);

  /* -----------------------------------------------------------
     3. Deploy MMMToken
  ------------------------------------------------------------ */
  const MMM_SUPPLY = ethers.parseUnits("1000000000", 18); // 1B

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

  /* -----------------------------------------------------------
     4. Deploy TaxVault
  ------------------------------------------------------------ */
  const TaxVault = await ethers.getContractFactory("TaxVault");
  const taxVault = await TaxVault.deploy(MMM, deployer.address);
  await taxVault.waitForDeployment();

  const TAX_VAULT = await taxVault.getAddress();
  console.log("TaxVault deployed:", TAX_VAULT);

  /* -----------------------------------------------------------
     5. Deploy RewardVault (Base rewards in MMM)
  ------------------------------------------------------------ */
  const RewardVault = await ethers.getContractFactory("RewardVault");
  const rewardVault = await RewardVault.deploy(
    MMM,
    TAX_VAULT,
    43200, // minHold
    43200, // cooldown
    ethers.parseUnits("1", 18),
    deployer.address
  );
  await rewardVault.waitForDeployment();

  const REWARD_VAULT = await rewardVault.getAddress();
  console.log("RewardVault deployed:", REWARD_VAULT);

  /* -----------------------------------------------------------
     6. Deploy BoostVault (USDC later, mock OK)
  ------------------------------------------------------------ */
  const BoostVault = await ethers.getContractFactory("BoostVault");
  const boostVault = await BoostVault.deploy(
    WMON, // placeholder token for testnet
    deployer.address
  );
  await boostVault.waitForDeployment();

  const BOOST_VAULT = await boostVault.getAddress();
  console.log("BoostVault deployed:", BOOST_VAULT);

  /* -----------------------------------------------------------
     7. Deploy SwapVault (MMM / WMON)
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
     8. Deploy MarketingVault (2-of-3 multisig)
  ------------------------------------------------------------ */
  const MarketingVault = await ethers.getContractFactory("MarketingVault");
  const marketingVault = await MarketingVault.deploy(
    WMON,
    [
      process.env.DOPTESTNET,
      process.env.TESTER,
      process.env.CLAIMER,
    ],
    deployer.address
  );
  await marketingVault.waitForDeployment();

  const MARKETING_VAULT = await marketingVault.getAddress();
  console.log("MarketingVault deployed:", MARKETING_VAULT);

  /* -----------------------------------------------------------
     9. Deploy TeamVestingVault
  ------------------------------------------------------------ */
  const TeamVestingVault = await ethers.getContractFactory("TeamVestingVault");
  const teamVault = await TeamVestingVault.deploy(
    WMON,
    process.env.TEAM_VESTING_VAULT,
    deployer.address
  );
  await teamVault.waitForDeployment();

  const TEAM_VAULT = await teamVault.getAddress();
  console.log("TeamVestingVault deployed:", TEAM_VAULT);

  /* -----------------------------------------------------------
     10. Wire everything
  ------------------------------------------------------------ */
  await taxVault.setRewardVault(REWARD_VAULT);
  await taxVault.setBoostVault(BOOST_VAULT);
  await taxVault.setSwapVault(SWAP_VAULT);
  await taxVault.setMarketingVault(MARKETING_VAULT);
  await taxVault.setTeamVestingVault(TEAM_VAULT);

  await swapVault.setRouter(ROUTER);
  await swapVault.setTaxVault(TAX_VAULT);

  await boostVault.setRewardVaultOnce(REWARD_VAULT);

  await mmm.setTaxVaultOnce(TAX_VAULT);

  console.log("");
  console.log("=== WIRING COMPLETE ===");

  /* -----------------------------------------------------------
     11. Write manifest
  ------------------------------------------------------------ */
  const manifest = {
    network: hre.network.name,
    chainId: Number(net.chainId),
    deployer: deployer.address,
    contracts: {
      MMM,
      WMON,
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

  console.log("Manifest written:", outPath);
  console.log("");
  console.log("=== TESTNET DEPLOY COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
