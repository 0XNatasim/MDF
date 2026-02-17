const hre = require("hardhat");
const { ethers } = hre;

function mustEnv(name) {
  if (!process.env[name]) {
    throw new Error(`Missing env var: ${name}`);
  }
  return process.env[name];
}

function bn(x) {
  return BigInt(x.toString());
}

async function main() {

  console.log("=== LIVE ECONOMIC SIMULATION ===\n");

  const MMM_ADDR          = mustEnv("TESTNET_MMM");
  const TAXVAULT_ADDR     = mustEnv("TESTNET_TAXVAULT");
  const REWARDVAULT_ADDR  = mustEnv("TESTNET_REWARDVAULT");
  const MKT_ADDR          = mustEnv("TESTNET_MARKETINGVAULT");
  const TEAM_ADDR         = mustEnv("TESTNET_TEAMVESTINGVAULT");
  const USDC_ADDR         = mustEnv("TESTNET_USDC");

  const [signer] = await ethers.getSigners();

  const MMM         = await ethers.getContractAt("MMMToken", MMM_ADDR, signer);
  const TaxVault    = await ethers.getContractAt("TaxVault", TAXVAULT_ADDR, signer);
  const USDC        = await ethers.getContractAt("IERC20", USDC_ADDR);

  const DEAD = "0x000000000000000000000000000000000000dEaD";

  /* --------------------------------------------------
     1️⃣ Seed TaxVault
  -------------------------------------------------- */

  const mmmAmount = ethers.parseUnits("1000", 18);

  console.log("Seeding TaxVault with 1000 MMM...");

  const txSeed = await MMM.transfer(TAXVAULT_ADDR, mmmAmount);
  await txSeed.wait();

  /* --------------------------------------------------
     2️⃣ Capture balances BEFORE
  -------------------------------------------------- */

  const before = {
    taxMMM:    bn(await MMM.balanceOf(TAXVAULT_ADDR)),
    rewardMMM: bn(await MMM.balanceOf(REWARDVAULT_ADDR)),
    burnMMM:   bn(await MMM.balanceOf(DEAD)),
    mktUSDC:   bn(await USDC.balanceOf(MKT_ADDR)),
    teamUSDC:  bn(await USDC.balanceOf(TEAM_ADDR))
  };

  console.log("Balances BEFORE captured.\n");

  /* --------------------------------------------------
     3️⃣ Run process()
  -------------------------------------------------- */

  const deadline = Math.floor(Date.now() / 1000) + 1200;

  console.log("Calling process()...");

  const txProcess = await TaxVault.process(
    mmmAmount,
    0,
    deadline
  );

  await txProcess.wait();

  console.log("process() executed.\n");

  /* --------------------------------------------------
     4️⃣ Capture balances AFTER
  -------------------------------------------------- */

  const after = {
    taxMMM:    bn(await MMM.balanceOf(TAXVAULT_ADDR)),
    rewardMMM: bn(await MMM.balanceOf(REWARDVAULT_ADDR)),
    burnMMM:   bn(await MMM.balanceOf(DEAD)),
    mktUSDC:   bn(await USDC.balanceOf(MKT_ADDR)),
    teamUSDC:  bn(await USDC.balanceOf(TEAM_ADDR))
  };

  /* --------------------------------------------------
     5️⃣ Compute expected math
  -------------------------------------------------- */

  const BPS = 10000n;

  const bpsReward = bn(await TaxVault.bpsReward());
  const bpsBurn   = bn(await TaxVault.bpsBurn());
  const bpsMkt    = bn(await TaxVault.bpsMkt());
  const bpsTeam   = bn(await TaxVault.bpsTeam());

  const toReward = mmmAmount * bpsReward / BPS;
  const toBurn   = mmmAmount * bpsBurn   / BPS;
  const toSwap   = mmmAmount - toReward - toBurn;

  // 18 → 6 decimals
  const usdcOut = toSwap / 1000000000000n;

  const denom = bpsMkt + bpsTeam;

  const toMkt  = denom === 0n ? 0n : (usdcOut * bpsMkt) / denom;
  const toTeam = usdcOut - toMkt;

  /* --------------------------------------------------
     6️⃣ Validate
  -------------------------------------------------- */

  function assertEqual(actual, expected, label) {
    if (actual !== expected) {
      throw new Error(
        `${label} mismatch:\nExpected: ${expected}\nActual:   ${actual}`
      );
    }
  }

  assertEqual(after.rewardMMM - before.rewardMMM, toReward, "Reward MMM");
  assertEqual(after.burnMMM - before.burnMMM,     toBurn,   "Burn MMM");
  assertEqual(after.mktUSDC - before.mktUSDC,     toMkt,    "Marketing USDC");
  assertEqual(after.teamUSDC - before.teamUSDC,   toTeam,   "Team USDC");

  console.log("✅ LIVE ECONOMIC SIMULATION PASSED");
  console.log("All balances match expected math.\n");
}

main().catch((e) => {
  console.error("\n❌ LIVE ECONOMIC SIMULATION FAILED");
  console.error(e);
  process.exit(1);
});
