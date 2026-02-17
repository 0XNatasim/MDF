const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { coreFixture } = require("./fixtures/core.fixture");

describe("TaxVault - No Tax on Wallet Transfers", function () {

  it("does NOT tax wallet -> wallet transfer", async function () {

    const {
      owner,
      user1,
      mmm,
      taxVault
    } = await loadFixture(coreFixture);

    const amount = ethers.parseUnits("1000", 18);

    // Give user1 tokens
    await mmm.transfer(user1.address, amount);

    const beforeTaxVault = await mmm.balanceOf(await taxVault.getAddress());

    // Wallet → Wallet transfer
    await mmm.connect(user1).transfer(owner.address, amount);

    const afterTaxVault = await mmm.balanceOf(await taxVault.getAddress());

    expect(afterTaxVault).to.equal(beforeTaxVault);

  });

});
