#!/usr/bin/env node
/**
 * scripts/stamp-manifest.js
 *
 * Purpose:
 *   Fill manifest.build.gitCommit and build.*BytecodeHash from on-chain runtime bytecode.
 *   Optionally stamp params.PAIR_ADDR / params.ROUTER_ADDR if they exist in env.
 *
 * Usage (recommended):
 *   $env:MANIFEST="deployments\\monadTestnet\\latest.json"
 *   npx hardhat run --network monadTestnet scripts/stamp-manifest.js
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function log(msg = "") { process.stdout.write(String(msg) + "\n"); }
function ok(msg) { log(`[OK] ${msg}`); }
function warn(msg) { log(`[WARN] ${msg}`); }
function fail(msg) { log(`\n[FAIL] ${msg}\n`); process.exit(1); }

function isObject(x) { return x && typeof x === "object" && !Array.isArray(x); }

function resolveManifestPath() {
  const p = process.env.MANIFEST || "deployments/hardhat/latest.json";
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

function readJson(absPath) {
  const raw = fs.readFileSync(absPath, "utf8");
  try { return JSON.parse(raw); }
  catch (e) { fail(`Manifest JSON parse error: ${e.message}`); }
}

function writeJson(absPath, obj) {
  fs.writeFileSync(absPath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function getGitCommit() {
  try {
    const out = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (out && /^[0-9a-f]{40}$/i.test(out)) return out;
    return "";
  } catch {
    return "";
  }
}

function getAddressesFromManifest(raw) {
  // Supports A) raw.contracts.* or B) raw.*
  if (isObject(raw.contracts)) {
    return {
      fmt: "A",
      MMMToken: raw.contracts.MMMToken,
      TaxVault: raw.contracts.TaxVault,
      RewardVault: raw.contracts.RewardVault,
    };
  }
  return {
    fmt: "B",
    MMMToken: raw.MMMToken,
    TaxVault: raw.TaxVault,
    RewardVault: raw.RewardVault,
  };
}

function setBuildField(raw, key, value) {
  if (!isObject(raw.build)) raw.build = {};
  raw.build[key] = value;
}

function setParamsField(raw, key, value) {
  if (!isObject(raw.params)) raw.params = {};
  raw.params[key] = value;
}

async function main() {
  let hre;
  try {
    hre = require("hardhat");
  } catch {
    fail("This script must be run via Hardhat: npx hardhat run --network <net> scripts/stamp-manifest.js");
  }

  const { ethers } = hre;

  const manifestPath = resolveManifestPath();
  log("=== MANIFEST STAMP ===");
  log(`Manifest: ${manifestPath}`);

  if (!fs.existsSync(manifestPath)) fail(`Missing manifest: ${manifestPath}`);

  const raw = readJson(manifestPath);
  const { fmt, MMMToken, TaxVault, RewardVault } = getAddressesFromManifest(raw);

  if (!ethers.isAddress(MMMToken || "")) fail("Invalid MMMToken address in manifest");
  if (!ethers.isAddress(TaxVault || "")) fail("Invalid TaxVault address in manifest");
  if (!ethers.isAddress(RewardVault || "")) fail("Invalid RewardVault address in manifest");

  ok(`Detected format: ${fmt === "A" ? "A (nested contracts)" : "B (flat)"}`);

  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  // If manifest has chainId and it mismatches provider, stop
  if (raw.chainId != null) {
    const mChainId = Number(raw.chainId);
    if (mChainId !== chainId) fail(`chainId mismatch: manifest=${mChainId} provider=${chainId}`);
  } else {
    raw.chainId = chainId;
    ok(`Set manifest.chainId = ${chainId}`);
  }

  if (!raw.network) {
    raw.network = hre.network.name;
    ok(`Set manifest.network = ${raw.network}`);
  }

  // Compute bytecode hashes from runtime bytecode
  async function runtimeHash(addr, label) {
    const code = await ethers.provider.getCode(addr);
    if (!code || code === "0x") fail(`${label} has no code at ${addr}`);
    return ethers.keccak256(code);
  }

  const mmmHash = await runtimeHash(MMMToken, "MMMToken");
  const tvHash  = await runtimeHash(TaxVault, "TaxVault");
  const rvHash  = await runtimeHash(RewardVault, "RewardVault");

  setBuildField(raw, "mmmTokenBytecodeHash", mmmHash);
  setBuildField(raw, "taxVaultBytecodeHash", tvHash);
  setBuildField(raw, "rewardVaultBytecodeHash", rvHash);
  ok("Stamped build.*BytecodeHash from on-chain runtime code.");

  const commit = getGitCommit();
  if (commit) {
    setBuildField(raw, "gitCommit", commit);
    ok(`Stamped build.gitCommit = ${commit}`);
  } else {
    warn("Could not detect git commit (not a git repo or git unavailable). Leaving build.gitCommit as-is.");
  }

  // Optional: stamp params from env if missing in manifest
  const envPair = process.env.PAIR_ADDR || "";
  const envRouter = process.env.ROUTER_ADDR || "";

  if (envPair && ethers.isAddress(envPair) && (!raw.params || !raw.params.PAIR_ADDR)) {
    setParamsField(raw, "PAIR_ADDR", envPair);
    ok(`Stamped params.PAIR_ADDR from env: ${envPair}`);
  }
  if (envRouter && ethers.isAddress(envRouter) && (!raw.params || !raw.params.ROUTER_ADDR)) {
    setParamsField(raw, "ROUTER_ADDR", envRouter);
    ok(`Stamped params.ROUTER_ADDR from env: ${envRouter}`);
  }

  // Ensure timestamp exists
  if (!raw.timestamp) {
    raw.timestamp = new Date().toISOString();
    ok(`Set manifest.timestamp = ${raw.timestamp}`);
  }

  writeJson(manifestPath, raw);
  ok("Wrote manifest successfully.");

  log("\nNext:");
  log("  1) Re-run assert-manifest to confirm warnings are gone.");
  log("  2) Commit the manifest update to git.");
}

main().catch((e) => fail(e?.stack || e?.message || String(e)));
