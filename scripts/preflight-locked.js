// scripts/preflight-locked.js
//
// MMM v1 locked preflight:
// - Reads a deployment manifest JSON (NOT .env addresses)
// - Hard-fails on any wiring mismatch
// - Prints a compact status report
//
// Usage:
//   npx hardhat run --network monadTestnet scripts/preflight-locked.js
//
// Env (optional):
//   DEPLOYMENT_MANIFEST=deployments/monadTestnet/latest.json
//   EXPECT_CHAIN_ID=10143
//   EXPECT_NETWORK=monadTestnet
//   CLAIMANT_PRIVATE_KEY=0x... (optional; prints claimant snapshot)
//
// Notes:
// - This script does NOT mutate state.
// - It will exit(1) if anything critical is wrong.

const hre = require("hardhat");
const { ethers, network } = hre;
const fs = require("fs");
const path = require("path");

function die(msg) {
  console.error(`\n[FAIL] ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[OK]  ${msg}`);
}

function warn(msg) {
  console.log(`[WARN] ${msg}`);
}

function mustFile(p) {
  if (!fs.existsSync(p)) die(`Missing manifest file: ${p}`);
  return p;
}

function loadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    die(`Failed to parse manifest JSON at ${p}: ${e.message}`);
  }
}

function normAddr(a) {
  if (!a) return "";
  return String(a).toLowerCase();
}

function isZero(a) {
  return normAddr(a) === "0x0000000000000000000000000000000000000000";
}

async function codeAt(addr) {
  if (!addr) return "0x";
  return await ethers.provider.getCode(addr);
}

