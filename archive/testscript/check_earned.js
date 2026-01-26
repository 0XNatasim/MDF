// scripts/check_earned.js
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const TRACKER = "0x5B870DAa512DB9DADEbD53d55045BAE798B4B86B";
  const USER = process.env.USER_ADDR || "0xBF98e5FEf825CcD68dcFF3cF0a766faB413D6207";

  const provider = ethers.provider;

  const abi = [
    "function earned(address) view returns (uint256)",
    "function withdrawable(address) view returns (uint256)",
    "function minClaimAmount() view returns (uint256)",
    "function isExcludedFromRewards(address) view returns (bool)",
  ];
  const t = new ethers.Contract(TRACKER, abi, provider);

  const [earned, min, excluded, bal] = await Promise.all([
    t.earned(USER),
    t.minClaimAmount(),
    t.isExcludedFromRewards(USER),
    provider.getBalance(TRACKER),
  ]);

  console.log("User:", USER);
  console.log("Excluded:", excluded);
  console.log("Earned:", ethers.formatEther(earned), "MON");
  console.log("MinClaim:", ethers.formatEther(min), "MON");
  console.log("Tracker balance:", ethers.formatEther(bal), "MON");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
