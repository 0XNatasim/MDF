const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const TRACKER = "0x5B870DAa512DB9DADEbD53d55045BAE798B4B86B";
  const AMOUNT_MON = "0.1"; // change as needed

  const [signer] = await ethers.getSigners();
  console.log("Network:", hre.network.name);
  console.log("Signer :", signer.address);
  console.log("Tracker:", TRACKER);

  const before = await ethers.provider.getBalance(TRACKER);
  console.log("Tracker balance before:", ethers.formatEther(before), "MON");

  // Try notifyReward() payable
  const ABI = ["function notifyReward() payable"];
  const tracker = new ethers.Contract(TRACKER, ABI, signer);

  const tx = await tracker.notifyReward({ value: ethers.parseEther(AMOUNT_MON) });
  console.log("tx:", tx.hash);
  await tx.wait();

  const after = await ethers.provider.getBalance(TRACKER);
  console.log("Tracker balance after :", ethers.formatEther(after), "MON");
  console.log("✅ notifyReward funded.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
