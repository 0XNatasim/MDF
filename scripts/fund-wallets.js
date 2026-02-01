// scripts/fund-wallets.js
// Usage: npx hardhat run --network monadTestnet scripts/fund-wallets.js
//
// Funds every wallet in .env up to 1 MON using DOPTESTNET as the source.
// Adds a delay between RPC calls to stay under QuickNode's 25 req/s limit.

const hre = require("hardhat");
const { ethers } = hre;
const fs   = require("fs");
const path = require("path");

const TARGET     = ethers.parseEther("1.0");
const DELAY_MS   = 300; // 300ms between each RPC call (~3 req/s, well under 25/s)

// ─── Rate-limit-safe delay
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Same filtering logic as check-balances.js
function isContractKey(key) {
  const contractPatterns = [
    /FACTORY/i,
    /ROUTER/i,
    /WMON/i,
    /USDC/i,
    /BURN/i,
    /COMMON_NFT/i,
    /RARE_NFT/i,
    /MMM(?!.*PK)/i,
    /VAULT/i,
    /MULTISIG(?!.*SIGNER)/i,
  ];
  return contractPatterns.some((p) => p.test(key));
}

function isRealAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test((value || "").trim());
}

function parseEnvWallets(envPath) {
  const envRaw = fs.readFileSync(envPath, "utf8");
  const wallets = [];

  for (const line of envRaw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-----")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key   = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    if (!isRealAddress(value)) continue;
    if (isContractKey(key))    continue;

    const existing = wallets.find((w) => w.address.toLowerCase() === value.toLowerCase());
    if (existing) {
      existing.keys.push(key);
    } else {
      wallets.push({ keys: [key], address: value });
    }
  }
  return wallets;
}

async function main() {
  const rpcUrl   = hre.network.config.url;
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  if (!process.env.PRIVATE_KEY) {
    throw new Error(
      "Missing PRIVATE_KEY in .env.\n" +
      "This should be the private key for DOPTESTNET (the funded wallet)."
    );
  }
  const funder = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const expectedFunder = process.env.DOPTESTNET;
  if (expectedFunder && funder.address.toLowerCase() !== expectedFunder.toLowerCase()) {
    throw new Error(
      "PRIVATE_KEY does not match DOPTESTNET address.\n" +
      "  PRIVATE_KEY resolves to: " + funder.address + "\n" +
      "  DOPTESTNET is:           " + expectedFunder
    );
  }

  console.log("");
  console.log("=== Fund Wallets to 1 MON ===\n");
  console.log("Funder:", funder.address);

  const funderBal = await provider.getBalance(funder.address);
  await sleep(DELAY_MS);
  console.log("Funder balance:", ethers.formatUnits(funderBal, 18), "MON\n");

  // ─── Parse wallets and check balances (with delay between each)
  const envPath = path.resolve(__dirname, "..", ".env");
  const wallets = parseEnvWallets(envPath);

  const toFund = [];
  let totalNeeded = 0n;

  for (const wallet of wallets) {
    if (wallet.address.toLowerCase() === funder.address.toLowerCase()) continue;

    const bal = await provider.getBalance(wallet.address);
    await sleep(DELAY_MS);

    const shortfall = TARGET - bal;

    if (shortfall <= 0n) {
      console.log("✓ SKIP", wallet.keys.join(" / ").padEnd(34), ethers.formatUnits(bal, 18), "MON (already funded)");
      continue;
    }

    toFund.push({ ...wallet, balance: bal, shortfall });
    totalNeeded += shortfall;
    console.log("→ NEED", wallet.keys.join(" / ").padEnd(34), ethers.formatUnits(bal, 18), "MON  (short:", ethers.formatUnits(shortfall, 18) + ")");
  }

  console.log("");

  if (toFund.length === 0) {
    console.log("All wallets already have ≥ 1 MON. Nothing to do.");
    return;
  }

  console.log("Total to send:", ethers.formatUnits(totalNeeded, 18), "MON across", toFund.length, "wallet(s)\n");

  if (totalNeeded > funderBal) {
    throw new Error(
      "Funder does not have enough MON.\n" +
      "  Need:  " + ethers.formatUnits(totalNeeded, 18) + "\n" +
      "  Have:  " + ethers.formatUnits(funderBal, 18)
    );
  }

  // ─── Send transactions sequentially with delay between each
  for (const wallet of toFund) {
    const tx = await funder.sendTransaction({
      to:    wallet.address,
      value: wallet.shortfall,
    });
    await tx.wait();
    await sleep(DELAY_MS);

    console.log("✓ Funded", wallet.keys.join(" / ").padEnd(34), "→ sent", ethers.formatUnits(wallet.shortfall, 18), "MON  [tx: " + tx.hash.slice(0, 18) + "...]");
  }

  // ─── Final balances (with delay between each)
  console.log("\n=== Final Balances ===\n");

  const col1 = 38;
  const col2 = 44;
  console.log("KEY".padEnd(col1) + "ADDRESS".padEnd(col2) + "MON BALANCE");
  console.log("-".repeat(col1 + col2 + 20));

  let total = 0n;
  for (const wallet of wallets) {
    const bal = await provider.getBalance(wallet.address);
    await sleep(DELAY_MS);
    total += bal;
    console.log(
      wallet.keys.join(" / ").padEnd(col1) +
      wallet.address.padEnd(col2) +
      ethers.formatUnits(bal, 18) + " MON"
    );
  }

  console.log("-".repeat(col1 + col2 + 20));
  console.log("TOTAL".padEnd(col1 + col2) + ethers.formatUnits(total, 18) + " MON");
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});