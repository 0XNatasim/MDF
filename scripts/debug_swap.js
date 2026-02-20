/**
 * ============================================================
 * debug_swap.js — FULL DIAGNOSTIC + SWAP ATTEMPT SUITE
 * ============================================================
 * Runs every possible check and swap variant to find what works.
 *
 * Usage:
 *   npx hardhat run scripts/debug_swap.js --network monadTestnet
 *
 * Required .env vars:
 *   FRESH3_PRIVATE_KEY, TESTNET_ROUTER, TESTNET_MMM, TESTNET_WMON,
 *   TESTNET_FACTORY, TESTNET_PAIR, TESTNET_TAX_VAULT (optional – read from token)
 * ============================================================
 */

const hre = require("hardhat");
const { ethers } = hre;

// ─── Helpers ────────────────────────────────────────────────
const sep  = (title) => console.log(`\n${"═".repeat(60)}\n  ${title}\n${"═".repeat(60)}`);
const ok   = (msg)   => console.log("  ✅", msg);
const warn = (msg)   => console.log("  ⚠️ ", msg);
const fail = (msg)   => console.log("  ❌", msg);
const info = (msg)   => console.log("  ℹ️ ", msg);

async function tryCall(label, fn) {
  try {
    const r = await fn();
    ok(`${label}: ${r}`);
    return r;
  } catch (e) {
    fail(`${label}: ${e.message?.slice(0, 120)}`);
    return null;
  }
}

// ─── ABIs ───────────────────────────────────────────────────
const ROUTER_ABI = [
  "function WETH() view returns (address)",
  "function factory() view returns (address)",
  "function swapExactETHForTokens(uint256,address[],address,uint256) payable returns (uint256[])",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256) payable",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
  "function getAmountsOut(uint256,address[]) view returns (uint256[])",
];

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function sync() external",
  "function skim(address) external",
  "function swap(uint256,uint256,address,bytes) external",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address,uint256) external returns (bool)",
  "function transfer(address,uint256) external returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

const WETH_ABI = [
  ...ERC20_ABI,
  "function deposit() payable",
  "function withdraw(uint256)",
];

const MMM_ABI = [
  ...ERC20_ABI,
  "function launched() view returns (bool)",
  "function tradingEnabled() view returns (bool)",
  "function launchTime() view returns (uint256)",
  "function pair() view returns (address)",
  "function router() view returns (address)",
  "function taxVault() view returns (address)",
  "function isTaxExempt(address) view returns (bool)",
  "function getBuyTaxBps() view returns (uint256)",
  "function getSellTaxBps() view returns (uint256)",
];

