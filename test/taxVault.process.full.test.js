const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { coreFixture } = require("./fixtures/core.fixture");

describe("TaxVault - Full process() Flow", function () {

  it("splits, burns, swaps and distributes correctly", async function () {

    const {
      owner,
      mmm,
      usdc,
      taxVault,
      rewardVault,
      marketingVault,
      teamVestingVault
    } = await loadFixture(coreFixture);

    const DEAD = "0x000000000000000000000000000000000000dEaD";

    // Seed 1000 MMM into TaxVault
    const mmmAmount = ethers.parseUnits("1000", 18);
    await mmm.transfer(await taxVault.getAddress(), mmmAmount);

    const deadline = Math.floor(Date.now() / 1000) + 1000;

    await taxVault.connect(owner).process(
      mmmAmount,
      0,
      deadline
    );

    /* -----------------------------
       Validate MMM splits
    ------------------------------*/

    const rewardExpected = mmmAmount * 4000n / 10000n;
    const burnExpected   = mmmAmount * 1000n / 10000n;
    const swapExpected   = mmmAmount - rewardExpected - burnExpected;

    expect(await mmm.balanceOf(await rewardVault.getAddress()))
      .to.equal(rewardExpected);

    expect(await mmm.balanceOf(DEAD))
      .to.equal(burnExpected);

    /* -----------------------------
       Validate USDC swap result
    ------------------------------*/

    // swapExpected (18 decimals) → /1e12 for USDC (6 decimals)
    const usdcOut = swapExpected / 1000000000000n;

    const mktExpected  = usdcOut * 700n / (700n + 300n);
    const teamExpected = usdcOut - mktExpected;

    expect(await usdc.balanceOf(await marketingVault.getAddress()))
      .to.equal(mktExpected);

    expect(await usdc.balanceOf(await teamVestingVault.getAddress()))
      .to.equal(teamExpected);

  });

});
