const hre = require("hardhat");
const { ethers } = hre;

const CONFIG = {
  MMM:    "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16",
  ROUTER: "0x53FE6D2499742779BF2Bd12a23e3c102fAe9fEcA",
};

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  // Fully-qualified IERC20 to avoid HH701 ambiguity
  const MMM = await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
    CONFIG.MMM,
    signer
  );

  // Router ABI minimal
  const Router = await ethers.getContractAt(
    "IUniswapV2Router02",
    CONFIG.ROUTER,
    signer
  );

  const wmon = await Router.WETH();
  console.log("Router.WETH():", wmon);

  const MMM_DECIMALS = 18; // your MMM is 18
  const MMM_AMOUNT = ethers.parseUnits("100000", MMM_DECIMALS);
  const MON_AMOUNT = ethers.parseEther("0.05");

  const mBal = await MMM.balanceOf(signer.address);
  const eBal = await ethers.provider.getBalance(signer.address);

  console.log("Balances MMM:", ethers.formatUnits(mBal, MMM_DECIMALS));
  console.log("Balances MON:", ethers.formatEther(eBal));

  if (mBal < MMM_AMOUNT) throw new Error("Insufficient MMM");
  if (eBal < MON_AMOUNT) throw new Error("Insufficient MON");

  // Approve router if needed
  const allowance = await MMM.allowance(signer.address, CONFIG.ROUTER);
  if (allowance < MMM_AMOUNT) {
    console.log("Approving MMM...");
    const txA = await MMM.approve(CONFIG.ROUTER, MMM_AMOUNT);
    await txA.wait();
    console.log("Approved.");
  } else {
    console.log("Allowance OK.");
  }

  const deadline = Math.floor(Date.now() / 1000) + 600;

  // IMPORTANT: mins set to 0 to avoid tax/min mismatch for seeding
  const amountTokenMin = 0;
  const amountETHMin = 0;

  console.log("Seeding: 100000 MMM + 0.05 MON");
  console.log("Simulating callStatic first...");

  // callStatic / staticCall to surface revert early
  try {
    await Router.addLiquidityETH.staticCall(
      CONFIG.MMM,
      MMM_AMOUNT,
      amountTokenMin,
      amountETHMin,
      signer.address,
      deadline,
      { value: MON_AMOUNT }
    );
    console.log("Static simulation: OK");
  } catch (e) {
    console.error("Static simulation reverted.");
    // ethers v6: show as much detail as possible
    console.error(e.shortMessage || e.message || e);
    throw e;
  }

  console.log("Sending tx...");
  const tx = await Router.addLiquidityETH(
    CONFIG.MMM,
    MMM_AMOUNT,
    amountTokenMin,
    amountETHMin,
    signer.address,
    deadline,
    { value: MON_AMOUNT }
  );

  console.log("Tx:", tx.hash);
  const rcpt = await tx.wait();
  console.log("✅ Seeded. Gas used:", rcpt.gasUsed.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
