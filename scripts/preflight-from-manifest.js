// scripts/preflight-from-manifest.js
//
// Usage:
//   $env:MANIFEST="deployments/monadTestnet/latest.json"
//   npx hardhat run --network monadTestnet scripts/preflight-from-manifest.js
//
// or (defaults):
//   npx hardhat run --network monadTestnet scripts/preflight-from-manifest.js
//   npx hardhat run --network monadMainnet scripts/preflight-from-manifest.js
//
// Supports BOTH manifest formats:
//
// Format A (nested):
// {
//   "chainId": 10143,
//   "network": "monadTestnet",
//   "contracts": { "MMMToken":"0x..", "TaxVault":"0x..", "RewardVault":"0x.." },
//   "params": { "PAIR_ADDR":"0x..", "ROUTER_ADDR":"0x.." }
// }
//
// Format B (flat):
// {
//   "MMMToken":"0x..", "TaxVault":"0x..", "RewardVault":"0x..",
//   "PAIR_ADDR":"0x..", "ROUTER_ADDR":"0x.."
// }

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

function die(msg) {
  console.error(`\n[FAIL] ${msg}\n`);
  process.exit(1);
}
function warn(msg) {
  console.log(`[WARN] ${msg}`);
}
function ok(msg) {
  console.log(`[OK] ${msg}`);
}

function fmtAddr(a) {
  return a ? String(a) : "(none)";
}

function fmtWei(x, decimals = 18) {
  try {
    return ethers.formatUnits(x, decimals);
  } catch {
    return String(x);
  }
}

async function codeAt(addr) {
  if (!addr) return "0x";
  return await ethers.provider.getCode(addr);
}

