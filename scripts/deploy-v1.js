// scripts/redeploy-v1.js
const hre = require("hardhat");
const { ethers } = hre;

function mustEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

function optEnv(k, def = "") {
  return process.env[k] ?? def;
}

async function main() {
  const [deployer] = await ethers.getSigners();

  // --- Params (edit as needed) ---
  const NAME = optEnv("MMM_NAME", "Monad Money Machine");
  const SYMBOL = optEnv("MMM_SYMBOL", "MMM");
  const TOTAL_SUPPLY = ethers.parseUnits(optEnv("MMM_SUPPLY", "1000000"), 18);

  // Your “pair” can be any address if you’re using it only as the tax trigger.
  // If you already have a “pair” contract deployed (code != 0x), use it.
  const PAIR_ADDR = mustEnv("PAIR_ADDR"); // IMPORTANT: set in .env
  // router can remain zero unless you actually use it
  const ROUTER_ADDR = optEnv("ROUTER_ADDR", ethers.ZeroAddress);

  // v1 reward parameters
  const MIN_HOLD_SEC = BigInt(optEnv("MIN_HOLD_SEC", String(12 * 60 * 60))); // 12h
  const COOLDOWN_SEC = BigInt(optEnv("COOLDOWN_SEC", String(12 * 60 * 60))); // 12h
  const MIN_BALANCE = ethers.parseUnits(optEnv("MIN_BALANCE_MMM", "1"), 18); // 1 MMM

  // taxes
  const BUY_TAX_BPS = BigInt(optEnv("BUY_TAX_BPS", "500"));
  const SELL_TAX_BPS = BigInt(optEnv("SELL_TAX_BPS", "500"));

  console.log("=== MMM v1 FULL REDEPLOY (monadTestnet) ===");
  console.log("deployer:", deployer.address);
  console.log("PAIR_ADDR:", PAIR_ADDR);
  console.log("ROUTER_ADDR:", ROUTER_ADDR);
  console.log("reward params:", {
    MIN_HOLD_SEC: MIN_HOLD_SEC.toString(),
    COOLDOWN_SEC: COOLDOWN_SEC.toString(),
    MIN_BALANCE: MIN_BALANCE.toString(),
  });
  console.log("tax params:", { BUY_TAX_BPS: BUY_TAX_BPS.toString(), SELL_TAX_BPS: SELL_TAX_BPS.toString() });
  console.log("");

  // -----------------------------
  // 1) Deploy MMMToken
  // -----------------------------
  // NOTE: this assumes your MMMToken constructor matches what you have in your repo.
  // If it differs, paste your MMMToken constructor signature here and I’ll adjust the script.
  const MMMTokenF = await ethers.getContractFactory("MMMToken");
  const mmm = await MMMTokenF.deploy(
    NAME,
    SYMBOL,
    TOTAL_SUPPLY,
    deployer.address
  );
  await mmm.waitForDeployment();
  const MMM_ADDR = await mmm.getAddress();
  console.log("MMMToken deployed :", MMM_ADDR);

  // -----------------------------
  // 2) Deploy TaxVault (owner = deployer)
  // -----------------------------
  const TaxVaultF = await ethers.getContractFactory("TaxVault");
  const tv = await TaxVaultF.deploy(MMM_ADDR, deployer.address);
  await tv.waitForDeployment();
  const TV_ADDR = await tv.getAddress();
  console.log("TaxVault deployed :", TV_ADDR);

  // -----------------------------
  // 3) Deploy RewardVault (owner = deployer)
  // -----------------------------
  const RewardVaultF = await ethers.getContractFactory("RewardVault");
  const rv = await RewardVaultF.deploy(
    MMM_ADDR,
    TV_ADDR,
    MIN_HOLD_SEC,
    COOLDOWN_SEC,
    MIN_BALANCE,
    deployer.address
  );
  await rv.waitForDeployment();
  const RV_ADDR = await rv.getAddress();
  console.log("RewardVault deployed:", RV_ADDR);

  // -----------------------------
  // 4) Wire TaxVault -> RewardVault (ONE TIME)
  // -----------------------------
  {
    const isSet = await tv.rewardVaultSet();
    if (isSet) throw new Error("Unexpected: new TaxVault already set");
    const tx = await tv.setRewardVaultOnce(RV_ADDR);
    console.log("TaxVault.setRewardVaultOnce tx:", tx.hash);
    await tx.wait();
    console.log("TaxVault.rewardVault:", await tv.rewardVault());
  }

  // -----------------------------
  // 5) Wire MMMToken -> TaxVault, Pair, Router, Taxes
  // -----------------------------
  // MMMToken wiring functions must match your MMMToken implementation.
  // Based on your ABI fragments shown earlier: setTaxVaultOnce, setPair, setRouter, setTaxes, setTaxesEnabled
  {
    const tx1 = await mmm.setTaxVaultOnce(TV_ADDR);
    console.log("MMMToken.setTaxVaultOnce tx:", tx1.hash);
    await tx1.wait();

    const tx2 = await mmm.setPair(PAIR_ADDR);
    console.log("MMMToken.setPair tx:", tx2.hash);
    await tx2.wait();

    if (ROUTER_ADDR && ROUTER_ADDR !== ethers.ZeroAddress) {
      const tx3 = await mmm.setRouter(ROUTER_ADDR);
      console.log("MMMToken.setRouter tx:", tx3.hash);
      await tx3.wait();
    }

    const tx4 = await mmm.setTaxes(BUY_TAX_BPS, SELL_TAX_BPS);
    console.log("MMMToken.setTaxes tx:", tx4.hash);
    await tx4.wait();

    const tx5 = await mmm.setTaxesEnabled(true);
    console.log("MMMToken.setTaxesEnabled(true) tx:", tx5.hash);
    await tx5.wait();
  }

  // -----------------------------
  // 6) Sanity checks (must not revert)
  // -----------------------------
  console.log("\n=== SANITY ===");
  console.log("MMMToken.taxVault():", await mmm.taxVault());
  console.log("MMMToken.pair():", await mmm.pair());
  console.log("MMMToken.router():", await mmm.router());
  console.log("MMMToken.taxesEnabled():", await mmm.taxesEnabled());
  console.log("TaxVault.rewardVaultSet():", await tv.rewardVaultSet());
  console.log("TaxVault.rewardVault():", await tv.rewardVault());
  console.log("RewardVault.mmm():", await rv.mmm());
  console.log("RewardVault.taxVault():", await rv.taxVault());
  console.log("RewardVault.claimCooldown():", (await rv.claimCooldown()).toString());
  console.log("RewardVault.minHoldTimeSec():", (await rv.minHoldTimeSec()).toString()); // MUST WORK
  console.log("RewardVault.minBalance():", (await rv.minBalance()).toString());

  console.log("\n=== DONE ===");
  console.log("Set these in .env:");
  console.log(`MMMToken=${MMM_ADDR}`);
  console.log(`TaxVault=${TV_ADDR}`);
  console.log(`RewardVault=${RV_ADDR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
