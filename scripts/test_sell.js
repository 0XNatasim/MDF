// scripts/test_sell.js — MMM → MON sell test (Monad Testnet)
// Mirrors test_buy.js structure exactly.
// Flow: approve MMM → swapExactTokensForTokensSupportingFeeOnTransferTokens → withdraw WMON → verify tax

require("dotenv").config();
const { ethers } = require("hardhat");

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CONTRACTS = {
  MMM:      "0x61fE82f9FA8135B68683bB0cD55BD2Be6E48aE16",
  WMON:     "0xdb595Fc88D176aAe8Ae64c54bB50F815E3982825",
  ROUTER:   "0x3ac0d8EDd13e8030B1fBc470C4e28a07D209068e",
  PAIR:     "0x425d3382BEc9b1b293554f42dD993CBd390B6394",
  TAX_VAULT:"0x89DfC58aB3da4937C9a8dDec2Ab87cb49dF1eFfE",
};

// Amount of MMM to sell — adjust as needed
const MMM_SELL_AMOUNT = "100"; // human units

// Slippage tolerance in bps (500 = 5%, covers sell tax + buffer)
const SLIPPAGE_BPS = 1000n; // 10% — generous for testnet

// ─── ABIs (minimal) ────────────────────────────────────────────────────────
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function getSellTaxBps() view returns (uint256)",
];

const ROUTER_ABI = [
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external",
];

const WMON_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function withdraw(uint256 amount)",
];

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)",
];

// ─── HELPERS ───────────────────────────────────────────────────────────────
function fmt(bn, decimals = 18) {
  return ethers.formatUnits(bn, decimals);
}

