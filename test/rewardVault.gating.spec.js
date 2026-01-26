// test/rewardVault.gating.spec.js
// Run (monadTestnet):
//   npx hardhat test test/rewardVault.gating.spec.js --network monadTestnet
//
// Required .env variables (example):
//   MMMToken=0x...
//   RewardVault=0x...
//   TaxVault=0x...
//   PAIR_ADDR=0x...            (your MMMToken.pair() address; in your case 0x22BC...)
//   FRESH_PRIVATE_KEY=...      (optional; only used if you want to test with a real external wallet)
//   FRESH3_PRIVATE_KEY=...     (optional)
//
// Notes:
// - This is an *integration test* against already-deployed contracts on monadTestnet.
// - It avoids sleeping/waiting for hold-time/cooldown by asserting the *reverts* immediately
//   (HoldTimeNotMet, ClaimCooldownActive) and by using NothingToClaim right after a claim.

const { expect } = require("chai");
const { ethers } = require("hardhat");

const PRIORITY_FEE = 2_000_000_000n; // 2 gwei

function mustEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

async function latestTs() {
  const bn = await ethers.provider.getBlockNumber();
  return (await ethers.provider.getBlock(bn)).timestamp;
}

async function decodeRevert(rv, err) {
  const data = err?.data || err?.error?.data;
  if (!data) return { name: null, args: null, raw: null };
  try {
    const decoded = rv.interface.parseError(data);
    return { name: decoded?.name ?? null, args: decoded?.args ?? null, raw: data };
  } catch {
    return { name: null, args: null, raw: data };
  }
}

async function expectRevertCustom(rv, promise, expectedName) {
  try {
    await promise;
    throw new Error(`Expected revert ${expectedName}, but call succeeded`);
  } catch (e) {
    const d = await decodeRevert(rv, e);
    expect(d.name).to.equal(expectedName);
    return d;
  }
}

async function ensureMON(fromSigner, to, minWei) {
  const bal = await ethers.provider.getBalance(to);
  if (bal >= minWei) return;
  const tx = await fromSigner.sendTransaction({ to, value: minWei - bal });
  await tx.wait();
}

async function ensureMMM(mmm, fromSigner, to, minWei) {
  const bal = await mmm.balanceOf(to);
  if (bal >= minWei) return;
  const tx = await mmm.connect(fromSigner).transfer(to, minWei - bal);
  await tx.wait();
}

// Tax generator helper: create taxes into TaxVault by doing a taxed transfer to or from pair.
async function taxedSellToPair(mmm, sellerSigner, pairAddr, amountWei) {
  // seller -> pair (taxed)
  const tx = await mmm.connect(sellerSigner).transfer(pairAddr, amountWei);
  await tx.wait();
}

async function distributeAllTaxVaultToRewards(mmm, rv, tvAddr) {
  const taxBal = await mmm.balanceOf(tvAddr);
  if (taxBal === 0n) return { moved: 0n };
  const tx = await rv.notifyRewardAmountFromTaxVault(taxBal);
  await tx.wait();
  return { moved: taxBal };
}

