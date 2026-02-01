// scripts/check-balances.js
// Usage: npx hardhat run --network monadTestnet scripts/check-balances.js
//
// Reads every key in .env whose value is a real 0x address (not a placeholder),
// skips known contract-token addresses (WMON, USDC, etc.), and prints the
// native MON balance for each wallet.

const hre = require("hardhat");
const { ethers } = hre;
const fs   = require("fs");
const path = require("path");

// ─── Addresses that are contracts / tokens, not wallets.
//     We skip these because checking their MON balance is meaningless.
const SKIP_KEYS = new Set([
  "WMON_ADDR",
  "USDC_ADDR",
  "BURN_ADDRESS",
  "MONAD_MAINNET_FACTORY",
  "MONAD_MAINNET_ROUTER",
  // Also skip any TESTNET_ or MAINNET_ contract keys if they ever get filled in
]);

function isContractKey(key) {
  if (SKIP_KEYS.has(key)) return true;
  // Generic: skip anything that looks like a contract deployment address
  // (factories, routers, tokens, vaults, NFTs, multisigs that are contracts)
  const contractPatterns = [
    /FACTORY/i,
    /ROUTER/i,
    /WMON/i,
    /USDC/i,
    /BURN/i,
    /COMMON_NFT/i,
    /RARE_NFT/i,
    /MMM(?!.*PK)/i,          // MMM but not a private key
    /VAULT/i,
    /MULTISIG(?!.*SIGNER)/i, // multisig address but not a signer key
  ];
  return contractPatterns.some((p) => p.test(key));
}

function isRealAddress(value) {
  // Must be a 0x-prefixed 40-hex-char address and NOT a placeholder like "0x..."
  return /^0x[0-9a-fA-F]{40}$/.test((value || "").trim());
}

async function main() {
  // ─── Use raw JsonRpcProvider (avoids HardhatEthersProvider issues)
  const rpcUrl   = hre.network.config.url;
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // ─── Parse .env manually so we get the raw key=value pairs
  //     (process.env works too, but this way we see exactly what's in the file)
  const envPath = path.resolve(__dirname, "..", ".env");
  const envRaw  = fs.readFileSync(envPath, "utf8");

  const wallets = [];

  for (const line of envRaw.split(/\r?\n/)) {
    const trimmed = line.trim();

    // Skip comments, blank lines, section separators
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-----")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key   = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    // Only care about real addresses
    if (!isRealAddress(value)) continue;

    // Skip known contract / token addresses
    if (isContractKey(key)) continue;

    // Deduplicate by address (same address might appear under multiple keys)
    if (wallets.some((w) => w.address.toLowerCase() === value.toLowerCase())) {
      wallets.find((w) => w.address.toLowerCase() === value.toLowerCase()).keys.push(key);
      continue;
    }

    wallets.push({ keys: [key], address: value });
  }

  if (wallets.length === 0) {
    console.log("No wallet addresses found in .env (all were placeholders or contracts).");
    return;
  }

  // ─── Header
  const col1 = 38; // key column width
  const col2 = 44; // address column width
  console.log("");
  console.log("=== MON Balances (Monad Testnet) ===\n");
  console.log(
    "KEY".padEnd(col1) +
    "ADDRESS".padEnd(col2) +
    "MON BALANCE"
  );
  console.log("-".repeat(col1 + col2 + 20));

  // ─── Fetch balances
  let total = 0n;

  for (const wallet of wallets) {
    const bal = await provider.getBalance(wallet.address);
    total += bal;

    const label = wallet.keys.join(" / ");
    const formatted = ethers.formatUnits(bal, 18);

    // Right-align the balance for readability
    console.log(
      label.padEnd(col1) +
      wallet.address.padEnd(col2) +
      formatted + " MON"
    );
  }

  console.log("-".repeat(col1 + col2 + 20));
  console.log(
    "TOTAL".padEnd(col1 + col2) +
    ethers.formatUnits(total, 18) + " MON"
  );
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
