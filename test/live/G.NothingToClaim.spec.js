const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

function mustEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

/**
 * Live RPC tolerant revert decode:
 * - uses a real tx (not staticCall)
 * - attempts to parse custom error data
 * - falls back to UnknownRevert if RPC strips revert data
 */
async function decodeRevertFromTx(promiseTx, iface) {
  try {
    const tx = await promiseTx;
    await tx.wait();
    return { ok: true, name: null };
  } catch (e) {
    const data = e?.data || e?.error?.data;
    if (!data) return { ok: false, name: "UnknownRevert" };

    if (typeof data === "string" && data.startsWith("0x")) {
      try {
        const decoded = iface.parseError(data);
        return { ok: false, name: decoded?.name, args: decoded?.args };
      } catch (_) {
        return { ok: false, name: "UnknownRevert" };
      }
    }

    return { ok: false, name: "UnknownRevert" };
  }
}

describe("G) NothingToClaim gate (live)", function () {
  this.timeout(120_000);

  it("G) claim with zero pending reverts with correct gating error", async function () {
    const RewardVaultAddr = mustEnv("RewardVault");
    const pk = mustEnv("FRESH3_PRIVATE_KEY");
    const fresh = new ethers.Wallet(pk, ethers.provider);

    const rv = await ethers.getContractAt("RewardVault", RewardVaultAddr);

    // Ensure the wallet can actually send a tx; otherwise you get misleading failures.
    const gas = await ethers.provider.getBalance(fresh.address);
    expect(gas).to.be.greaterThan(
      0n,
      "FRESH3 wallet has 0 gas. Fund it with MON on Monad testnet."
    );

    // We want a revert; gate order may vary based on live state.
    const acceptable = [
      "NothingToClaim",
      "ClaimCooldownActive",
      "HoldTimeNotMet",
      "MinBalanceNotMet",     // (preferred naming)
      "BalanceBelowMin",      // keep if older name exists in some builds
      "ExcludedFromRewards",
      "UnknownRevert",        // RPC may strip revert data
    ];

    const r = await decodeRevertFromTx(rv.connect(fresh).claim(), rv.interface);

    expect(r.ok).to.equal(false);
    expect(acceptable).to.include(r.name, `Unexpected revert: ${r.name || "null"}`);
  });
});
