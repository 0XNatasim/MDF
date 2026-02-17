const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { coreFixture } = require("./fixtures/core.fixture");

describe("RewardVault - NothingToClaim Gate", function () {

  it("reverts when user has no pending rewards", async function () {

    const {
      owner,
      user1,
      mmm,
      rewardVault,
      minHoldTime
    } = await loadFixture(coreFixture);

    // Give user tokens
    await mmm.transfer(user1.address, ethers.parseUnits("500", 18));

    // Pass hold time so hold gate does NOT interfere
    await time.increase(minHoldTime + 1);

    // There has been NO reward emission yet
    await expect(
      rewardVault.connect(user1).claim()
    ).to.be.reverted;

  });

});
