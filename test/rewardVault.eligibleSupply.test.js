const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { coreFixture } = require("./fixtures/core.fixture");

describe("RewardVault - Eligible Supply Integrity", function () {

  it("eligibleSupply = totalSupply - vault balance", async function () {

    const {
      owner,
      user1,
      mmm,
      rewardVault
    } = await loadFixture(coreFixture);

    // Give user tokens
    await mmm.transfer(user1.address, ethers.parseUnits("1000", 18));

    const totalSupply = await mmm.totalSupply();

    // Vault is excluded by default
    const vaultBalance = await mmm.balanceOf(await rewardVault.getAddress());

    const eligible = await rewardVault.eligibleSupply();

    expect(eligible).to.equal(totalSupply - vaultBalance);

  });

});
