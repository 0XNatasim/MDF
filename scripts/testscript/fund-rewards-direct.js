// scripts/fund-rewards-direct.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  const [owner] = await ethers.getSigners();
  console.log("Funding from:", owner.address);

  const MMM_ADDR = "0x08e3e7677DdBf2B4C7b45407e665E7726d4823dc";

  const mmm = await ethers.getContractAt("MMM", MMM_ADDR);

  // 💰 Amount of MON to inject as rewards
  const amount = ethers.parseUnits("0.5", 18n); // 0.5 MON

  const tx = await mmm.fundRewardsDirect({ value: amount });
  console.log("Fund tx:", tx.hash);
  await tx.wait();

  console.log("Rewards funded via fundRewardsDirect ✅");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
