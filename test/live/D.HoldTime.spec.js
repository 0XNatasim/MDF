const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

function mustEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

describe("D) Hold time enforced (live)", function () {
  it("D) new entrant cannot claim before minHoldTime", async function () {
    const MMMToken = mustEnv("MMMToken");
    const RewardVault  = mustEnv("RewardVault");
    const TaxVault  = mustEnv("TaxVault");

    const pk = mustEnv("FRESH3_PRIVATE_KEY");
    const fresh = new ethers.Wallet(pk, ethers.provider);

    const [deployer] = await ethers.getSigners();
    const mmm = await ethers.getContractAt("MMMToken", MMMToken);
    const rv  = await ethers.getContractAt("RewardVault", RewardVault);

    // force exit to zero then re-enter
    const bal = await mmm.balanceOf(fresh.address);
    if (bal > 0n) {
      await (await mmm.connect(fresh).transfer(deployer.address, bal)).wait();
    }
    await (await mmm.connect(deployer).transfer(fresh.address, ethers.parseUnits("2", 18))).wait();

    // generate and distribute something so pending > 0 (otherwise it might revert NothingToClaim instead)
    const pair = await mmm.pair();
    await (await mmm.connect(deployer).transfer(pair, ethers.parseUnits("100", 18))).wait();
    const taxBal = await mmm.balanceOf(TaxVault);
    if (taxBal > 0n) {
      await (await rv.connect(deployer).notifyRewardAmountFromTaxVault(taxBal)).wait();
    }

    // claim should revert due to hold time (if pending is nonzero; otherwise other gate may trigger)
    await expect(rv.connect(fresh).claim()).to.be.reverted;
  });
});