describe("RewardVault claim gating (monadTestnet integration)", function () {
  this.timeout(180_000);

  let MMMToken, RewardVault, TaxVault, PAIR_ADDR;
  let mmm, rv;

  let deployer, pairSigner, other1;

  before(async () => {
    MMMToken = mustEnv("MMMToken");
    RewardVault = mustEnv("RewardVault");
    TaxVault = mustEnv("TaxVault");
    PAIR_ADDR = mustEnv("PAIR_ADDR");

    [deployer, pairSigner, other1] = await ethers.getSigners();

    mmm = await ethers.getContractAt("MMMToken", MMMToken);
    rv = await ethers.getContractAt("RewardVault", RewardVault);

    // Sanity: pair in contract should match PAIR_ADDR
    const onchainPair = await mmm.pair();
    expect(onchainPair.toLowerCase()).to.equal(PAIR_ADDR.toLowerCase());
  });

  it("A) eligibleSupply rule matches totalSupply - sum(excludedRewardAddresses) AND excluded cannot claim", async () => {
    const totalSupply = await mmm.totalSupply();

    const len = await rv.excludedRewardAddressesLength();
    let sumExcluded = 0n;
    for (let i = 0n; i < len; i++) {
      const addr = await rv.excludedRewardAddresses(i);
      sumExcluded += await mmm.balanceOf(addr);
    }

    const eligibleSupply = await rv.eligibleSupply();
    const expected = totalSupply - sumExcluded;

    expect(eligibleSupply).to.equal(expected);

    // Pick an excluded address: the pair is typically excluded in your setup
    const excludedAddr = PAIR_ADDR;
    const isExcluded = await rv.isExcludedReward(excludedAddr);
    expect(isExcluded).to.equal(true);

    // excluded claim should revert ExcludedFromRewards
    await expectRevertCustom(rv, rv.connect(pairSigner).claim.staticCall(), "ExcludedFromRewards");
  });

  it("B) HoldTimeNotMet: zero-out + re-enter resets lastNonZeroAt and blocks claim", async () => {
    // Create a fresh wallet for this test (ephemeral)
    const tmp = ethers.Wallet.createRandom().connect(ethers.provider);

    // Fund gas + give it minBalance MMM
    const minBal = await rv.minBalance();
    await ensureMON(deployer, tmp.address, ethers.parseEther("1"));
    await ensureMMM(mmm, deployer, tmp.address, minBal);

    // Force “re-entry”: set MMM balance to 0 then back to >0 to update lastNonZeroAt
    // 1) tmp -> deployer (drain)
    await (await mmm.connect(tmp).transfer(deployer.address, await mmm.balanceOf(tmp.address))).wait();

    // 2) deployer -> tmp (re-enter at exactly minBalance)
    await (await mmm.connect(deployer).transfer(tmp.address, minBal)).wait();

    const lnz = await mmm.lastNonZeroAt(tmp.address);
    const hold = await rv.minHoldTime();

    // Create distribution so pending exists (note: pending can be 0 if balance very small vs rewardDebt;
    // we still only need the HoldTimeNotMet revert gate)
    await taxedSellToPair(mmm, deployer, PAIR_ADDR, ethers.parseUnits("100", 18));
    await distributeAllTaxVaultToRewards(mmm, rv, TaxVault);

    // Claim must revert HoldTimeNotMet (even if pending==0, it should hit hold gate first if coded that way;
    // your contract does).
    await expectRevertCustom(rv, rv.connect(tmp).claim.staticCall(), "HoldTimeNotMet");

    // Extra: confirm lnz is "recent" and remaining ~= hold
    const now = await latestTs();
    expect(Number(now) - Number(lnz)).to.be.lessThan(120); // allow drift
    expect(Number(lnz) + Number(hold)).to.be.greaterThan(Number(now));
  });

  it("C) BalanceBelowMin: when balance < minBalance claim reverts", async () => {
    const tmp = ethers.Wallet.createRandom().connect(ethers.provider);

    const minBal = await rv.minBalance();

    await ensureMON(deployer, tmp.address, ethers.parseEther("1"));
    // Give it 0.5 * minBalance
    const half = minBal / 2n;
    await ensureMMM(mmm, deployer, tmp.address, half);

    // Make some distribution so it would otherwise have rewards
    await taxedSellToPair(mmm, deployer, PAIR_ADDR, ethers.parseUnits("100", 18));
    await distributeAllTaxVaultToRewards(mmm, rv, TaxVault);

    await expectRevertCustom(rv, rv.connect(tmp).claim.staticCall(), "BalanceBelowMin");
  });

  it("D) ClaimCooldownActive: second claim inside cooldown reverts when new pending arrives", async () => {
    const tmp = ethers.Wallet.createRandom().connect(ethers.provider);

    const minBal = await rv.minBalance();

    await ensureMON(deployer, tmp.address, ethers.parseEther("2"));
    await ensureMMM(mmm, deployer, tmp.address, minBal);

    // IMPORTANT: avoid hold gate by using an address with old lastNonZeroAt.
    // For a brand-new wallet, lastNonZeroAt will be "now" and hold gate will block.
    // So we “age” it by setting lastNonZeroAt in the past is not possible on-chain,
    // therefore we use your already-aged FRESH wallet if provided, else we skip this test.
    //
    // If you want this test ALWAYS, set env FRESH_PRIVATE_KEY for a wallet that already waited hold time.
    const pk = process.env.FRESH_PRIVATE_KEY;
    if (!pk || pk.length !== 64) {
      this.skip();
      return;
    }

    const fresh = new ethers.Wallet(pk, ethers.provider);
    await ensureMON(deployer, fresh.address, ethers.parseEther("2"));
    await ensureMMM(mmm, deployer, fresh.address, minBal);

    // Round 1: create pending then claim (sets lastClaimAt)
    await taxedSellToPair(mmm, deployer, PAIR_ADDR, ethers.parseUnits("100000", 18)); // large to ensure pending > 0
    await distributeAllTaxVaultToRewards(mmm, rv, TaxVault);

    const p1 = await rv.pending(fresh.address);
    expect(p1).to.be.gt(0n);

    await (await rv.connect(fresh).claim({ maxPriorityFeePerGas: PRIORITY_FEE })).wait();

    const last1 = await rv.lastClaimAt(fresh.address);
    const cd = await rv.claimCooldown();
    expect(cd).to.be.gt(0n);
    expect(last1).to.be.gt(0n);

    // Round 2: create NEW pending immediately (still inside cooldown)
    await taxedSellToPair(mmm, deployer, PAIR_ADDR, ethers.parseUnits("100000", 18));
    await distributeAllTaxVaultToRewards(mmm, rv, TaxVault);

    const p2 = await rv.pending(fresh.address);
    expect(p2).to.be.gt(0n);

    // Second claim should revert ClaimCooldownActive
    await expectRevertCustom(rv, rv.connect(fresh).claim.staticCall(), "ClaimCooldownActive");
  });

  it("E) NothingToClaim: after successful claim, claim.staticCall reverts NothingToClaim", async () => {
    // Use FRESH3 if provided (since you’ve been using it already)
    const pk = process.env.FRESH3_PRIVATE_KEY || process.env.FRESH_PRIVATE_KEY;
    if (!pk || pk.length !== 64) {
      this.skip();
      return;
    }

    const w = new ethers.Wallet(pk, ethers.provider);
    await ensureMON(deployer, w.address, ethers.parseEther("2"));

    // If there is pending, claim once; if not, create some pending then claim.
    const pending0 = await rv.pending(w.address);
    if (pending0 === 0n) {
      await taxedSellToPair(mmm, deployer, PAIR_ADDR, ethers.parseUnits("100000", 18));
      await distributeAllTaxVaultToRewards(mmm, rv, TaxVault);
    }

    const pending1 = await rv.pending(w.address);
    if (pending1 > 0n) {
      await (await rv.connect(w).claim({ maxPriorityFeePerGas: PRIORITY_FEE })).wait();
    }

    const pendingAfter = await rv.pending(w.address);
    expect(pendingAfter).to.equal(0n);

    await expectRevertCustom(rv, rv.connect(w).claim.staticCall(), "NothingToClaim");
  });

  it("F) Tax scope sanity: normal transfer (non-pair) should not tax; pair-involved should tax", async () => {
    const tv0 = await mmm.balanceOf(TaxVault);

    // normal transfer deployer -> other1 (not pair)
    if (other1.address.toLowerCase() === PAIR_ADDR.toLowerCase()) {
      this.skip();
      return;
    }
    await (await mmm.connect(deployer).transfer(other1.address, ethers.parseUnits("10", 18))).wait();

    const tv1 = await mmm.balanceOf(TaxVault);
    expect(tv1 - tv0).to.equal(0n);

    // taxed sell: deployer -> pair
    const tv2 = await mmm.balanceOf(TaxVault);
    await taxedSellToPair(mmm, deployer, PAIR_ADDR, ethers.parseUnits("100", 18));
    const tv3 = await mmm.balanceOf(TaxVault);
    expect(tv3 - tv2).to.be.gt(0n);
  });
});
