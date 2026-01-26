// test/helpers/rewardvault.env.js
const { ethers } = require("hardhat");

/**
 * Normalize env addresses safely for ethers v6.
 * - If you paste a checksummed address but with wrong checksum, ethers.getAddress() throws.
 * - Lowercasing first makes it normalize consistently.
 */
function asAddr(x, label = "address") {
  if (!x) throw new Error(`Missing env var for ${label}`);
  return ethers.getAddress(String(x).trim().toLowerCase());
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") throw new Error(`Missing required env var: ${name}`);
  return String(v).trim();
}

function optEnv(name, def = "") {
  const v = process.env[name];
  if (!v || String(v).trim() === "") return def;
  return String(v).trim();
}

function walletFromEnv(pkName, addrName = null) {
  const pk = mustEnv(pkName);
  const w = new ethers.Wallet(pk, ethers.provider);
  if (addrName) {
    const expected = asAddr(mustEnv(addrName), addrName);
    if (w.address.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(
        `${pkName} does not match ${addrName}: pk->${w.address} env->${expected}`
      );
    }
  }
  return w;
}

async function getContracts() {
  const MMMToken = asAddr(mustEnv("MMMToken"), "MMMToken");
  const RewardVault = asAddr(mustEnv("RewardVault"), "RewardVault");

  const mmm = await ethers.getContractAt("MMMToken", MMMToken);
  const rv = await ethers.getContractAt("RewardVault", RewardVault);

  // Prefer on-chain TaxVault, but allow env TaxVault for sanity check (optional).
  const tvOnchain = await mmm.taxVault();
  const tvEnv = optEnv("TaxVault", "");
  if (tvEnv) {
    const tvEnvNorm = asAddr(tvEnv, "TaxVault");
    if (tvEnvNorm.toLowerCase() !== tvOnchain.toLowerCase()) {
      throw new Error(
        `Your .env TaxVault does not match the on-chain TaxVault\n` +
          `env:     ${tvEnvNorm}\n` +
          `onchain: ${tvOnchain}`
      );
    }
  }

  return { mmm, rv, MMMToken, RewardVault, TaxVault: tvOnchain };
}

async function decodeCustomError(rv, e) {
  const data = e?.data || e?.error?.data;
  if (!data) return { name: null, args: null, raw: null };
  try {
    const parsed = rv.interface.parseError(data);
    return { name: parsed?.name ?? null, args: parsed?.args ?? null, raw: data };
  } catch {
    return { name: null, args: null, raw: data };
  }
}

/**
 * Generate tax by transferring to pair (sell leg) and distribute *everything* from TaxVault.
 * This uses the "deployer" signer (Hardhat-managed) so you don't depend on external wallet keys.
 */
async function sellToPairAndDistributeAll({ mmm, rv, TaxVault, deployer, amountMMM }) {
  const pair = await mmm.pair();

  const tv0 = await mmm.balanceOf(TaxVault);
  await (await mmm.connect(deployer).transfer(pair, amountMMM)).wait();
  const tv1 = await mmm.balanceOf(TaxVault);

  const taxBal = await mmm.balanceOf(TaxVault);
  if (taxBal > 0n) {
    await (await rv.notifyRewardAmountFromTaxVault(taxBal)).wait();
  }

  return { pair, taxDelta: tv1 - tv0, distributed: taxBal };
}

/**
 * “Buy” leg (pair -> recipient) requires pair signer (TESTER_PRIVATE_KEY).
 */
async function buyFromPair({ mmm, TaxVault, pairWallet, to, amountMMM }) {
  const tv0 = await mmm.balanceOf(TaxVault);
  await (await mmm.connect(pairWallet).transfer(to, amountMMM)).wait();
  const tv1 = await mmm.balanceOf(TaxVault);
  return { taxDelta: tv1 - tv0 };
}

/**
 * “Normal transfer” should not tax (deployer -> to, where to != pair).
 */
async function normalTransferNoTax({ mmm, TaxVault, fromSigner, to, amountMMM }) {
  const tv0 = await mmm.balanceOf(TaxVault);
  await (await mmm.connect(fromSigner).transfer(to, amountMMM)).wait();
  const tv1 = await mmm.balanceOf(TaxVault);
  return { taxDelta: tv1 - tv0 };
}

async function getNow() {
  const bn = await ethers.provider.getBlockNumber();
  const blk = await ethers.provider.getBlock(bn);
  return Number(blk.timestamp);
}

async function getHoldRemainingMaybe(rv, addr) {
  // Your deployed RV has lastNonZeroAt/minHoldTime; but guard in case ABI mismatch.
  if (typeof rv.lastNonZeroAt !== "function" || typeof rv.minHoldTime !== "function") {
    return { supported: false, remaining: null, lastNonZeroAt: null, minHoldTime: null, now: await getNow() };
  }
  const now = await getNow();
  const lnz = await rv.lastNonZeroAt(addr);
  const minHold = await rv.minHoldTime();
  const eligibleAt = Number(lnz) + Number(minHold);
  const remaining = Math.max(0, eligibleAt - now);
  return { supported: true, remaining, lastNonZeroAt: lnz, minHoldTime: minHold, now };
}

async function getCooldownRemaining(rv, addr) {
  const now = await getNow();
  const last = await rv.lastClaimAt(addr);
  const cd = await rv.claimCooldown();
  const eligibleAt = Number(last) + Number(cd);
  const remaining = Math.max(0, eligibleAt - now);
  return { remaining, now, last, cd, eligibleAt };
}

module.exports = {
  asAddr,
  mustEnv,
  optEnv,
  walletFromEnv,
  getContracts,
  decodeCustomError,
  sellToPairAndDistributeAll,
  buyFromPair,
  normalTransferNoTax,
  getHoldRemainingMaybe,
  getCooldownRemaining,
};
