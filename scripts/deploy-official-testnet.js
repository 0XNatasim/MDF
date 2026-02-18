const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("================================================");
  console.log("OFFICIAL MMM TESTNET DEPLOY");
  console.log("Deployer:", deployer.address);
  console.log("================================================\n");

  const deadline = Math.floor(Date.now() / 1000) + 1800;

  /* ============================================================
     1. Deploy WETH9 (WMON)
  ============================================================ */
  const WETH = await ethers.getContractFactory("WETH9");
  const weth = await WETH.deploy();
  await weth.waitForDeployment();
  const WETH_ADDR = await weth.getAddress();
  console.log("WMON deployed:", WETH_ADDR);

  /* ============================================================
     2. Deploy Mock USDC (6 decimals)
  ============================================================ */
  const MockERC20 = await ethers.getContractFactory("MockERC20");

  const usdc = await MockERC20.deploy(
    "USD Coin",
    "USDC",
    6,
    deployer.address
  );

  await usdc.waitForDeployment();
  const USDC_ADDR = await usdc.getAddress();
  console.log("USDC deployed:", USDC_ADDR);

  // Mint 1,000,000 USDC to deployer
  await (await usdc.mint(
    deployer.address,
    ethers.parseUnits("1000000", 6)
  )).wait();

  console.log("USDC minted to deployer.");

  /* ============================================================
     3. Deploy Uniswap Factory
  ============================================================ */
  const Factory = await ethers.getContractFactory("UniswapV2Factory");
  const factory = await Factory.deploy(deployer.address);
  await factory.waitForDeployment();
  const FACTORY_ADDR = await factory.getAddress();
  console.log("Factory deployed:", FACTORY_ADDR);

  /* ============================================================
     4. Deploy Uniswap Router02
  ============================================================ */
  const Router = await ethers.getContractFactory("UniswapV2Router02");
  const router = await Router.deploy(FACTORY_ADDR, WETH_ADDR);
  await router.waitForDeployment();
  const ROUTER_ADDR = await router.getAddress();
  console.log("Router deployed:", ROUTER_ADDR);

  /* ============================================================
     5. Deploy MMM Token
  ============================================================ */
  const MMM = await ethers.getContractFactory("MMMToken");

  const initialSupply = ethers.parseUnits("1000000000", 18); // 1B supply

  const mmm = await MMM.deploy(
    "Monad Money Machine",
    "MMM",
    initialSupply,
    deployer.address
  );

  await mmm.waitForDeployment();
  const MMM_ADDR = await mmm.getAddress();
  console.log("MMM deployed:", MMM_ADDR);

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
  console.log("TaxVault deployed:", TAXVAULT_ADDR);

  /* ============================================================
     7. Create MMM / WMON Pair
  ============================================================ */
  await (await factory.createPair(MMM_ADDR, WETH_ADDR)).wait();
  const pairAddr = await factory.getPair(MMM_ADDR, WETH_ADDR);
  console.log("Pair created:", pairAddr);

  /* ============================================================
     8. Wire MMM
  ============================================================ */
  await (await mmm.setPair(pairAddr)).wait();
  await (await mmm.setRouter(ROUTER_ADDR)).wait();
  await (await mmm.setTaxVaultOnce(TAXVAULT_ADDR)).wait();

  console.log("MMM wired (pair, router, taxVault).");

  /* ============================================================
     9. Set Tax Exemptions (DO NOT EXEMPT PAIR)
  ============================================================ */
  await (await mmm.setTaxExempt(deployer.address, true)).wait();
  await (await mmm.setTaxExempt(TAXVAULT_ADDR, true)).wait();
  await (await mmm.setTaxExempt(ROUTER_ADDR, true)).wait();

  console.log("Tax exemptions configured.");

  /* ============================================================
     10. Add Initial Liquidity (PRE-LAUNCH) - Manual seed
  ============================================================ */
  const amountMMM = ethers.parseUnits("5000", 18);
  const amountETH = ethers.parseEther("5");

  const pair = await ethers.getContractAt("UniswapV2Pair", pairAddr);
  const wmon = await ethers.getContractAt("WETH9", WETH_ADDR);

  // Transfer MMM directly to pair (deployer is tax exempt)
  await (await mmm.transfer(pairAddr, amountMMM)).wait();

  // Wrap ETH and send WMON to pair
  await (await weth.deposit({ value: amountETH })).wait();
  await (await weth.transfer(pairAddr, amountETH)).wait();

  // Mint LP tokens
  await (await pair.mint(deployer.address, { gasLimit: 300000 })).wait();

  console.log("Liquidity added successfully.");

  /* ============================================================
     11. Launch Token
  ============================================================ */
  await (await mmm.launch()).wait();
  console.log("Token launched.");

  console.log("\n================================================");
  console.log("OFFICIAL TESTNET DEPLOY COMPLETE");
  console.log("================================================");
  console.log("WMON:      ", WETH_ADDR);
  console.log("USDC:      ", USDC_ADDR);
  console.log("Factory:   ", FACTORY_ADDR);
  console.log("Router:    ", ROUTER_ADDR);
  console.log("MMM:       ", MMM_ADDR);
  console.log("Pair:      ", pairAddr);
  console.log("TaxVault:  ", TAXVAULT_ADDR);
  console.log("================================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
