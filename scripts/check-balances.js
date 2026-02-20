/**
 * check-balances.js
 * Run before and after a swap to see the difference.
 *
 * Usage:
 *   npx hardhat run scripts/check-balances.js --network monadTestnet
 */
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const provider = new ethers.JsonRpcProvider(hre.network.config.url);

  // ── Addresses to check ───────────────────────────────────────────
  const WALLETS = {
    "Fresh Buyer  ": process.env.FRESH3_WALLET,  
    "Deployer     ": "0xBF98e5FEf825CcD68dcFF3cF0a766faB413D6207",
    "TaxVault     ": process.env.TESTNET_TAX_VAULT,
    "Pair         ": process.env.TESTNET_PAIR,
  };

  const MMM_ADDR  = process.env.TESTNET_MMM;
  const USDC_ADDR = process.env.TESTNET_USDC;
  const WMON_ADDR = process.env.TESTNET_WMON;

  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
  ];

  const mmm  = new ethers.Contract(MMM_ADDR,  ERC20_ABI, provider);
  const usdc = new ethers.Contract(USDC_ADDR, ERC20_ABI, provider);
  const wmon = new ethers.Contract(WMON_ADDR, ERC20_ABI, provider);

  const block = await provider.getBlock("latest");
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  BALANCE SNAPSHOT");
  console.log(`  Block: ${block.number}  |  ${new Date(Number(block.timestamp) * 1000).toISOString()}`);
  console.log("══════════════════════════════════════════════════════════════\n");

  console.log(
    "  Wallet".padEnd(20),
    "MON".padStart(18),
    "WMON".padStart(18),
    "MMM".padStart(22),
    "USDC".padStart(14)
  );
  console.log("  " + "─".repeat(90));

  for (const [label, addr] of Object.entries(WALLETS)) {
    if (!addr) {
      console.log(`  ${label}  ⚠️  address not set in .env`);
      continue;
    }

    const [monRaw, wmonRaw, mmmRaw, usdcRaw] = await Promise.all([
      provider.getBalance(addr),
      wmon.balanceOf(addr),
      mmm.balanceOf(addr),
      usdc.balanceOf(addr),
    ]);

    const mon  = ethers.formatEther(monRaw);
    const wmonF = ethers.formatEther(wmonRaw);
    const mmmF  = ethers.formatUnits(mmmRaw, 18);
    const usdcF = ethers.formatUnits(usdcRaw, 6);

    console.log(
      `  ${label}`,
      Number(mon).toFixed(4).padStart(18),
      Number(wmonF).toFixed(4).padStart(18),
      Number(mmmF).toFixed(4).padStart(22),
      Number(usdcF).toFixed(2).padStart(14)
    );
  }

  console.log("\n══════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});