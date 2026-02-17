const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { coreFixture } = require("./fixtures/core.fixture");

describe("RewardVault - Deterministic Distribution", function () {

  it("increases pending after notifyRewardAmount", async function () {

    const {
      owner,
      user1,
      mmm,
      rewardVault,
      minHoldTime
    } = await loadFixture(coreFixture);

    // Give user tokens
    await mmm.transfer(user1.address, ethers.parseUnits("1000", 18));

    // Pass hold time
    await time.increase(minHoldTime + 1);

    const p0 = await rewardVault.pending(user1.address);

    // Simulate reward emission
    const rewardAmount = ethers.parseUnits("100", 18);

    await rewardVault.connect(owner).notifyRewardAmount(rewardAmount);

    const p1 = await rewardVault.pending(user1.address);

    expect(p1).to.be.gt(p0);

  });

});
