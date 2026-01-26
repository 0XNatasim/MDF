// test/RewardVault.live.spec.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

const {
  walletFromEnv,
  getContracts,
  decodeCustomError,
  sellToPairAndDistributeAll,
  getHoldRemainingMaybe,
  getCooldownRemaining,
} = require("../helpers/rewardvault.env");

describe("RewardVault (MMM v1) — live-state tolerant", function () {
  this.timeout(240000);

  let mmm, rv, TaxVault;
  let deployer;

  // Use a “stable” wallet that you control (private key in env) and that typically has:
  // - balance >= minBalance
  // - hold remaining == 0
  // If your FRESH3 is frequently used/reset, switch this to FRESH_PRIVATE_KEY, etc.
  let claimantWallet;

  const AMT_5000 = ethers.parseUnits("5000", 18);
  const AMT_20000 = ethers.parseUnits("20000", 18);

  before(async () => {
    ({ mmm, rv, TaxVault } = await getContracts());
    [deployer] = await ethers.getSigners();

    // Choose one wallet as claimant for the live tests
    // (You can swap to FRESH_PRIVATE_KEY if you prefer.)
    claimantWallet = walletFromEnv("FRESH3_PRIVATE_KEY", "FRESH3_WALLET");
  });

  async function readExcludedFlag(rv, addr) {
    // Try common function/mapping getter names across versions
    const candidates = [
      "isExcludedFromRewards",
      "excludedFromRewards",      // common: public mapping getter
      "excluded",                 // some people use this
      "isExcluded",               // other common pattern
      "rewardExcluded",
    ];
  
    for (const name of candidates) {
      const fn = rv[name];
      if (typeof fn === "function") {
        try {
          return await fn(addr);
        } catch (_) {
          // function exists but call failed; try next
        }
      }
    }
  
    // No known view exists. In that case, we cannot pre-check exclusion,
    // so we treat it as "unknown" and let claim() reveal gating.
    return null; // unknown
  } 
  

  async function ensureClaimantEligibleOrThrow(addr) {
    const excluded = await rv.isExcludedFromRewards(addr);
    if (excluded) throw new Error(`Claimant ${addr} is excluded from rewards`);

    const minBal = await rv.minBalance();
    const bal = await mmm.balanceOf(addr);
    if (bal < minBal) throw new Error(`Claimant MMM balance below minBalance: bal=${bal} min=${minBal}`);

    const hold = await getHoldRemainingMaybe(rv, addr);
    if (hold.supported && hold.remaining > 0) {
      throw new Error(`Claimant hold-time still active: remaining=${hold.remaining}s`);
    }
  }

  async function expectedFirstGateError(addr) {
    // Determine expected revert by checking gates in the contract’s likely order.
    // If your contract order differs, align it here.
    if (await rv.isExcludedFromRewards(addr)) return "ExcludedFromRewards";

    const minBal = await rv.minBalance();
    if ((await mmm.balanceOf(addr)) < minBal) return "BalanceBelowMin";

    const hold = await getHoldRemainingMaybe(rv, addr);
    if (hold.supported && hold.remaining > 0) return "HoldTimeNotMet";

    const cd = await getCooldownRemaining(rv, addr);
    if (cd.remaining > 0) return "ClaimCooldownActive";

    const pending = await rv.pending(addr);
    if (pending === 0n) return "NothingToClaim";

    return null; // would succeed
  }

  it("F) Cooldown enforced: second claim during cooldown reverts ClaimCooldownActive (or NothingToClaim if pending rounds to 0)", async () => {
    const addr = claimantWallet.address;

    // Precheck eligibility (don’t wait timers inside tests)
    await ensureClaimantEligibleOrThrow(addr);

    // Round 1: create pending, claim once (sets lastClaimAt)
    await sellToPairAndDistributeAll({
      mmm,
      rv,
      TaxVault,
      deployer,
      amountMMM: AMT_20000,
    });

    const p1 = await rv.pending(addr);
    if (p1 === 0n) {
      throw new Error("F precheck failed: pending stayed 0 after distribution (rounding); increase AMT_20000 or holder balance");
    }

    await (await rv.connect(claimantWallet).claim({ maxPriorityFeePerGas: 2_000_000_000n })).wait();

    // Round 2: create *new* pending while cooldown is active
    await sellToPairAndDistributeAll({
      mmm,
      rv,
      TaxVault,
      deployer,
      amountMMM: AMT_20000,
    });

    const p2 = await rv.pending(addr);

    // We want: during cooldown, claim.staticCall should revert ClaimCooldownActive.
    // If p2 == 0 due to rounding, the revert might be NothingToClaim depending on check order.
    try {
      await rv.connect(claimantWallet).claim.staticCall();
      throw new Error("Unexpected: second claim would succeed");
    } catch (e) {
      const d = await decodeCustomError(rv, e);
      expect(["ClaimCooldownActive", "NothingToClaim"]).to.include(d.name);

      // If we *do* have pending > 0, we should see cooldown specifically.
      if (p2 > 0n) {
        expect(d.name).to.equal("ClaimCooldownActive");
      }
    }
  });

  it("G) NothingToClaim: claim with zero pending reverts with the correct gating error (NothingToClaim OR stricter gate)", async () => {
    const addr = claimantWallet.address;

    // Ensure state is “zero pending” by checking; if non-zero, claim it first (best-effort).
    const pendingNow = await rv.pending(addr);
    if (pendingNow > 0n) {
      // If cooldown/hold/minBalance blocks, we can’t force pending to zero without waiting.
      // So we don’t send a tx blindly; we evaluate expected gate and assert staticCall matches it.
      const expected = await expectedFirstGateError(addr);

      try {
        await rv.connect(claimantWallet).claim.staticCall();
        if (expected) throw new Error(`Unexpected: claim would succeed but expected gate ${expected}`);
      } catch (e) {
        const d = await decodeCustomError(rv, e);
        expect(d.name).to.equal(expected);
      }
      return;
    }

    // pending == 0 -> expectedFirstGateError should be either NothingToClaim,
    // or one of the stricter gates if they apply first.
    const expected = await expectedFirstGateError(addr);
    expect(expected).to.not.equal(null);

    try {
      await rv.connect(claimantWallet).claim.staticCall();
      throw new Error(`Unexpected: claim would succeed; expected ${expected}`);
    } catch (e) {
      const d = await decodeCustomError(rv, e);
      expect(d.name).to.equal(expected);
    }
  });
});
