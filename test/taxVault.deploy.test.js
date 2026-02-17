const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { coreFixture } = require("./fixtures/core.fixture");

describe("TaxVault Deployment", function () {

  it("stores constructor parameters correctly", async function () {

    const {
      mmm,
      usdc,
      wmon,
      taxVault
    } = await loadFixture(coreFixture);

    expect(await taxVault.mmm()).to.equal(await mmm.getAddress());
    expect(await taxVault.usdc()).to.equal(await usdc.getAddress());
    expect(await taxVault.wmon()).to.equal(await wmon.getAddress());

  });

});
