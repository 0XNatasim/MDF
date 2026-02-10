const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const { ethers } = hre;

  const provider = ethers.provider;

  const sender = new ethers.Wallet(
    process.env.TESTER_PRIVATE_KEY,
    provider
  );

  const to = process.env.DOPTESTNET;
  const amount = ethers.parseEther("0.90"); // 1 MON

  console.log("From :", sender.address);
  console.log("To   :", to);
  console.log("Amount:", ethers.formatEther(amount), "MON");

  const tx = await sender.sendTransaction({
    to,
    value: amount,
  });

  console.log("Tx hash:", tx.hash);

  await tx.wait();
  console.log("✅ Transfer confirmed");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
