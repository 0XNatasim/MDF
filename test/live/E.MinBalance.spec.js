const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

function mustEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

describe("E) minBalance enforced (live)", function () {
  it("E) below minBalance cannot claim", async function () {
    const MMMToken = mustEnv("MMMToken");
    const RewardVault  = mustEnv("RewardVault");
    const TaxVault  = mustEnv("TaxVault");
    const pk = mustEnv("FRESH3_PRIVATE_KEY");

    const fresh = new ethers.Wallet(pk, ethers.provider);
    const [deployer] = await ethers.getSigners();

    const mmm = await ethers.getContractAt("MMMToken", MMMToken);
    const rv  = await ethers.getContractAt("RewardVault", RewardVault);

    // create pending
    const pair = await mmm.pair();
    await (await mmm.connect(deployer).transfer(pair, ethers.parseUnits("100", 18))).wait();
    const taxBal = await mmm.balanceOf(TaxVault);
    if (taxBal > 0n) await (await rv.connect(deployer).notifyRewardAmountFromTaxVault(taxBal)).wait();

    // drop below minBalance by moving tokens out
    const minBal = await rv.minBalance();
    const bal = await mmm.balanceOf(fresh.address);
    if (bal >= minBal) {
      const target = minBal / 2n;
      const toSend = bal - target;
      if (toSend > 0n) await (await mmm.connect(fresh).transfer(deployer.address, toSend)).wait();
    }

    await expect(rv.connect(fresh).claim()).to.be.reverted;
  });
});