// Uniswap v2 getAmountOut
function getAmountOut(amountIn, reserveIn, reserveOut) {
  const amountInWithFee = amountIn * 997n;
  const numerator       = amountInWithFee * reserveOut;
  const denominator     = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n=== MMM SELL TEST ===");

  const wallet = new ethers.Wallet(process.env.FRESH3_PRIVATE_KEY, ethers.provider);
  const seller = wallet;
  const network  = await ethers.provider.getNetwork();
  console.log(`Connected to network chainId: ${network.chainId}`);
  console.log(`Seller wallet: ${seller.address}`);

  const monBefore = await ethers.provider.getBalance(seller.address);
  console.log(`MON balance:   ${fmt(monBefore)}`);

  // ── Instantiate contracts ──────────────────────────────────────────────
  const mmm    = new ethers.Contract(CONTRACTS.MMM,      ERC20_ABI,  seller);
  const wmon   = new ethers.Contract(CONTRACTS.WMON,     WMON_ABI,   seller);
  const router = new ethers.Contract(CONTRACTS.ROUTER,   ROUTER_ABI, seller);
  const pair   = new ethers.Contract(CONTRACTS.PAIR,     PAIR_ABI,   seller);

  const decimals = await mmm.decimals();
  const mmmSellBn = ethers.parseUnits(MMM_SELL_AMOUNT, decimals);

  // ── Pre-flight checks ─────────────────────────────────────────────────
  const mmmBalBefore = await mmm.balanceOf(seller.address);
  console.log(`\nMMM balance before:  ${fmt(mmmBalBefore, decimals)}`);

  if (mmmBalBefore < mmmSellBn) {
    throw new Error(
      `Insufficient MMM. Have ${fmt(mmmBalBefore, decimals)}, need ${MMM_SELL_AMOUNT}`
    );
  }

  const taxVaultBefore = await mmm.balanceOf(CONTRACTS.TAX_VAULT);
  console.log(`TaxVault MMM before: ${fmt(taxVaultBefore, decimals)}`);

  // ── Current sell tax ──────────────────────────────────────────────────
  let currentSellTaxBps = 500n;
  try {
    currentSellTaxBps = await mmm.getSellTaxBps();
    console.log(`Current sell tax:    ${Number(currentSellTaxBps) / 100}%`);
  } catch (e) {
    console.log("getSellTaxBps() not available on this build, assuming 5%");
  }

  // ── Quote expected WMON out ───────────────────────────────────────────
  const [token0] = await Promise.all([pair.token0()]);
  const reserves  = await pair.getReserves();
  const [r0, r1]  = [reserves[0], reserves[1]];

  const mmmIsToken0 = token0.toLowerCase() === CONTRACTS.MMM.toLowerCase();
  const reserveMMM  = mmmIsToken0 ? r0 : r1;
  const reserveWMON = mmmIsToken0 ? r1 : r0;

  // Net MMM hitting pair after sell tax
  const netMmmToPair = mmmSellBn - (mmmSellBn * currentSellTaxBps) / 10000n;
  const expectedWmon = getAmountOut(netMmmToPair, reserveMMM, reserveWMON);
  const minWmonOut   = expectedWmon - (expectedWmon * SLIPPAGE_BPS) / 10000n;

  console.log(`\nPool reserves: MMM=${fmt(reserveMMM, decimals)} | WMON=${fmt(reserveWMON)}`);
  console.log(`Net MMM to pair (after ${Number(currentSellTaxBps)/100}% tax): ${fmt(netMmmToPair, decimals)}`);
  console.log(`Expected WMON out: ${fmt(expectedWmon)}`);
  console.log(`Min WMON out (${Number(SLIPPAGE_BPS)/100}% slippage): ${fmt(minWmonOut)}`);

  // ── Step 1: Approve ───────────────────────────────────────────────────
  const allowance = await mmm.allowance(seller.address, CONTRACTS.ROUTER);
  if (allowance < mmmSellBn) {
    console.log("\nApproving MMM for router...");
    const approveTx = await mmm.approve(CONTRACTS.ROUTER, ethers.MaxUint256);
    await approveTx.wait();
    console.log("Approved ✅");
  } else {
    console.log("\nAllowance sufficient, skipping approve.");
  }

  // ── Step 2: Swap MMM → WMON ───────────────────────────────────────────
  const path     = [CONTRACTS.MMM, CONTRACTS.WMON];
  const deadline = Math.floor(Date.now() / 1000) + 1200;

  console.log("\nSending swap tx: MMM → WMON...");
  const swapTx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
    mmmSellBn,
    minWmonOut,
    path,
    seller.address,
    deadline,
    { gasLimit: 600_000n }
  );
  console.log(`Tx sent: ${swapTx.hash}`);
  const swapRcpt = await swapTx.wait();
  console.log(`Status: ${swapRcpt.status === 1 ? "✅ Success" : "❌ Failed"}`);
  console.log(`Gas used: ${swapRcpt.gasUsed}`);

  // ── Step 3: Unwrap WMON → MON ─────────────────────────────────────────
  const wmonBal = await wmon.balanceOf(seller.address);
  console.log(`\nWMON received: ${fmt(wmonBal)}`);

  if (wmonBal > 0n) {
    console.log("Unwrapping WMON → MON...");
    const unwrapTx = await wmon.withdraw(wmonBal);
    await unwrapTx.wait();
    console.log("Unwrapped ✅");
  }

  // ── Results ───────────────────────────────────────────────────────────
  const mmmBalAfter    = await mmm.balanceOf(seller.address);
  const taxVaultAfter  = await mmm.balanceOf(CONTRACTS.TAX_VAULT);
  const monAfter       = await ethers.provider.getBalance(seller.address);

  const mmmSold        = mmmBalBefore - mmmBalAfter;
  const taxCollected   = taxVaultAfter - taxVaultBefore;
  const monReceived    = monAfter - monBefore; // net (includes gas)
  const effectiveTax   = mmmSold > 0n
    ? (Number(taxCollected) / Number(mmmSold) * 100).toFixed(2)
    : "—";

  console.log("\n── Results ──────────────────────────────");
  console.log(`MMM sold (gross):      ${fmt(mmmSold, decimals)}`);
  console.log(`Tax collected (MMM):   ${fmt(taxCollected, decimals)}`);
  console.log(`Effective tax rate:    ${effectiveTax}%`);
  console.log(`MON received (net):    ${fmt(monReceived)} (after gas)`);
  console.log(`TaxVault total (MMM):  ${fmt(taxVaultAfter, decimals)}`);
  console.log("─────────────────────────────────────────");
  console.log("=== DONE ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});