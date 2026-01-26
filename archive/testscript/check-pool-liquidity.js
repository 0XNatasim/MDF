// scripts/check-pool-liquidity.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  const [user] = await ethers.getSigners();
  
  console.log("Checking MMM/wMON pool liquidity...");
  
  // Configuration
  const MMM_ADDRESS = "0x08e3e7677DdBf2B4C7b45407e665E7726d4823dc";
  const WMON_ADDRESS = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
  const ROUTER_ADDR = "0xfb8e1c3b833f9e67a71c859a132cf783b645e436";
  const FACTORY_ADDR = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"; // Uniswap V2 factory
  
  const provider = ethers.provider;
  
  // Factory ABI to get pair address
  const FACTORY_ABI = [
    "function getPair(address tokenA, address tokenB) view returns (address)",
    "function allPairsLength() view returns (uint256)"
  ];
  
  // Pair ABI to check liquidity
  const PAIR_ABI = [
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function totalSupply() view returns (uint256)",
    "function symbol() view returns (string)"
  ];
  
  // Router ABI for quotes
  const ROUTER_ABI = [
    "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)",
    "function factory() view returns (address)",
    "function WETH() view returns (address)"
  ];
  
  try {
    // Check factory
    const factory = new ethers.Contract(FACTORY_ADDR, FACTORY_ABI, provider);
    const pairCount = await factory.allPairsLength();
    console.log(`Total pairs in factory: ${pairCount}`);
    
    // Get pair address
    const pairAddress = await factory.getPair(MMM_ADDRESS, WMON_ADDRESS);
    console.log(`MMM/wMON pair address: ${pairAddress}`);
    
    if (pairAddress === "0x0000000000000000000000000000000000000000") {
      console.log("❌ Pair does NOT exist! You need to create it first.");
      console.log("\nTo create the pair:");
      console.log("1. Go to the DEX frontend (if exists)");
      console.log("2. Or create it via factory.createPair()");
      console.log("3. Then add liquidity");
      return;
    }
    
    console.log("✅ Pair exists!");
    
    // Check pair details
    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
    const [token0, token1, reserves, totalSupply] = await Promise.all([
      pair.token0(),
      pair.token1(),
      pair.getReserves(),
      pair.totalSupply()
    ]);
    
    console.log(`\n=== Pair Details ==="`);
    console.log(`Token0: ${token0} (${token0 === MMM_ADDRESS ? "MMM" : "wMON"})`);
    console.log(`Token1: ${token1} (${token1 === WMON_ADDRESS ? "wMON" : "MMM"})`);
    console.log(`Reserves:`);
    console.log(`  Reserve0: ${ethers.formatUnits(reserves.reserve0, 18)}`);
    console.log(`  Reserve1: ${ethers.formatUnits(reserves.reserve1, 18)}`);
    console.log(`Total Supply: ${ethers.formatUnits(totalSupply, 18)} LP tokens`);
    
    // Check if there's any liquidity
    if (reserves.reserve0 === 0n && reserves.reserve1 === 0n) {
      console.log("❌ Pair exists but has NO LIQUIDITY!");
      console.log("You need to add liquidity before swapping.");
      return;
    }
    
    console.log("✅ Pair has liquidity!");
    
    // Get quote from router
    const router = new ethers.Contract(ROUTER_ADDR, ROUTER_ABI, provider);
    const amountIn = ethers.parseEther("0.01"); // 0.01 MON
    const path = [WMON_ADDRESS, MMM_ADDRESS];
    
    try {
      const amounts = await router.getAmountsOut(amountIn, path);
      console.log(`\n=== Swap Quote ==="`);
      console.log(`Input: ${ethers.formatEther(amountIn)} MON`);
      console.log(`Output: ${ethers.formatUnits(amounts[1], 18)} MMM`);
      
      // Calculate price
      const price = amounts[1] * 1000000000000000000n / amountIn;
      console.log(`Price: 1 MON = ${ethers.formatUnits(price, 18)} MMM`);
      
    } catch (quoteError) {
      console.log("❌ Cannot get quote:", quoteError.message);
      console.log("The token might have restrictions (fee-on-transfer, etc.)");
    }
    
    // Check MMM token for restrictions
    console.log("\n=== Checking MMM Token ===");
    const MMM_ABI = [
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
      "function totalSupply() view returns (uint256)",
      // Check for fee mechanisms
      "function fee() view returns (uint256)",
      "function feeOnTransfer() view returns (bool)",
      "function taxFee() view returns (uint256)"
    ];
    
    const mmm = new ethers.Contract(MMM_ADDRESS, MMM_ABI, provider);
    
    try {
      const fee = await mmm.fee();
      console.log(`MMM fee: ${ethers.formatUnits(fee, 18)}`);
    } catch {
      console.log("MMM fee: Not found or 0");
    }
    
    try {
      const taxFee = await mmm.taxFee();
      console.log(`MMM taxFee: ${taxFee}%`);
    } catch {
      console.log("MMM taxFee: Not found or 0");
    }
    
    try {
      const feeOnTransfer = await mmm.feeOnTransfer();
      console.log(`MMM feeOnTransfer: ${feeOnTransfer}`);
      if (feeOnTransfer) {
        console.log("⚠️ Token has fee-on-transfer! Use swapExactETHForTokensSupportingFeeOnTransferTokens");
      }
    } catch {
      console.log("MMM feeOnTransfer: Not found or false");
    }
    
  } catch (error) {
    console.error("Error:", error.message);
  }
}

main().catch(console.error);