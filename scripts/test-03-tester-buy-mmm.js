const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer, tester] = await ethers.getSigners();

  const MMM = await ethers.getContractAt(
    "MMMToken",
    process.env.TESTNET_MMM
  );

  console.log("\n=== TEST 03: Tester acquires MMM (eligibility flow) ===\n");
  console.log("Tester:", tester.address);

  const amount = ethers.parseUnits("1000", 18);

  console.log("Transferring MMM from deployer → tester...");
  await MMM.transfer(tester.address, amount);
  console.log("✓ Tester received MMM:", ethers.formatUnits(amount, 18));

  const bal = await MMM.balanceOf(tester.address);
  console.log("Tester MMM balance:", ethers.formatUnits(bal, 18));

  console.log("\n=== TEST 03 COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
