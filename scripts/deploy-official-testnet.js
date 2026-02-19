const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("================================================");
  console.log("OFFICIAL MMM TESTNET DEPLOY");
  console.log("Deployer:", deployer.address);
  console.log("================================================\n");

  // 3 multisig owners for MarketingVault and TeamVestingVault
  // Using deployer for all 3 on testnet – change for mainnet
  const MULTISIG_OWNERS = [
    deployer.address,
    process.env.TESTNET_MULTISIG_2 || deployer.address,
    process.env.TESTNET_MULTISIG_3 || deployer.address,
  ];

  // Validate no duplicate owners (required by TwoOfThreeERC20Vault)
  const unique = new Set(MULTISIG_OWNERS);
  if (unique.size !== 3) {
    throw new Error(
      "MULTISIG owners must be 3 unique addresses. Set TESTNET_MULTISIG_2 and TESTNET_MULTISIG_3 in .env"
    );
  }

  /* ============================================================
     1. Deploy WETH9 (WMON)
  ============================================================ */
  const WETH = await ethers.getContractFactory("WETH9");
  const weth = await WETH.deploy();
  await weth.waitForDeployment();
  const WETH_ADDR = await weth.getAddress();
  console.log("WMON deployed:          ", WETH_ADDR);

  /* ============================================================
     2. Deploy Mock USDC (6 decimals)
  ============================================================ */
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6, deployer.address);
  await usdc.waitForDeployment();
  const USDC_ADDR = await usdc.getAddress();
  console.log("USDC deployed:          ", USDC_ADDR);

  await (await usdc.mint(deployer.address, ethers.parseUnits("1000000", 6))).wait();
  console.log("USDC minted to deployer.");

  /* ============================================================
     3. Deploy Uniswap Factory
  ============================================================ */
  const Factory = await ethers.getContractFactory("UniswapV2Factory");
  const factory = await Factory.deploy(deployer.address);
  await factory.waitForDeployment();
  const FACTORY_ADDR = await factory.getAddress();
  console.log("Factory deployed:       ", FACTORY_ADDR);

  /* ============================================================
     4. Deploy Uniswap Router02
  ============================================================ */
  const Router = await ethers.getContractFactory("UniswapV2Router02");
  const router = await Router.deploy(FACTORY_ADDR, WETH_ADDR);
  await router.waitForDeployment();
  const ROUTER_ADDR = await router.getAddress();
  console.log("Router deployed:        ", ROUTER_ADDR);

  /* ============================================================
     5. Deploy MMM Token
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
     6. Deploy TaxVault
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
     7. Deploy RewardVault
     Note: owner starts as deployer so we can wire BoostNFT and
     exclusions first, then transfer ownership to TaxVault so it
     can call notifyRewardAmount() during tax processing.
  ============================================================ */
  const RewardVault = await ethers.getContractFactory("RewardVault");
  const rewardVault = await RewardVault.deploy(
    MMM_ADDR,
    7 * 24 * 3600,                        // 7 day min hold
    24 * 3600,                             // 24h claim cooldown
    ethers.parseUnits("1000", 18),         // 1000 MMM min balance
    deployer.address                       // owner = deployer FIRST
  );
  await rewardVault.waitForDeployment();
  const REWARDVAULT_ADDR = await rewardVault.getAddress();
  console.log("RewardVault deployed:   ", REWARDVAULT_ADDR);

  /* ============================================================
     8. Deploy MarketingVault (2-of-3 multisig, holds USDC)
  ============================================================ */
  const MarketingVault = await ethers.getContractFactory("MarketingVault");
  const marketingVault = await MarketingVault.deploy(USDC_ADDR, MULTISIG_OWNERS);
  await marketingVault.waitForDeployment();
  const MARKETINGVAULT_ADDR = await marketingVault.getAddress();
  console.log("MarketingVault deployed:", MARKETINGVAULT_ADDR);

  /* ============================================================
     9. Deploy TeamVestingVault (2-of-3 multisig, holds USDC)
  ============================================================ */
  const TeamVestingVault = await ethers.getContractFactory("TeamVestingVault");
  const teamVestingVault = await TeamVestingVault.deploy(USDC_ADDR, MULTISIG_OWNERS);
  await teamVestingVault.waitForDeployment();
  const TEAMVESTINGVAULT_ADDR = await teamVestingVault.getAddress();
  console.log("TeamVestingVault deployed:", TEAMVESTINGVAULT_ADDR);

  /* ============================================================
     10. Deploy BoostNFT
  ============================================================ */
  const BoostNFT = await ethers.getContractFactory("BoostNFT");
  const boostNFT = await BoostNFT.deploy(deployer.address);
  await boostNFT.waitForDeployment();
  const BOOSTNFT_ADDR = await boostNFT.getAddress();
  console.log("BoostNFT deployed:      ", BOOSTNFT_ADDR);

  /* ============================================================
     11. Create MMM / WMON Pair
  ============================================================ */
  await (await factory.createPair(MMM_ADDR, WETH_ADDR)).wait();
  const PAIR_ADDR = await factory.getPair(MMM_ADDR, WETH_ADDR);
  console.log("Pair created:           ", PAIR_ADDR);

  /* ============================================================
     12. Wire MMM Token
  ============================================================ */
  await (await mmm.setPair(PAIR_ADDR)).wait();
  await (await mmm.setRouter(ROUTER_ADDR)).wait();
  await (await mmm.setTaxVaultOnce(TAXVAULT_ADDR)).wait();
  console.log("MMM wired (pair, router, taxVault).");

  /* ============================================================
     13. Tax Exemptions
  ============================================================ */
  await (await mmm.setTaxExempt(deployer.address,    true)).wait();
  await (await mmm.setTaxExempt(TAXVAULT_ADDR,       true)).wait();
  await (await mmm.setTaxExempt(ROUTER_ADDR,         true)).wait();
  await (await mmm.setTaxExempt(REWARDVAULT_ADDR,    true)).wait();
  console.log("Tax exemptions configured.");

  /* ============================================================
     14. Wire TaxVault
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
     15. Wire RewardVault
         - Set BoostNFT
         - Exclude all protocol addresses from eligible supply
         - Transfer ownership to TaxVault last
  ============================================================ */
  await (await rewardVault.setBoostNFT(BOOSTNFT_ADDR)).wait();
  console.log("RewardVault: BoostNFT set.");

  await (await rewardVault.addExcludedRewardAddress(PAIR_ADDR)).wait();
  await (await rewardVault.addExcludedRewardAddress(TAXVAULT_ADDR)).wait();
  await (await rewardVault.addExcludedRewardAddress(deployer.address)).wait();
  console.log("RewardVault: exclusions set.");

  // Transfer ownership to TaxVault so it can call notifyRewardAmount()
  await (await rewardVault.transferOwnership(TAXVAULT_ADDR)).wait();
  console.log("RewardVault: ownership transferred to TaxVault.");

  /* ============================================================
     16. Add Initial Liquidity – Manual seed (bypasses router)
         Monad testnet gas estimator is broken for addLiquidityETH
  ============================================================ */
  const amountMMM = ethers.parseUnits("10000", 18);
  const amountETH = ethers.parseEther("10");

  const pair = await ethers.getContractAt("UniswapV2Pair", PAIR_ADDR);

  // Transfer MMM directly to pair (deployer is tax exempt, no trading lock)
  await (await mmm.transfer(PAIR_ADDR, amountMMM)).wait();

  // Wrap MON -> WMON and send to pair
  await (await weth.deposit({ value: amountETH })).wait();
  await (await weth.transfer(PAIR_ADDR, amountETH)).wait();

  // Mint LP tokens
  await (await pair.mint(deployer.address, { gasLimit: 300000 })).wait();
  console.log("Liquidity seeded: 1000 MMM + 1 WMON.");

  /* ============================================================
     17. Launch Token
  ============================================================ */
  await (await mmm.launch()).wait();
  console.log("Token launched.");

  /* ============================================================
     SUMMARY
  ============================================================ */
  console.log("\n================================================");
  console.log("DEPLOY COMPLETE");
  console.log("================================================");
  console.log("TESTNET_WMON:             ", WETH_ADDR);
  console.log("TESTNET_USDC:             ", USDC_ADDR);
  console.log("TESTNET_Factory:          ", FACTORY_ADDR);
  console.log("TESTNET_Router:           ", ROUTER_ADDR);
  console.log("TESTNET_MMM:              ", MMM_ADDR);
  console.log("TESTNET_Pair:             ", PAIR_ADDR);
  console.log("TESTNET_TaxVault:         ", TAXVAULT_ADDR);
  console.log("TESTNET_RewardVault:      ", REWARDVAULT_ADDR);
  console.log("TESTNET_MarketingVault:   ", MARKETINGVAULT_ADDR);
  console.log("TESTNET_TeamVestingVault: ", TEAMVESTINGVAULT_ADDR);
  console.log("TESTNET_BoostNFT:         ", BOOSTNFT_ADDR);
  console.log("================================================");
  console.log("\n⚠️  POST-DEPLOY CHECKLIST:");
  console.log("1. Update your .env with all addresses above.");
  console.log("2. Set TESTNET_MULTISIG_2 and TESTNET_MULTISIG_3 in .env");
  console.log("   for proper 2-of-3 multisig on Marketing/TeamVesting vaults.");
  console.log("3. RewardVault ownership transferred to TaxVault.");
  console.log("4. To exclude malicious addresses from rewards later, add");
  console.log("   excludeFromRewards(address) to TaxVault.sol and call it");
  console.log("   as owner — see previous discussion.");
  console.log("================================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});