function short(a) {
  if (!a) return "(none)";
  const s = String(a);
  return s.length <= 10 ? s : `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function fmtUnits(x, decimals = 18) {
  try {
    return ethers.formatUnits(x, decimals);
  } catch {
    return String(x);
  }
}

async function mustNonEmptyCode(label, addr) {
  const c = await codeAt(addr);
  if (!addr || c === "0x") die(`${label} has no code at ${addr}`);
  ok(`${label} code present @ ${addr}`);
  return c;
}

async function assertEqAddr(label, actual, expected) {
  if (normAddr(actual) !== normAddr(expected)) {
    die(`${label} mismatch: actual=${actual} expected=${expected}`);
  }
  ok(`${label} matches (${actual})`);
}

async function main() {
  // -------- manifest path resolution --------
  const root = process.cwd();

  // prefer explicit env, else default to deployments/<network>/latest.json
  const envManifest = process.env.DEPLOYMENT_MANIFEST;
  const defaultManifest = path.join("deployments", network.name, "latest.json");
  const manifestPath = mustFile(path.resolve(root, envManifest || defaultManifest));

  const m = loadJson(manifestPath);

  // basic manifest validation
  if (!m.contracts || !m.contracts.MMMToken || !m.contracts.TaxVault || !m.contracts.RewardVault) {
    die(`Manifest missing contracts.MMMToken/TaxVault/RewardVault. Path=${manifestPath}`);
  }

  console.log(`=== MMM v1 LOCKED PREFLIGHT (${network.name}) ===`);
  console.log(`Manifest: ${manifestPath}\n`);

  // -------- chainId gating --------
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const expectedChainId = process.env.EXPECT_CHAIN_ID
    ? Number(process.env.EXPECT_CHAIN_ID)
    : (m.chainId != null ? Number(m.chainId) : null);

  if (expectedChainId == null || Number.isNaN(expectedChainId)) {
    warn("No EXPECT_CHAIN_ID and manifest.chainId missing; skipping strict chainId gate.");
  } else {
    if (chainId !== expectedChainId) {
      die(`Wrong chainId: connected=${chainId} expected=${expectedChainId}`);
    }
    ok(`chainId gate passed (${chainId})`);
  }

  const expectedNetwork = process.env.EXPECT_NETWORK || m.network || null;
  if (expectedNetwork && expectedNetwork !== network.name) {
    die(`Wrong Hardhat network: running=${network.name} expected=${expectedNetwork}`);
  }
  if (expectedNetwork) ok(`network gate passed (${network.name})`);

  // -------- addresses --------
  const MMMTokenAddr = m.contracts.MMMToken;
  const TaxVaultAddr = m.contracts.TaxVault;
  const RewardVaultAddr = m.contracts.RewardVault;

  const pairExpected = m.params?.PAIR_ADDR || "";
  const routerExpected = m.params?.ROUTER_ADDR || "";
  const buyTaxExpected = m.params?.BUY_TAX_BPS;
  const sellTaxExpected = m.params?.SELL_TAX_BPS;
  const minHoldExpected = m.params?.MIN_HOLD_SEC;
  const cooldownExpected = m.params?.COOLDOWN_SEC;
  const minBalanceExpected = m.params?.MIN_BALANCE;

  console.log("[Addresses]");
  console.log("MMMToken   :", MMMTokenAddr);
  console.log("TaxVault   :", TaxVaultAddr);
  console.log("RewardVault:", RewardVaultAddr);
  if (pairExpected) console.log("PAIR (exp) :", pairExpected);
  if (routerExpected) console.log("ROUTER(exp):", routerExpected);
  console.log("");

  // -------- code presence --------
  await mustNonEmptyCode("MMMToken", MMMTokenAddr);
  await mustNonEmptyCode("TaxVault", TaxVaultAddr);
  await mustNonEmptyCode("RewardVault", RewardVaultAddr);

  // Also check pair/router if provided in manifest
  if (pairExpected) {
    const c = await codeAt(pairExpected);
    if (c === "0x") die(`PAIR_ADDR has no code at ${pairExpected}`);
    ok(`PAIR_ADDR code present @ ${pairExpected}`);
  }
  if (routerExpected && !isZero(routerExpected)) {
    const c = await codeAt(routerExpected);
    if (c === "0x") die(`ROUTER_ADDR has no code at ${routerExpected}`);
    ok(`ROUTER_ADDR code present @ ${routerExpected}`);
  } else if (routerExpected && isZero(routerExpected)) {
    warn("ROUTER_ADDR is zero (acceptable on test setups; not acceptable on mainnet).");
  }

  console.log("");

  // -------- attach contracts --------
  const mmm = await ethers.getContractAt("MMMToken", MMMTokenAddr);
  const tv = await ethers.getContractAt("TaxVault", TaxVaultAddr);
  const rv = await ethers.getContractAt("RewardVault", RewardVaultAddr);

  // -------- MMMToken wiring assertions --------
  console.log("[MMMToken checks]");
  const name = await mmm.name();
  const symbol = await mmm.symbol();
  const decimals = await mmm.decimals();
  const totalSupply = await mmm.totalSupply();

  ok(`name/symbol: ${name} (${symbol})`);
  ok(`decimals: ${decimals.toString()}`);
  ok(`totalSupply: ${fmtUnits(totalSupply, decimals)} (${totalSupply.toString()} raw)`);

  const pair = await mmm.pair();
  const router = await mmm.router();
  const taxVault = await mmm.taxVault();
  const taxesEnabled = await mmm.taxesEnabled();
  const buyTaxBps = await mmm.buyTaxBps();
  const sellTaxBps = await mmm.sellTaxBps();

  await assertEqAddr("MMMToken.taxVault()", taxVault, TaxVaultAddr);

  if (pairExpected) await assertEqAddr("MMMToken.pair()", pair, pairExpected);
  else ok(`MMMToken.pair(): ${pair} (no expected pair in manifest)`);

  if (routerExpected) await assertEqAddr("MMMToken.router()", router, routerExpected);
  else ok(`MMMToken.router(): ${router} (no expected router in manifest)`);

  if (buyTaxExpected != null) {
    if (Number(buyTaxBps) !== Number(buyTaxExpected)) {
      die(`buyTaxBps mismatch: actual=${buyTaxBps} expected=${buyTaxExpected}`);
    }
    ok(`buyTaxBps matches (${buyTaxBps.toString()})`);
  } else {
    ok(`buyTaxBps: ${buyTaxBps.toString()} (no expected in manifest)`);
  }

  if (sellTaxExpected != null) {
    if (Number(sellTaxBps) !== Number(sellTaxExpected)) {
      die(`sellTaxBps mismatch: actual=${sellTaxBps} expected=${sellTaxExpected}`);
    }
    ok(`sellTaxBps matches (${sellTaxBps.toString()})`);
  } else {
    ok(`sellTaxBps: ${sellTaxBps.toString()} (no expected in manifest)`);
  }

  if (!taxesEnabled) die("MMMToken.taxesEnabled() is false (expected true for v1 live)");
  ok("taxesEnabled: true");

  console.log("");

  // -------- TaxVault wiring assertions --------
  console.log("[TaxVault checks]");
  const rewardVaultSet = await tv.rewardVaultSet();
  if (!rewardVaultSet) die("TaxVault.rewardVaultSet() is false");
  ok("rewardVaultSet: true");

  const rewardVault = await tv.rewardVault();
  await assertEqAddr("TaxVault.rewardVault()", rewardVault, RewardVaultAddr);

  console.log("");

  // -------- RewardVault wiring assertions --------
  console.log("[RewardVault checks]");
  const rvMMM = await rv.mmm();
  const rvTV = await rv.taxVault();

  await assertEqAddr("RewardVault.mmm()", rvMMM, MMMTokenAddr);
  await assertEqAddr("RewardVault.taxVault()", rvTV, TaxVaultAddr);

  // parameters
  const minHold = await rv.minHoldTimeSec();
  const cooldown = await rv.claimCooldown();
  const minBalance = await rv.minBalance();

  if (minHoldExpected != null && Number(minHold) !== Number(minHoldExpected)) {
    die(`minHoldTimeSec mismatch: actual=${minHold} expected=${minHoldExpected}`);
  }
  ok(`minHoldTimeSec: ${minHold.toString()}${minHoldExpected != null ? " (matches)" : ""}`);

  if (cooldownExpected != null && Number(cooldown) !== Number(cooldownExpected)) {
    die(`claimCooldown mismatch: actual=${cooldown} expected=${cooldownExpected}`);
  }
  ok(`claimCooldown: ${cooldown.toString()}${cooldownExpected != null ? " (matches)" : ""}`);

  if (minBalanceExpected != null && String(minBalance) !== String(minBalanceExpected)) {
    die(`minBalance mismatch: actual=${minBalance} expected=${minBalanceExpected}`);
  }
  ok(`minBalance: ${minBalance.toString()}${minBalanceExpected != null ? " (matches)" : ""}`);

  // eligible supply sanity
  const elig = await rv.eligibleSupply();
  if (elig <= 0n) die("eligibleSupply is 0");
  ok(`eligibleSupply: ${fmtUnits(elig, decimals)} (${elig.toString()} raw)`);

  console.log("");

  // -------- balances snapshot --------
  console.log("[Balances]");
  const tvBal = await mmm.balanceOf(TaxVaultAddr);
  const rvBal = await mmm.balanceOf(RewardVaultAddr);
  console.log(`TaxVault MMM   : ${fmtUnits(tvBal, decimals)} (${tvBal.toString()} raw)`);
  console.log(`RewardVault MMM : ${fmtUnits(rvBal, decimals)} (${rvBal.toString()} raw)`);
  console.log("");

  // -------- optional claimant snapshot --------
  const pk = process.env.CLAIMANT_PRIVATE_KEY || "";
  if (pk) {
    const claimant = new ethers.Wallet(pk, ethers.provider);
    console.log("[Claimant Snapshot]");
    console.log("claimant:", claimant.address);

    const monBal = await ethers.provider.getBalance(claimant.address);
    const mmmBal = await mmm.balanceOf(claimant.address);
    const pending = await rv.pending(claimant.address);
    const lnz = await mmm.lastNonZeroAt(claimant.address);
    const lc = await rv.lastClaimAt(claimant.address);

    console.log(`MON balance     : ${ethers.formatEther(monBal)} (${monBal.toString()} wei)`);
    console.log(`MMM balance     : ${fmtUnits(mmmBal, decimals)} (${mmmBal.toString()} raw)`);
    console.log(`pending         : ${fmtUnits(pending, decimals)} (${pending.toString()} raw)`);
    console.log(`lastNonZeroAt   : ${lnz.toString()}`);
    console.log(`lastClaimAt     : ${lc.toString()}`);

    // best-effort exclusion check (function exists in your latest ABI)
    try {
      const ex = await rv.isExcludedFromRewards(claimant.address);
      console.log(`excluded         : ${ex ? "true" : "false"}`);
    } catch {
      console.log("excluded         : (no alias fn)");
    }

    console.log("");
  }

  console.log("=== PREFLIGHT PASSED ===");
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