function readJson(p) {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function isNonZeroAddress(a) {
  if (!a) return false;
  const s = String(a).toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(s) && s !== "0x0000000000000000000000000000000000000000";
}

function getPath(obj, pathStr) {
  // minimal safe getter: "a.b.c"
  const parts = pathStr.split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function detectFormat(manifest) {
  const hasContractsObj =
    manifest &&
    typeof manifest === "object" &&
    manifest.contracts &&
    typeof manifest.contracts === "object";

  // If contracts exists, treat as A (even if it also has flat keys)
  return hasContractsObj ? "A" : "B";
}

function normalizeManifest(manifest) {
  const fmt = detectFormat(manifest);

  // addresses
  const MMMToken =
    getPath(manifest, "contracts.MMMToken") ??
    manifest.MMMToken ??
    "";

  const TaxVault =
    getPath(manifest, "contracts.TaxVault") ??
    manifest.TaxVault ??
    "";

  const RewardVault =
    getPath(manifest, "contracts.RewardVault") ??
    manifest.RewardVault ??
    "";

  // params (either params.* or top-level aliases)
  const PAIR_ADDR =
    getPath(manifest, "params.PAIR_ADDR") ??
    manifest.PAIR_ADDR ??
    manifest.pair ??
    "";

  const ROUTER_ADDR =
    getPath(manifest, "params.ROUTER_ADDR") ??
    manifest.ROUTER_ADDR ??
    manifest.router ??
    "";

  const chainId =
    (manifest.chainId !== undefined ? BigInt(manifest.chainId) : undefined) ??
    (manifest.meta && manifest.meta.chainId !== undefined ? BigInt(manifest.meta.chainId) : undefined);

  const network =
    manifest.network ??
    (manifest.meta ? manifest.meta.network : undefined);

  return {
    format: fmt,
    MMMToken,
    TaxVault,
    RewardVault,
    PAIR_ADDR,
    ROUTER_ADDR,
    chainId,
    network,
  };
}

async function safeCall(label, fn) {
  try {
    const v = await fn();
    return { ok: true, v };
  } catch (e) {
    return { ok: false, v: null, err: e, label };
  }
}

function isMainnetNetworkName(networkName) {
  return String(networkName || "").toLowerCase().includes("mainnet");
}

async function main() {
  const root = process.cwd();
  const networkName = hre.network.name; // monadTestnet / monadMainnet
  const net = await ethers.provider.getNetwork();
  const [deployer] = await ethers.getSigners();
  const latest = await ethers.provider.getBlock("latest");

  // Resolve manifest path:
  // Priority 1: MANIFEST env var
  // Priority 2: deployments/<networkName>/latest.json
  const envManifest = process.env.MANIFEST && String(process.env.MANIFEST).trim();
  const manifestPath = envManifest
    ? path.isAbsolute(envManifest)
      ? envManifest
      : path.join(root, envManifest)
    : path.join(root, "deployments", networkName, "latest.json");

  if (!fs.existsSync(manifestPath)) {
    die(`Missing manifest: ${manifestPath}`);
  }

  const manifestRaw = readJson(manifestPath);
  const manifest = normalizeManifest(manifestRaw);

  // Basic address validation
  if (!isNonZeroAddress(manifest.MMMToken)) die(`Manifest missing/invalid MMMToken address in ${manifestPath}`);
  if (!isNonZeroAddress(manifest.TaxVault)) die(`Manifest missing/invalid TaxVault address in ${manifestPath}`);
  if (!isNonZeroAddress(manifest.RewardVault)) die(`Manifest missing/invalid RewardVault address in ${manifestPath}`);

  console.log(`=== MMM v1 PREFLIGHT FROM MANIFEST (${networkName}) ===\n`);

  console.log("[Manifest]");
  console.log("path      :", manifestPath);
  console.log("format    :", manifest.format);
  console.log("MMMToken   :", manifest.MMMToken);
  console.log("TaxVault   :", manifest.TaxVault);
  console.log("RewardVault:", manifest.RewardVault);
  console.log("PAIR_ADDR  :", fmtAddr(manifest.PAIR_ADDR));
  console.log("ROUTER_ADDR:", fmtAddr(manifest.ROUTER_ADDR));
  console.log("");

  console.log("[Network]");
  console.log("chainId     :", net.chainId.toString());
  console.log("latest block:", latest.number);
  console.log("timestamp   :", latest.timestamp);
  console.log("deployer    :", deployer.address);
  console.log("");

  // Optional manifest chainId sanity (non-fatal)
  if (manifest.chainId !== undefined) {
    if (manifest.chainId !== BigInt(net.chainId)) {
      die(`chainId mismatch: manifest=${manifest.chainId.toString()} provider=${net.chainId.toString()}`);
    }
    ok("chainId matches manifest.");
  } else {
    warn("manifest.chainId missing; skipping chainId assert (recommended to include).");
  }

  // 1) Code checks
  console.log("[Code Checks]");
  const mmmCode = await codeAt(manifest.MMMToken);
  const tvCode = await codeAt(manifest.TaxVault);
  const rvCode = await codeAt(manifest.RewardVault);

  if (mmmCode === "0x") die(`No code at MMMToken: ${manifest.MMMToken}`);
  if (tvCode === "0x") die(`No code at TaxVault: ${manifest.TaxVault}`);
  if (rvCode === "0x") die(`No code at RewardVault: ${manifest.RewardVault}`);

  ok("MMMToken code present");
  ok("TaxVault code present");
  ok("RewardVault code present");

  // Pair param: optional, but if present must have code
  if (isNonZeroAddress(manifest.PAIR_ADDR)) {
    const pairCode = await codeAt(manifest.PAIR_ADDR);
    if (pairCode === "0x") die(`PAIR_ADDR provided but has no code: ${manifest.PAIR_ADDR}`);
    ok("PAIR_ADDR code present");
  } else {
    warn("PAIR_ADDR not provided in manifest (ok if MMMToken.pair() is set).");
  }

  // Router param: only enforced on mainnet
  const isMainnet = isMainnetNetworkName(networkName);
  if (isNonZeroAddress(manifest.ROUTER_ADDR)) {
    const routerCode = await codeAt(manifest.ROUTER_ADDR);
    if (routerCode === "0x") {
      if (isMainnet) die(`ROUTER_ADDR provided but has no code: ${manifest.ROUTER_ADDR}`);
      warn(`params.ROUTER_ADDR has no code at ${manifest.ROUTER_ADDR} (maybe expected on testnet)`);
    } else {
      ok("ROUTER_ADDR code present");
    }
  } else {
    if (isMainnet) {
      die("Mainnet guard: ROUTER_ADDR missing/zero in manifest.");
    }
    warn("ROUTER_ADDR is zero/absent in manifest (allowed on testnet).");
  }
  console.log("");

  // Attach contracts
  const mmm = await ethers.getContractAt("MMMToken", manifest.MMMToken);
  const tv = await ethers.getContractAt("TaxVault", manifest.TaxVault);
  const rv = await ethers.getContractAt("RewardVault", manifest.RewardVault);

  // 2) MMMToken wiring + basic info
  console.log("[MMMToken]");
  const nameR = await safeCall("name", () => mmm.name());
  const symbolR = await safeCall("symbol", () => mmm.symbol());
  const decimalsR = await safeCall("decimals", () => mmm.decimals());
  const tsR = await safeCall("totalSupply", () => mmm.totalSupply());
  const pairR = await safeCall("pair", () => mmm.pair());
  const routerR = await safeCall("router", () => mmm.router());
  const taxVaultR = await safeCall("taxVault", () => mmm.taxVault());
  const taxesEnabledR = await safeCall("taxesEnabled", () => mmm.taxesEnabled());
  const buyTaxR = await safeCall("buyTaxBps", () => mmm.buyTaxBps());
  const sellTaxR = await safeCall("sellTaxBps", () => mmm.sellTaxBps());

  const decimals = decimalsR.ok ? Number(decimalsR.v) : 18;

  if (nameR.ok && symbolR.ok) console.log("name/symbol:", `${nameR.v} (${symbolR.v})`);
  if (decimalsR.ok) console.log("decimals   :", decimalsR.v.toString());
  if (tsR.ok) console.log("totalSupply:", fmtWei(tsR.v, decimals), `(${tsR.v.toString()} raw)`);
  console.log("pair()      :", pairR.ok ? pairR.v : "(reverted)");
  console.log("router()    :", routerR.ok ? routerR.v : "(reverted)");
  console.log("taxVault()  :", taxVaultR.ok ? taxVaultR.v : "(reverted)");
  console.log("taxesEnabled:", taxesEnabledR.ok ? String(taxesEnabledR.v) : "(reverted)");
  console.log("buy/sell bps:", buyTaxR.ok && sellTaxR.ok ? `${buyTaxR.v.toString()} / ${sellTaxR.v.toString()}` : "(reverted)");
  console.log("");

  // Required: MMMToken.taxVault() must match manifest TaxVault
  if (!taxVaultR.ok) die("MMMToken.taxVault() reverted; ABI/deploy mismatch");
  if (taxVaultR.v.toLowerCase() !== manifest.TaxVault.toLowerCase()) {
    die(`MMMToken.taxVault() mismatch.\n  onchain: ${taxVaultR.v}\n  manifest: ${manifest.TaxVault}`);
  }
  ok("MMMToken.taxVault() matches manifest");

  // Required: MMMToken.pair() must be set and have code
  if (!pairR.ok) die("MMMToken.pair() reverted; ABI/deploy mismatch");
  if (!isNonZeroAddress(pairR.v)) die("MMMToken.pair() is zero address (pair not set)");
  const onchainPairCode = await codeAt(pairR.v);
  if (onchainPairCode === "0x") die(`MMMToken.pair() has no code: ${pairR.v}`);
  ok("MMMToken.pair() is set and has code");

  // If manifest PAIR_ADDR provided, enforce it matches MMMToken.pair()
  if (isNonZeroAddress(manifest.PAIR_ADDR) && pairR.v.toLowerCase() !== manifest.PAIR_ADDR.toLowerCase()) {
    die(`PAIR_ADDR mismatch.\n  MMMToken.pair(): ${pairR.v}\n  manifest PAIR_ADDR: ${manifest.PAIR_ADDR}`);
  }

  // Router enforcement:
  const routerIsZero = !routerR.ok || !isNonZeroAddress(routerR.v);

  if (isMainnet) {
    if (routerIsZero) {
      die("Mainnet guard: MMMToken.router() is not set (zero). Set router before mainnet launch.");
    }
    const onchainRouterCode = await codeAt(routerR.v);
    if (onchainRouterCode === "0x") die(`Mainnet guard: MMMToken.router() has no code: ${routerR.v}`);
    ok("Mainnet guard: MMMToken.router() is set and has code");

    // If manifest ROUTER_ADDR is provided, enforce match
    if (isNonZeroAddress(manifest.ROUTER_ADDR) && routerR.v.toLowerCase() !== manifest.ROUTER_ADDR.toLowerCase()) {
      die(`ROUTER_ADDR mismatch.\n  MMMToken.router(): ${routerR.v}\n  manifest ROUTER_ADDR: ${manifest.ROUTER_ADDR}`);
    }
  } else {
    if (!routerIsZero) {
      const onchainRouterCode = await codeAt(routerR.v);
      if (onchainRouterCode === "0x") die(`MMMToken.router() set but has no code: ${routerR.v}`);
      ok("MMMToken.router() set and has code");
    } else {
      warn("Testnet note: MMMToken.router() is zero (allowed)");
    }
  }

  // 3) TaxVault wiring
  console.log("[TaxVault]");
  const rvSetR = await safeCall("rewardVaultSet", () => tv.rewardVaultSet());
  const tvRewardVaultR = await safeCall("rewardVault", () => tv.rewardVault());
  console.log("rewardVaultSet():", rvSetR.ok ? String(rvSetR.v) : "(reverted)");
  console.log("rewardVault():   ", tvRewardVaultR.ok ? tvRewardVaultR.v : "(reverted)");
  console.log("");

  if (!tvRewardVaultR.ok) die("TaxVault.rewardVault() reverted; ABI/deploy mismatch");
  if (tvRewardVaultR.v.toLowerCase() !== manifest.RewardVault.toLowerCase()) {
    die(`TaxVault.rewardVault() mismatch.\n  onchain: ${tvRewardVaultR.v}\n  manifest: ${manifest.RewardVault}`);
  }
  ok("TaxVault.rewardVault() matches manifest RewardVault");

  // 4) RewardVault wiring + params
  console.log("[RewardVault]");
  const rvMmmR = await safeCall("mmm", () => rv.mmm());
  const rvTaxVaultR = await safeCall("taxVault", () => rv.taxVault());
  const minHoldR = await safeCall("minHoldTimeSec", () => rv.minHoldTimeSec());
  const cooldownR = await safeCall("claimCooldown", () => rv.claimCooldown());
  const minBalR = await safeCall("minBalance", () => rv.minBalance());
  const eligR = await safeCall("eligibleSupply", () => rv.eligibleSupply());

  console.log("mmm()          :", rvMmmR.ok ? rvMmmR.v : "(reverted)");
  console.log("taxVault()     :", rvTaxVaultR.ok ? rvTaxVaultR.v : "(reverted)");
  console.log("minHoldTimeSec :", minHoldR.ok ? minHoldR.v.toString() : "(reverted/missing)");
  console.log("claimCooldown  :", cooldownR.ok ? cooldownR.v.toString() : "(reverted/missing)");
  console.log("minBalance     :", minBalR.ok ? fmtWei(minBalR.v, decimals) : "(reverted/missing)");
  console.log("eligibleSupply :", eligR.ok ? fmtWei(eligR.v, decimals) : "(reverted/missing)");
  console.log("");

  if (!rvMmmR.ok) die("RewardVault.mmm() reverted; ABI/deploy mismatch");
  if (rvMmmR.v.toLowerCase() !== manifest.MMMToken.toLowerCase()) {
    die(`RewardVault.mmm() mismatch.\n  onchain: ${rvMmmR.v}\n  manifest: ${manifest.MMMToken}`);
  }
  ok("RewardVault.mmm() matches manifest MMMToken");

  if (!rvTaxVaultR.ok) die("RewardVault.taxVault() reverted; ABI/deploy mismatch");
  if (rvTaxVaultR.v.toLowerCase() !== manifest.TaxVault.toLowerCase()) {
    die(`RewardVault.taxVault() mismatch.\n  onchain: ${rvTaxVaultR.v}\n  manifest: ${manifest.TaxVault}`);
  }
  ok("RewardVault.taxVault() matches manifest TaxVault");

  // 5) Balances snapshot
  console.log("[Balances]");
  const tvBal = await mmm.balanceOf(manifest.TaxVault);
  const rvBal = await mmm.balanceOf(manifest.RewardVault);
  console.log("TaxVault MMM :", fmtWei(tvBal, decimals), `(${tvBal.toString()} raw)`);
  console.log("RewardVault MMM:", fmtWei(rvBal, decimals), `(${rvBal.toString()} raw)`);
  console.log("");

  console.log("=== PREFLIGHT PASS ===");
}

main().catch((e) => {
  console.error("\n[ERROR]", e);
  process.exit(1);
});
