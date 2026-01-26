// scripts/preflight-live.js
const hre = require("hardhat");
const { ethers } = hre;

function mustEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

function optEnv(k) {
  return process.env[k] || "";
}

function fmtAddr(a) {
  if (!a) return "(none)";
  return a;
}

function fmtBool(b) {
  return b ? "true" : "false";
}

function fmtWei(x, decimals = 18) {
  try {
    return ethers.formatUnits(x, decimals);
  } catch {
    return String(x);
  }
}

async function codeAt(addr) {
  if (!addr) return "0x";
  return await ethers.provider.getCode(addr);
}

async function safe(label, fn) {
  try {
    const v = await fn();
    return { ok: true, v };
  } catch (e) {
    return { ok: false, v: null, err: e, label };
  }
}

async function main() {
  const MMMToken = mustEnv("MMMToken");
  const RewardVault = mustEnv("RewardVault");
  const TaxVault = mustEnv("TaxVault");

  const pk = optEnv("FRESH3_PRIVATE_KEY");
  const claimant = pk ? new ethers.Wallet(pk, ethers.provider) : null;

  const [deployer] = await ethers.getSigners();

  console.log("=== MMM v1 LIVE PREFLIGHT (monadTestnet) ===\n");

  console.log("[Addresses]");
  console.log("MMMToken   :", MMMToken);
  console.log("RewardVault:", RewardVault);
  console.log("TaxVault   :", TaxVault);
  console.log("Deployer   :", deployer.address);
  console.log("Claimant   :", claimant ? claimant.address : "(no FRESH3_PRIVATE_KEY provided)");
  console.log("");

  const mmmCode = await codeAt(MMMToken);
  const rvCode = await codeAt(RewardVault);
  const tvCode = await codeAt(TaxVault);

  console.log("[Code Checks]");
  console.log("MMMToken code   :", mmmCode !== "0x" ? "OK" : "MISSING");
  console.log("RewardVault code:", rvCode !== "0x" ? "OK" : "MISSING");
  console.log("TaxVault code   :", tvCode !== "0x" ? "OK" : "MISSING");
  console.log("");

  if (mmmCode === "0x" || rvCode === "0x" || tvCode === "0x") {
    console.log("One or more contracts have no code at the provided addresses. Stop here.");
    process.exit(1);
  }

  const mmm = await ethers.getContractAt("MMMToken", MMMToken);
  const rv = await ethers.getContractAt("RewardVault", RewardVault);

  const net = await ethers.provider.getNetwork();
  const latest = await ethers.provider.getBlock("latest");

  console.log("[Network]");
  console.log("chainId     :", net.chainId.toString());
  console.log("latest block:", latest.number);
  console.log("timestamp   :", latest.timestamp);
  console.log("");

  console.log("[MMMToken Wiring]");
  const name = await mmm.name();
  const symbol = await mmm.symbol();
  const decimals = await mmm.decimals();
  const totalSupply = await mmm.totalSupply();

  const pair = await mmm.pair();
  const router = await mmm.router();
  const taxVault = await mmm.taxVault();
  const taxesEnabled = await mmm.taxesEnabled();
  const buyTaxBps = await mmm.buyTaxBps();
  const sellTaxBps = await mmm.sellTaxBps();

  console.log("name/symbol         :", `${name} (${symbol})`);
  console.log("decimals            :", decimals.toString());
  console.log("totalSupply         :", fmtWei(totalSupply, decimals), `(${totalSupply.toString()} raw)`);
  console.log("pair                :", fmtAddr(pair), "code:", (await codeAt(pair)) !== "0x" ? "OK" : "0x");
  console.log("router              :", fmtAddr(router), "code:", (await codeAt(router)) !== "0x" ? "OK" : "0x");
  console.log(
    "taxVault()          :",
    fmtAddr(taxVault),
    taxVault.toLowerCase() === TaxVault.toLowerCase() ? "(matches env)" : "(DIFF from env)"
  );
  console.log("taxesEnabled        :", fmtBool(taxesEnabled));
  console.log("buyTaxBps/sellTaxBps:", `${buyTaxBps.toString()} / ${sellTaxBps.toString()}`);
  console.log("");

  console.log("[RewardVault Params]");

  const rvMmmR = await safe("rv.mmm()", () => rv.mmm());
  const rvTaxVaultR = await safe("rv.taxVault()", () => rv.taxVault());

  console.log("rv.mmm()     :", rvMmmR.ok ? rvMmmR.v : "(reverted/missing)");
  console.log("rv.taxVault():", rvTaxVaultR.ok ? rvTaxVaultR.v : "(reverted/missing)");

  const minHoldR = await safe("rv.minHoldTimeSec()", () => rv.minHoldTimeSec());
  const cooldownR = await safe("rv.claimCooldown()", () => rv.claimCooldown());
  const minBalR = await safe("rv.minBalance()", () => rv.minBalance());
  const eligibleSupplyR = await safe("rv.eligibleSupply()", () => rv.eligibleSupply());

  console.log("minHoldTimeSec :", minHoldR.ok ? minHoldR.v.toString() : "(reverted/missing)");
  console.log("claimCooldown  :", cooldownR.ok ? cooldownR.v.toString() : "(reverted/missing)");
  console.log("minBalance     :", minBalR.ok ? fmtWei(minBalR.v, decimals) : "(reverted/missing)");
  console.log("eligibleSupply :", eligibleSupplyR.ok ? fmtWei(eligibleSupplyR.v, decimals) : "(reverted/missing)");
  console.log("");

  console.log("[Balances]");
  const taxVaultMmmBal = await mmm.balanceOf(TaxVault);
  const rvMmmBal = await mmm.balanceOf(RewardVault);
  console.log("TaxVault MMM balance   :", fmtWei(taxVaultMmmBal, decimals), `(${taxVaultMmmBal.toString()} raw)`);
  console.log("RewardVault MMM balance:", fmtWei(rvMmmBal, decimals), `(${rvMmmBal.toString()} raw)`);
  console.log("");

  if (claimant) {
    console.log("[Claimant Snapshot]");
    const monBal = await ethers.provider.getBalance(claimant.address);
    const mmmBal = await mmm.balanceOf(claimant.address);

    let excluded = null;
    try {
      excluded = await rv.isExcludedFromRewards(claimant.address);
    } catch {
      // ignore if function not present
    }

    const lastNonZeroAt = await mmm.lastNonZeroAt(claimant.address);
    const lastClaimAt = await rv.lastClaimAt(claimant.address);
    const pending = await rv.pending(claimant.address);

    console.log("MON balance       :", ethers.formatEther(monBal), `(${monBal.toString()} wei)`);
    console.log("MMM balance       :", fmtWei(mmmBal, decimals), `(${mmmBal.toString()} raw)`);
    console.log("excluded          :", excluded === null ? "(no alias fn)" : fmtBool(excluded));
    console.log("mmm.lastNonZeroAt :", lastNonZeroAt.toString());
    console.log("rv.lastClaimAt    :", lastClaimAt.toString());
    console.log("rv.pending        :", fmtWei(pending, decimals), `(${pending.toString()} raw)`);
    console.log("");

    const canHeuristic = minHoldR.ok && cooldownR.ok && minBalR.ok;

    console.log("[Eligibility Heuristics]");
    if (!canHeuristic) {
      console.log(
        "Skipped (RewardVault getter missing/reverted):",
        !minHoldR.ok ? "minHoldTimeSec" : "",
        !cooldownR.ok ? "claimCooldown" : "",
        !minBalR.ok ? "minBalance" : ""
      );
      console.log("");
    } else {
      const latest2 = await ethers.provider.getBlock("latest");
      const nowTs = BigInt(latest2.timestamp);

      const lnz = BigInt(lastNonZeroAt);
      const mh = BigInt(minHoldR.v);
      const lc = BigInt(lastClaimAt);
      const cd = BigInt(cooldownR.v);
      const minBal = BigInt(minBalR.v);

      const holdOk = nowTs >= (lnz + mh);
      const balOk = BigInt(mmmBal) >= minBal;
      const cooldownOk = lc === 0n ? true : nowTs >= (lc + cd);
      const pendingOk = BigInt(pending) > 0n;

      console.log("minBalance OK:", fmtBool(balOk));
      console.log("holdTime OK :", fmtBool(holdOk), `(now=${nowTs} vs lnz+minHold=${lnz + mh})`);
      console.log("cooldown OK :", fmtBool(cooldownOk), lc === 0n ? "(first claim)" : `(now=${nowTs} vs last+cd=${lc + cd})`);
      console.log("pending > 0 :", fmtBool(pendingOk));
      console.log("");
    }
  }

  console.log("Preflight complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
