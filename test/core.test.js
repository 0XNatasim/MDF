const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { coreFixture } = require("./fixtures/core.fixture");

describe("Core MMM Deployment", function () {
  it("deploys with correct supply and owner", async function () {
    const { owner, mmm } = await loadFixture(coreFixture);

    const total = await mmm.totalSupply();
    const ownerBal = await mmm.balanceOf(owner.address);

    expect(total).to.equal(ownerBal);
  });
});
