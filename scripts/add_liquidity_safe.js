const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function fmt18(x) {
  return Number(ethers.formatUnits(x, 18)).toLocaleString(undefined, { maximumFractionDigits: 8 });
}

async function main() {
  const net = hre.network.name;

  // Load deployments (adjust if your filenames differ)
  const mmmPath   = path.join("deployments", `mmm.${net}.json`);
  const pairPath  = path.join("deployments", `pair.${net}.json`);
  const routerPath = path.join("deployments", `router_patched.${net}.json`);
  const wmonPath  = path.join("deployments", `wmon.${net}.json`);

  if (!fs.existsSync(mmmPath)) throw new Error(`Missing ${mmmPath}`);
  if (!fs.existsSync(pairPath)) throw new Error(`Missing ${pairPath}`);
  if (!fs.existsSync(routerPath)) throw new Error(`Missing ${routerPath}`);
  if (!fs.existsSync(wmonPath)) throw new Error(`Missing ${wmonPath}`);

  const { mmm } = readJson(mmmPath);
  const { pair } = readJson(pairPath);
  const { router } = readJson(routerPath);
  const { wmon } = readJson(wmonPath);

  const [signer] = await ethers.getSigners();

  console.log("Network:", net);
  console.log("Signer:", signer.address);
  console.log("MMM:", mmm);
  console.log("PAIR:", pair);
  console.log("Router:", router);
  console.log("WMON:", wmon);

  // Contracts
  const MMM = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", mmm);
  const Pair = await ethers.getContractAt("@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol:IUniswapV2Pair", pair);
  const Router = await ethers.getContractAt("PatchedV2Router02", router);

  // Identify token0/token1 and reserves
  const token0 = await Pair.token0();
  const token1 = await Pair.token1();
  const [r0, r1] = await Pair.getReserves();

  console.log("\n--- Pair tokens ---");
  console.log("token0:", token0);
  console.log("token1:", token1);

  // Map reserves to MMM/WMON
  let reserveMMM, reserveWMON;
  if (token0.toLowerCase() === mmm.toLowerCase() && token1.toLowerCase() === wmon.toLowerCase()) {
    reserveMMM = r0;
    reserveWMON = r1;
  } else if (token1.toLowerCase() === mmm.toLowerCase() && token0.toLowerCase() === wmon.toLowerCase()) {
    reserveMMM = r1;
    reserveWMON = r0;
  } else {
    throw new Error("PAIR is not MMM/WMON. Check deployments.");
  }

  console.log("\n--- Reserves ---");
  console.log("reserve MMM :", fmt18(reserveMMM));
  console.log("reserve WMON:", fmt18(reserveWMON));

  if (reserveMMM === 0n || reserveWMON === 0n) {
    console.log("\nPool looks empty. You can set ANY initial ratio.");
  } else {
    // price: MMM per 1 MON (approx)
    const mmmPerMon = (reserveMMM * 10n**18n) / reserveWMON;
    console.log("\nImplied price ~ MMM per 1 MON:", fmt18(mmmPerMon));
  }

  // === USER INPUTS ===
  // Choose ONE of these: set desired MON, and compute MMM to match pool ratio
  const DESIRED_MON = "1.0"; // you want to add 1 MON
  const monIn = ethers.parseEther(DESIRED_MON);

  // Compute matching MMM amount from reserves ratio (if pool has reserves)
  let mmmIn;
  if (reserveMMM === 0n || reserveWMON === 0n) {
    // for an empty pool, pick your own ratio
    const DESIRED_MMM = "1000";
    mmmIn = ethers.parseUnits(DESIRED_MMM, 18);
    console.log("\nEmpty pool: using manual MMM:", DESIRED_MMM);
  } else {
    // MMM needed = MON_in * reserveMMM / reserveWMON
    mmmIn = (monIn * reserveMMM) / reserveWMON;
    console.log("\nFor", DESIRED_MON, "MON, matching MMM is ~", fmt18(mmmIn), "MMM");
  }

  // Slippage mins (set loose while debugging)
  const SLIPPAGE_BPS = 500; // 5%
  const minMMM = (mmmIn * BigInt(10000 - SLIPPAGE_BPS)) / 10000n;
  const minMON = (monIn * BigInt(10000 - SLIPPAGE_BPS)) / 10000n;

  // Balances
  const balMMM = await MMM.balanceOf(signer.address);
  const balMON = await ethers.provider.getBalance(signer.address);

  console.log("\n--- Balances ---");
  console.log("MMM:", fmt18(balMMM));
  console.log("MON:", ethers.formatEther(balMON));

  if (balMMM < mmmIn) throw new Error("Insufficient MMM for this ratio-based add.");
  if (balMON < monIn) throw new Error("Insufficient MON.");

  // Approve MMM to router
  const allowance = await MMM.allowance(signer.address, router);
  if (allowance < mmmIn) {
    console.log("\nApproving router for MMM...");
    const txA = await MMM.approve(router, mmmIn);
    await txA.wait();
    console.log("Approved.");
  } else {
    console.log("\nAllowance OK.");
  }

  // Sanity: router WETH should equal WMON
  const routerWETH = await Router.WETH();
  console.log("\nRouter.WETH():", routerWETH);
  if (routerWETH.toLowerCase() !== wmon.toLowerCase()) {
    throw new Error("Router.WETH() != WMON deployment. Wrong router or wrong WMON.");
  }

  console.log("\nAdding liquidity with ratio-consistent amounts:");
  console.log("MMM in:", fmt18(mmmIn));
  console.log("MON in:", ethers.formatEther(monIn));
  console.log("minMMM:", fmt18(minMMM));
  console.log("minMON:", ethers.formatEther(minMON));

  const deadline = Math.floor(Date.now() / 1000) + 600;

  // Call addLiquidityETH (router wraps MON -> WMON automatically)
  const tx = await Router.addLiquidityETH(
    mmm,
    mmmIn,
    minMMM,
    minMON,
    signer.address,
    deadline,
    { value: monIn }
  );

  console.log("tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("✅ Added liquidity. Gas used:", receipt.gasUsed.toString());
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
