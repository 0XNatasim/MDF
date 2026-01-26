const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [signer] = await ethers.getSigners();

  const MMM_ADDR = "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16";

  const MMM = await ethers.getContractAt("MMM", MMM_ADDR, signer);

  console.log("Signer:", signer.address);
  console.log("Excluding signer from fees...");
  console.log("Static sim...");
await Router.addLiquidityETH.staticCall(
  CONFIG.mmmToken,
  mmmAmount,
  0,  // amountTokenMin
  0,  // amountETHMin
  signer.address,
  deadline,
  { value: monAmount }
);
console.log("Static OK, sending...");

  const tx = await MMM.setExcludedFromFees(signer.address, true);
  console.log("tx:", tx.hash);
  await tx.wait();
  console.log("✅ Done");
}

main().catch((e) => { console.error(e); process.exit(1); });
