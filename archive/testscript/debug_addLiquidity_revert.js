const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const net = hre.network.name;

  const MMM  = "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16";
  const ROUTER = "0x53FE6D2499742779BF2Bd12a23e3c102fAe9fEcA";
  const WMON = "0x51C0bb68b65bd84De6518C939CB9Dbe2d6Fa7079";

  const MMM_AMOUNT = ethers.parseUnits("1000", 18);
  const MON_AMOUNT = ethers.parseEther("1");
  const DEADLINE = Math.floor(Date.now()/1000) + 600;

  const [signer] = await ethers.getSigners();
  console.log("Network:", net);
  console.log("Signer:", signer.address);

  const mmm = await ethers.getContractAt("IERC20", MMM);
  const router = await ethers.getContractAt("IUniswapV2Router02", ROUTER);

  // sanity: router WETH
  const weth = await router.WETH();
  console.log("router.WETH():", weth, " (expected WMON:", WMON, ")");

  // balances
  const balMMM = await mmm.balanceOf(signer.address);
  const balMON = await ethers.provider.getBalance(signer.address);
  console.log("Signer MMM:", ethers.formatUnits(balMMM, 18));
  console.log("Signer MON:", ethers.formatEther(balMON));

  // allowance
  const allowance = await mmm.allowance(signer.address, ROUTER);
  console.log("Allowance MMM->Router:", ethers.formatUnits(allowance, 18));

  // Try a tiny direct MMM transfer to the PAIR to detect MMM transfer gating
  // (We’ll discover the pair via factory if your router exposes factory)
  const factory = await router.factory();
  console.log("router.factory():", factory);

  const fac = await ethers.getContractAt("IUniswapV2Factory", factory);
  const pair = await fac.getPair(MMM, WMON);
  console.log("pair(MMM,WMON):", pair);

  console.log("Test: MMM.transfer(pair, 1 MMM)...");
  try {
    const tx = await (await mmm.transfer(pair, ethers.parseUnits("1", 18))).wait();
    console.log("OK transfer to pair:", tx.hash);
  } catch (e) {
    console.error("FAILED transfer to pair (this is usually the root cause).");
    throw e;
  }

  // Now try addLiquidityETH as a static call (no state change) to capture revert
  console.log("Static call: addLiquidityETH...");
  try {
    await router.addLiquidityETH.staticCall(
      MMM,
      MMM_AMOUNT,
      MMM_AMOUNT * 95n / 100n,
      MON_AMOUNT * 95n / 100n,
      signer.address,
      DEADLINE,
      { value: MON_AMOUNT }
    );
    console.log("Static call passed (should succeed on-chain too).");
  } catch (e) {
    console.error("Static call REVERTED. Raw error:");
    console.error(e);
    throw e;
  }

  // If static call passed, send real tx
  console.log("Sending real addLiquidityETH tx...");
  const tx = await router.addLiquidityETH(
    MMM,
    MMM_AMOUNT,
    MMM_AMOUNT * 95n / 100n,
    MON_AMOUNT * 95n / 100n,
    signer.address,
    DEADLINE,
    { value: MON_AMOUNT }
  );
  console.log("tx:", tx.hash);
  const rc = await tx.wait();
  console.log("mined:", rc.hash, "gasUsed:", rc.gasUsed.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
