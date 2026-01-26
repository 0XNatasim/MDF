// scripts/topup-claimant-mmm.js
const hre = require("hardhat");
const { ethers } = hre;

function mustEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

async function main() {
  const MMMToken = mustEnv("MMMToken");
  const pk = mustEnv("FRESH3_PRIVATE_KEY");

  const claimant = new ethers.Wallet(pk, ethers.provider);
  const [deployer] = await ethers.getSigners();

  const mmm = await ethers.getContractAt("MMMToken", MMMToken);

  const decimals = await mmm.decimals();
  const minBalance = ethers.parseUnits("1", decimals); // target total balance (1.0 MMM)

  const before = await mmm.balanceOf(claimant.address);
  console.log("Claimant:", claimant.address);
  console.log("Before MMM:", ethers.formatUnits(before, decimals));

  if (before >= minBalance) {
    console.log("No top-up needed (already >= 1.0 MMM).");
    return;
  }

  const delta = minBalance - before;
  console.log("Top-up amount MMM:", ethers.formatUnits(delta, decimals));

  // IMPORTANT: send from deployer (must hold MMM)
  const tx = await mmm.connect(deployer).transfer(claimant.address, delta);
  console.log("Sent tx:", tx.hash);
  await tx.wait();

  const after = await mmm.balanceOf(claimant.address);
  console.log("After MMM:", ethers.formatUnits(after, decimals));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
