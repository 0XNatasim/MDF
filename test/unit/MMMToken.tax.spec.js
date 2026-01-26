const { expect } = require("chai");
const { ethers, network } = require("hardhat");

async function setNextTs(ts) {
  await network.provider.send("evm_setNextBlockTimestamp", [ts]);
  await network.provider.send("evm_mine");
}

async function mineAndGetBlockTs() {
  const block = await ethers.provider.getBlock("latest");
  return Number(block.timestamp);
}

describe("MMMToken - tax & wiring", function () {
  async function deploy() {
    const [owner, alice, bob, pair, router, taxVault] = await ethers.getSigners();

    const MMMToken = await ethers.getContractFactory("MMMToken");
    const initialSupply = ethers.parseUnits("1000000", 18);

    const token = await MMMToken.deploy("Monad Money Machine", "MMM", initialSupply, owner.address);
    await token.waitForDeployment();

    return { token, owner, alice, bob, pair, router, taxVault, initialSupply };
  }

  it("defaults: taxesEnabled=false; vault unset; bps default 500/500", async () => {
    const { token } = await deploy();
    expect(await token.taxesEnabled()).to.eq(false);
    expect(await token.taxVaultSet()).to.eq(false);
    expect(await token.buyTaxBps()).to.eq(500);
    expect(await token.sellTaxBps()).to.eq(500);
  });

  it("wiring gate: no taxes before vault is set and taxes enabled", async () => {
    const { token, owner, alice, pair, taxVault } = await deploy();

    await token.connect(owner).setPair(pair.address);
    await token.connect(owner).transfer(alice.address, ethers.parseUnits("1000", 18));

    const sellAmt = ethers.parseUnits("100", 18);

    const vaultBal0 = await token.balanceOf(taxVault.address);
    const pairBal0 = await token.balanceOf(pair.address);

    await token.connect(alice).transfer(pair.address, sellAmt);

    expect(await token.balanceOf(pair.address)).to.eq(pairBal0 + sellAmt);
    expect(await token.balanceOf(taxVault.address)).to.eq(vaultBal0);

    await token.connect(owner).setTaxVaultOnce(taxVault.address);

    const pairBal1 = await token.balanceOf(pair.address);
    const vaultBal1 = await token.balanceOf(taxVault.address);

    await token.connect(alice).transfer(pair.address, sellAmt);

    expect(await token.balanceOf(pair.address)).to.eq(pairBal1 + sellAmt);
    expect(await token.balanceOf(taxVault.address)).to.eq(vaultBal1);

    await token.connect(owner).setTaxesEnabled(true);

    const pairBal2 = await token.balanceOf(pair.address);
    const vaultBal2 = await token.balanceOf(taxVault.address);

    await token.connect(alice).transfer(pair.address, sellAmt);

    const tax = (sellAmt * 500n) / 10000n; // 5%
    const net = sellAmt - tax;

    expect(await token.balanceOf(pair.address)).to.eq(pairBal2 + net);
    expect(await token.balanceOf(taxVault.address)).to.eq(vaultBal2 + tax);
  });

  it("tax caps: cannot set taxes above 800 bps", async () => {
    const { token, owner } = await deploy();

    await expect(token.connect(owner).setTaxes(801, 0)).to.be.revertedWithCustomError(token, "TaxTooHigh");
    await expect(token.connect(owner).setTaxes(0, 801)).to.be.revertedWithCustomError(token, "TaxTooHigh");

    await token.connect(owner).setTaxes(800, 800);
    expect(await token.buyTaxBps()).to.eq(800);
    expect(await token.sellTaxBps()).to.eq(800);
  });

  it("tax applies only on canonical pair: wallet-to-wallet is not taxed", async () => {
    const { token, owner, alice, bob, pair, taxVault } = await deploy();

    await token.connect(owner).setPair(pair.address);
    await token.connect(owner).setTaxVaultOnce(taxVault.address);
    await token.connect(owner).setTaxesEnabled(true);

    await token.connect(owner).transfer(alice.address, ethers.parseUnits("1000", 18));

    const amt = ethers.parseUnits("100", 18);
    const bobBal0 = await token.balanceOf(bob.address);
    const vaultBal0 = await token.balanceOf(taxVault.address);

    await token.connect(alice).transfer(bob.address, amt);

    expect(await token.balanceOf(bob.address)).to.eq(bobBal0 + amt);
    expect(await token.balanceOf(taxVault.address)).to.eq(vaultBal0);
  });

  it("buy tax: transfer from pair -> user is taxed when enabled", async () => {
    const { token, owner, alice, pair, taxVault } = await deploy();

    await token.connect(owner).setPair(pair.address);
    await token.connect(owner).setTaxVaultOnce(taxVault.address);
    await token.connect(owner).setTaxesEnabled(true);

    await token.connect(owner).transfer(pair.address, ethers.parseUnits("1000", 18));

    const amt = ethers.parseUnits("100", 18);
    const aliceBal0 = await token.balanceOf(alice.address);
    const vaultBal0 = await token.balanceOf(taxVault.address);

    await token.connect(pair).transfer(alice.address, amt);

    const tax = (amt * 500n) / 10000n;
    const net = amt - tax;

    expect(await token.balanceOf(alice.address)).to.eq(aliceBal0 + net);
    expect(await token.balanceOf(taxVault.address)).to.eq(vaultBal0 + tax);
  });

  it("router exemption: any leg involving router is not taxed", async () => {
    const { token, owner, router, pair, taxVault } = await deploy();

    await token.connect(owner).setPair(pair.address);
    await token.connect(owner).setTaxVaultOnce(taxVault.address);
    await token.connect(owner).setRouter(router.address);
    await token.connect(owner).setTaxesEnabled(true);

    await token.connect(owner).transfer(router.address, ethers.parseUnits("1000", 18));
    await token.connect(owner).transfer(pair.address, ethers.parseUnits("1000", 18));

    const amt = ethers.parseUnits("100", 18);

    const vaultBal0 = await token.balanceOf(taxVault.address);
    const pairBal0 = await token.balanceOf(pair.address);

    await token.connect(router).transfer(pair.address, amt);

    expect(await token.balanceOf(pair.address)).to.eq(pairBal0 + amt);
    expect(await token.balanceOf(taxVault.address)).to.eq(vaultBal0);

    const routerBal0 = await token.balanceOf(router.address);
    const vaultBal1 = await token.balanceOf(taxVault.address);

    await token.connect(pair).transfer(router.address, amt);

    expect(await token.balanceOf(router.address)).to.eq(routerBal0 + amt);
    expect(await token.balanceOf(taxVault.address)).to.eq(vaultBal1);
  });

  it("lastNonZeroAt: set on 0->>0, unchanged while non-zero, cleared on >0->0", async () => {
    const { token, owner, alice, bob } = await deploy();

    // Alice starts at 0
    expect(await token.balanceOf(alice.address)).to.eq(0n);
    expect(await token.lastNonZeroAt(alice.address)).to.eq(0);

    // Set time, then perform the transfer and record the actual block timestamp
    const t1Target = 1_800_000_000;
    await setNextTs(t1Target);

    const tx1 = await token.connect(owner).transfer(alice.address, ethers.parseUnits("100", 18));
    const r1 = await tx1.wait();
    const b1 = await ethers.provider.getBlock(r1.blockNumber);
    const t1Actual = Number(b1.timestamp);

    expect(await token.lastNonZeroAt(alice.address)).to.eq(t1Actual);

    // Partial transfer (still non-zero) should not change lastNonZeroAt
    const t2Target = t1Target + 3600;
    await setNextTs(t2Target);

    const tx2 = await token.connect(alice).transfer(bob.address, ethers.parseUnits("10", 18));
    const r2 = await tx2.wait();
    const b2 = await ethers.provider.getBlock(r2.blockNumber);
    const t2Actual = Number(b2.timestamp);

    expect(await token.lastNonZeroAt(alice.address)).to.eq(t1Actual);

    // Transfer remaining to zero: timestamp clears
    const t3Target = t2Target + 3600;
    await setNextTs(t3Target);

    await token.connect(alice).transfer(bob.address, ethers.parseUnits("90", 18));
    expect(await token.balanceOf(alice.address)).to.eq(0n);
    expect(await token.lastNonZeroAt(alice.address)).to.eq(0);

    // Bob first became non-zero at tx2 time (t2Actual)
    expect(await token.lastNonZeroAt(bob.address)).to.eq(t2Actual);
  });

  it("cannot enable taxes before taxVault is set", async () => {
    const { token, owner } = await deploy();
    await expect(token.connect(owner).setTaxesEnabled(true)).to.be.revertedWithCustomError(token, "TaxVaultNotSet");
  });

  it("setTaxVaultOnce is one-time only and marks vault as tax-exempt", async () => {
    const { token, owner, taxVault } = await deploy();

    await token.connect(owner).setTaxVaultOnce(taxVault.address);

    expect(await token.taxVault()).to.eq(taxVault.address);
    expect(await token.taxVaultSet()).to.eq(true);
    expect(await token.isTaxExempt(taxVault.address)).to.eq(true);

    await expect(token.connect(owner).setTaxVaultOnce(taxVault.address)).to.be.revertedWithCustomError(
      token,
      "TaxVaultAlreadySet"
    );
  });
});
