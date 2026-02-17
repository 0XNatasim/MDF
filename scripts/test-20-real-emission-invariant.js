// scripts/test-20-real-emission-invariant.js
import hre from "hardhat";
import fs from "fs";
import path from "path";

const { ethers } = hre;

function loadManifest() {
  const file = path.join(
    "deployments",
    hre.network.name,
    "latest.json"
  );

  if (!fs.existsSync(file)) {
    throw new Error(`No deployment manifest for ${hre.network.name}`);
  }

  return JSON.parse(fs.readFileSync(file));
}

async function main() {

  console.log(`\n=== TEST 20: FULL ECONOMIC + SUPPLY + PRECISION INVARIANT (${hre.network.name}) ===\n`);

  const manifest = loadManifest();
  const { MMM, REWARD_VAULT } = manifest.contracts;

  const [owner, w1, w2, w3] = await ethers.getSigners();

  const mmm = await ethers.getContractAt("MMMToken", MMM, owner);
  const rv  = await ethers.getContractAt("RewardVault", REWARD_VAULT);

  const wallets = [w1, w2, w3];

  /* ===================================================== */
  /* 1. Distribute balances                                */
  /* ===================================================== */

  await (await mmm.transfer(w1.address, ethers.parseUnits("1000",18))).wait();
  await (await mmm.transfer(w2.address, ethers.parseUnits("5000",18))).wait();
  await (await mmm.transfer(w3.address, ethers.parseUnits("10000",18))).wait();

  /* ===================================================== */
  /* 2. Emit reward                                        */
  /* ===================================================== */

  // Seed TaxVault first
const taxVault = await ethers.getContractAt(
  "TaxVault",
  manifest.contracts.TAX_VAULT,
  owner
);

const seedAmount = ethers.parseUnits("10000",18);
await (await mmm.transfer(taxVault.target, seedAmount)).wait();

// Call real emission
await (await taxVault.process(
  seedAmount,
  0,
  Math.floor(Date.now()/1000) + 600
)).wait();


  /* ===================================================== */
  /* 3. Partial transfer                                   */
  /* ===================================================== */

  const bal2 = await mmm.balanceOf(w2.address);
  if (bal2 > 0n) {
    await (await mmm.connect(w2).transfer(owner.address, bal2 / 2n)).wait();
  }

  /* ===================================================== */
  /* 4. Claims                                             */
  /* ===================================================== */

  let totalClaimed = 0n;

  for (const w of wallets) {
    try {
      const pending = await rv.pending(w.address);
      if (pending > 0n) {
        await (await rv.connect(w).claim()).wait();
        totalClaimed += pending;
      }
    } catch {}
  }

  /* ===================================================== */
  /* 5. ECONOMIC INVARIANT                                 */
  /* ===================================================== */

  console.log("\n=== ECONOMIC INVARIANT ===");

  const totalDistributed = await rv.totalDistributed();

  let sumPending = 0n;
  for (const w of wallets) {
    sumPending += await rv.pending(w.address);
  }

  const accounting = totalClaimed + sumPending;

  const diff =
    totalDistributed > accounting
      ? totalDistributed - accounting
      : accounting - totalDistributed;

  const tolerance = ethers.parseUnits("0.0000000001",18);

  console.log("Total Distributed :", ethers.formatUnits(totalDistributed,18));
  console.log("Total Claimed     :", ethers.formatUnits(totalClaimed,18));
  console.log("Sum Pending       :", ethers.formatUnits(sumPending,18));
  console.log("Difference        :", ethers.formatUnits(diff,18));

  if (diff > tolerance) {
    throw new Error("❌ ECONOMIC DRIFT DETECTED");
  }

  console.log("✅ Economic invariant holds");

  /* ===================================================== */
  /* 6. SUPPLY INVARIANT                                   */
  /* ===================================================== */

  console.log("\n=== SUPPLY INVARIANT ===");

  const totalSupply = await mmm.totalSupply();
  const eligibleSupply = await rv.eligibleSupply();

  let excludedSum = 0n;
  const length = await rv.excludedRewardAddressesLength();

  for (let i = 0; i < length; i++) {
    const addr = await rv.excludedRewardAddresses(i);
    excludedSum += await mmm.balanceOf(addr);
  }

  const computedEligible = totalSupply - excludedSum;

  console.log("Total Supply        :", ethers.formatUnits(totalSupply,18));
  console.log("Eligible Supply     :", ethers.formatUnits(eligibleSupply,18));
  console.log("Computed Eligible   :", ethers.formatUnits(computedEligible,18));

  if (eligibleSupply !== computedEligible) {
    throw new Error("❌ SUPPLY INVARIANT BROKEN");
  }

  console.log("✅ Supply invariant holds");

  /* ===================================================== */
  /* 7. PRECISION INVARIANT                                */
  /* ===================================================== */

  console.log("\n=== ACC REWARD PRECISION INVARIANT ===");

  const ACC_SCALE = ethers.parseUnits("1", 18);
  const acc = await rv.accRewardPerToken();

  for (const w of wallets) {

    const bal = await mmm.balanceOf(w.address);
    const pending = await rv.pending(w.address);
    const debt = await rv.rewardDebt(w.address);

    const expected = (bal * acc) / ACC_SCALE;
    const actual = debt + pending;

    const diff =
      expected > actual
        ? expected - actual
        : actual - expected;

    if (diff > 3n) {
      throw new Error("❌ ACC REWARD PRECISION DRIFT DETECTED");
    }
  }

  console.log("✅ Precision invariant holds");

  console.log("\n=== TEST 20 PASSED ===\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
