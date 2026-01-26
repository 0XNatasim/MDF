const hre = require("hardhat");
const { ethers } = hre;
require("dotenv").config();

async function main() {
  const RPC_URL = process.env.RPC_URL;
  const FRESH3_PK = process.env.FRESH3_PRIVATE_KEY;
  const TESTER = process.env.TESTER;

  if (!RPC_URL || !FRESH3_PK || !TESTER) {
    throw new Error("Missing RPC_URL, FRESH3_PRIVATE_KEY, or TESTER in .env");
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const sender = new ethers.Wallet(FRESH3_PK, provider);

  const amount = ethers.parseEther("2.5");

  const bal = await provider.getBalance(sender.address);
  console.log("Sender:", sender.address);
  console.log("Balance:", ethers.formatEther(bal), "MON");

  if (bal < amount) {
    throw new Error("Insufficient balance");
  }

  const tx = await sender.sendTransaction({
    to: TESTER,
    value: amount,
  });

  console.log("TX sent:", tx.hash);
  await tx.wait();
  console.log("✅ Transfer confirmed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
