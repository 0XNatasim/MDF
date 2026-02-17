const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { coreFixture } = require("./fixtures/core.fixture");

describe("RewardVault - Hold Time Gate", function () {

  it("cannot claim before minHoldTimeSec", async function () {

    const {
      owner,
      user1,
      mmm,
      rewardVault,
      minHoldTime
    } = await loadFixture(coreFixture);

    // Give user tokens
    await mmm.transfer(user1.address, ethers.parseUnits("500", 18));

    // Fast-forward small amount (less than hold time)
    await time.increase(minHoldTime - 10);

    // Try claim
    await expect(
      rewardVault.connect(user1).claim()
    ).to.be.reverted;

  });

});
