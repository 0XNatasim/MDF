const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("\n=== FRESH3 BUY 0.01 MON → MMM ===\n");

  const provider = new ethers.JsonRpcProvider(hre.network.config.url);
  const fresh = new ethers.Wallet(process.env.FRESH3_PRIVATE_KEY, provider);

  // Check network connectivity
  let network;
  try {
    network = await provider.getNetwork();
    console.log("Connected to network chainId:", network.chainId);
  } catch (e) {
    console.error("Cannot connect to network. Is your local node running?");
    process.exit(1);
  }

  console.log("Fresh wallet:", fresh.address);
  const monBal = await provider.getBalance(fresh.address);
  console.log("MON balance:", ethers.formatEther(monBal), "\n");

  const ROUTER_ADDR = process.env.TESTNET_ROUTER;
  const MMM_ADDR = process.env.TESTNET_MMM;
  const WETH_ADDR = process.env.TESTNET_WMON;

  console.log("Router:", ROUTER_ADDR);

  const ROUTER_ABI = [
    "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256) payable",
  ];

  const router = new ethers.Contract(ROUTER_ADDR, ROUTER_ABI, fresh);

  // -----------------------------------------------------------------
  // 1. Get token and WETH contracts
  // -----------------------------------------------------------------
  const mmm = await ethers.getContractAt("MMMToken", MMM_ADDR, provider);
  const weth = await ethers.getContractAt("WETH9", WETH_ADDR, provider);
  const taxVaultAddr = await mmm.taxVault();

  const latestBlock = await provider.getBlock('latest');
  console.log("Current block timestamp:", latestBlock.timestamp);

  // -----------------------------------------------------------------
  // 2. Debug: check token state and pair reserves
  // -----------------------------------------------------------------
  const launched = await mmm.launched();
  const tradingEnabled = await mmm.tradingEnabled();
  const launchTime = await mmm.launchTime();
  console.log("Launched:", launched, "Trading enabled:", tradingEnabled, "Launch time:", launchTime);

  const pairAddr = await mmm.pair();
  console.log("Token's pair address (from token):", pairAddr);
  const pair = await ethers.getContractAt("UniswapV2Pair", pairAddr);
  const [reserve0, reserve1] = await pair.getReserves();
  console.log("Reserves (raw):", reserve0.toString(), reserve1.toString());
  const token0 = await pair.token0();
  const token1 = await pair.token1();
  console.log("Token0:", token0, "Token1:", token1);

  const mmmBalanceInPair = await mmm.balanceOf(pairAddr);
  console.log("MMM balance in pair:", ethers.formatUnits(mmmBalanceInPair, 18));
  const wmonBalanceInPair = await weth.balanceOf(pairAddr);
  console.log("WMON balance in pair:", ethers.formatUnits(wmonBalanceInPair, 18));

  console.log("isBuy(pair, fresh)?", await mmm.isBuy(pairAddr, fresh.address));
  console.log("isSell(fresh, pair)?", await mmm.isSell(fresh.address, pairAddr));

  const tokenRouter = await mmm.router();
  console.log("Token's router:", tokenRouter);

  // -----------------------------------------------------------------
  // 3. Pre-swap balances
  // -----------------------------------------------------------------
  const mmmBefore = await mmm.balanceOf(fresh.address);
  const taxBefore = await mmm.balanceOf(taxVaultAddr);
  console.log("TaxVault:", taxVaultAddr);
  console.log("MMM before:", ethers.formatUnits(mmmBefore, 18));
  console.log("Tax before:", ethers.formatUnits(taxBefore, 18), "\n");

  // -----------------------------------------------------------------
  // 4. Swap parameters
  // -----------------------------------------------------------------
  const path = [WETH_ADDR, MMM_ADDR];
  const deadline = Math.floor(Date.now() / 1000) + 1200;
  const buyAmount = ethers.parseEther("0.01");

  console.log("Preparing swap...");

  // -----------------------------------------------------------------
  // 5. Gas estimation (with fallback)
  // -----------------------------------------------------------------
  let gasLimit;
  try {
    const gasEstimate = await router.swapExactETHForTokensSupportingFeeOnTransferTokens.estimateGas(
      0,
      path,
      fresh.address,
      deadline,
      { value: buyAmount }
    );
    console.log("Estimated gas:", gasEstimate.toString());
    gasLimit = gasEstimate * 120n / 100n;
  } catch (e) {
    console.log("Gas estimation failed, using fallback of 2,000,000 gas.");
    gasLimit = 2_000_000;
  }

  // -----------------------------------------------------------------
  // 6. Execute the swap
  // -----------------------------------------------------------------
  console.log("Sending transaction...");
  const tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
    0,
    path,
    fresh.address,
    deadline,
    { value: buyAmount, gasLimit }
  );

  console.log("Tx sent:", tx.hash);
  const receipt = await tx.wait();
  console.log("Status:", receipt.status === 1 ? "✅ Success" : "❌ Reverted");
  console.log("Gas used:", receipt.gasUsed.toString());

  if (receipt.status !== 1) {
    console.log("Reverted.");
    return;
  }

  // -----------------------------------------------------------------
  // 7. Post-swap results
  // -----------------------------------------------------------------
  const mmmAfter = await mmm.balanceOf(fresh.address);
  const taxAfter = await mmm.balanceOf(taxVaultAddr);

  const received = mmmAfter - mmmBefore;
  const taxCollected = taxAfter - taxBefore;
  const gross = received + taxCollected;
  const effectiveTax =
    gross > 0n
      ? ((Number(taxCollected) * 100) / Number(gross)).toFixed(2)
      : "0.00";

  console.log("\n── Results ──────────────────────────────");
  console.log("MMM received (net):   ", ethers.formatUnits(received, 18));
  console.log("Tax collected (MMM):  ", ethers.formatUnits(taxCollected, 18));
  console.log("Effective tax rate:   ", effectiveTax + "%");
  console.log("TaxVault total (MMM): ", ethers.formatUnits(taxAfter, 18));
  console.log("─────────────────────────────────────────");
  console.log("\n=== DONE ===\n");
}

main().catch((e) => {
  console.error("Swap failed:");
  console.error(e);
  process.exit(1);
});