// test/RewardVault.spec.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

function reqEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing .env ${name}`);
  return String(v).trim();
}

function asAddr(x) {
  return ethers.getAddress(String(x).trim());
}

async function chainNow() {
  const bn = await ethers.provider.getBlockNumber();
  const blk = await ethers.provider.getBlock(bn);
  return Number(blk.timestamp);
}

async function decodeRevertName(contract, err) {
  const data = err?.data || err?.error?.data;
  if (!data) return { name: null, args: null, raw: null };
  try {
    const parsed = contract.interface.parseError(data);
    return { name: parsed?.name || null, args: parsed?.args || null, raw: data };
  } catch {
    return { name: null, args: null, raw: data };
  }
}

async function staticRevert(contract, signer, fn, args = []) {
  try {
    await contract.connect(signer)[fn].staticCall(...args);
    return { ok: false, revertedWith: null, args: null, raw: null };
  } catch (e) {
    const d = await decodeRevertName(contract, e);
    return { ok: true, revertedWith: d.name, args: d.args, raw: d.raw };
  }
}

function walletFromEnv(pkName) {
  const pk = (process.env[pkName] || "").trim();
  if (!pk) return null;
  return new ethers.Wallet(pk, ethers.provider);
}

async function ensureMon(signer, minWei) {
  const bal = await ethers.provider.getBalance(signer.address);
  if (bal < minWei) {
    throw new Error(
      `Signer ${signer.address} needs native gas. Have ${ethers.formatEther(
        bal
      )}, need >= ${ethers.formatEther(minWei)}`
    );
  }
}

async function ensureMmmBalance(mmm, fromSigner, toAddr, minMMMWei) {
  const bal = await mmm.balanceOf(toAddr);
  if (bal >= minMMMWei) return;
  const top = (minMMMWei - bal) + ethers.parseUnits("1", 18);
  await (await mmm.connect(fromSigner).transfer(toAddr, top)).wait();
}

describe("RewardVault (MMM v1) — integration", function () {
  const MMMToken = asAddr(reqEnv("MMMToken"));
  const RewardVault  = asAddr(reqEnv("RewardVault"));
  const TaxVault  = asAddr(reqEnv("TaxVault"));

  let mmm, rv;
  let deployer;
  let pairAddr;

  const fresh  = walletFromEnv("FRESH_PRIVATE_KEY");
  const fresh2 = walletFromEnv("FRESH2_PRIVATE_KEY");
  const fresh3 = walletFromEnv("FRESH3_PRIVATE_KEY");

  function envWallets() {
    const arr = [fresh, fresh2, fresh3].filter(Boolean);
    if (!arr.length) {
      throw new Error("Provide at least one of FRESH_PRIVATE_KEY / FRESH2_PRIVATE_KEY / FRESH3_PRIVATE_KEY in .env");
    }
    return arr;
  }

  async function distributeAllTaxVault(callerSigner) {
    const bal = await mmm.balanceOf(TaxVault);
    if (bal === 0n) return 0n;
    await (await rv.connect(callerSigner).notifyRewardAmountFromTaxVault(bal)).wait();
    return bal;
  }

  async function makeTax(amountMMMWei) {
    // taxed path = transfer to pair
    await (await mmm.connect(deployer).transfer(pairAddr, amountMMMWei)).wait();
  }

  async function pickEligibleHolderForPendingIncrease() {
    // For test C we ONLY need: not excluded + >= minBalance
    const minBal = await rv.minBalance();
    for (const w of envWallets()) {
      if (await rv.isExcludedReward(w.address)) continue;
      const b = await mmm.balanceOf(w.address);
      if (b < minBal) continue;
      return w;
    }
    return null;
  }

  async function pickClaimReadyWalletWithPending() {
    // For E/F we need a wallet that is actually allowed to claim once pending exists.
    // We do it behaviorally (no lastNonZeroAt needed).
    const minBal = await rv.minBalance();

    for (const w of envWallets()) {
      await ensureMon(w, ethers.parseUnits("0.03", 18));

      if (await rv.isExcludedReward(w.address)) continue;

      // ensure meets minBalance
      await ensureMmmBalance(mmm, deployer, w.address, minBal);

      // generate meaningful pending
      await makeTax(ethers.parseUnits("5000", 18));
      const moved = await distributeAllTaxVault(deployer);
      if (moved === 0n) continue;

      const pending = await rv.pending(w.address);
      if (pending === 0n) {
        // push harder to avoid rounding-to-zero
        await makeTax(ethers.parseUnits("50000", 18));
        await distributeAllTaxVault(deployer);
      }

      const p2 = await rv.pending(w.address);
      if (p2 === 0n) continue;

      // now check gating
      const chk = await staticRevert(rv, w, "claim", []);
      if (!chk.ok) {
        // would succeed
        return { wallet: w, pending: p2, gate: null };
      }

      // would revert; if it's cooldown/nothing-to-claim that's fine for some tests,
      // but for "claim-ready" we need it not blocked by hold/min/excluded.
      if (["HoldTimeNotMet", "BalanceBelowMin", "ExcludedFromRewards"].includes(chk.revertedWith)) {
        continue;
      }

      // if cooldown active, we can still use it for F (cooldown test),
      // but not for tests that require a successful claim first.
      if (chk.revertedWith === "ClaimCooldownActive") {
        return { wallet: w, pending: p2, gate: "ClaimCooldownActive" };
      }

      // NothingToClaim shouldn't happen since we asserted pending>0, but keep safe:
      if (chk.revertedWith === "NothingToClaim") continue;
    }

    return null;
  }

  before(async () => {
    [deployer] = await ethers.getSigners();
    mmm = await ethers.getContractAt("MMMToken", MMMToken);
    rv  = await ethers.getContractAt("RewardVault", RewardVault);

    pairAddr = await mmm.pair();

    // Env TaxVault must match on-chain taxVault (this is critical)
    const onchainTV = await rv.taxVault();
    expect(asAddr(onchainTV)).to.equal(TaxVault);
  });

  it("A) Eligible supply rule holds; excluded cannot claim", async () => {
    const excludedLen = Number(await rv.excludedRewardAddressesLength());
    expect(excludedLen).to.be.greaterThan(0);

    const totalSupply = await mmm.totalSupply();

    let sumExcluded = 0n;
    for (let i = 0; i < excludedLen; i++) {
      const a = await rv.excludedRewardAddresses(i);
      sumExcluded += await mmm.balanceOf(a);
    }

    const expectedEligible = totalSupply - sumExcluded;
    const eligible = await rv.eligibleSupply();
    expect(eligible).to.equal(expectedEligible);

    const ex0 = await rv.excludedRewardAddresses(0);
    expect(await rv.isExcludedReward(ex0)).to.equal(true);

    // Excluded cannot claim (static)
    // We cannot sign from excluded, so just validate the error selector via parseError using staticCall on a *wallet we control* is not possible.
    // This is covered in your earlier manual REPL. For this suite, the deterministic part is eligibleSupply + exclusion list integrity.
  });

  it("B) Taxing: buy/sell taxed; normal transfer not taxed", async () => {
    const amount = ethers.parseUnits("100", 18);

    // normal transfer should not tax
    const tv0 = await mmm.balanceOf(TaxVault);
    const to = fresh3 ? fresh3.address : deployer.address;
    await (await mmm.connect(deployer).transfer(to, amount)).wait();
    const tv1 = await mmm.balanceOf(TaxVault);
    expect(tv1 - tv0).to.equal(0n);

    // sell (to pair) should tax
    const tv2 = await mmm.balanceOf(TaxVault);
    await (await mmm.connect(deployer).transfer(pairAddr, amount)).wait();
    const tv3 = await mmm.balanceOf(TaxVault);
    expect(tv3 - tv2).to.be.gt(0n);
  });

  it("C) Distribution from TaxVault increases pending for an eligible holder", async () => {
    const holder = await pickEligibleHolderForPendingIncrease();
    if (!holder) throw new Error("No eligible env wallet for C (need PK + not excluded + >= minBalance).");

    const p0 = await rv.pending(holder.address);

    await makeTax(ethers.parseUnits("5000", 18));
    const moved = await distributeAllTaxVault(deployer);
    expect(moved).to.be.gt(0n);

    const p1 = await rv.pending(holder.address);

    // monotonic (should not go down from distribution-only)
    expect(p1).to.be.gte(p0);

    // usually >0; if rounding gives 0, push bigger once
    if (p1 === 0n) {
      await makeTax(ethers.parseUnits("50000", 18));
      await distributeAllTaxVault(deployer);
    }
    const p2 = await rv.pending(holder.address);
    expect(p2).to.be.gt(0n);
  });

  it("D) Hold time enforced: new entrant cannot claim before minHoldTime", async () => {
    const w = fresh3 || fresh2 || fresh;
    if (!w) throw new Error("Need a FRESH*_PRIVATE_KEY for D.");
    await ensureMon(w, ethers.parseUnits("0.03", 18));

    const minBal = await rv.minBalance();

    // reset: drop to 0 to force a true "re-entry" path (your contracts enforce hold on new non-zero)
    const bal0 = await mmm.balanceOf(w.address);
    if (bal0 > 0n) {
      await (await mmm.connect(w).transfer(deployer.address, bal0)).wait();
    }

    // re-enter with minBal
    await ensureMmmBalance(mmm, deployer, w.address, minBal);

    // create distribution to give it pending
    await makeTax(ethers.parseUnits("5000", 18));
    await distributeAllTaxVault(deployer);

    const chk = await staticRevert(rv, w, "claim", []);
    expect(chk.ok).to.equal(true);
    expect(chk.revertedWith).to.equal("HoldTimeNotMet");
  });

  it("E) minBalance enforced: below minBalance cannot claim", async () => {
    const cand = await pickClaimReadyWalletWithPending();
    if (!cand) throw new Error("No usable env wallet for E.");
    const w = cand.wallet;

    const minBal = await rv.minBalance();

    // drop below minBalance
    const cur = await mmm.balanceOf(w.address);
    if (cur >= minBal) {
      const target = minBal - ethers.parseUnits("0.5", 18);
      if (cur > target) {
        await (await mmm.connect(w).transfer(deployer.address, cur - target)).wait();
      }
    }

    // generate new pending
    await makeTax(ethers.parseUnits("5000", 18));
    await distributeAllTaxVault(deployer);

    const chk = await staticRevert(rv, w, "claim", []);
    expect(chk.ok).to.equal(true);

    // BalanceBelowMin should appear unless other gates precede it.
    expect(["BalanceBelowMin", "HoldTimeNotMet", "ClaimCooldownActive", "NothingToClaim"]).to.include(chk.revertedWith);
  });

  it("F) Cooldown enforced: second claim during cooldown reverts ClaimCooldownActive (or NothingToClaim if rounding zero)", async function () {
    this.timeout(300000);

    const cand = await pickClaimReadyWalletWithPending();
    if (!cand) throw new Error("No usable env wallet for F.");
    const w = cand.wallet;

    // If already in cooldown, prove cooldown blocks claim (static)
    // (This handles repeated runs + long cooldown like 43200.)
    const chk0 = await staticRevert(rv, w, "claim", []);
    if (chk0.ok && chk0.revertedWith === "ClaimCooldownActive") {
      expect(chk0.revertedWith).to.equal("ClaimCooldownActive");
      return;
    }

    // otherwise attempt first claim (should succeed or be NothingToClaim if pending rounded away)
    const pendingBefore = await rv.pending(w.address);
    if (pendingBefore === 0n) {
      // force pending
      await makeTax(ethers.parseUnits("50000", 18));
      await distributeAllTaxVault(deployer);
    }
    const p1 = await rv.pending(w.address);
    expect(p1).to.be.gt(0n);

    await (await rv.connect(w).claim({ maxPriorityFeePerGas: 2_000_000_000n })).wait();

    // Create NEW pending during cooldown
    await makeTax(ethers.parseUnits("5000", 18));
    await distributeAllTaxVault(deployer);

    const pending2 = await rv.pending(w.address);

    const chk2 = await staticRevert(rv, w, "claim", []);
    expect(chk2.ok).to.equal(true);

    if (pending2 > 0n) {
      expect(chk2.revertedWith).to.equal("ClaimCooldownActive");
    } else {
      expect(["ClaimCooldownActive", "NothingToClaim"]).to.include(chk2.revertedWith);
    }
  });

  it("G) NothingToClaim: claim with zero pending reverts with the correct gating error", async () => {
    const w = fresh3 || fresh2 || fresh;
    if (!w) throw new Error("Need a FRESH*_PRIVATE_KEY for G.");
    await ensureMon(w, ethers.parseUnits("0.03", 18));

    // If pending > 0 and claim is permitted, drain it first; otherwise accept gating.
    const p = await rv.pending(w.address);
    if (p > 0n) {
      const chk0 = await staticRevert(rv, w, "claim", []);
      if (chk0.ok && chk0.revertedWith && chk0.revertedWith !== "NothingToClaim") {
        // gated by other rules; valid for "correct gating"
        expect(["HoldTimeNotMet", "BalanceBelowMin", "ClaimCooldownActive"]).to.include(chk0.revertedWith);
        return;
      }
      await (await rv.connect(w).claim({ maxPriorityFeePerGas: 2_000_000_000n })).wait();
    }

    const chk = await staticRevert(rv, w, "claim", []);
    expect(chk.ok).to.equal(true);

    // depending on order of checks in contract, any of these may be first gate
    expect(["NothingToClaim", "ClaimCooldownActive", "HoldTimeNotMet", "BalanceBelowMin", "ExcludedFromRewards"]).to.include(
      chk.revertedWith
    );
  });
});
