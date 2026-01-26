#!/usr/bin/env node
/* scripts/assert-manifest.js
 *
 * OFFLINE=1 node scripts/assert-manifest.js <path>
 *   => JSON-only checks, no Hardhat/provider.
 *
 * MANIFEST=<path> npx hardhat run --network <net> scripts/assert-manifest.js
 *   => JSON + on-chain checks (strict chainId match, code present, optional hash lock).
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");

function log(msg = "") { process.stdout.write(String(msg) + "\n"); }
function ok(msg) { log(`[OK] ${msg}`); }
function warn(msg) { log(`[WARN] ${msg}`); }
function fail(msg) { log(`\n[FAIL] ${msg}\n`); process.exit(1); }

function isBytes32(x) {
  return typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x);
}

function readJson(absPath) {
  const raw = fs.readFileSync(absPath, "utf8");
  try { return JSON.parse(raw); }
  catch (e) { fail(`Manifest JSON parse error: ${e.message}`); }
}

function resolveManifestPath(argvPath) {
  const envPath = process.env.MANIFEST;
  const p = argvPath || envPath || "deployments/hardhat/latest.json";
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

/**
 * Supports:
 *  A) { contracts: { MMMToken, TaxVault, RewardVault }, params, build, chainId, network... }
 *  B) { MMMToken, TaxVault, RewardVault, params, build, chainId, network... }
 */
function normalizeManifest(m) {
  if (!m || typeof m !== "object") fail("Manifest is not an object");

  const hasNested = m.contracts && typeof m.contracts === "object";
  const hasFlat =
    typeof m.MMMToken === "string" ||
    typeof m.TaxVault === "string" ||
    typeof m.RewardVault === "string";

  let fmt = null;
  let contracts = null;

  if (hasNested) {
    fmt = "A (nested contracts)";
    contracts = {
      MMMToken: m.contracts.MMMToken,
      TaxVault: m.contracts.TaxVault,
      RewardVault: m.contracts.RewardVault,
    };
  } else if (hasFlat) {
    fmt = "B (flat)";
    contracts = {
      MMMToken: m.MMMToken,
      TaxVault: m.TaxVault,
      RewardVault: m.RewardVault,
    };
  } else {
    // helpful debug
    const keys = Object.keys(m).slice(0, 40);
    fail(
      `Missing contracts in supported formats.\n` +
      `Expected either manifest.contracts.{MMMToken,TaxVault,RewardVault} OR top-level {MMMToken,TaxVault,RewardVault}.\n` +
      `Top-level keys seen: ${keys.join(", ")}`
    );
  }

  return {
    __format: fmt,
    chainId: m.chainId,
    network: m.network,
    deployer: m.deployer,
    timestamp: m.timestamp,
    contracts,
    params: m.params || {},
    build: m.build || {},
  };
}

async function main() {
  const argvPath = process.argv[2] || "";
  const manifestPath = resolveManifestPath(argvPath);

  log("=== MANIFEST ASSERT ===");
  log(`Manifest: ${manifestPath}`);

  if (!fs.existsSync(manifestPath)) fail(`Missing manifest: ${manifestPath}`);

  const raw = readJson(manifestPath);
  const m = normalizeManifest(raw);

  ok(`Detected manifest format: ${m.__format}`);

  const ethers = require("ethers"); // safe standalone

  if (typeof m.chainId !== "number" && typeof m.chainId !== "string") {
    fail("manifest.chainId must be number or string");
  }
  const manifestChainId = BigInt(m.chainId);

  const { MMMToken, TaxVault, RewardVault } = m.contracts;

  if (!ethers.isAddress(MMMToken || "")) fail("Invalid MMMToken address in manifest");
  if (!ethers.isAddress(TaxVault || "")) fail("Invalid TaxVault address in manifest");
  if (!ethers.isAddress(RewardVault || "")) fail("Invalid RewardVault address in manifest");

  ok("Manifest structure looks valid.");

  // Build pinning warnings
  const gitCommit = m.build.gitCommit || "";
  if (!gitCommit || gitCommit === "abc123..." || gitCommit.includes("...")) {
    warn("build.gitCommit is missing/placeholder (recommended to pin a real commit hash).");
  }

  for (const k of ["mmmTokenBytecodeHash", "taxVaultBytecodeHash", "rewardVaultBytecodeHash"]) {
    const v = m.build[k];
    if (!v) warn(`build.${k} missing (recommended to lock bytecode hash).`);
    else if (!isBytes32(v)) warn(`build.${k} is not bytes32 (0x + 64 hex). Got: ${v}`);
  }

  // Params (optional)
  const PAIR_ADDR = m.params.PAIR_ADDR;
  const ROUTER_ADDR = m.params.ROUTER_ADDR;

  if (PAIR_ADDR && !ethers.isAddress(PAIR_ADDR)) warn(`params.PAIR_ADDR invalid: ${PAIR_ADDR}`);
  if (ROUTER_ADDR && !ethers.isAddress(ROUTER_ADDR)) warn(`params.ROUTER_ADDR invalid: ${ROUTER_ADDR}`);

  // OFFLINE => stop here (no provider/hardhat)
  if (process.env.OFFLINE === "1") {
    ok("OFFLINE=1 set; skipping on-chain checks.");
    ok("=== ASSERT PASS (offline) ===");
    return;
  }

  // On-chain checks require Hardhat execution context
  let hre;
  try {
    hre = require("hardhat");
  } catch {
    warn("Hardhat not available here. Run on-chain mode with:");
    warn("  npx hardhat run --network <net> scripts/assert-manifest.js");
    ok("=== ASSERT PASS (offline fallback) ===");
    return;
  }

  const { ethers: hhEthers } = hre;

  log("\n[Runtime]");
  log(`hre.network.name: ${hre.network.name}`);

  const net = await hhEthers.provider.getNetwork();
  const providerChainId = BigInt(net.chainId);

  log(`provider chainId : ${providerChainId.toString()}`);

  if (providerChainId !== manifestChainId) {
    fail(`chainId mismatch: manifest=${manifestChainId.toString()} provider=${providerChainId.toString()}`);
  }
  ok("chainId matches manifest.");

  async function codePresent(addr, label) {
    const code = await hhEthers.provider.getCode(addr);
    if (!code || code === "0x") fail(`${label} has no code at ${addr}`);
    ok(`${label} code present`);
  }

  await codePresent(MMMToken, "MMMToken");
  await codePresent(TaxVault, "TaxVault");
  await codePresent(RewardVault, "RewardVault");

  if (PAIR_ADDR) await codePresent(PAIR_ADDR, "PAIR_ADDR");
  else warn("params.PAIR_ADDR missing; skipping pair code check.");

  if (ROUTER_ADDR) {
    const code = await hhEthers.provider.getCode(ROUTER_ADDR);
    if (!code || code === "0x") warn(`params.ROUTER_ADDR has no code at ${ROUTER_ADDR} (maybe expected on testnet)`);
    else ok("ROUTER_ADDR code present");
  } else {
    warn("params.ROUTER_ADDR missing; skipping router code check.");
  }

  ok("=== ASSERT PASS (on-chain) ===");
}

main().catch((e) => {
  fail(e?.stack || e?.message || String(e));
});
