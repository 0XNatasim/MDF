const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { coreFixture } = require("./fixtures/core.fixture");

describe("RewardVault Deployment", function () {
  it("stores constructor parameters correctly", async function () {
    const { rewardVault, mmm, minHoldTime, cooldown, minBalance } =
      await loadFixture(coreFixture);

    expect(await rewardVault.mmm()).to.equal(await mmm.getAddress());
    expect(await rewardVault.minHoldTimeSec()).to.equal(minHoldTime);
    expect(await rewardVault.claimCooldown()).to.equal(cooldown);
    expect(await rewardVault.minBalance()).to.equal(minBalance);
  });
});
