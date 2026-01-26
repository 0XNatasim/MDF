// scripts/deploy-v1-locked-testnet-mocks.js
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
function nowIso() { return new Date().toISOString(); }

function safeGitCommit() {
  try {
    const out = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return /^[a-f0-9]{40}$/i.test(out) ? out : "";
  } catch { return ""; }
}
function isHexAddress(a) { return typeof a === "string" && /^0x[a-fA-F0-9]{40}$/.test(a); }

async function codeAt(addr) {
  if (!addr || addr === ethers.ZeroAddress) return "0x";
  return await ethers.provider.getCode(addr);
}
function keccakHex(hex) {
  if (!hex || hex === "0x") return ethers.ZeroHash;
  return ethers.keccak256(hex);
}
function assertNumericTokenString(s, label) {
  if (!/^[0-9]+$/.test(String(s))) throw new Error(`${label} must be integer string. Got "${s}"`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const networkName = hre.network.name;
  const chainId = Number(net.chainId);

  const DRYRUN = optEnv("DRYRUN", "") === "1";

  // Token identity
  const MMM_NAME = optEnv("MMM_NAME", "Monad Money Machine");
  const MMM_SYMBOL = optEnv("MMM_SYMBOL", "MMM");

  // Supply (1B default)
  const MMM_SUPPLY_TOKENS = optEnv("MMM_SUPPLY_TOKENS", "1000000000");
  assertNumericTokenString(MMM_SUPPLY_TOKENS, "MMM_SUPPLY_TOKENS");
  const supplyRaw = ethers.parseUnits(MMM_SUPPLY_TOKENS, 18);

  // Reward params
  const MIN_HOLD_SEC = BigInt(optEnv("MIN_HOLD_SEC", "43200"));
  const COOLDOWN_SEC = BigInt(optEnv("COOLDOWN_SEC", "43200"));
  const MIN_BALANCE = BigInt(optEnv("MIN_BALANCE", ethers.parseUnits("1", 18).toString()));

  // Taxes (still 5% buy/sell as before)
  const BUY_TAX_BPS = BigInt(optEnv("BUY_TAX_BPS", "500"));
  const SELL_TAX_BPS = BigInt(optEnv("SELL_TAX_BPS", "500"));

  // 2-of-3 owners (use your env addresses)
  const OWNER1 = mustEnv("DOPTESTNET"); // deployer
  const OWNER2 = mustEnv("TESTER");
  const OWNER3 = mustEnv("CLAIMER");

  if (![OWNER1, OWNER2, OWNER3].every(isHexAddress)) {
    throw new Error("Multisig owners must be valid addresses (DOPTESTNET/TESTER/CLAIMER).");
  }

  console.log(`=== MMM v1 TESTNET LOCKED DEPLOY (WITH MOCK DEX) (${networkName}) ===`);
  console.log("deployer:", deployer.address);
  console.log("chainId :", chainId);
  console.log("dryrun  :", DRYRUN);
  console.log("token   :", { MMM_NAME, MMM_SYMBOL, MMM_SUPPLY_TOKENS });
  console.log("reward  :", { MIN_HOLD_SEC: MIN_HOLD_SEC.toString(), COOLDOWN_SEC: COOLDOWN_SEC.toString(), MIN_BALANCE: MIN_BALANCE.toString() });
  console.log("taxes   :", { BUY_TAX_BPS: BUY_TAX_BPS.toString(), SELL_TAX_BPS: SELL_TAX_BPS.toString() });
  console.log("multisig:", { OWNER1, OWNER2, OWNER3 });
  console.log("");

  // -------------------------
  // 1) Deploy mocks: USDC (6), WMON (18), Router
  // -------------------------
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const MockRouter = await ethers.getContractFactory("MockRouter");

  if (DRYRUN) {
    console.log("DRYRUN=1: stopping before tx sends (mocks + suite).");
    return;
  }

  const usdc = await MockERC20.deploy("Mock USDC", "mUSDC", 6, deployer.address);
  await usdc.waitForDeployment();
  const USDC = await usdc.getAddress();

  const wmon = await MockERC20.deploy("Mock Wrapped MON", "mWMON", 18, deployer.address);
  await wmon.waitForDeployment();
  const WMON = await wmon.getAddress();

  const router = await MockRouter.deploy(deployer.address);
  await router.waitForDeployment();
  const ROUTER = await router.getAddress();

  console.log("[Mocks]");
  console.log("USDC  :", USDC);
  console.log("WMON  :", WMON);
  console.log("Router:", ROUTER);
  console.log("LP    :", await router.lpToken());
  console.log("");

  // Mint inventory so router can pay out swaps (MMM->...->USDC)
  // Give router a big USDC balance
  const usdcMintToRouter = 50_000_000n * 10n ** 6n; // 50,000,000 USDC (6 decimals) as inventory
  let tx = await usdc.mint(ROUTER, usdcMintToRouter);
  await tx.wait();

  // Give deployer some USDC too (optional)
  tx = await usdc.mint(deployer.address, 1_000_000n * 10n ** 6n);
  await tx.wait();

  // -------------------------
  // 2) Deploy MMMToken
  // -------------------------
  const MMMTokenFactory = await ethers.getContractFactory("MMMToken");
  const mmm = await MMMTokenFactory.deploy(MMM_NAME, MMM_SYMBOL, supplyRaw, deployer.address);
  await mmm.waitForDeployment();
  const MMM = await mmm.getAddress();
  console.log("[Core]");
  console.log("MMMToken:", MMM);

  // -------------------------
  // 3) Deploy RewardVault
  // -------------------------
  const RewardVaultFactory = await ethers.getContractFactory("RewardVault");
  const rv = await RewardVaultFactory.deploy(
    MMM,
    Number(MIN_HOLD_SEC),
    Number(COOLDOWN_SEC),
    MIN_BALANCE,
    deployer.address
  );
  await rv.waitForDeployment();
  const RewardVault = await rv.getAddress();
  console.log("RewardVault:", RewardVault);

  // -------------------------
  // 4) Deploy BoostVault (USDC)
  // -------------------------
  const BoostVaultFactory = await ethers.getContractFactory("BoostVault");
  const bv = await BoostVaultFactory.deploy(USDC, deployer.address);
  await bv.waitForDeployment();
  const BoostVault = await bv.getAddress();
  console.log("BoostVault:", BoostVault);

  // -------------------------
  // 5) Deploy SwapVault (MMM/WMON)
  // -------------------------
  const SwapVaultFactory = await ethers.getContractFactory("SwapVault");
  const sv = await SwapVaultFactory.deploy(MMM, WMON, deployer.address);
  await sv.waitForDeployment();
  const SwapVault = await sv.getAddress();
  console.log("SwapVault:", SwapVault);

  // -------------------------
  // 6) Deploy MarketingVault + TeamVestingVault (2-of-3)
  // -------------------------
  const ownersArr = [OWNER1, OWNER2, OWNER3];

  const MarketingVaultFactory = await ethers.getContractFactory("MarketingVault");
  const mv = await MarketingVaultFactory.deploy(USDC, ownersArr);
  await mv.waitForDeployment();
  const MarketingVault = await mv.getAddress();
  console.log("MarketingVault:", MarketingVault);

  const TeamVestingVaultFactory = await ethers.getContractFactory("TeamVestingVault");
  const tvv = await TeamVestingVaultFactory.deploy(USDC, ownersArr);
  await tvv.waitForDeployment();
  const TeamVestingVault = await tvv.getAddress();
  console.log("TeamVestingVault:", TeamVestingVault);

  // -------------------------
  // 7) Deploy NFTs (Common + Rare)
  // -------------------------
  const CommonNFTFactory = await ethers.getContractFactory("CommonBoostNFT");
  const cn = await CommonNFTFactory.deploy(deployer.address);
  await cn.waitForDeployment();
  const CommonNFT = await cn.getAddress();

  const RareNFTFactory = await ethers.getContractFactory("RareBoostNFT");
  const rn = await RareNFTFactory.deploy(deployer.address);
  await rn.waitForDeployment();
  const RareNFT = await rn.getAddress();

  console.log("[NFTs]");
  console.log("CommonNFT:", CommonNFT);
  console.log("RareNFT  :", RareNFT);
  console.log("");

  // -------------------------
  // 8) Deploy TaxVault (needs MMM, USDC, WMON) and wire everything
  // -------------------------
  const TaxVaultFactory = await ethers.getContractFactory("TaxVault");
  const taxV = await TaxVaultFactory.deploy(MMM, USDC, WMON, deployer.address);
  await taxV.waitForDeployment();
  const TaxVault = await taxV.getAddress();
  console.log("[TaxVault]");
  console.log("TaxVault:", TaxVault);

  // Wire tax vault destinations
  tx = await taxV.setRouter(ROUTER);
  await tx.wait();

  tx = await taxV.wireOnce(RewardVault, BoostVault, SwapVault, MarketingVault, TeamVestingVault);
  await tx.wait();

  // SwapVault wires
  tx = await sv.setRouter(ROUTER);
  await tx.wait();

  tx = await sv.setTaxVaultOnce(TaxVault);
  await tx.wait();

  // RewardVault <-> BoostVault wires
  tx = await bv.setRewardVaultOnce(RewardVault);
  await tx.wait();

  tx = await rv.setBoostVaultOnce(BoostVault);
  await tx.wait();

  // BoostVault NFT wiring
  tx = await bv.setNFTs(CommonNFT, RareNFT);
  await tx.wait();

  // MMMToken wires
  tx = await mmm.setTaxVaultOnce(TaxVault);
  await tx.wait();

  // setRouter on MMMToken (optional but matches your prior layout)
  tx = await mmm.setRouter(ROUTER);
  await tx.wait();

  // -------------------------
  // 9) Create + set a mock Pair (MMM/WMON)
  // -------------------------
  const MockPair = await ethers.getContractFactory("MockPair");
  const pair = await MockPair.deploy(MMM, WMON);
  await pair.waitForDeployment();
  const PAIR = await pair.getAddress();

  tx = await mmm.setPair(PAIR);
  await tx.wait();

  // Set taxes and enable
  tx = await mmm.setTaxes(BUY_TAX_BPS, SELL_TAX_BPS);
  await tx.wait();

  tx = await mmm.setTaxesEnabled(true);
  await tx.wait();

  console.log("[MockPair]");
  console.log("PAIR:", PAIR);
  console.log("");

  // -------------------------
  // 10) Write manifest (flat format)
  // -------------------------
  const mmmCode = await codeAt(MMM);
  const taxCode = await codeAt(TaxVault);
  const rvCode = await codeAt(RewardVault);
  const bvCode = await codeAt(BoostVault);
  const svCode = await codeAt(SwapVault);

  const manifest = {
    chainId,
    network: networkName,
    deployer: deployer.address,
    timestamp: nowIso(),

    // core suite
    MMMToken: MMM,
    TaxVault,
    RewardVault,
    BoostVault,
    SwapVault,
    MarketingVault,
    TeamVestingVault,

    // mocks
    mocks: {
      USDC,
      WMON,
      ROUTER,
      PAIR,
      LP: await router.lpToken(),
    },

    // NFTs
    nfts: {
      CommonNFT,
      RareNFT,
      commonMultiplierBps: 10500,
      rareMultiplierBps: 11500,
    },

    params: {
      MMM_NAME,
      MMM_SYMBOL,
      MMM_SUPPLY_TOKENS,
      MIN_HOLD_SEC: Number(MIN_HOLD_SEC),
      COOLDOWN_SEC: Number(COOLDOWN_SEC),
      MIN_BALANCE: MIN_BALANCE.toString(),
      BUY_TAX_BPS: Number(BUY_TAX_BPS),
      SELL_TAX_BPS: Number(SELL_TAX_BPS),

      // split of tax pot (bps-of-pot)
      SPLIT_BPS: {
        REWARD: 4000,
        BOOST: 2500,
        LIQ: 1500,
        BURN: 1000,
        MARKETING: 700,
        TEAM: 300,
      },

      LIQ_PAIR: "MMM/WMON",
      USDC_DECIMALS: 6,
    },

    build: {
      gitCommit: safeGitCommit() || "",
      mmmTokenBytecodeHash: keccakHex(mmmCode),
      taxVaultBytecodeHash: keccakHex(taxCode),
      rewardVaultBytecodeHash: keccakHex(rvCode),
      boostVaultBytecodeHash: keccakHex(bvCode),
      swapVaultBytecodeHash: keccakHex(svCode),
    },
  };

  const outDir = path.join(process.cwd(), "deployments", networkName);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "latest.json");
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

  console.log("=== MANIFEST WRITTEN ===");
  console.log(outPath);
  console.log("");

  console.log("=== QUICK SANITY ===");
  console.log("MMM.taxVault():", await mmm.taxVault());
  console.log("MMM.pair():", await mmm.pair());
  console.log("MMM.router():", await mmm.router());
  console.log("MMM.taxesEnabled():", await mmm.taxesEnabled());
  console.log("TaxVault.router():", await taxV.router());
  console.log("RewardVault.boostVault():", await rv.boostVault());
  console.log("BoostVault.rewardVault():", await bv.rewardVault());
  console.log("SwapVault.taxVault():", await sv.taxVault());
  console.log("");

  console.log("DONE. Next:");
  console.log(`  $env:MANIFEST="deployments\\${networkName}\\latest.json"`);
  console.log(`  npx hardhat run --network ${networkName} scripts/preflight-from-manifest.js`);
  console.log(`  npx hardhat run --network ${networkName} scripts/assert-manifest.js`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
