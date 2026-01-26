require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const MMM =
    process.env.MMM || "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16";
  const TRACKER =
    process.env.REWARD_TRACKER || "0x5B870DAa512DB9DADEbD53d55045BAE798B4B86B";
  const TESTER =
    process.env.TESTER || "0x22BC7a72000faE48a67520c056C0944d9a675412";

  // Optional: set TRANSFER_MMM="1" or "0.0001" etc
  const TRANSFER_MMM = process.env.TRANSFER_MMM || "1";

  console.log("Network:", hre.network.name);
  console.log("MMM:", MMM);
  console.log("Tracker:", TRACKER);
  console.log("Tester:", TESTER);

  // --- Contracts ---
  const MMM_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function transfer(address to, uint256 amount) returns (bool)",
  ];

  const TRACKER_ABI = [
    "function earned(address) view returns (uint256)",
    "function withdrawable(address) view returns (uint256)",
    "function userRewardPerTokenPaid(address) view returns (uint256)",
    "function rewards(address) view returns (uint256)",
    "function rewardPerTokenStored() view returns (uint256)",
    "function isExcludedFromRewards(address) view returns (bool)",
  ];

  const mmm = await hre.ethers.getContractAt(MMM_ABI, MMM);
  const tracker = await hre.ethers.getContractAt(TRACKER_ABI, TRACKER);

  const [owner] = await hre.ethers.getSigners();

  // We need to SEND FROM TESTER, so we need tester's PRIVATE KEY.
  const TESTER_PRIVATE_KEY = process.env.TESTER_PRIVATE_KEY;
  if (!TESTER_PRIVATE_KEY) {
    throw new Error(
      "Missing TESTER_PRIVATE_KEY in .env (needed to sign the tester->owner transfer)."
    );
  }

  const provider = hre.ethers.provider;
  const testerWallet = new hre.ethers.Wallet(TESTER_PRIVATE_KEY, provider);

  if (testerWallet.address.toLowerCase() !== TESTER.toLowerCase()) {
    throw new Error(
      `TESTER_PRIVATE_KEY does not match TESTER address.\nWallet: ${testerWallet.address}\nTESTER:  ${TESTER}`
    );
  }

  const decimals = await mmm.decimals();
  const symbol = await mmm.symbol();

  const amt = hre.ethers.parseUnits(TRANSFER_MMM, decimals);

  const earnedBefore = await tracker.earned(TESTER);
  const paidBefore = await tracker.userRewardPerTokenPaid(TESTER);
  const accruedBefore = await tracker.rewards(TESTER);
  const rpt = await tracker.rewardPerTokenStored();
  const excluded = await tracker.isExcludedFromRewards(TESTER);
  const testerBal = await mmm.balanceOf(TESTER);

  console.log("\n--- BEFORE ---");
  console.log("Tester excluded?:", excluded);
  console.log(`Tester ${symbol}:`, hre.ethers.formatUnits(testerBal, decimals));
  console.log("rewardPerTokenStored:", rpt.toString());
  console.log("userRewardPerTokenPaid:", paidBefore.toString());
  console.log("rewards[tester] (accrued):", hre.ethers.formatEther(accruedBefore));
  console.log("earned(tester):", hre.ethers.formatEther(earnedBefore));

  if (testerBal < amt) {
    throw new Error(
      `Tester does not have enough ${symbol} for the transfer amount.`
    );
  }

  // Connect MMM to tester signer and transfer to owner (owner is typically non-excluded)
  const mmmAsTester = mmm.connect(testerWallet);

  console.log(`\nSending ${TRANSFER_MMM} ${symbol} from Tester -> Owner (${owner.address}) to force checkpoint...`);
  const tx = await mmmAsTester.transfer(owner.address, amt);
  console.log("tx:", tx.hash);
  await tx.wait();

  const earnedAfter = await tracker.earned(TESTER);
  const paidAfter = await tracker.userRewardPerTokenPaid(TESTER);
  const accruedAfter = await tracker.rewards(TESTER);

  console.log("\n--- AFTER ---");
  console.log("userRewardPerTokenPaid:", paidAfter.toString());
  console.log("rewards[tester] (accrued):", hre.ethers.formatEther(accruedAfter));
  console.log("earned(tester):", hre.ethers.formatEther(earnedAfter));

  console.log("\nDONE.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
