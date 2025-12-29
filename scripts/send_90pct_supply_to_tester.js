// scripts/send_90pct_supply_to_tester.js
// Transfers 90% of MMM total supply from owner to tester

require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const [owner] = await hre.ethers.getSigners();

  // === Addresses (fallback to known values) ===
  const MMM_ADDRESS =
    process.env.MMM ||
    "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16";

  const TESTER =
    process.env.TESTER ||
    "0x22BC7a72000faE48a67520c056C0944d9a675412";

  console.log("Network:", hre.network.name);
  console.log("Owner:", owner.address);
  console.log("Tester:", TESTER);
  console.log("MMM:", MMM_ADDRESS);

  // Minimal MMM ABI
  const MMM_ABI = [
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function transfer(address to, uint256 amount) returns (bool)",
  ];

  const mmm = await hre.ethers.getContractAt(MMM_ABI, MMM_ADDRESS);

  const [decimals, symbol, totalSupply] = await Promise.all([
    mmm.decimals(),
    mmm.symbol(),
    mmm.totalSupply(),
  ]);

  const ownerBalBefore = await mmm.balanceOf(owner.address);
  const testerBalBefore = await mmm.balanceOf(TESTER);

  // 90% of total supply
  const amount = (totalSupply * 90n) / 100n;

  console.log("\n--- BEFORE ---");
  console.log(
    `Owner ${symbol}:`,
    hre.ethers.formatUnits(ownerBalBefore, decimals)
  );
  console.log(
    `Tester ${symbol}:`,
    hre.ethers.formatUnits(testerBalBefore, decimals)
  );
  console.log(
    `Total supply:`,
    hre.ethers.formatUnits(totalSupply, decimals)
  );
  console.log(
    `Transfer amount (90%):`,
    hre.ethers.formatUnits(amount, decimals)
  );

  if (ownerBalBefore < amount) {
    throw new Error("Owner does NOT have enough MMM to send 90% of supply");
  }

  console.log("\nSending 90% of supply to tester...");
  const tx = await mmm.transfer(TESTER, amount);
  console.log("tx:", tx.hash);
  await tx.wait();

  const ownerBalAfter = await mmm.balanceOf(owner.address);
  const testerBalAfter = await mmm.balanceOf(TESTER);

  console.log("\n--- AFTER ---");
  console.log(
    `Owner ${symbol}:`,
    hre.ethers.formatUnits(ownerBalAfter, decimals)
  );
  console.log(
    `Tester ${symbol}:`,
    hre.ethers.formatUnits(testerBalAfter, decimals)
  );

  const pct =
    (testerBalAfter * 10000n) / totalSupply; // basis points
  console.log(
    `Tester now holds: ${(Number(pct) / 100).toFixed(2)}% of supply`
  );

  console.log("\nDONE.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// npx hardhat run scripts/send_90pct_supply_to_tester.js --network monadTestnet
