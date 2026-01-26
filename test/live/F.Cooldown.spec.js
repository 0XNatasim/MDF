const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

function mustEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

function pickRevertData(e) {
  return (
    e?.data ||
    e?.error?.data ||
    e?.info?.error?.data ||
    e?.error?.error?.data ||
    null
  );
}

async function decodeRevertName(rv, fnPromise) {
  try {
    await fnPromise;
    return { ok: true, name: null };
  } catch (e) {
    const data = pickRevertData(e);
    if (!data || data === "0x") return { ok: false, name: "UnknownRevert" };
    try {
      const decoded = rv.interface.parseError(data);
      return { ok: false, name: decoded?.name, args: decoded?.args };
    } catch {
      return { ok: false, name: "UnknownRevert" };
    }
  }
}

describe("F) Cooldown enforced (live)", function () {
  it("F) claim reverts during cooldown (or UnknownRevert if RPC strips data)", async function () {
    const RewardVault = mustEnv("RewardVault");
    const pk = mustEnv("FRESH3_PRIVATE_KEY");

    const fresh = new ethers.Wallet(pk, ethers.provider);
    const rv = await ethers.getContractAt("RewardVault", RewardVault);

    // If we're not currently in cooldown, we cannot deterministically test cooldown on a shared chain
    // without sending a first claim tx (flaky). So we skip.
    const last = await rv.lastClaimAt(fresh.address);
    const cooldown = await rv.claimCooldown();
    const latest = await ethers.provider.getBlock("latest");

    const lastTs = BigInt(last);
    const cd = BigInt(cooldown);
    const nowTs = BigInt(latest.timestamp);

    const inCooldown = (lastTs !== 0n) && (nowTs < (lastTs + cd));
    if (!inCooldown) {
      this.skip();
      return;
    }

    // While in cooldown, claim must revert (cooldown is gate #4 in your contract)
    const r = await decodeRevertName(rv, rv.connect(fresh).claim.staticCall());
    expect(r.ok).to.equal(false);
    expect(["ClaimCooldownActive", "UnknownRevert"]).to.include(r.name);
  });
});
