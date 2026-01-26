const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

function mustEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

describe("C) Distribution increases pending (live)", function () {
  it("C) Distribution from TaxVault increases pending for an eligible holder", async function () {
    const MMMToken = mustEnv("MMMToken");
    const TaxVault  = mustEnv("TaxVault");
    const RewardVault  = mustEnv("RewardVault");
    const HOLDER   = mustEnv("FRESH3_WALLET"); // or FRESH2/FRESH3—pick one you know is eligible

    const [deployer] = await ethers.getSigners();
    const mmm = await ethers.getContractAt("MMMToken", MMMToken);
    const rv  = await ethers.getContractAt("RewardVault", RewardVault);

    const pair = await mmm.pair();

    const p0 = await rv.pending(HOLDER);

    // generate tax into TaxVault via sell
    await (await mmm.connect(deployer).transfer(pair, ethers.parseUnits("100", 18))).wait();

    const taxBal = await mmm.balanceOf(TaxVault);
    if (taxBal > 0n) {
      await (await rv.connect(deployer).notifyRewardAmountFromTaxVault(taxBal)).wait();
    }

    const p1 = await rv.pending(HOLDER);
    expect(p1).to.be.greaterThan(p0);
  });
});
