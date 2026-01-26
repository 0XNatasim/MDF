const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TaxVault (v1)", function () {
  async function deploy() {
    const [owner, alice, rewardVault, other] = await ethers.getSigners();

    // Deploy MMMToken as the MMM ERC20
    const MMMToken = await ethers.getContractFactory("MMMToken");
    const initialSupply = ethers.parseUnits("1000000", 18);
    const mmm = await MMMToken.deploy("Monad Money Machine", "MMM", initialSupply, owner.address);
    await mmm.waitForDeployment();

    // Deploy a second ERC20 (also MMMToken) to simulate "random token accidentally sent"
    const otherToken = await MMMToken.deploy("Other Token", "OTK", initialSupply, owner.address);
    await otherToken.waitForDeployment();

    const TaxVault = await ethers.getContractFactory("TaxVault");
    const vault = await TaxVault.deploy(await mmm.getAddress(), owner.address);
    await vault.waitForDeployment();

    return { owner, alice, rewardVault, other, mmm, otherToken, vault };
  }

  it("constructor wires immutable MMM token and owner", async () => {
    const { owner, mmm, vault } = await deploy();
    expect(await vault.owner()).to.eq(owner.address);
    expect(await vault.mmm()).to.eq(await mmm.getAddress());
    expect(await vault.rewardVaultSet()).to.eq(false);
    expect(await vault.rewardVault()).to.eq(ethers.ZeroAddress);
  });

  it("setRewardVaultOnce: onlyOwner, non-zero, one-time", async () => {
    const { owner, alice, rewardVault, vault } = await deploy();

    await expect(vault.connect(alice).setRewardVaultOnce(rewardVault.address))
      .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");

    await expect(vault.connect(owner).setRewardVaultOnce(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(vault, "ZeroAddress");

    await vault.connect(owner).setRewardVaultOnce(rewardVault.address);
    expect(await vault.rewardVaultSet()).to.eq(true);
    expect(await vault.rewardVault()).to.eq(rewardVault.address);

    await expect(vault.connect(owner).setRewardVaultOnce(rewardVault.address))
      .to.be.revertedWithCustomError(vault, "RewardVaultAlreadySet");
  });

  it("sweepToRewardVault: only rewardVault can pull MMM", async () => {
    const { owner, alice, rewardVault, mmm, vault } = await deploy();

    // Fund vault with MMM (simulate taxes)
    await mmm.connect(owner).transfer(await vault.getAddress(), ethers.parseUnits("1000", 18));
    expect(await mmm.balanceOf(await vault.getAddress())).to.eq(ethers.parseUnits("1000", 18));

    // Not set yet => rewardVault is zero, so anyone calling should revert
    await expect(vault.connect(alice).sweepToRewardVault(ethers.parseUnits("1", 18)))
      .to.be.revertedWithCustomError(vault, "OnlyRewardVault");

    // Set reward vault
    await vault.connect(owner).setRewardVaultOnce(rewardVault.address);

    // Non-rewardVault cannot sweep
    await expect(vault.connect(alice).sweepToRewardVault(ethers.parseUnits("1", 18)))
      .to.be.revertedWithCustomError(vault, "OnlyRewardVault")
      .withArgs(alice.address);

    // RewardVault can sweep
    const amt = ethers.parseUnits("250", 18);
    const rvBal0 = await mmm.balanceOf(rewardVault.address);
    await vault.connect(rewardVault).sweepToRewardVault(amt);

    expect(await mmm.balanceOf(rewardVault.address)).to.eq(rvBal0 + amt);
    expect(await mmm.balanceOf(await vault.getAddress())).to.eq(ethers.parseUnits("1000", 18) - amt);
  });

  it("rescueToken: onlyOwner, cannot rescue MMM, can rescue other tokens", async () => {
    const { owner, alice, other, mmm, otherToken, vault } = await deploy();

    // Send OTHER token to vault to simulate accidental transfer
    await otherToken.connect(owner).transfer(await vault.getAddress(), ethers.parseUnits("123", 18));
    expect(await otherToken.balanceOf(await vault.getAddress())).to.eq(ethers.parseUnits("123", 18));

    // Non-owner cannot rescue
    await expect(vault.connect(alice).rescueToken(await otherToken.getAddress(), other.address, ethers.parseUnits("1", 18)))
      .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");

    // Owner cannot rescue MMM
    await expect(vault.connect(owner).rescueToken(await mmm.getAddress(), other.address, ethers.parseUnits("1", 18)))
      .to.be.revertedWithCustomError(vault, "CannotRescueMMM");

    // Owner can rescue other token
    const to = other.address;
    const amt = ethers.parseUnits("23", 18);
    const toBal0 = await otherToken.balanceOf(to);

    await vault.connect(owner).rescueToken(await otherToken.getAddress(), to, amt);

    expect(await otherToken.balanceOf(to)).to.eq(toBal0 + amt);
    expect(await otherToken.balanceOf(await vault.getAddress())).to.eq(ethers.parseUnits("123", 18) - amt);
  });
});
