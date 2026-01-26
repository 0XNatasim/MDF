const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const { loadLiveEnv } = require("../helpers/env.live");
const { getContracts } = require("../helpers/getContracts");


function mustEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

describe("A) Eligible supply + excluded claim gate (live)", function () {
  it("A) Eligible supply rule holds; excluded cannot claim", async function () {
    const MMMToken = mustEnv("MMMToken");
    const RewardVault  = mustEnv("RewardVault");
    const { env, tv } = await getContracts();


    const mmm = await ethers.getContractAt("MMMToken", MMMToken);
    const rv  = await ethers.getContractAt("RewardVault", RewardVault);

    // Pull excluded list from RewardVault (professional pattern: vault owns reward logic)
    const len = Number(await rv.excludedRewardAddressesLength());
    expect(len).to.be.greaterThan(0);

    let sumExcluded = 0n;
    for (let i = 0; i < len; i++) {
      const ex = await rv.excludedRewardAddresses(i);
      sumExcluded += await mmm.balanceOf(ex);
    }

    const totalSupply = await mmm.totalSupply();
    const eligibleSupply = await rv.eligibleSupply();
    expect(eligibleSupply).to.equal(totalSupply - sumExcluded);

    // excluded cannot claim
    const excluded0 = await rv.excludedRewardAddresses(0);
    expect(await rv.isExcludedReward(excluded0)).to.equal(true);


    // claim.staticCall should revert with ExcludedFromRewards(excluded0) if excluded is excluded by mapping
    // If your contract uses a different error name, adjust here.
    await expect(rv.connect(await ethers.getSigner(excluded0)).claim.staticCall())
      .to.be.reverted;
  });
});
