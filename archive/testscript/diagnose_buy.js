// scripts/diagnose_buy_revert.js
// Run:
//   npx hardhat run scripts/diagnose_buy_revert.js --network monadTestnet --no-compile

const hre = require("hardhat");
const { ethers } = hre;

const CONFIG = {
  MMM:    "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16",
  WMON:   "0x51C0bb68b65bd84De6518C939CB9Dbe2d6Fa7079",
  ROUTER: "0x53FE6D2499742779BF2Bd12a23e3c102fAe9fEcA",
  FACTORY:"0x8e8a713Be23d9be017d7A5f4D649982B5dD24615",
  PAIR:   "0x7d4A5Ed4C366aFa71c5b4158b2F203B1112AC7FD",
};

const ROUTER_ABI = [
  "function WETH() view returns (address)",
  "function factory() view returns (address)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable",
];

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) view returns (address)",
];

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data)",
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
];

const WMON_ABI = [
  "function deposit() payable",
  "function withdraw(uint wad)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address dst, uint wad) returns (bool)",
];

function fmtUnits(x, d) {
  return Number(ethers.formatUnits(x, d)).toLocaleString("en-US", { maximumFractionDigits: 18 });
}

function fmtEth(x) {
  return Number(ethers.formatEther(x)).toLocaleString("en-US", { maximumFractionDigits: 18 });
}

