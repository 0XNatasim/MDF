// scripts/prove_reinclude_no_backearn.js
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function fmtEth(x) {
  return hre.ethers.formatEther(x);
}

async function getBalance(address) {
  return await hre.ethers.provider.getBalance(address);
}

async function main() {
  const net = hre.network.name;

  // Deployment files
  const mmmPath = path.join("deployments", `mmm.${net}.json`);
  const rtPath  = path.join("deployments", `rewardTracker.${net}.json`);

  if (!fs.existsSync(mmmPath)) throw new Error("MMM not found");
  if (!fs.existsSync(rtPath))  throw new Error("RewardTracker not found");

  const { mmm } = readJson(mmmPath);
  const { rewardTracker } = readJson(rtPath);

  // Pull tester from env (recommended) or hardcode fallback
  const tester =
    process.env.TESTER_ADDRESS ||
    "0x22BC7a72000faE48a67520c056C0944d9a675412";

  const [owner] = await hre.ethers.getSigners();

  console.log("Network:", net);
  console.log("Owner:  ", owner.address);
  console.log("MMM:    ", mmm);
  console.log("Tracker:", rewardTracker);
  console.log("Tester: ", tester);

  const tracker = await hre.ethers.getContractAt(
    "SnapshotRewardTrackerMon",
    rewardTracker,
    owner
  );

  const mmmToken = await hre.ethers.getContractAt("MMM", mmm, owner);

  // Helpers: read key tracker vars
  async function snap(label) {
    const rpts = await tracker.rewardPerTokenStored();
    const paid = await tracker.userRewardPerTokenPaid(tester);
    const excl = await tracker.isExcludedFromRewards(tester);
    const earned = await tracker.earned(tester);
    const rewardsAccrued = await tracker.rewards(tester);
    const eligSupply = await tracker.eligibleSupply();
    const tBal = await mmmToken.balanceOf(tester);
    const trBal = await getBalance(rewardTracker);

    console.log(`\n--- ${label} ---`);
    console.log("testerExcluded:       ", excl);
    console.log("tester MMM balance:   ", hre.ethers.formatUnits(tBal, 18));
    console.log("tracker MON balance:  ", fmtEth(trBal));
    console.log("eligibleSupply (MMM): ", hre.ethers.formatUnits(eligSupply, 18));
    console.log("rewardPerTokenStored: ", rpts.toString());
    console.log("userRPTPaid(tester):  ", paid.toString());
    console.log("rewards[tester]:      ", fmtEth(rewardsAccrued));
    console.log("earned(tester):       ", fmtEth(earned));
    return { rpts, paid, excl, earned, rewardsAccrued, eligSupply, trBal, tBal };
  }

  // Ensure tester is NOT excluded (start from known state)
  const pre = await snap("PRE-CHECK");
  if (pre.excl) {
    console.log("Tester is excluded; including tester to start baseline...");
    await (await tracker.excludeFromRewards(tester, false)).wait();
  }

  // 0) Optional checkpoint: force a tiny transfer to trigger token hook
  // This helps avoid “earned is 0 because never checkpointed” confusion.
  // If you don’t want this, set SKIP_CHECKPOINT=1 in env.
  if (!process.env.SKIP_CHECKPOINT) {
    // transfer 1 wei MMM from owner -> tester then tester -> owner requires tester signer.
    // We'll do a safe owner->tester 1 MMM "wei" transfer only (owner has tokens).
    // This triggers token hook and checkpoints tester.
    console.log("\nCheckpointing tester via owner -> tester transfer of 1 wei MMM...");
    await (await mmmToken.transfer(tester, 1n)).wait();
  }

  await snap("AFTER-CHECKPOINT");

  // 1) Deposit reward while tester is INCLUDED (baseline earned should become >0 after checkpoint + notify)
  const amount1 = hre.ethers.parseEther("0.2");
  console.log(`\nSending baseline reward (included): ${fmtEth(amount1)} MON to tracker...`);
  await (await owner.sendTransaction({ to: rewardTracker, value: amount1 })).wait();

  const s1 = await snap("AFTER BASELINE REWARD (INCLUDED)");
  // It's fine if earned isn't >0 yet if checkpointing didn't update rewards state,
  // but after a checkpoint it should.
  // We won't hard-fail here; the proof focuses on excluded interval.

  // 2) Exclude tester
  console.log("\nExcluding tester...");
  await (await tracker.excludeFromRewards(tester, true)).wait();
  const s2 = await snap("AFTER EXCLUDE");

  // 3) Deposit rewards while tester is EXCLUDED
  const amount2 = hre.ethers.parseEther("0.5");
  console.log(`\nSending reward while tester is EXCLUDED: ${fmtEth(amount2)} MON to tracker...`);
  await (await owner.sendTransaction({ to: rewardTracker, value: amount2 })).wait();
  const s3 = await snap("AFTER REWARD WHILE EXCLUDED");

  // 4) Re-include tester
  console.log("\nRe-including tester...");
  await (await tracker.excludeFromRewards(tester, false)).wait();
  const s4 = await snap("AFTER RE-INCLUDE (SHOULD NOT BACK-EARN)");

  // CRITICAL ASSERTION:
  // Immediately after re-include, before any new reward, earned should remain 0 (no retro earn)
  // In practice, earned might show tiny dust if you had pre-existing accrued rewards.
  // So we compare: earned after re-include should NOT jump upward due to excluded-period deposit.
  //
  // Strong check: during excluded period, tester must not gain.
  // We enforce: s4.earned <= s2.earned + tiny_epsilon
  const epsilon = hre.ethers.parseEther("0.000000001"); // 1e-9 MON dust tolerance
  const okNoBackEarn = s4.earned <= (s2.earned + epsilon);

  console.log("\nASSERT: no retro-earn during excluded window");
  console.log("earned(after exclude):   ", fmtEth(s2.earned));
  console.log("earned(after re-include):", fmtEth(s4.earned));
  console.log("Result:", okNoBackEarn ? "PASS ✅" : "FAIL ❌");

  // 5) Deposit reward after re-include; now tester should earn
  const amount3 = hre.ethers.parseEther("0.5");
  console.log(`\nSending reward after re-include: ${fmtEth(amount3)} MON to tracker...`);
  await (await owner.sendTransaction({ to: rewardTracker, value: amount3 })).wait();
  const s5 = await snap("AFTER REWARD POST-REINCLUDE");

  const okEarnResumes = s5.earned > s4.earned + epsilon;

  console.log("\nASSERT: earning resumes after re-include + new reward");
  console.log("earned(before post reward):", fmtEth(s4.earned));
  console.log("earned(after post reward): ", fmtEth(s5.earned));
  console.log("Result:", okEarnResumes ? "PASS ✅" : "FAIL ❌");

  // Final status
  console.log("\n==============================");
  console.log("Proof summary:");
  console.log("No back-earn: ", okNoBackEarn ? "PASS ✅" : "FAIL ❌");
  console.log("Earn resumes: ", okEarnResumes ? "PASS ✅" : "FAIL ❌");
  console.log("==============================\n");

  if (!okNoBackEarn || !okEarnResumes) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
