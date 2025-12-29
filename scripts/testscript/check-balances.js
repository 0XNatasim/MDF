// scripts/check-balances.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;

  // 👉 1. CONFIG – put your real contracts here
  const MMM_ADDRESS     = "0x08e3e7677DdBf2B4C7b45407e665E7726d4823dc"; // your MMM on testnet
  const TRACKER_ADDRESS = "0xD1c7AFF5D89363eFaC6Fa40d7D534f39Efc2cEc6"; // your snapshot tracker

  // 👉 2. TARGET WALLET
  // - You can pass it via env: TARGET=0x...  (see commands below)
  // - Or hardcode a default here:
  const target = process.env.TARGET || "0xBF98e5FEf825CcD68dcFF3cF0a766faB413D6207";

  if (!ethers.isAddress(target)) {
    throw new Error(`TARGET is not a valid address: ${target}`);
  }

  console.log("===== CHECK BALANCES =====");
  console.log("Address:", target);
  console.log("");

  // --- Minimal ABIs ---
  const MMM_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
  ];

  const TRACKER_ABI = [
    "function withdrawable(address account) view returns (uint256)"
  ];

  const provider = ethers.provider;

  const mmm     = new ethers.Contract(MMM_ADDRESS, MMM_ABI, provider);
  const tracker = new ethers.Contract(TRACKER_ADDRESS, TRACKER_ABI, provider);

  // --- 3. Read everything in parallel ---
  const [
    monBalWei,
    mmmBalRaw,
    mmmDecimals,
    mmmSymbol,
    rewardsRaw
  ] = await Promise.all([
    provider.getBalance(target),
    mmm.balanceOf(target),
    mmm.decimals(),
    mmm.symbol(),
    tracker.withdrawable(target)
  ]);

  const monBal     = ethers.formatEther(monBalWei);
  const mmmBal     = ethers.formatUnits(mmmBalRaw, mmmDecimals);
  const rewardsMon = ethers.formatEther(rewardsRaw);

  console.log("MON balance:          ", monBal, "MON");
  console.log(`MMM balance:           ${mmmBal} ${mmmSymbol}`);
  console.log("Withdrawable rewards: ", rewardsMon, "MON");
  console.log("");
  console.log("✅ Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
