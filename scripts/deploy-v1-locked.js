// scripts/deploy-v1-locked.js
//
// Locked v1 deploy:
// - Deterministic MMMToken constructor enforcement (no guessing)
// - Writes a flat manifest (Format B) to deployments/<network>/latest.json
// - Router enforcement ONLY on mainnet (chainId 143 or network name contains "mainnet")
// - On mainnet, ROUTER_ADDR is resolved from MONAD_MAINNET_ROUTER first (then ROUTER_ADDR)
// - Pair must have code (tax logic depends on recognizing pair)
//
// Usage:
//   npx hardhat run --network monadTestnet scripts/deploy-v1-locked.js
//   npx hardhat run --network monadMainnet scripts/deploy-v1-locked.js
//
// Required env:
//   PRIVATE_KEY
//   PAIR_ADDR                 (must be a deployed pair contract address)
//   MMM_SUPPLY_TOKENS         (integer string; default 1000000000)
// Optional env:
//   MMM_NAME, MMM_SYMBOL
//   MIN_HOLD_SEC, COOLDOWN_SEC, MIN_BALANCE
//   BUY_TAX_BPS, SELL_TAX_BPS
//
// Mainnet-only env (required on mainnet):
//   MONAD_MAINNET_ROUTER      (preferred)
//   MONAD_MAINNET_FACTORY     (recommended, not required by this script)
//
// Notes:
// - This script assumes TaxVault constructor: (address mmmToken, address initialOwner)
// - RewardVault constructor: (address _mmm, address _taxVault, uint48 minHold, uint48 cooldown, uint256 minBal, address initialOwner)
// - MMMToken constructor: (string name_, string symbol_, uint256 initialSupply, address owner_)

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function mustEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}
function optEnv(k, d = "") {
  const v = process.env[k];
  return v === undefined || v === null || v === "" ? d : v;
}

function isHexAddress(a) {
  return typeof a === "string" && /^0x[a-fA-F0-9]{40}$/.test(a);
}
function isNonZeroAddress(a) {
  return isHexAddress(a) && a.toLowerCase() !== ethers.ZeroAddress;
}

async function codeAt(addr) {
  if (!addr || addr === ethers.ZeroAddress) return "0x";
  return await ethers.provider.getCode(addr);
}

function keccakHex(hex) {
  if (!hex || hex === "0x") return ethers.ZeroHash;
  return ethers.keccak256(hex);
}

function nowIso() {
  return new Date().toISOString();
}

function safeGitCommit() {
  try {
    const out = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (/^[a-f0-9]{40}$/i.test(out)) return out;
    return "";
  } catch {
    return "";
  }
}

