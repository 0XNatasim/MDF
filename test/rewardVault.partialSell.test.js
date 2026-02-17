const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { coreFixture } = require("./fixtures/core.fixture");

describe("RewardVault - Partial Sell Does Not Reset Hold", function () {

  it("does NOT reset hold timer when balance stays > 0", async function () {

    const {
      owner,
      user1,
      mmm
    } = await loadFixture(coreFixture);

    const amount = ethers.parseUnits("1000", 18);

    // User enters
    await mmm.transfer(user1.address, amount);

    const firstHold = await mmm.lastNonZeroAt(user1.address);

    // Partial sell (not full exit)
    await mmm.connect(user1).transfer(owner.address, ethers.parseUnits("500", 18));

    const afterPartial = await mmm.lastNonZeroAt(user1.address);

    // Hold timestamp must NOT change
    expect(afterPartial).to.equal(firstHold);

  });

});
