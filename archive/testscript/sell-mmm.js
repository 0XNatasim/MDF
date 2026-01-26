// scripts/sell-mmm-test.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  
  const MMM_ADDRESS = "0x27Badfbd4836d392E1E87487C0EE22A1E90dC096";
  const ROUTER_ADDR = "0xfb8e1c3b833f9e67a71c859a132cf783b645e436";
  const WMON_ADDRESS = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
  const POOL_ADDRESS = "0x2B8dB008429b5320fb435289D4902c297Fb9f70e";
  
  const [user] = await ethers.getSigners();
  
  const mmm = new ethers.Contract(MMM_ADDRESS, [
    "function balanceOf(address) view returns (uint256)",
    "function taxTokens() view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function sellTaxBps() view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
  ], user);
  
  const wmon = new ethers.Contract(WMON_ADDRESS, [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)"
  ], user);
  
  const router = new ethers.Contract(ROUTER_ADDR, [
    "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256) external",
    "function getAmountsOut(uint256,address[]) view returns (uint256[])"
  ], user);
  
  console.log("💰 Testing Sell Tax");
  console.log("=".repeat(50));
  
  const [mmmBalance, taxBefore, sellTax, decimals, symbol] = await Promise.all([
    mmm.balanceOf(user.address),
    mmm.taxTokens(),
    mmm.sellTaxBps(),
    mmm.decimals(),
    mmm.symbol()
  ]);
  
  console.log(`Your ${symbol} balance: ${ethers.formatUnits(mmmBalance, decimals)}`);
  console.log(`Current tax pool: ${ethers.formatUnits(taxBefore, decimals)}`);
  console.log(`Sell tax: ${Number(sellTax) / 100}%`);
  
  // Sell a small amount
  const sellAmount = ethers.parseUnits("1000", decimals); // 1000 MMM
  
  if (mmmBalance < sellAmount) {
    console.log(`❌ Not enough ${symbol}. Need ${ethers.formatUnits(sellAmount, decimals)}`);
    return;
  }
  
  // Approve router to spend MMM
  console.log(`\n✅ Approving router to spend ${symbol}...`);
  const approveTx = await mmm.approve(ROUTER_ADDR, sellAmount);
  await approveTx.wait();
  
  // Estimate output
  const amounts = await router.getAmountsOut(
    sellAmount,
    [MMM_ADDRESS, WMON_ADDRESS]
  );
  
  const estimatedWMON = amounts[1];
  console.log(`Estimated: ${ethers.formatUnits(sellAmount, decimals)} ${symbol} → ${ethers.formatEther(estimatedWMON)} WMON`);
  
  // Sell with 50% slippage tolerance
  const minOut = estimatedWMON * 50n / 100n;
  
  console.log(`\n🔄 Selling ${symbol} for WMON...`);
  const deadline = Math.floor(Date.now() / 1000) + 300;
  
  const sellTx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
    sellAmount,
    minOut,
    [MMM_ADDRESS, WMON_ADDRESS],
    user.address,
    deadline
  );
  
  console.log(`Sell tx: ${sellTx.hash}`);
  await sellTx.wait();
  
  // Check tax collection
  const taxAfter = await mmm.taxTokens();
  const taxCollected = taxAfter - taxBefore;
  
  console.log(`\n📊 Results:`);
  console.log(`Tax collected: ${ethers.formatUnits(taxCollected, decimals)} ${symbol}`);
  
  if (taxCollected > 0n) {
    const expectedTax = sellAmount * sellTax / 10000n;
    console.log(`Expected tax (${Number(sellTax)/100}%): ${ethers.formatUnits(expectedTax, decimals)} ${symbol}`);
    console.log("✅ Sell tax working!");
  } else {
    console.log("❌ No sell tax collected");
  }
}

main();