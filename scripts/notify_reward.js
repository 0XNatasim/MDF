require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const TRACKER =
    process.env.REWARD_TRACKER || "0x5B870DAa512DB9DADEbD53d55045BAE798B4B86B";
  const TESTER =
    process.env.TESTER || "0x22BC7a72000faE48a67520c056C0944d9a675412";

  // change if you want: SEND_MON="1.0"
  const SEND_MON = process.env.SEND_MON || "0.1";

  const [owner] = await hre.ethers.getSigners();
  const provider = hre.ethers.provider;

  console.log("Network:", hre.network.name);
  console.log("Owner:", owner.address);
  console.log("Tracker:", TRACKER);
  console.log("Tester:", TESTER);
  console.log("Sending:", SEND_MON, "MON");

  const TRACKER_ABI = [
    "function earned(address) view returns (uint256)",
    "function rewardPerTokenStored() view returns (uint256)",
    "function eligibleSupply() view returns (uint256)",
  ];

  const tracker = await hre.ethers.getContractAt(TRACKER_ABI, TRACKER);

  const earnedBefore = await tracker.earned(TESTER);
  const rptBefore = await tracker.rewardPerTokenStored();
  const elig = await tracker.eligibleSupply();

  console.log("\n--- BEFORE ---");
  console.log("eligibleSupply:", elig.toString());
  console.log("rewardPerTokenStored:", rptBefore.toString());
  console.log("earned(tester):", hre.ethers.formatEther(earnedBefore), "MON");

  // Send native MON to tracker -> triggers receive() -> _notifyReward(msg.value)
  const tx = await owner.sendTransaction({
    to: TRACKER,
    value: hre.ethers.parseEther(SEND_MON),
  });
  console.log("\nnotify tx:", tx.hash);
  await tx.wait();

  const earnedAfter = await tracker.earned(TESTER);
  const rptAfter = await tracker.rewardPerTokenStored();

  console.log("\n--- AFTER ---");
  console.log("rewardPerTokenStored:", rptAfter.toString());
  console.log("earned(tester):", hre.ethers.formatEther(earnedAfter), "MON");

  console.log("\nDONE.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
