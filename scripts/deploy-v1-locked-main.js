// scripts/deploy-v1-locked-main.js
//
// Locked deployment pipeline (v1):
// - Deterministic MMMToken constructor enforcement (no guessing)
// - Mainnet guards: ROUTER must be non-zero + have code
// - Pair handling:
//    * If PAIR_ADDR is provided, it must have code and match factory.getPair(MMM, WMON)
//    * If PAIR_ADDR is not provided, script will create (or reuse) factory pair(MMM, WMON)
// - Taxes are enabled ONLY after pair is set
// - Writes a "flat format B" manifest to deployments/<network>/latest.json
//
// Usage:
//   # Testnet
//   $env:FACTORY_ADDR="0x..."   # optional on testnet if you supply PAIR_ADDR instead
//   $env:PAIR_ADDR="0x..."      # optional
//   $env:ROUTER_ADDR="0x0000000000000000000000000000000000000000"  # allowed on testnet
//   npx hardhat run --network monadTestnet scripts/deploy-v1-locked.js
//
//   # Mainnet (recommended)
//   $env:FACTORY_ADDR="0x182a927119d56008d921126764bf884221b10f59"
//   $env:ROUTER_ADDR="0x4b2ab38dbf28d31d467aa8993f6c2585981d6804"
//   $env:WMON_ADDR="0x75C95922181F9CC16c1Dd0e77Ce26e1BB425208f"   # verify!
//   npx hardhat run --network monadMainnet scripts/deploy-v1-locked.js
//
// Optional:
//   $env:DRYRUN="1"  (does not send tx, prints what it WOULD do)

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

function isProbablyMainnet(networkName, chainId) {
  if (optEnv("IS_MAINNET", "") === "1") return true;
  if (optEnv("IS_MAINNET", "") === "0") return false;

  const n = String(networkName || "").toLowerCase();
  if (n.includes("mainnet") && !n.includes("test")) return true;

  const mainChainId = optEnv("MAINNET_CHAIN_ID", "");
  if (mainChainId && String(chainId) === String(mainChainId)) return true;

  return false;
}

function assertNumericTokenString(s, label) {
  if (!/^[0-9]+$/.test(String(s))) {
    throw new Error(`${label} must be an integer string (digits only). Got: "${s}"`);
  }
}

function ctorSignature(factory) {
  const ctor = factory.interface.fragments.find((x) => x.type === "constructor");
  if (!ctor) return "constructor()";
  return `constructor(${(ctor.inputs || []).map((i) => `${i.type} ${i.name}`).join(", ")})`;
}

async function deployMMMTokenDeterministic({ name, symbol, supplyRaw, owner, dryrun }) {
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

  if (dryrun) {
    return {
      contract: null,
      address: "(dryrun)",
      usedArgs: args,
      ctorTypes: types,
      ctorNames: names,
    };
  }

  const c = await f.deploy(...args);
  await c.waitForDeployment();

  return {
    contract: c,
    address: await c.getAddress(),
    usedArgs: args,
    ctorTypes: types,
    ctorNames: names,
  };
}