function normalizeName(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function assertNumericTokenString(s, label) {
  // allow integers only for supply tokens in this pipeline (avoid decimals surprises)
  if (!/^[0-9]+$/.test(String(s))) {
    throw new Error(`${label} must be an integer string (digits only). Got: "${s}"`);
  }
}

function ctorSignature(factory) {
  const ctor = factory.interface.fragments.find((x) => x.type === "constructor");
  if (!ctor) return "constructor()";
  return `constructor(${(ctor.inputs || []).map((i) => `${i.type} ${i.name}`).join(", ")})`;
}

/**
 * Deterministic MMMToken deploy:
 * - If constructor matches (string,string,uint256,address), deploy EXACTLY with (name,symbol,supply,owner)
 * - Otherwise, fail loudly with the detected signature.
 */
async function deployMMMTokenDeterministic({ name, symbol, supplyRaw, owner }) {
  const f = await ethers.getContractFactory("MMMToken");
  const ctor = f.interface.fragments.find((x) => x.type === "constructor");
  const inputs = ctor?.inputs ?? [];
  const types = inputs.map((i) => i.type);
  const names = inputs.map((i) => i.name || "");

  const expected = ["string", "string", "uint256", "address"];
  const matches =
    inputs.length === 4 &&
    types[0] === expected[0] &&
    types[1] === expected[1] &&
    types[2] === expected[2] &&
    types[3] === expected[3];

  if (!matches) {
    throw new Error(
      [
        `MMMToken constructor mismatch for locked deploy.`,
        `Detected: ${ctorSignature(f)}`,
        `Expected: constructor(string name_, string symbol_, uint256 initialSupply, address owner_)`,
        `Fix: update deploy script to match actual constructor once (no guessing).`,
      ].join("\n")
    );
  }

  const args = [name, symbol, supplyRaw, owner];
  const c = await f.deploy(...args);
  await c.waitForDeployment();

  return {
    contract: c,
    usedArgs: args,
    ctorTypes: types,
    ctorNames: names,
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const networkName = hre.network.name;
  const chainId = Number(net.chainId);

  // Mainnet detection (strong + explicit)
  const isMainnet = chainId === 143 || /mainnet/i.test(String(networkName));

  // Pair is mandatory (tax logic recognizes buys/sells vs transfers)
  const PAIR_ADDR = mustEnv("PAIR_ADDR");
  if (!isHexAddress(PAIR_ADDR)) throw new Error(`PAIR_ADDR is not a valid address: ${PAIR_ADDR}`);

  // Router resolution (this is the critical piece you requested)
  // - On mainnet: require non-zero router, prefer MONAD_MAINNET_ROUTER, fallback ROUTER_ADDR
  // - On testnet: allow zero
  let ROUTER_ADDR = optEnv("ROUTER_ADDR", "");
  if (isMainnet) {
    ROUTER_ADDR = optEnv("MONAD_MAINNET_ROUTER", ROUTER_ADDR);
    if (!isNonZeroAddress(ROUTER_ADDR)) {
      throw new Error(
        `Mainnet deployment requires ROUTER_ADDR non-zero.\n` +
          `Set MONAD_MAINNET_ROUTER (preferred) or ROUTER_ADDR in env.`
      );
    }
  } else {
    if (!isNonZeroAddress(ROUTER_ADDR)) ROUTER_ADDR = ethers.ZeroAddress;
  }

  // Validate pair code exists
  const pCode = await codeAt(PAIR_ADDR);
  if (pCode === "0x") {
    throw new Error(`PAIR_ADDR has no code at ${PAIR_ADDR}. Provide a valid Pair contract address.`);
  }

  // Enforce router code on mainnet (optional on testnet)
  if (isMainnet) {
    const rCode = await codeAt(ROUTER_ADDR);
    if (rCode === "0x") {
      throw new Error(`Mainnet deployment requires ROUTER_ADDR to have code. Got 0x at ${ROUTER_ADDR}`);
    }
  } else {
    if (ROUTER_ADDR !== ethers.ZeroAddress) {
      const rCode = await codeAt(ROUTER_ADDR);
      if (rCode === "0x") throw new Error(`ROUTER_ADDR provided but has no code: ${ROUTER_ADDR}`);
    }
  }

  // Token identity
  const MMM_NAME = optEnv("MMM_NAME", "Monad Money Machine");
  const MMM_SYMBOL = optEnv("MMM_SYMBOL", "MMM");

  // Params
  const MIN_HOLD_SEC = BigInt(optEnv("MIN_HOLD_SEC", "43200"));
  const COOLDOWN_SEC = BigInt(optEnv("COOLDOWN_SEC", "43200"));
  const MIN_BALANCE = BigInt(optEnv("MIN_BALANCE", ethers.parseUnits("1", 18).toString()));
  const BUY_TAX_BPS = BigInt(optEnv("BUY_TAX_BPS", "500"));
  const SELL_TAX_BPS = BigInt(optEnv("SELL_TAX_BPS", "500"));

  // SUPPLY: default to 1B, but allow override. Must be integer digits only.
  const SUPPLY_TOKENS = optEnv("MMM_SUPPLY_TOKENS", "1000000000");
  assertNumericTokenString(SUPPLY_TOKENS, "MMM_SUPPLY_TOKENS");
  const supplyRaw = ethers.parseUnits(SUPPLY_TOKENS, 18);

  // Optional dry-run (no tx)
  const DRYRUN = optEnv("DRYRUN", "") === "1";

  console.log(`=== MMM v1 LOCKED DEPLOY (${networkName}) ===`);
  console.log("deployer   :", deployer.address);
  console.log("chainId    :", chainId);
  console.log("isMainnet  :", isMainnet);
  console.log("PAIR_ADDR  :", PAIR_ADDR);
  console.log("ROUTER_ADDR:", ROUTER_ADDR);
  console.log("token      :", { MMM_NAME, MMM_SYMBOL });
  console.log("reward params:", {
    MIN_HOLD_SEC: MIN_HOLD_SEC.toString(),
    COOLDOWN_SEC: COOLDOWN_SEC.toString(),
    MIN_BALANCE: MIN_BALANCE.toString(),
  });
  console.log("tax params:", { BUY_TAX_BPS: BUY_TAX_BPS.toString(), SELL_TAX_BPS: SELL_TAX_BPS.toString() });
  console.log("supply:", { MMM_SUPPLY_TOKENS: SUPPLY_TOKENS, supplyRaw: supplyRaw.toString() });
  console.log("");

  if (DRYRUN) {
    console.log("DRYRUN=1 — exiting before deployment (no transactions).");
    return;
  }

  // 1) Deploy MMMToken (deterministic)
  const { contract: mmm, usedArgs, ctorTypes, ctorNames } = await deployMMMTokenDeterministic({
    name: MMM_NAME,
    symbol: MMM_SYMBOL,
    supplyRaw,
    owner: deployer.address,
  });

  const MMMToken = await mmm.getAddress();
  console.log("MMMToken deployed :", MMMToken);
  console.log("MMMToken ctor types:", ctorTypes);
  console.log("MMMToken ctor names:", ctorNames);
  console.log(
    "MMMToken ctor args :",
    usedArgs.map((x) => (typeof x === "bigint" ? x.toString() : String(x)))
  );
  console.log("");

  // 2) Deploy TaxVault(address mmmToken, address initialOwner)
  const TaxVaultFactory = await ethers.getContractFactory("TaxVault");
  const tv = await TaxVaultFactory.deploy(MMMToken, deployer.address);
  await tv.waitForDeployment();
  const TaxVault = await tv.getAddress();
  console.log("TaxVault deployed :", TaxVault);

  // 3) Deploy RewardVault(address _mmm, address _taxVault, uint48 minHold, uint48 cooldown, uint256 minBal, address initialOwner)
  const RewardVaultFactory = await ethers.getContractFactory("RewardVault");
  const rv = await RewardVaultFactory.deploy(
    MMMToken,
    TaxVault,
    Number(MIN_HOLD_SEC),
    Number(COOLDOWN_SEC),
    MIN_BALANCE,
    deployer.address
  );
  await rv.waitForDeployment();
  const RewardVault = await rv.getAddress();
  console.log("RewardVault deployed:", RewardVault);

  // 4) Wire TaxVault -> RewardVault
  {
    const tx = await tv.setRewardVaultOnce(RewardVault);
    console.log("TaxVault.setRewardVaultOnce tx:", tx.hash);
    await tx.wait();
  }

  // 5) Wire MMMToken -> TaxVault (one-time)
  {
    const MMM = await ethers.getContractAt("MMMToken", MMMToken);
    const tx = await MMM.setTaxVaultOnce(TaxVault);
    console.log("MMMToken.setTaxVaultOnce tx:", tx.hash);
    await tx.wait();
  }

  // 6) Set pair
  {
    const MMM = await ethers.getContractAt("MMMToken", MMMToken);
    const tx = await MMM.setPair(PAIR_ADDR);
    console.log("MMMToken.setPair tx:", tx.hash);
    await tx.wait();
  }

  // 7) Set router
  // - On mainnet: always set (enforced non-zero)
  // - On testnet: set only if non-zero
  if (ROUTER_ADDR !== ethers.ZeroAddress) {
    const MMM = await ethers.getContractAt("MMMToken", MMMToken);
    const tx = await MMM.setRouter(ROUTER_ADDR);
    console.log("MMMToken.setRouter tx:", tx.hash);
    await tx.wait();
  } else {
    console.log("MMMToken.setRouter skipped (ROUTER_ADDR is zero; allowed on testnet)");
  }

  // 8) Set taxes + enable
  {
    const MMM = await ethers.getContractAt("MMMToken", MMMToken);
    const tx1 = await MMM.setTaxes(BUY_TAX_BPS, SELL_TAX_BPS);
    console.log("MMMToken.setTaxes tx:", tx1.hash);
    await tx1.wait();

    const tx2 = await MMM.setTaxesEnabled(true);
    console.log("MMMToken.setTaxesEnabled(true) tx:", tx2.hash);
    await tx2.wait();
  }

  // 9) Write locked manifest (Format B flat)
  const mmmCode = await codeAt(MMMToken);
  const tvCode = await codeAt(TaxVault);
  const rvCode = await codeAt(RewardVault);

  const manifest = {
    chainId,
    network: networkName,
    deployer: deployer.address,
    timestamp: nowIso(),

    MMMToken,
    TaxVault,
    RewardVault,

    params: {
      PAIR_ADDR,
      ...(ROUTER_ADDR !== ethers.ZeroAddress ? { ROUTER_ADDR } : {}),
      BUY_TAX_BPS: Number(BUY_TAX_BPS),
      SELL_TAX_BPS: Number(SELL_TAX_BPS),
      MIN_HOLD_SEC: Number(MIN_HOLD_SEC),
      COOLDOWN_SEC: Number(COOLDOWN_SEC),
      MIN_BALANCE: MIN_BALANCE.toString(),
      MMM_SUPPLY_TOKENS: SUPPLY_TOKENS,
      MMM_NAME,
      MMM_SYMBOL,
    },

    build: {
      gitCommit: safeGitCommit() || "",
      mmmTokenBytecodeHash: keccakHex(mmmCode),
      taxVaultBytecodeHash: keccakHex(tvCode),
      rewardVaultBytecodeHash: keccakHex(rvCode),
    },
  };

  const outDir = path.join(process.cwd(), "deployments", networkName);
  fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, "latest.json");
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log("");
  console.log("=== MANIFEST WRITTEN ===");
  console.log(outPath);

  // 10) Sanity readbacks
  console.log("");
  console.log("=== SANITY ===");
  const MMM = await ethers.getContractAt("MMMToken", MMMToken);
  const tv2 = await ethers.getContractAt("TaxVault", TaxVault);
  const rv2 = await ethers.getContractAt("RewardVault", RewardVault);

  console.log("MMMToken.taxVault():", await MMM.taxVault());
  console.log("MMMToken.pair():", await MMM.pair());
  console.log("MMMToken.router():", await MMM.router());
  console.log("MMMToken.taxesEnabled():", await MMM.taxesEnabled());

  console.log("TaxVault.rewardVaultSet():", await tv2.rewardVaultSet());
  console.log("TaxVault.rewardVault():", await tv2.rewardVault());

  console.log("RewardVault.mmm():", await rv2.mmm());
  console.log("RewardVault.taxVault():", await rv2.taxVault());
  console.log("RewardVault.claimCooldown():", (await rv2.claimCooldown()).toString());
  console.log("RewardVault.minHoldTimeSec():", (await rv2.minHoldTimeSec()).toString());
  console.log("RewardVault.minBalance():", (await rv2.minBalance()).toString());

  // Strict sanity
  if ((await MMM.taxVault()).toLowerCase() !== TaxVault.toLowerCase()) throw new Error("Sanity fail: MMM.taxVault != TaxVault");
  if ((await MMM.pair()).toLowerCase() !== PAIR_ADDR.toLowerCase()) throw new Error("Sanity fail: MMM.pair != PAIR_ADDR");
  if ((await tv2.rewardVault()).toLowerCase() !== RewardVault.toLowerCase()) throw new Error("Sanity fail: TaxVault.rewardVault != RewardVault");
  if ((await rv2.mmm()).toLowerCase() !== MMMToken.toLowerCase()) throw new Error("Sanity fail: RewardVault.mmm != MMMToken");
  if ((await rv2.taxVault()).toLowerCase() !== TaxVault.toLowerCase()) throw new Error("Sanity fail: RewardVault.taxVault != TaxVault");

  if (isMainnet) {
    const r = await MMM.router();
    if (r === ethers.ZeroAddress) throw new Error("Sanity fail: mainnet router is zero");
    if (r.toLowerCase() !== ROUTER_ADDR.toLowerCase()) throw new Error("Sanity fail: MMM.router != ROUTER_ADDR");
  }

  console.log("");
  console.log("=== DONE (LOCKED) ===");
  console.log("Manifest:", outPath);
  console.log("");
  console.log("Next (recommended):");
  console.log(`  $env:MANIFEST="deployments\\${networkName}\\latest.json"`);
  console.log(`  npx hardhat run --network ${networkName} scripts/preflight-from-manifest.js`);
  console.log(`  npx hardhat run --network ${networkName} scripts/assert-manifest.js`);
  console.log(`  npx hardhat run --network ${networkName} scripts/stamp-manifest.js`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
