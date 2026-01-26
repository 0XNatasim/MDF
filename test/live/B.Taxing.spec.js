const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

function mustEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

describe("B) Taxing (live)", function () {
  it("B) buy/sell taxed; normal transfer not taxed", async function () {
    const MMMToken = mustEnv("MMMToken");
    const TaxVault  = mustEnv("TaxVault");
    const FRESH3   = mustEnv("FRESH3_WALLET");

    const [deployer] = await ethers.getSigners();
    const mmm = await ethers.getContractAt("MMMToken", MMMToken);

    const pair = await mmm.pair();
    expect(pair).to.not.equal(ethers.ZeroAddress);

    // 1) wallet -> wallet NOT taxed
    const tv0 = await mmm.balanceOf(TaxVault);
    await (await mmm.connect(deployer).transfer(FRESH3, ethers.parseUnits("1", 18))).wait();
    const tv1 = await mmm.balanceOf(TaxVault);
    expect(tv1 - tv0).to.equal(0n);

    // 2) buy leg (pair -> user) taxed (we simulate by sending from pair address if we control it; on live we usually don't)
    // Live-safe alternative: verify that a transfer *to pair* is taxed (sell), which we can do from deployer.
    const tv2 = await mmm.balanceOf(TaxVault);
    await (await mmm.connect(deployer).transfer(pair, ethers.parseUnits("100", 18))).wait();
    const tv3 = await mmm.balanceOf(TaxVault);

    expect(tv3 - tv2).to.be.greaterThan(0n);
  });
});
