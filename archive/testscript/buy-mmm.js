// scripts/buy-mmm-fixed.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;

  // === NEW ADDRESSES ===
  const MMM_ADDRESS   = "0x27Badfbd4836d392E1E87487C0EE22A1E90dC096"; // NEW MMM
  const ROUTER_ADDR   = "0xfb8e1c3b833f9e67a71c859a132cf783b645e436";
  const WMON_ADDRESS  = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";

  const [user] = await ethers.getSigners();
  console.log("Using wallet:", user.address);
  console.log("Network:", hre.network.name);

  // ---- ABIs ----
  const MMM_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function taxTokens() view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function buyTaxBps() view returns (uint256)",
    "function sellTaxBps() view returns (uint256)",
    "function ammPairs(address) view returns (bool)"
  ];

  const WMON_ABI = [
    "function deposit() payable",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function symbol() view returns (string)"
  ];

  const ROUTER_ABI = [
    "function swapExactTokensForTokensSupportingFeeOnTransferTokens(" +
    "uint256 amountIn," +
    "uint256 amountOutMin," +
    "address[] calldata path," +
    "address to," +
    "uint256 deadline" +
    ") external",
    "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)",
    "function factory() view returns (address)",
    "function WETH() view returns (address)"
  ];

  const FACTORY_ABI = [
    "function getPair(address tokenA, address tokenB) view returns (address pair)"
  ];

  const PAIR_ABI = [
    "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function totalSupply() view returns (uint256)"
  ];

  const provider = ethers.provider;
  const mmm   = new ethers.Contract(MMM_ADDRESS, MMM_ABI, provider);
  const wmon  = new ethers.Contract(WMON_ADDRESS, WMON_ABI, user);
  const router = new ethers.Contract(ROUTER_ADDR, ROUTER_ABI, user);

  console.log("🛒 Testing Buy with NEW MMM Contract");
  console.log("=".repeat(50));

  // Get token info
  const [mmmSymbol, mmmDecimals, wmonSymbol, buyTax, sellTax] = await Promise.all([
    mmm.symbol(),
    mmm.decimals(),
    wmon.symbol(),
    mmm.buyTaxBps(),
    mmm.sellTaxBps()
  ]);

  console.log(`Token: ${mmmSymbol}`);
  console.log(`Buy Tax: ${Number(buyTax) / 100}%`); // Fixed: Convert BigInt to Number
  console.log(`Sell Tax: ${Number(sellTax) / 100}%`);

  // 1. Get pool address
  console.log("\n🔍 Finding pool address...");
  const factoryAddr = await router.factory();
  const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider);
  const WETH = await router.WETH();
  const pairAddress = await factory.getPair(MMM_ADDRESS, WETH);
  
  if (pairAddress === ethers.ZeroAddress) {
    console.log("❌ NO POOL FOUND!");
    console.log("You need to create a liquidity pool first.");
    console.log("Run: npx hardhat run scripts/create-pool-new.js --network monadTestnet");
    return;
  }
  
  console.log(`✅ Pool found: ${pairAddress}`);
  
  // Check if pool is set as AMM pair
  const isAMMPair = await mmm.ammPairs(pairAddress);
  console.log(`Pool is AMM pair: ${isAMMPair ? "✅ Yes" : "❌ No (tax won't work!)"}`);
  
  if (!isAMMPair) {
    console.log("\n⚠️  WARNING: Pool is not set as AMM pair!");
    console.log("Taxes will NOT be collected until you set it.");
    console.log("Run: npx hardhat run scripts/set-pair-new.js --network monadTestnet");
  }

  // Get pool info
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
  const [reserves, token0] = await Promise.all([
    pair.getReserves(),
    pair.token0()
  ]);

  let wmonReserve, mmmReserve;
  if (token0.toLowerCase() === WETH.toLowerCase()) {
    wmonReserve = reserves[0];
    mmmReserve = reserves[1];
  } else {
    wmonReserve = reserves[1];
    mmmReserve = reserves[0];
  }

  // Convert BigInt to Number for calculations
  const wmonReserveNum = Number(wmonReserve);
  const mmmReserveNum = Number(mmmReserve);
  const mmmDecimalsNum = Number(mmmDecimals);
  
  console.log("\n📊 Pool State:");
  console.log(`${wmonSymbol} Reserve: ${ethers.formatEther(wmonReserve)}`);
  console.log(`${mmmSymbol} Reserve: ${ethers.formatUnits(mmmReserve, mmmDecimals)}`);
  console.log(`Price: 1 ${mmmSymbol} = ${(wmonReserveNum / mmmReserveNum).toFixed(8)} ${wmonSymbol}`);

  // How much MON to wrap & swap
  const amountMon = ethers.parseEther("0.01"); // 0.01 MON - small test
  
  console.log(`\n💰 Buy amount: ${ethers.formatEther(amountMon)} MON`);

  // Get initial balances and tax
  const [mmmBefore, taxBefore, monBefore] = await Promise.all([
    mmm.balanceOf(user.address),
    mmm.taxTokens(),
    provider.getBalance(user.address)
  ]);

  console.log("\n=== BEFORE BUY ===");
  console.log(`MON balance : ${ethers.formatEther(monBefore)}`);
  console.log(`${mmmSymbol} balance : ${ethers.formatUnits(mmmBefore, mmmDecimals)}`);
  console.log(`Tax pool    : ${ethers.formatUnits(taxBefore, mmmDecimals)} ${mmmSymbol}`);

  // 1) Wrap MON → wMON
  console.log(`\n💱 Wrapping ${ethers.formatEther(amountMon)} MON into ${wmonSymbol}...`);
  let tx = await wmon.deposit({ value: amountMon });
  console.log("Deposit tx:", tx.hash);
  await tx.wait();

  const wmonBal = await wmon.balanceOf(user.address);
  console.log(`${wmonSymbol} balance after wrap: ${ethers.formatEther(wmonBal)}`);

  // 2) Approve router to spend wMON
  console.log(`\n✅ Approving router to spend ${wmonSymbol}...`);
  tx = await wmon.approve(ROUTER_ADDR, wmonBal);
  await tx.wait();
  console.log("Approved");

  // 3) Estimate output
  console.log(`\n📈 Estimating swap output...`);
  try {
    const amounts = await router.getAmountsOut(
      wmonBal,
      [WMON_ADDRESS, MMM_ADDRESS]
    );
    
    const estimatedOutput = amounts[1];
    console.log(`Estimated: ${ethers.formatEther(wmonBal)} ${wmonSymbol} → ${ethers.formatUnits(estimatedOutput, mmmDecimals)} ${mmmSymbol}`);
    
    // Set minimum output with 50% slippage (high for testing)
    const amountOutMin = estimatedOutput * 50n / 100n; // 50% of estimated
    console.log(`Minimum accepted: ${ethers.formatUnits(amountOutMin, mmmDecimals)} ${mmmSymbol} (50% slippage)`);
    
    // 4) Swap with fee-on-transfer support
    console.log(`\n🔄 Swapping ${wmonSymbol} for ${mmmSymbol} (with fee-on-transfer)...`);
    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
    
    tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
      wmonBal,                    // amountIn
      amountOutMin,               // amountOutMin
      [WMON_ADDRESS, MMM_ADDRESS], // path
      user.address,               // to
      deadline                    // deadline
    );
    
    console.log("Swap tx:", tx.hash);
    await tx.wait();
    console.log("✅ Swap completed!");
    
  } catch (error) {
    console.log("❌ Error during swap:", error.message);
    
    // Try with 0 minimum
    console.log("\n⚠️  Trying with 0 minimum output...");
    try {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      
      tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        wmonBal,
        0, // Accept any output
        [WMON_ADDRESS, MMM_ADDRESS],
        user.address,
        deadline
      );
      
      console.log("Swap tx (0 min):", tx.hash);
      await tx.wait();
      console.log("✅ Swap completed with 0 minimum!");
    } catch (error2) {
      console.log("❌ Swap failed even with 0 minimum:", error2.message);
      return;
    }
  }

  // 5) Check results
  console.log("\n=== AFTER BUY ===");
  const [mmmAfter, taxAfter, monAfter] = await Promise.all([
    mmm.balanceOf(user.address),
    mmm.taxTokens(),
    provider.getBalance(user.address)
  ]);

  const mmmReceived = mmmAfter - mmmBefore;
  const taxCollected = taxAfter - taxBefore;

  console.log(`MON spent     : ${ethers.formatEther(monBefore - monAfter)}`);
  console.log(`${mmmSymbol} received : ${ethers.formatUnits(mmmReceived, mmmDecimals)}`);
  console.log(`${mmmSymbol} balance  : ${ethers.formatUnits(mmmAfter, mmmDecimals)}`);
  console.log(`Tax collected : ${ethers.formatUnits(taxCollected, mmmDecimals)} ${mmmSymbol}`);
  console.log(`Total tax pool: ${ethers.formatUnits(taxAfter, mmmDecimals)} ${mmmSymbol}`);

  // Check if tax was collected
  if (taxCollected > 0n) {
    console.log(`\n🎉 SUCCESS: Tax of ${ethers.formatUnits(taxCollected, mmmDecimals)} ${mmmSymbol} was collected!`);
    
    // Calculate effective tax rate (convert to Number for division)
    if (mmmReceived > 0n) {
      const effectiveTaxRate = (Number(taxCollected) / Number(mmmReceived + taxCollected)) * 100;
      console.log(`Effective tax rate: ${effectiveTaxRate.toFixed(2)}%`);
      
      // Compare with expected tax
      const expectedTaxRate = Number(buyTax) / 100;
      console.log(`Expected tax rate: ${expectedTaxRate}%`);
    }
  } else {
    console.log(`\n⚠️  No tax collected! Possible issues:`);
    console.log(`1. Pool not set as AMM pair (run set-pair-new.js)`);
    console.log(`2. Buy tax is 0% (check contract: ${Number(buyTax)} bps)`);
    console.log(`3. Router not excluded from fees`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ Buy test complete!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});