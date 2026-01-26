// scripts/create-pool-fixed.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;

  // === REQUIRED (your deployed token) ===
  const MMM_ADDRESS = "0xE4bAA11CAb36579165b983da4cd42D01220D4786";

  // === Monad testnet canonical addresses (or from .env) ===
  const ROUTER_ADDR  = process.env.UNISWAP_ROUTER  || "0xfb8e1c3b833f9e67a71c859a132cf783b645e436";
  const WMON_ADDRESS = process.env.WMON           || "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541";
  const FACTORY_ADDR = process.env.UNISWAP_FACTORY|| "0x733e88f248b742db6c14c0b1713af5ad7fdd59d0";

  const [user] = await ethers.getSigners();
  const provider = ethers.provider;

  console.log("Using wallet:", user.address);
  console.log("Network:", hre.network.name);
  console.log("MMM:", MMM_ADDRESS);
  console.log("Router:", ROUTER_ADDR);
  console.log("Factory:", FACTORY_ADDR);
  console.log("WMON:", WMON_ADDRESS);

  // ---- ABIs ----
  const MMM_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
  ];

  const ROUTER_ABI = [
    "function addLiquidityETH(address token,uint amountTokenDesired,uint amountTokenMin,uint amountETHMin,address to,uint deadline) external payable returns (uint amountToken,uint amountETH,uint liquidity)",
    "function WETH() view returns (address)"
  ];

  const FACTORY_ABI = [
    "function getPair(address tokenA, address tokenB) view returns (address pair)"
  ];

  // Instances
  const router  = new ethers.Contract(ROUTER_ADDR, ROUTER_ABI, user);
  const factory = new ethers.Contract(FACTORY_ADDR, FACTORY_ABI, provider);
  const mmm     = new ethers.Contract(MMM_ADDRESS, MMM_ABI, user);

  // Bytecode sanity checks
  const routerCode = await provider.getCode(ROUTER_ADDR);
  const factoryCode = await provider.getCode(FACTORY_ADDR);
  if (routerCode === "0x") throw new Error("No bytecode at ROUTER_ADDR. Wrong address or wrong RPC.");
  if (factoryCode === "0x") throw new Error("No bytecode at FACTORY_ADDR. Wrong address or wrong RPC.");
  console.log("✅ Router bytecode OK. ✅ Factory bytecode OK.");

  console.log("\n🏗️  Creating MMM-WMON Liquidity Pool");
  console.log("=".repeat(55));

  // Balances
  const [mmmBal, monBal] = await Promise.all([
    mmm.balanceOf(user.address),
    provider.getBalance(user.address),
  ]);

  const mmmDecimals = await mmm.decimals();
  const mmmSymbol = await mmm.symbol();

  console.log("\n💰 Checking balances...");
  console.log(`Your ${mmmSymbol} balance: ${ethers.formatUnits(mmmBal, mmmDecimals)}`);
  console.log(`Your MON balance: ${ethers.formatEther(monBal)}`);

  // LP amounts (safe with your 0.106 MON balance)
  const monAmount = ethers.parseEther("0.05");
  const mmmAmount = ethers.parseUnits("50000", mmmDecimals);

  console.log("\n📊 Planned Liquidity:");
  console.log(`- ${ethers.formatEther(monAmount)} MON`);
  console.log(`- ${ethers.formatUnits(mmmAmount, mmmDecimals)} ${mmmSymbol}`);
  console.log(`- Initial price: 1 ${mmmSymbol} = ${(0.05 / 50000).toFixed(8)} MON`);

  if (monBal < monAmount) throw new Error("Insufficient MON for LP seed + gas. Lower monAmount.");
  if (mmmBal < mmmAmount) throw new Error(`Insufficient ${mmmSymbol} for LP seed.`);

  // Determine pair tokenB: use router.WETH() if it works, else fall back to WMON_ADDRESS
  let weth;
  try {
    weth = await router.WETH();
    console.log("\nRouter.WETH():", weth);
  } catch (e) {
    console.log("\n⚠️ router.WETH() failed, falling back to WMON_ADDRESS");
    weth = WMON_ADDRESS;
  }

  // Check if pool exists (NO router.factory() call)
  console.log("\n🔍 Checking if pool exists...");
  const existingPair = await factory.getPair(MMM_ADDRESS, weth);
  console.log("Existing pair:", existingPair);

  if (existingPair !== ethers.ZeroAddress) {
    console.log(`⚠️ Pool already exists at: ${existingPair}`);
    console.log("Stop here. Set pair in MMM if needed, or add more liquidity.");
    return;
  }

  console.log("✅ No pool exists — proceeding.");

  // Approve MMM
  console.log("\n✅ Approving MMM for router...");
  const approveTx = await mmm.approve(ROUTER_ADDR, mmmAmount);
  console.log("Approve tx:", approveTx.hash);
  await approveTx.wait();
  console.log("✅ Approved.");

  // Add liquidity
  console.log("\n➕ Adding liquidity with addLiquidityETH...");
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;

  const addTx = await router.addLiquidityETH(
    MMM_ADDRESS,
    mmmAmount,
    0,
    0,
    user.address,
    deadline,
    { value: monAmount }
  );

  console.log("LP tx:", addTx.hash);
  await addTx.wait();
  console.log("✅ Liquidity added.");

  // Confirm pair
  const pair = await factory.getPair(MMM_ADDRESS, weth);
  console.log(`🎉 New MMM/WMON pair: ${pair}`);
}

main().catch((e) => {
  console.error("❌ create-pool-fixed failed:", e);
  process.exitCode = 1;
});
