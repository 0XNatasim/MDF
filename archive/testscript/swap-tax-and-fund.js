// scripts/swap-tax-and-fund.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  const [owner] = await ethers.getSigners();
  console.log("Using owner:", owner.address);

  const MMM_ADDR = "0xd656Ee449c299352f0a510cD39569633659Ac7E8";

  const mmm = await ethers.getContractAt("MMM", MMM_ADDR);

  // 0 = use ALL accumulated taxTokens
  const tokenAmount = 0n;

  const tx = await mmm.swapTaxForMONAndSendToRewards(tokenAmount);
  console.log("Swap + notify tx:", tx.hash);
  const rc = await tx.wait();
  console.log("Mined in block:", rc.blockNumber);

  console.log("MMM taxes swapped to MON and sent to tracker ✅");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