async function main() {
  const dryrun = optEnv("DRYRUN", "") === "1";
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const networkName = hre.network.name;
  const chainId = Number(net.chainId);

  const isMainnet = isProbablyMainnet(networkName, chainId);

  // DEX + pair inputs
  // - ROUTER enforced on mainnet
  // - FACTORY + WMON required if we want the script to create/verify the pair automatically (recommended mainnet)
  const ROUTER_ADDR = mustEnv("MONAD_MAINNET_ROUTER");
  const FACTORY_ADDR = mustEnv("MONAD_MAINNET_FACTORY");
  const WMON_ADDR = mustEnv("WMON_ADDR");
  const PAIR_ADDR_ENV = optEnv("PAIR_ADDR", "");

  if (ROUTER_ADDR !== ethers.ZeroAddress && !isHexAddress(ROUTER_ADDR)) {
    throw new Error(`ROUTER_ADDR is not a valid address: ${ROUTER_ADDR}`);
  }
  if (FACTORY_ADDR && !isHexAddress(FACTORY_ADDR)) throw new Error(`FACTORY_ADDR is not a valid address: ${FACTORY_ADDR}`);
  if (WMON_ADDR && !isHexAddress(WMON_ADDR)) throw new Error(`WMON_ADDR is not a valid address: ${WMON_ADDR}`);
  if (PAIR_ADDR_ENV && !isHexAddress(PAIR_ADDR_ENV)) throw new Error(`PAIR_ADDR is not a valid address: ${PAIR_ADDR_ENV}`);

  // Mainnet guards
  if (isMainnet) {
    if (ROUTER_ADDR === ethers.ZeroAddress) {
      throw new Error(`Mainnet requires ROUTER_ADDR non-zero. Set ROUTER_ADDR in env.`);
    }
    const rCode = await codeAt(ROUTER_ADDR);
    if (rCode === "0x") throw new Error(`Mainnet requires ROUTER_ADDR to have code. Got 0x at ${ROUTER_ADDR}`);

    // For mainnet, strongly require FACTORY+WMON so we can create and lock the pair deterministically.
    if (!FACTORY_ADDR) throw new Error(`Mainnet requires FACTORY_ADDR (UniswapV2 Factory).`);
    if (!WMON_ADDR) throw new Error(`Mainnet requires WMON_ADDR (Wrapped MON) to create pair.`);
    const fCode = await codeAt(FACTORY_ADDR);
    if (fCode === "0x") throw new Error(`FACTORY_ADDR has no code at ${FACTORY_ADDR}`);
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

  // SUPPLY: default to 1B, integer tokens only.
  const SUPPLY_TOKENS = optEnv("MMM_SUPPLY_TOKENS", "1000000000");
  assertNumericTokenString(SUPPLY_TOKENS, "MMM_SUPPLY_TOKENS");
  const supplyRaw = ethers.parseUnits(SUPPLY_TOKENS, 18);

  console.log(`=== MMM v1 LOCKED DEPLOY (${networkName}) ===`);
  console.log("deployer  :", deployer.address);
  console.log("chainId   :", chainId);
  console.log("isMainnet :", isMainnet);
  console.log("dryrun    :", dryrun);
  console.log("DEX:", { FACTORY_ADDR: FACTORY_ADDR || "(none)", ROUTER_ADDR, WMON_ADDR: WMON_ADDR || "(none)", PAIR_ADDR: PAIR_ADDR_ENV || "(none)" });
  console.log("token     :", { MMM_NAME, MMM_SYMBOL });
  console.log("reward params:", {
    MIN_HOLD_SEC: MIN_HOLD_SEC.toString(),
    COOLDOWN_SEC: COOLDOWN_SEC.toString(),
    MIN_BALANCE: MIN_BALANCE.toString(),
  });
  console.log("tax params:", { BUY_TAX_BPS: BUY_TAX_BPS.toString(), SELL_TAX_BPS: SELL_TAX_BPS.toString() });
  console.log("supply:", { MMM_SUPPLY_TOKENS: SUPPLY_TOKENS, supplyRaw: supplyRaw.toString() });
  console.log("");

  // 1) Deploy MMMToken (deterministic)
  const mmmRes = await deployMMMTokenDeterministic({
    name: MMM_NAME,
    symbol: MMM_SYMBOL,
    supplyRaw,
    owner: deployer.address,
    dryrun,
  });

  const MMMToken = mmmRes.address !== "(dryrun)" ? mmmRes.address : "(dryrun)";
  console.log("MMMToken deployed :", MMMToken);
  console.log("MMMToken ctor types:", mmmRes.ctorTypes);
  console.log("MMMToken ctor names:", mmmRes.ctorNames);
  console.log(
    "MMMToken ctor args :",
    mmmRes.usedArgs.map((x) => (typeof x === "bigint" ? x.toString() : String(x)))
  );
  console.log("");

  if (dryrun) {
    console.log("DRYRUN=1: stopping before tx sends.");
    console.log("Tip: unset DRYRUN to execute deployment.");
    return;
  }

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

  const MMM = await ethers.getContractAt("MMMToken", MMMToken);

  // 5) Wire MMMToken -> TaxVault (one-time)
  {
    const tx = await MMM.setTaxVaultOnce(TaxVault);
    console.log("MMMToken.setTaxVaultOnce tx:", tx.hash);
    await tx.wait();
  }

  // 6) Router: mainnet required, testnet optional
  if (ROUTER_ADDR !== ethers.ZeroAddress) {
    const tx = await MMM.setRouter(ROUTER_ADDR);
    console.log("MMMToken.setRouter tx:", tx.hash);
    await tx.wait();
  } else {
    console.log("MMMToken.setRouter skipped (ROUTER_ADDR is zero; allowed on testnet)");
  }

  // 7) Pair resolution
  // If FACTORY+WMON present: use factory.getPair(MMM, WMON), create if absent.
  // Else, require PAIR_ADDR from env.
  let PAIR_ADDR = ethers.ZeroAddress;

  const hasFactoryPath = FACTORY_ADDR && WMON_ADDR;

  if (hasFactoryPath) {
    const factoryAbi = [
      "function getPair(address tokenA, address tokenB) external view returns (address pair)",
      "function createPair(address tokenA, address tokenB) external returns (address pair)",
    ];
    const factory = await ethers.getContractAt(factoryAbi, FACTORY_ADDR);

    let existing = await factory.getPair(MMMToken, WMON_ADDR);
    if (existing && existing !== ethers.ZeroAddress) {
      PAIR_ADDR = existing;
      console.log("Factory.getPair =>", PAIR_ADDR);
    } else {
      console.log("Factory.getPair => zero; creating pair...");
      const tx = await factory.createPair(MMMToken, WMON_ADDR);
      console.log("Factory.createPair tx:", tx.hash);
      await tx.wait();
      existing = await factory.getPair(MMMToken, WMON_ADDR);
      if (!existing || existing === ethers.ZeroAddress) {
        throw new Error("Pair create failed: getPair still zero after createPair");
      }
      PAIR_ADDR = existing;
      console.log("Factory.getPair (post-create) =>", PAIR_ADDR);
    }

    // If user provided PAIR_ADDR too, enforce match
    if (PAIR_ADDR_ENV && PAIR_ADDR_ENV.toLowerCase() !== PAIR_ADDR.toLowerCase()) {
      throw new Error(`PAIR_ADDR mismatch: env=${PAIR_ADDR_ENV} factory.getPair=${PAIR_ADDR}`);
    }

    const pairCode = await codeAt(PAIR_ADDR);
    if (pairCode === "0x") throw new Error(`Resolved PAIR_ADDR has no code: ${PAIR_ADDR}`);
  } else {
    if (!PAIR_ADDR_ENV) {
      throw new Error(
        "No pair path available. Provide either:\n" +
          "  (A) FACTORY_ADDR + WMON_ADDR (recommended), or\n" +
          "  (B) PAIR_ADDR (already-created pair address)"
      );
    }
    const pairCode = await codeAt(PAIR_ADDR_ENV);
    if (pairCode === "0x") throw new Error(`PAIR_ADDR has no code at ${PAIR_ADDR_ENV}`);
    PAIR_ADDR = PAIR_ADDR_ENV;
  }

  // 8) Set pair on token (required for tax classification)
  {
    const tx = await MMM.setPair(PAIR_ADDR);
    console.log("MMMToken.setPair tx:", tx.hash);
    await tx.wait();
  }

  // 9) Set taxes + enable (ONLY after pair is set)
  {
    const tx1 = await MMM.setTaxes(BUY_TAX_BPS, SELL_TAX_BPS);
    console.log("MMMToken.setTaxes tx:", tx1.hash);
    await tx1.wait();

    const tx2 = await MMM.setTaxesEnabled(true);
    console.log("MMMToken.setTaxesEnabled(true) tx:", tx2.hash);
    await tx2.wait();
  }

  // 10) Write locked manifest (Format B flat)
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
      FACTORY_ADDR: FACTORY_ADDR || undefined,
      ROUTER_ADDR: ROUTER_ADDR !== ethers.ZeroAddress ? ROUTER_ADDR : undefined,
      WMON_ADDR: WMON_ADDR || undefined,
      PAIR_ADDR: PAIR_ADDR !== ethers.ZeroAddress ? PAIR_ADDR : undefined,

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

  // Remove undefined keys for cleanliness
  Object.keys(manifest.params).forEach((k) => {
    if (manifest.params[k] === undefined) delete manifest.params[k];
  });

  const outDir = path.join(process.cwd(), "deployments", networkName);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "latest.json");
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

  console.log("");
  console.log("=== MANIFEST WRITTEN ===");
  console.log(outPath);

  // 11) Sanity readbacks
  console.log("");
  console.log("=== SANITY ===");
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
