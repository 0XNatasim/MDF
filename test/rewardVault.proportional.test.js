const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { coreFixture } = require("./fixtures/core.fixture");

describe("RewardVault - Proportional Distribution", function () {

  it("distributes rewards proportionally to balances", async function () {

    const {
      owner,
      user1,
      user2,
      mmm,
      rewardVault,
      minHoldTime
    } = await loadFixture(coreFixture);

    // Give different balances
    const amount1 = ethers.parseUnits("1000", 18);
    const amount2 = ethers.parseUnits("3000", 18);

    await mmm.transfer(user1.address, amount1);
    await mmm.transfer(user2.address, amount2);

    await time.increase(minHoldTime + 1);

    // Emit rewards
    const rewardAmount = ethers.parseUnits("400", 18);

    await mmm.transfer(await rewardVault.getAddress(), rewardAmount);
    await rewardVault.connect(owner).notifyRewardAmount(rewardAmount);

    const pending1 = await rewardVault.pending(user1.address);
    const pending2 = await rewardVault.pending(user2.address);

    // user2 has 3x balance of user1 → should receive 3x reward
    const ratio = pending2 * 1n / pending1;

    expect(ratio).to.equal(3n);

  });

});
