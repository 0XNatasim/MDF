const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("\n=== ADDING 5 MON + 5000 MMM LIQUIDITY ===\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // ---- ADDRESSES ----
  const MMM_ADDR   = "0x29cf40de9830e15d94bD1E383fE8Af9693be33e9";
  const PAIR_ADDR  = "0x1576a58f083fD0ee24b5dC3270e785Ae8D9bbCF7";
  const WMON_ADDR  = "0xE7b0bA4Afca4e2469A7Fd496AE7EC7a90cC17dF3";

  // ---- AMOUNTS ----
  const amountMMM = ethers.parseUnits("5000", 18);
  const amountMON = ethers.parseEther("5");

  // ---- CONTRACTS ----
  const mmm  = await ethers.getContractAt("MMMToken", MMM_ADDR);
  const pair = await ethers.getContractAt("UniswapV2Pair", PAIR_ADDR);
  const weth = await ethers.getContractAt("WETH9", WMON_ADDR);

  // ---- CHECK BALANCES ----
  const mmmBal = await mmm.balanceOf(deployer.address);
  const monBal = await ethers.provider.getBalance(deployer.address);

  console.log("Your MMM balance:", ethers.formatUnits(mmmBal, 18));
  console.log("Your MON balance:", ethers.formatEther(monBal));

  if (mmmBal < amountMMM) {
    throw new Error("❌ Not enough MMM");
  }
  if (monBal < amountMON) {
    throw new Error("❌ Not enough MON");
  }

  console.log("\nTransferring MMM to pair...");
  await (await mmm.transfer(PAIR_ADDR, amountMMM)).wait();

  console.log("Wrapping MON → WMON...");
  await (await weth.deposit({ value: amountMON })).wait();

  console.log("Sending WMON to pair...");
  await (await weth.transfer(PAIR_ADDR, amountMON)).wait();

  console.log("Minting LP tokens...");
  const tx = await pair.mint(deployer.address, { gasLimit: 500000 });
  await tx.wait();

  console.log("\n✅ Liquidity added successfully.");
  console.log("5000 MMM + 5 MON seeded.");
  console.log("\n=== DONE ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});