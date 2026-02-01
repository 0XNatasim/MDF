const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("=== TEST 03: Claim Reward + Boost ===");

  const provider = ethers.provider;

  const fresh = new ethers.Wallet(process.env.FRESH_PRIVATE_KEY, provider);

  const MMM = await ethers.getContractAt("MMMToken", process.env.TESTNET_MMM, fresh);
  const RewardVault = await ethers.getContractAt(
    "RewardVault",
    process.env.TESTNET_REWARDVAULT,
    fresh
  );
  const USDC = await ethers.getContractAt("MockERC20", process.env.TESTNET_USDC, fresh);

  /* -----------------------------------------------------------
     1) Check pending reward
  ------------------------------------------------------------ */
  const pending = await RewardVault.pending(fresh.address);
  console.log("Pending MMM reward:", ethers.formatUnits(pending, 18));

  if (pending === 0n) {
    throw new Error("❌ No rewards pending (hold time or process missing)");
  }

  /* -----------------------------------------------------------
     2) Claim
  ------------------------------------------------------------ */
  const beforeMMM = await MMM.balanceOf(fresh.address);
  const beforeUSDC = await USDC.balanceOf(fresh.address);

  const tx = await RewardVault.claim();
  await tx.wait();

  console.log("✓ Reward claimed");

  /* -----------------------------------------------------------
     3) Verify balances
  ------------------------------------------------------------ */
  const afterMMM = await MMM.balanceOf(fresh.address);
  const afterUSDC = await USDC.balanceOf(fresh.address);

  console.log("MMM gained:", ethers.formatUnits(afterMMM - beforeMMM, 18));
  console.log("USDC boost gained:", ethers.formatUnits(afterUSDC - beforeUSDC, 6));

  console.log("=== TEST 03 COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
