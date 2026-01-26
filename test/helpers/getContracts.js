// test/helpers/getContracts.js
const { ethers } = require("hardhat");
const { getEnv } = require("./env");

async function mustHaveCode(address, label) {
  const code = await ethers.provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error(`${label} has no code at ${address}. Wrong address or wrong network.`);
  }
}

async function getContracts() {
  const env = getEnv();

  await mustHaveCode(env.MMMToken, "MMMToken");
  await mustHaveCode(env.RewardVault, "RewardVault");
  await mustHaveCode(env.TaxVault, "TaxVault");

  // Use fully-qualified names if you ever had name collisions.
  // If you removed contracts/test/1RewardVault.sol, normal name is fine.
  const mmm = await ethers.getContractAt("MMMToken", env.MMMToken);
  const rv  = await ethers.getContractAt("RewardVault", env.RewardVault);
  const tv  = await ethers.getContractAt("TaxVault", env.TaxVault);

  return { env, mmm, rv, tv };
}

module.exports = { getContracts };