// ─── Main ───────────────────────────────────────────────────
async function main() {
  const provider = new ethers.JsonRpcProvider(hre.network.config.url);
  const fresh    = new ethers.Wallet(process.env.FRESH3_PRIVATE_KEY, provider);

  const ROUTER_ADDR  = process.env.TESTNET_ROUTER;
  const MMM_ADDR     = process.env.TESTNET_MMM;
  const WMON_ADDR    = process.env.TESTNET_WMON;

  console.log("\n🔍  MMM SWAP FULL DIAGNOSTIC SUITE");
  console.log("Wallet:", fresh.address);
  console.log("Time:  ", new Date().toISOString());

  // ────────────────────────────────────────────────────────
  sep("1. NETWORK + WALLET");
  // ────────────────────────────────────────────────────────
  const network = await provider.getNetwork();
  info(`Chain ID: ${network.chainId}`);

  const monBal = await provider.getBalance(fresh.address);
  info(`MON balance: ${ethers.formatEther(monBal)} MON`);
  if (monBal < ethers.parseEther("0.1")) {
    warn("Low MON balance – some tests may fail for insufficient gas.");
  } else {
    ok("Sufficient MON balance");
  }

  // ────────────────────────────────────────────────────────
  sep("2. CONTRACT ADDRESSES");
  // ────────────────────────────────────────────────────────
  info(`Router : ${ROUTER_ADDR}`);
  info(`MMM    : ${MMM_ADDR}`);
  info(`WMON   : ${WMON_ADDR}`);

  const router = new ethers.Contract(ROUTER_ADDR, ROUTER_ABI, fresh);
  const mmm    = new ethers.Contract(MMM_ADDR,    MMM_ABI,    provider);
  const wmon   = new ethers.Contract(WMON_ADDR,   WETH_ABI,   fresh);

  // ────────────────────────────────────────────────────────
  sep("3. ROUTER SANITY CHECKS");
  // ────────────────────────────────────────────────────────
  const routerWETH    = await tryCall("Router.WETH()", () => router.WETH());
  const routerFactory = await tryCall("Router.factory()", () => router.factory());

  if (routerWETH && routerWETH.toLowerCase() !== WMON_ADDR.toLowerCase()) {
    fail(`Router WETH (${routerWETH}) ≠ TESTNET_WMON (${WMON_ADDR})`);
    warn("→ Your TESTNET_WMON env var is WRONG or router uses a different WETH!");
  } else if (routerWETH) {
    ok("Router WETH matches TESTNET_WMON ✓");
  }

  // ────────────────────────────────────────────────────────
  sep("4. TOKEN STATE");
  // ────────────────────────────────────────────────────────
  const launched       = await tryCall("launched",       () => mmm.launched());
  const tradingEnabled = await tryCall("tradingEnabled", () => mmm.tradingEnabled());
  const launchTime     = await tryCall("launchTime",     () => mmm.launchTime());
  const pairAddr       = await tryCall("pair()",         () => mmm.pair());
  const routerAddr     = await tryCall("router()",       () => mmm.router());
  const taxVaultAddr   = await tryCall("taxVault()",     () => mmm.taxVault());

  if (!launched)       fail("Token not launched – swaps will revert with TradingNotEnabled");
  if (!tradingEnabled) fail("Trading not enabled – swaps will revert");

  if (launchTime) {
    const elapsed = Math.floor(Date.now() / 1000) - Number(launchTime);
    info(`Time since launch: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`);
  }

  if (pairAddr && pairAddr.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
    ok(`Pair set: ${pairAddr}`);
  } else {
    fail("Pair not set on token – tax logic will be broken");
  }

  if (routerAddr && routerAddr.toLowerCase() === ROUTER_ADDR.toLowerCase()) {
    ok("Token router matches TESTNET_ROUTER ✓");
  } else {
    warn(`Token router (${routerAddr}) ≠ TESTNET_ROUTER (${ROUTER_ADDR})`);
  }

  // ────────────────────────────────────────────────────────
  sep("5. TAX STATE");
  // ────────────────────────────────────────────────────────
  const buyTax  = await tryCall("getBuyTaxBps()",  () => mmm.getBuyTaxBps());
  const sellTax = await tryCall("getSellTaxBps()", () => mmm.getSellTaxBps());

  if (buyTax !== null) {
    info(`Buy tax:  ${Number(buyTax) / 100}%  (${buyTax} bps)`);
    if (Number(buyTax) >= 8000) warn("Buy tax is 80% (first 10 min after launch) – normal but very high");
  }
  if (sellTax !== null) {
    info(`Sell tax: ${Number(sellTax) / 100}% (${sellTax} bps)`);
  }

  const checkExempt = async (label, addr) => {
    if (!addr) return;
    const exempt = await tryCall(`isTaxExempt[${label}]`, () => mmm.isTaxExempt(addr));
    if (!exempt) warn(`${label} is NOT tax-exempt – check this is intentional`);
  };

  await checkExempt("fresh wallet",  fresh.address);
  await checkExempt("router",        routerAddr);
  await checkExempt("taxVault",      taxVaultAddr);
  await checkExempt("pair",          pairAddr);

  // ────────────────────────────────────────────────────────
  sep("6. PAIR / LIQUIDITY STATE");
  // ────────────────────────────────────────────────────────
  let pair, token0, token1, reserve0, reserve1;
  if (pairAddr) {
    pair = new ethers.Contract(pairAddr, PAIR_ABI, fresh);
    token0 = await tryCall("pair.token0()", () => pair.token0());
    token1 = await tryCall("pair.token1()", () => pair.token1());
    const reserves = await tryCall("pair.getReserves()", () => pair.getReserves());
    if (reserves) {
      [reserve0, reserve1] = reserves;
      info(`Reserve0 (${token0 === WMON_ADDR ? "WMON" : "MMM"}): ${ethers.formatUnits(reserve0, 18)}`);
      info(`Reserve1 (${token1 === WMON_ADDR ? "WMON" : "MMM"}): ${ethers.formatUnits(reserve1, 18)}`);

      if (reserve0 === 0n || reserve1 === 0n) {
        fail("One or both reserves are ZERO – no liquidity, swaps will fail!");
      } else {
        ok("Both reserves > 0 ✓");
      }
    }
  }

  // ────────────────────────────────────────────────────────
  sep("7. AMOUNTS OUT SIMULATION");
  // ────────────────────────────────────────────────────────
  const path = [WMON_ADDR, MMM_ADDR];
  const buyAmount = ethers.parseEther("0.01");
  let amountsOut;
  try {
    amountsOut = await router.getAmountsOut(buyAmount, path);
    info(`0.01 WMON → ${ethers.formatUnits(amountsOut[1], 18)} MMM (pre-tax)`);
    ok("getAmountsOut works ✓");
  } catch (e) {
    fail(`getAmountsOut failed: ${e.message?.slice(0, 120)}`);
    warn("This means the pair/factory wiring is broken for the router");
  }

  // ────────────────────────────────────────────────────────
  sep("8. WMON WRAP TEST");
  // ────────────────────────────────────────────────────────
  info("Wrapping 0.02 MON → WMON...");
  let wrapOk = false;
  try {
    const wrapTx = await wmon.deposit({ value: ethers.parseEther("0.02"), gasLimit: 100000 });
    await wrapTx.wait();
    const wmonBal = await wmon.balanceOf(fresh.address);
    ok(`Wrap successful. WMON balance: ${ethers.formatUnits(wmonBal, 18)}`);
    wrapOk = true;
  } catch (e) {
    fail(`Wrap failed: ${e.message?.slice(0, 120)}`);
  }

  // ────────────────────────────────────────────────────────
  sep("9. WMON → ROUTER APPROVAL");
  // ────────────────────────────────────────────────────────
  if (wrapOk) {
    try {
      const approveTx = await wmon.approve(ROUTER_ADDR, ethers.MaxUint256, { gasLimit: 100000 });
      await approveTx.wait();
      ok("Approved WMON on router ✓");
    } catch (e) {
      fail(`Approval failed: ${e.message?.slice(0, 120)}`);
    }
  }

  // ────────────────────────────────────────────────────────
  sep("10. STATIC CALL SIMULATION (no gas spent)");
  // ────────────────────────────────────────────────────────
  const deadline = Math.floor(Date.now() / 1000) + 1200;

  info("staticCall: swapExactETHForTokensSupportingFeeOnTransferTokens");
  try {
    await router.swapExactETHForTokensSupportingFeeOnTransferTokens.staticCall(
      0, path, fresh.address, deadline,
      { value: buyAmount }
    );
    ok("Static call PASSED – swap should work!");
  } catch (e) {
    fail(`Static call REVERTED: ${e.message?.slice(0, 200)}`);
    info("→ Revert data (if any):");
    if (e.data) {
      try {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + e.data.slice(10));
        info(`  Decoded reason: ${decoded[0]}`);
      } catch {}
      info(`  Raw data: ${e.data}`);
    }
  }

  info("staticCall: swapExactETHForTokens (no fee-on-transfer)");
  try {
    await router.swapExactETHForTokens.staticCall(
      0, path, fresh.address, deadline,
      { value: buyAmount }
    );
    ok("Static call (no-fot) PASSED");
  } catch (e) {
    fail(`Static call (no-fot) REVERTED: ${e.message?.slice(0, 200)}`);
  }

  // ────────────────────────────────────────────────────────
  sep("11. SWAP ATTEMPT A — swapExactETHForTokensSupportingFeeOnTransferTokens");
  // ────────────────────────────────────────────────────────
  info("Sending real tx...");
  try {
    const tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
      0, path, fresh.address, deadline,
      { value: buyAmount, gasLimit: 3_000_000 }
    );
    info(`Tx hash: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      ok(`✅ SWAP A SUCCEEDED! Gas used: ${receipt.gasUsed}`);
      const mmmAfter = await mmm.balanceOf(fresh.address);
      info(`MMM received: ${ethers.formatUnits(mmmAfter, 18)}`);
    } else {
      fail("Swap A reverted on-chain");
    }
  } catch (e) {
    fail(`Swap A threw: ${e.shortMessage || e.message?.slice(0, 150)}`);
  }

  // ────────────────────────────────────────────────────────
  sep("12. SWAP ATTEMPT B — swapExactETHForTokens (non-fot version)");
  // ────────────────────────────────────────────────────────
  info("Note: The token DOES take a fee-on-transfer. The standard (non-fot) function");
  info("will also revert if the pair's amountOut check fails due to buyer→taxVault transfer.");
  info("Trying anyway...");
  try {
    const tx = await router.swapExactETHForTokens(
      0, path, fresh.address, deadline,
      { value: buyAmount, gasLimit: 3_000_000 }
    );
    info(`Tx hash: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      ok(`✅ SWAP B SUCCEEDED! Gas used: ${receipt.gasUsed}`);
    } else {
      fail("Swap B reverted on-chain");
    }
  } catch (e) {
    fail(`Swap B threw: ${e.shortMessage || e.message?.slice(0, 150)}`);
  }

  // ────────────────────────────────────────────────────────
  sep("13. SWAP ATTEMPT C — swapExactTokensForTokensSupportingFeeOnTransferTokens (WMON pre-wrapped)");
  // ────────────────────────────────────────────────────────
  info("Using WMON directly (no ETH unwrap/rewrap in router)...");
  if (wrapOk) {
    const wmonBal = await wmon.balanceOf(fresh.address);
    const swapAmt = wmonBal < buyAmount ? wmonBal : buyAmount;
    info(`WMON to swap: ${ethers.formatUnits(swapAmt, 18)}`);
    try {
      const tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        swapAmt, 0, path, fresh.address, deadline,
        { gasLimit: 3_000_000 }
      );
      info(`Tx hash: ${tx.hash}`);
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        ok(`✅ SWAP C SUCCEEDED! Gas used: ${receipt.gasUsed}`);
        const mmmAfter = await mmm.balanceOf(fresh.address);
        info(`MMM balance: ${ethers.formatUnits(mmmAfter, 18)}`);
      } else {
        fail("Swap C reverted on-chain");
      }
    } catch (e) {
      fail(`Swap C threw: ${e.shortMessage || e.message?.slice(0, 150)}`);
    }
  } else {
    warn("Skipping Swap C – WMON wrap failed earlier");
  }

  // ────────────────────────────────────────────────────────
  sep("14. SWAP ATTEMPT D — DIRECT LOW-LEVEL PAIR SWAP (bypass router entirely)");
  // ────────────────────────────────────────────────────────
  info("Sending WMON directly to pair, then calling pair.swap()...");
  info("This bypasses router completely — tests if pair+token work in isolation.");
  if (wrapOk && pair && token0 && token1) {
    try {
      // Figure out which token is which
      const isToken0WMON = token0.toLowerCase() === WMON_ADDR.toLowerCase();
      const wmonIn = ethers.parseEther("0.005");

      // Get current reserves
      const [r0, r1] = await pair.getReserves();
      const [wmonReserve, mmmReserve] = isToken0WMON ? [r0, r1] : [r1, r0];

      // Calculate amount out using x*y=k
      const amountInWithFee = wmonIn * 997n;
      const numerator       = amountInWithFee * mmmReserve;
      const denominator     = wmonReserve * 1000n + amountInWithFee;
      const amountOut       = numerator / denominator;
      info(`Calculated amountOut: ${ethers.formatUnits(amountOut, 18)} MMM`);

      // Send WMON to pair
      const transferTx = await wmon.transfer(pairAddr, wmonIn, { gasLimit: 100000 });
      await transferTx.wait();
      ok("WMON sent to pair");

      // Call pair.swap directly
      const amount0Out = isToken0WMON ? 0n : amountOut;
      const amount1Out = isToken0WMON ? amountOut : 0n;

      const swapTx = await pair.swap(amount0Out, amount1Out, fresh.address, "0x", { gasLimit: 3_000_000 });
      info(`Tx hash: ${swapTx.hash}`);
      const receipt = await swapTx.wait();
      if (receipt.status === 1) {
        ok(`✅ SWAP D (DIRECT PAIR) SUCCEEDED! Gas used: ${receipt.gasUsed}`);
        const mmmAfter = await mmm.balanceOf(fresh.address);
        info(`MMM balance: ${ethers.formatUnits(mmmAfter, 18)}`);
      } else {
        fail("Swap D reverted on-chain");
      }
    } catch (e) {
      fail(`Swap D threw: ${e.shortMessage || e.message?.slice(0, 200)}`);
      if (e.data) info(`Revert data: ${e.data}`);
    }
  } else {
    warn("Skipping Swap D – pair info or WMON wrap unavailable");
  }

  // ────────────────────────────────────────────────────────
  sep("15. ROOT CAUSE ANALYSIS");
  // ────────────────────────────────────────────────────────
  console.log(`
  The MMMToken buy-tax logic works like this:
  
    1. pair  → buyer        (full amount transferred OUT of pair)
    2. buyer → taxVault     (tax clawed back from buyer)
  
  The Uniswap router's swapExactETHForTokensSupportingFeeOnTransferTokens
  checks:  balanceOf(recipient) AFTER - balanceOf(recipient) BEFORE >= amountOutMin
  
  If amountOutMin = 0  →  this check should always pass (any positive balance increase works).
  
  ⚠️  POSSIBLE ROOT CAUSES:
  
  A) The router's WETH address ≠ TESTNET_WMON
     → Router wraps ETH into its own WETH, but token path[0] is a different address.
     → Fix: make sure TESTNET_WMON == router.WETH()
  
  B) The token pair address stored in the token ≠ actual UniswapV2 pair
     → Tax logic checks (from == pair) — if pair address is wrong, no tax taken,
       but more importantly the router uses pairFor() from factory which may differ.
     → Fix: confirm pair address on token matches factory.getPair(MMM, WMON)
  
  C) Factory's pairFor init code hash mismatch
     → The router's UniswapV2Library.pairFor uses a hardcoded INIT_CODE_HASH.
     → If your factory's pair bytecode differs, pairFor returns a WRONG address
       and the router tries to call a non-existent contract.
     → Fix: check the INIT_CODE_HASH in UniswapV2Library matches your factory.
  
  D) The token's _update on buy calls buyer→taxVault but buyer has 0 allowance
     → This is an internal _update (super._update), so it bypasses allowance – OK.
  
  E) TaxVault not set / address(0)
     → taxVault == address(0) makes takeTax = false, so tax is skipped.
       This is fine for the swap itself but indicates misconfiguration.
  
  Check output of Step 3 (Router.WETH vs TESTNET_WMON) — this is the most
  likely culprit for a total revert with all gas consumed.
  `);

  // ────────────────────────────────────────────────────────
  sep("16. FACTORY PAIR CROSS-CHECK");
  // ────────────────────────────────────────────────────────
  if (routerFactory) {
    const FACTORY_ABI = ["function getPair(address,address) view returns (address)"];
    const factory = new ethers.Contract(routerFactory, FACTORY_ABI, provider);
    const factoryPair = await tryCall(
      "factory.getPair(MMM, WMON)",
      () => factory.getPair(MMM_ADDR, WMON_ADDR)
    );
    if (factoryPair && pairAddr) {
      if (factoryPair.toLowerCase() === pairAddr.toLowerCase()) {
        ok("factory.getPair matches token.pair() ✓");
      } else {
        fail(`MISMATCH! factory.getPair=${factoryPair} vs token.pair()=${pairAddr}`);
        warn("→ The token was wired to the WRONG pair address. This is a critical bug.");
      }
    }
  }

  // ────────────────────────────────────────────────────────
  sep("SUMMARY");
  // ────────────────────────────────────────────────────────
  console.log(`
  ✔ If Swap A or Swap C succeeded → you're done, use that method.
  ✔ If Swap D (direct pair) succeeded but A/C failed → router wiring issue.
  ✔ If ALL swaps failed → likely init code hash mismatch or pair mismatch.
  
  Attach this full output when asking for help.
  `);
}

main().catch((e) => {
  console.error("\n💥 Script crashed:", e);
  process.exit(1);
});