const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Seeding pools with:", deployer.address);

  // ------------------------------------------------------------------
  // ADDRESSES — replace if needed
  // ------------------------------------------------------------------
  const MMM   = "0x7E6eeA0E0B56b28d0f7B38BdE19b68d1C842620d";
  const WMON  = "0xC50ff5EF8874E742AcDD00C944a6E8E556bCaa74";
  const USDC  = "0x5d445F632DCC21f3797773Cc5AA8A1b7f330D031";
  const ROUTER = "0x6a2d4c65a881dbCd324873C59D4D0B04BaE9c909";

  // ------------------------------------------------------------------
  // CONTRACT HANDLES
  // ------------------------------------------------------------------
  const ERC20 = await ethers.getContractFactory("MockERC20");
  const router = await ethers.getContractAt("MockRouter", ROUTER);

  const mmm  = ERC20.attach(MMM);
  const wmon = ERC20.attach(WMON);
  const usdc = ERC20.attach(USDC);

  // ------------------------------------------------------------------
  // AMOUNTS
  // ------------------------------------------------------------------
  const MMM_AMOUNT  = ethers.parseEther("1000");   // 1,000 MMM
  const WMON_04     = ethers.parseEther("0.4");    // 0.4 WMON
  const USDC_20     = 20n * 10n ** 6n;              // 20 USDC (6 decimals)

  // ------------------------------------------------------------------
  // APPROVALS
  // ------------------------------------------------------------------
  console.log("Approving tokens…");

  await (await mmm.approve(ROUTER, MMM_AMOUNT)).wait();
  await (await wmon.approve(ROUTER, WMON_04 * 2n)).wait(); // used twice
  await (await usdc.approve(ROUTER, USDC_20)).wait();

  // ------------------------------------------------------------------
  // ADD LIQUIDITY: MMM / WMON
  // ------------------------------------------------------------------
  console.log("Adding liquidity: MMM / WMON");

  await (
    await router.addLiquidity(
      MMM,
      WMON,
      MMM_AMOUNT,
      WMON_04,
      0,
      0,
      deployer.address,
      Math.floor(Date.now() / 1000) + 3600
    )
  ).wait();

  // ------------------------------------------------------------------
  // ADD LIQUIDITY: WMON / USDC
  // ------------------------------------------------------------------
  console.log("Adding liquidity: WMON / USDC");

  await (
    await router.addLiquidity(
      WMON,
      USDC,
      WMON_04,
      USDC_20,
      0,
      0,
      deployer.address,
      Math.floor(Date.now() / 1000) + 3600
    )
  ).wait();

  console.log("✅ Pools successfully seeded");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
