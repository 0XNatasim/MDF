// scripts/check-balances.js
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const net = await ethers.provider.getNetwork();
  const block = await ethers.provider.getBlock("latest");

  console.log("=== BALANCE CHECK ===");
  console.log("network :", hre.network.name);
  console.log("chainId :", net.chainId.toString());
  console.log("block   :", block.number);
  console.log("");

  // --- Collect addresses ---
  const signers = await ethers.getSigners();

  const addresses = new Map();

  // Signers (wallets Hardhat knows about)
  for (let i = 0; i < signers.length; i++) {
    addresses.set(`signer[${i}]`, signers[i].address);
  }

  // Optional env addresses
  const envKeys = [
    "DEPLOYER",
    "FRESH3",
    "CLAIMANT",
    "TREASURY",
    "TAX_VAULT",
    "REWARD_VAULT",
    "MMMToken",
    "TaxVault",
    "RewardVault",
  ];

  for (const k of envKeys) {
    if (process.env[k]) {
      addresses.set(k, process.env[k]);
    }
  }

  // --- Optional MMM token ---
  let mmm = null;
  let decimals = 18;

  if (process.env.MMMToken) {
    try {
      mmm = await ethers.getContractAt("MMMToken", process.env.MMMToken);
      decimals = await mmm.decimals();
    } catch {
      console.log("[WARN] Could not attach MMMToken for ERC20 balance checks");
    }
  }

  // --- Print balances ---
  console.log("Address balances:\n");

  for (const [label, addr] of addresses.entries()) {
    if (!ethers.isAddress(addr)) continue;

    const native = await ethers.provider.getBalance(addr);
    const nativeFmt = ethers.formatEther(native);

    let mmmFmt = "-";
    if (mmm) {
      try {
        const bal = await mmm.balanceOf(addr);
        mmmFmt = ethers.formatUnits(bal, decimals);
      } catch {
        mmmFmt = "ERR";
      }
    }

    console.log(`${label.padEnd(16)} ${addr}`);
    console.log(`  MON : ${nativeFmt}`);
    if (mmm) console.log(`  MMM : ${mmmFmt}`);
    console.log("");
  }

  console.log("=== DONE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