// UniswapV2 amountOut formula with 0.3% fee
function getAmountOut(amountIn, reserveIn, reserveOut) {
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

async function codeSize(addr) {
  const code = await ethers.provider.getCode(addr);
  return code.length / 2 - 1; // bytes
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Network:", hre.network.name);
  console.log("Signer:", signer.address);

  // --- Code checks ---
  console.log("\n--- Code checks (bytes) ---");
  console.log("Router :", await codeSize(CONFIG.ROUTER));
  console.log("Factory:", await codeSize(CONFIG.FACTORY));
  console.log("Pair   :", await codeSize(CONFIG.PAIR));
  console.log("MMM    :", await codeSize(CONFIG.MMM));
  console.log("WMON   :", await codeSize(CONFIG.WMON));

  const router = new ethers.Contract(CONFIG.ROUTER, ROUTER_ABI, ethers.provider);
  const factory = new ethers.Contract(CONFIG.FACTORY, FACTORY_ABI, ethers.provider);
  const pair = new ethers.Contract(CONFIG.PAIR, PAIR_ABI, ethers.provider);
  const mmm = new ethers.Contract(CONFIG.MMM, ERC20_ABI, ethers.provider);
  const wmon = new ethers.Contract(CONFIG.WMON, WMON_ABI, signer); // needs signer for deposit/transfer

  // --- Sanity ---
  console.log("\n--- Router sanity ---");
  const routerWETH = await router.WETH();
  const routerFactory = await router.factory();
  console.log("router.WETH()   :", routerWETH);
  console.log("router.factory():", routerFactory);

  const pairFromFactory = await factory.getPair(CONFIG.WMON, CONFIG.MMM);
  console.log("factory.getPair(WMON, MMM):", pairFromFactory);

  // --- Pair reserves ---
  console.log("\n--- Pair ---");
  const t0 = await pair.token0();
  const t1 = await pair.token1();
  const [r0, r1] = await pair.getReserves();

  const dec = await mmm.decimals();
  const sym = await mmm.symbol().catch(() => "MMM");

  console.log("token0:", t0);
  console.log("token1:", t1);
  console.log("reserve0:", r0.toString());
  console.log("reserve1:", r1.toString());
  console.log("MMM decimals:", dec.toString(), "symbol:", sym);

  // Determine which reserve is MMM/WMON
  let reserveMMM, reserveWMON, mmmIs0;
  if (t0.toLowerCase() === CONFIG.MMM.toLowerCase()) {
    reserveMMM = r0; reserveWMON = r1; mmmIs0 = true;
  } else {
    reserveMMM = r1; reserveWMON = r0; mmmIs0 = false;
  }

  console.log("\n--- Human reserves ---");
  console.log("Reserve WMON:", fmtEth(reserveWMON));
  console.log(`Reserve ${sym} :`, fmtUnits(reserveMMM, dec));

  // Quote 0.01 MON -> MMM
  const amountInMON = ethers.parseEther("0.01");
  const expectedOut = getAmountOut(amountInMON, reserveWMON, reserveMMM);

  console.log("\n--- Quote for 0.01 MON -> MMM ---");
  console.log("Expected out:", fmtUnits(expectedOut, dec), sym);

  // Router calldata for supportingFee function
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const path = [CONFIG.WMON, CONFIG.MMM];

  const routerIface = new ethers.Interface(ROUTER_ABI);
  const dataSupporting = routerIface.encodeFunctionData(
    "swapExactETHForTokensSupportingFeeOnTransferTokens",
    [0, path, signer.address, deadline]
  );
  const dataNormal = routerIface.encodeFunctionData(
    "swapExactETHForTokens",
    [0, path, signer.address, deadline]
  );

  console.log("\n--- Expected calldata (supportingFee) ---");
  console.log("calldata prefix:", dataSupporting.slice(0, 10), "len:", dataSupporting.length);

  console.log("\n--- Expected calldata (normal swapExactETHForTokens) ---");
  console.log("calldata prefix:", dataNormal.slice(0, 10), "len:", dataNormal.length);

  // ------------------------------------------------------------
  // A) Try router via eth_call (best revert visibility)
  // ------------------------------------------------------------
  console.log("\n==== A) ROUTER eth_call: supportingFee | minOut=0 ====");
  try {
    await ethers.provider.call({
      from: signer.address,
      to: CONFIG.ROUTER,
      data: dataSupporting,
      value: amountInMON,
    });
    console.log("eth_call OK (unexpected).");
  } catch (e) {
    console.log("eth_call REVERT:", e?.shortMessage || e?.message || e);
    console.log("  data:", e?.data || "n/a");
  }

  console.log("\n==== A2) ROUTER eth_call: normal swapExactETHForTokens | minOut=0 ====");
  try {
    await ethers.provider.call({
      from: signer.address,
      to: CONFIG.ROUTER,
      data: dataNormal,
      value: amountInMON,
    });
    console.log("eth_call OK (unexpected).");
  } catch (e) {
    console.log("eth_call REVERT:", e?.shortMessage || e?.message || e);
    console.log("  data:", e?.data || "n/a");
  }

  // ------------------------------------------------------------
  // B) Manual swap (bypass router): deposit WMON -> transfer to pair -> pair.swap
  // This isolates whether router is the issue or the pair/token is the issue.
  // ------------------------------------------------------------
  console.log("\n==== B) MANUAL swap (bypass router) ====");
  const balBeforeMMM = await mmm.balanceOf(signer.address);
  const balBeforeWMON = await wmon.balanceOf(signer.address);

  console.log("Before balances:");
  console.log("  MMM :", fmtUnits(balBeforeMMM, dec), sym);
  console.log("  WMON:", fmtEth(balBeforeWMON));

  try {
    console.log("\n1) WMON.deposit(0.01 MON) ...");
    const tx1 = await wmon.deposit({ value: amountInMON });
    await tx1.wait();
    console.log("   deposit tx:", tx1.hash);

    console.log("2) WMON.transfer(pair, 0.01) ...");
    const tx2 = await wmon.transfer(CONFIG.PAIR, amountInMON);
    await tx2.wait();
    console.log("   transfer tx:", tx2.hash);

    console.log("3) pair.swap(...) ...");

    // amountOut computed from reserves, output token = MMM
    // If MMM is token0: amount0Out = expectedOut, amount1Out = 0
    // If MMM is token1: amount0Out = 0, amount1Out = expectedOut
    const amount0Out = mmmIs0 ? expectedOut : 0n;
    const amount1Out = mmmIs0 ? 0n : expectedOut;

    const pairWithSigner = pair.connect(signer);
    const tx3 = await pairWithSigner.swap(amount0Out, amount1Out, signer.address, "0x");
    const rcpt3 = await tx3.wait();
    console.log("   swap tx:", tx3.hash, "status:", rcpt3.status);

    const balAfterMMM = await mmm.balanceOf(signer.address);
    const balAfterWMON = await wmon.balanceOf(signer.address);

    console.log("\nAfter balances:");
    console.log("  MMM :", fmtUnits(balAfterMMM, dec), sym);
    console.log("  WMON:", fmtEth(balAfterWMON));

    console.log("\nMANUAL swap succeeded.");
    console.log("If router still fails but this works => router implementation is broken.");
  } catch (e) {
    console.log("\nMANUAL swap FAILED:");
    console.log("  ", e?.shortMessage || e?.message || e);
    console.log("  data:", e?.data || "n/a");
    console.log("\nIf manual swap fails too => the issue is in Pair or MMM transfer hook (likely tracker update).");
  }

  console.log("\n--- Done ---");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
