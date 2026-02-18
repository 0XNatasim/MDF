const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("\n=== FRESH3 BUY 0.1 MON → MMM ===\n");

  const provider = new ethers.JsonRpcProvider(hre.network.config.url);
  const fresh = new ethers.Wallet(
    process.env.FRESH3_PRIVATE_KEY,
    provider
  );

  const MMM = await ethers.getContractAt(
    "MMMToken",
    process.env.TESTNET_MMM,
    fresh
  );

  const Router = await ethers.getContractAt(
    "UniswapV2Router02",
    process.env.TESTNET_ROUTER,
    fresh
  );

  const RewardVault = await ethers.getContractAt(
    "RewardVault",
    process.env.TESTNET_REWARDVAULT,
    fresh
  );

  const buyAmount = ethers.parseEther("0.1");
  const deadline = Math.floor(Date.now() / 1000) + 1200;

  const path = [
    process.env.TESTNET_WMON,
    process.env.TESTNET_MMM
  ];

  const mmmBefore = await MMM.balanceOf(fresh.address);
  const taxVaultAddr = await MMM.taxVault();

  console.log("Swapping 0.1 MON for MMM...\n");

  await (
    await Router.swapExactETHForTokensSupportingFeeOnTransferTokens(
      0,
      path,
      fresh.address,
      deadline,
      { value: buyAmount }
    )
  ).wait();

  const [
    mmmAfter,
    taxVaultBal,
    lastNonZeroAt,
    minHold
  ] = await Promise.all([
    MMM.balanceOf(fresh.address),
    MMM.balanceOf(taxVaultAddr),
    MMM.lastNonZeroAt(fresh.address),
    RewardVault.minHoldTimeSec()
  ]);

  console.log("MMM received:",
    ethers.formatUnits(mmmAfter - mmmBefore, 18)
  );

  console.log("TaxVault MMM:",
    ethers.formatUnits(taxVaultBal, 18)
  );

  const now = Math.floor(Date.now() / 1000);
  const holdRemaining =
    Number(lastNonZeroAt) + Number(minHold) - now;

  console.log("Hold remaining (sec):",
    Math.max(0, holdRemaining)
  );

  console.log("\n=== DONE ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
