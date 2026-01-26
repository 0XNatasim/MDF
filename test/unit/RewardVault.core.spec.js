// test/RewardVault.core.spec.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

const {
  walletFromEnv,
  getContracts,
  decodeCustomError,
  sellToPairAndDistributeAll,
  buyFromPair,
  normalTransferNoTax,
  getHoldRemainingMaybe,
} = require("../helpers/rewardvault.env");

describe("RewardVault (MMM v1) — core invariants", function () {
  this.timeout(180000);

  let mmm, rv, TaxVault;
  let deployer;
  let pairWallet;   // TESTER_PRIVATE_KEY
  let fresh;        // FRESH_PRIVATE_KEY
  let fresh3;       // FRESH3_PRIVATE_KEY (used as “new entrant” in hold/minBalance tests when needed)

  const AMT_100 = ethers.parseUnits("100", 18);
  const AMT_1000 = ethers.parseUnits("1000", 18);
  const AMT_5000 = ethers.parseUnits("5000", 18);

  before(async () => {
    ({ mmm, rv, TaxVault } = await getContracts());
    [deployer] = await ethers.getSigners();

    // External wallets (must exist in .env)
    pairWallet = walletFromEnv("TESTER_PRIVATE_KEY", "TESTER");
    fresh = walletFromEnv("FRESH_PRIVATE_KEY", "FRESH_WALLET");
    fresh3 = walletFromEnv("FRESH3_PRIVATE_KEY", "FRESH3_WALLET");
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

    const eligibleSupply = await rv.eligibleSupply();
    expect(eligibleSupply).to.equal(totalSupply - sumExcluded);

    // Check excluded cannot claim
    const excluded = await rv.excludedRewardAddresses(0);
    try {
      await rv.connect(deployer).claim.staticCall({ from: excluded });
      throw new Error("Unexpected: excluded claim.staticCall did not revert");
    } catch (e) {
      const d = await decodeCustomError(rv, e);
      expect(d.name).to.equal("ExcludedFromRewards");
    }
  });

  it("B) Taxing: buy/sell taxed; normal transfer not taxed", async () => {
    const pair = await mmm.pair();
    const nonPairRecipient = fresh3.address.toLowerCase() === pair.toLowerCase() ? deployer.address : fresh3.address;

    // Normal transfer (deployer -> nonPairRecipient) should NOT tax
    const normal = await normalTransferNoTax({
      mmm,
      TaxVault,
      fromSigner: deployer,
      to: nonPairRecipient,
      amountMMM: AMT_100,
    });
    expect(normal.taxDelta).to.equal(0n);

    // Buy: pair -> recipient should tax (requires pair signer)
    const buy = await buyFromPair({
      mmm,
      TaxVault,
      pairWallet,
      to: nonPairRecipient,
      amountMMM: AMT_100,
    });
    expect(buy.taxDelta).to.be.greaterThan(0n);

    // Sell: deployer -> pair should tax
    const tv0 = await mmm.balanceOf(TaxVault);
    await (await mmm.connect(deployer).transfer(pair, AMT_100)).wait();
    const tv1 = await mmm.balanceOf(TaxVault);
    expect(tv1 - tv0).to.be.greaterThan(0n);
  });

  it("C) Distribution from TaxVault increases pending for an eligible holder", async () => {
    // Make sure holder has enough MMM so rounding doesn’t keep pending at 0.
    // If holder already has big balance, this is harmless.
    if ((await mmm.balanceOf(fresh.address)) < ethers.parseUnits("2", 18)) {
      await (await mmm.connect(deployer).transfer(fresh.address, ethers.parseUnits("10", 18))).wait();
    }

    const pending0 = await rv.pending(fresh.address);

    // Create tax + distribute. Use large amounts to avoid rounding.
    await sellToPairAndDistributeAll({
      mmm,
      rv,
      TaxVault,
      deployer,
      amountMMM: AMT_5000,
    });

    const pending1 = await rv.pending(fresh.address);
    expect(pending1).to.be.greaterThan(pending0);
  });

  it("D) Hold time enforced: new entrant cannot claim before minHoldTime", async () => {
    // Force “re-entry” behavior by bringing fresh3 to 0 then back > 0.
    // This updates lastNonZeroAt to now.
    const bal0 = await mmm.balanceOf(fresh3.address);
    if (bal0 > 0n) {
      await (await mmm.connect(new ethers.Wallet(process.env.FRESH3_PRIVATE_KEY, ethers.provider)).transfer(deployer.address, bal0)).wait();
    }
    await (await mmm.connect(deployer).transfer(fresh3.address, ethers.parseUnits("1", 18))).wait();

    const hold = await getHoldRemainingMaybe(rv, fresh3.address);
    if (!hold.supported) {
      // If contract/ABI doesn’t expose lastNonZeroAt/minHoldTime, treat as not applicable.
      this.skip();
    }
    expect(hold.remaining).to.be.greaterThan(0);

    // Create distribution so there is something to claim (use big tax+dist)
    await sellToPairAndDistributeAll({
      mmm,
      rv,
      TaxVault,
      deployer,
      amountMMM: AMT_5000,
    });

    // Claim should revert with HoldTimeNotMet
    const signer = new ethers.Wallet(process.env.FRESH3_PRIVATE_KEY, ethers.provider);
    try {
      await rv.connect(signer).claim.staticCall();
      throw new Error("Unexpected: claim would succeed; hold-time not enforced");
    } catch (e) {
      const d = await decodeCustomError(rv, e);
      expect(d.name).to.equal("HoldTimeNotMet");
    }
  });

  it("E) minBalance enforced: below minBalance cannot claim", async () => {
    const minBal = await rv.minBalance();

    // Put fresh3 below minBalance (but > 0 to not reset lastNonZeroAt to 0)
    const signer = new ethers.Wallet(process.env.FRESH3_PRIVATE_KEY, ethers.provider);
    const bal = await mmm.balanceOf(fresh3.address);
    if (bal >= minBal) {
      const target = minBal / 2n;
      const sendOut = bal - target;
      await (await mmm.connect(signer).transfer(deployer.address, sendOut)).wait();
    }

    // Ensure there is pending to claim (so the correct gate is minBalance)
    await sellToPairAndDistributeAll({
      mmm,
      rv,
      TaxVault,
      deployer,
      amountMMM: AMT_5000,
    });

    try {
      await rv.connect(signer).claim.staticCall();
      throw new Error("Unexpected: claim would succeed below minBalance");
    } catch (e) {
      const d = await decodeCustomError(rv, e);
      expect(d.name).to.equal("BalanceBelowMin");
    }

    // Restore to >= minBalance for later runs (good hygiene)
    const balAfter = await mmm.balanceOf(fresh3.address);
    if (balAfter < minBal) {
      await (await mmm.connect(deployer).transfer(fresh3.address, minBal - balAfter)).wait();
    }
  });
});
