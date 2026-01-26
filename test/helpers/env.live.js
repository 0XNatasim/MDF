const { ethers } = require("hardhat");

function mustEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing env var: ${name}`);
  return String(v).trim();
}

/**
 * Normalize checksum and fail early if invalid.
 * Accepts lower/upper/mixed-case.
 */
function asAddr(v, name = "address") {
  try {
    return ethers.getAddress(String(v).trim());
  } catch (e) {
    throw new Error(`Bad address for ${name}: ${v}`);
  }
}

function loadLiveEnv() {
  // STRICT: use only your .env keys
  const MMMToken = asAddr(mustEnv("MMMToken"), "MMMToken");
  const RewardVault  = asAddr(mustEnv("RewardVault"), "RewardVault");
  const TaxVault  = asAddr(mustEnv("TaxVault"), "TaxVault");

  return { MMMToken, RewardVault, TaxVault };
}

module.exports = { loadLiveEnv, mustEnv, asAddr };
