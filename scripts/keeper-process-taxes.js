const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const provider = new ethers.JsonRpcProvider(hre.network.config.url);
  const keeper = new ethers.Wallet(process.env.KEEPER_PRIVATE_KEY, provider);

  const taxVault = await ethers.getContractAt(
    "TaxVault",
    process.env.TESTNET_TAXVAULT,
    keeper
  );

  const mmm = await ethers.getContractAt(
    "MMMToken",
    process.env.TESTNET_MMM,
    provider
  );

  const balance = await mmm.balanceOf(taxVault.target);
  const minProcessAmount = await taxVault.minProcessAmount();
  const lastProcessTime = await taxVault.lastProcessTime();
  const minInterval = await taxVault.minProcessInterval();

  const now = Math.floor(Date.now() / 1000);

  console.log("MMM in TaxVault:", ethers.formatUnits(balance, 18));
  console.log("Threshold:", ethers.formatUnits(minProcessAmount, 18));

  if (balance < minProcessAmount) {
    console.log("Below threshold.");
    return;
  }

  if (now < Number(lastProcessTime) + Number(minInterval)) {
    console.log("Too soon to process.");
    return;
  }

  console.log("Processing taxes...");
  const tx = await taxVault.processTaxes({ gasLimit: 2_000_000 });
  console.log("Tx:", tx.hash);
  await tx.wait();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});