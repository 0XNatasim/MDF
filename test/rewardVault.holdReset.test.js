const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { coreFixture } = require("./fixtures/core.fixture");

describe("RewardVault - Hold Reset on Full Exit", function () {

  it("resets hold timer after full sell", async function () {

    const {
      owner,
      user1,
      mmm,
      rewardVault,
      minHoldTime
    } = await loadFixture(coreFixture);

    const amount = ethers.parseUnits("1000", 18);

    // User enters
    await mmm.transfer(user1.address, amount);

    const firstHold = await mmm.lastNonZeroAt(user1.address);

    // Full exit
    await mmm.connect(user1).transfer(owner.address, amount);

    // Re-enter
    await mmm.transfer(user1.address, amount);

    const secondHold = await mmm.lastNonZeroAt(user1.address);

    expect(secondHold).to.be.gt(firstHold);

    // Ensure cannot claim immediately
    await expect(
      rewardVault.connect(user1).claim()
    ).to.be.reverted;

  });

});
