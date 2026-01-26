// test/helpers/env.js
const { ethers } = require("hardhat");

function must(name, v) {
  if (!v || String(v).trim() === "") throw new Error(`Missing env var: ${name}`);
  return v;
}

function addr(name, v) {
  return ethers.getAddress(must(name, v));
}

// Accept both new and legacy env var names
function getEnv() {
  const MMMToken =
    process.env.MMMToken ||
    process.env.MMMToken ||
    process.env.MMM_TOKEN ||
    process.env.MMM;

  const RewardVault =
    process.env.RewardVault ||
    process.env.REWARD_VAULT_ADDR ||
    process.env.RewardVault;

  const TaxVault =
    process.env.TaxVault ||
    process.env.TAX_VAULT_ADDR ||
    process.env.TaxVault;

  const HOLD_TIME_SECONDS = Number(process.env.HOLD_TIME_SECONDS || "0");
  const CLAIM_COOLDOWN_SECONDS = Number(process.env.CLAIM_COOLDOWN_SECONDS || "0");

  return {
    MMMToken: addr("MMMToken|MMMToken", MMMToken),
    RewardVault: addr("RewardVault|RewardVault", RewardVault),
    TaxVault: addr("TaxVault|TaxVault", TaxVault),
    HOLD_TIME_SECONDS,
    CLAIM_COOLDOWN_SECONDS,

    // Optional wallets (for live tests)
    FRESH_WALLET: process.env.FRESH_WALLET ? addr("FRESH_WALLET", process.env.FRESH_WALLET) : null,
    FRESH2_WALLET: process.env.FRESH2_WALLET ? addr("FRESH2_WALLET", process.env.FRESH2_WALLET) : null,
    FRESH3_WALLET: process.env.FRESH3_WALLET ? addr("FRESH3_WALLET", process.env.FRESH3_WALLET) : null,
  };
}

module.exports = { getEnv };
