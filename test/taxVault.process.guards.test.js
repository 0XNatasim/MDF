const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { coreFixture } = require("./fixtures/core.fixture");

describe("TaxVault - process() Guard Tests", function () {

  it("reverts when processing is disabled", async function () {

    const {
      owner,
      taxVault
    } = await loadFixture(coreFixture);

    const deadline = Math.floor(Date.now() / 1000) + 1000;

    await expect(
      taxVault.connect(owner).process(
        1n,
        0,
        deadline
      )
    ).to.be.reverted;
  });

  it("reverts when amount is zero", async function () {

    const {
      owner,
      taxVault
    } = await loadFixture(coreFixture);

    await taxVault.connect(owner).setProcessingEnabled(true);

    const deadline = Math.floor(Date.now() / 1000) + 1000;

    await expect(
      taxVault.connect(owner).process(
        0n,
        0,
        deadline
      )
    ).to.be.reverted;
  });

  it("reverts when deadline expired", async function () {

    const {
      owner,
      taxVault
    } = await loadFixture(coreFixture);

    await taxVault.connect(owner).setProcessingEnabled(true);

    const pastDeadline = Math.floor(Date.now() / 1000) - 1;

    await expect(
      taxVault.connect(owner).process(
        1n,
        0,
        pastDeadline
      )
    ).to.be.reverted;
  });

  it("reverts when insufficient balance", async function () {

    const {
      owner,
      taxVault
    } = await loadFixture(coreFixture);

    await taxVault.connect(owner).setProcessingEnabled(true);

    const deadline = Math.floor(Date.now() / 1000) + 1000;

    await expect(
      taxVault.connect(owner).process(
        ethers.parseUnits("100", 18),
        0,
        deadline
      )
    ).to.be.reverted;
  });

});
