// scripts/remove_liquidity_and_withdraw_mon.js
// Removes liquidity from pool and withdraws MON from tracker
const hre = require("hardhat");
const { ethers } = hre;

const CONFIG = {
  mmmToken: "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16",
  tracker: "0x5B870DAa512DB9DADEbD53d55045BAE798B4B86B",
  pool: "0x7d4A5Ed4C366aFa71c5b4158b2F203B1112AC7FD",
  router: "0x53FE6D2499742779BF2Bd12a23e3c102fAe9fEcA",
  wmon: "0x51C0bb68b65bd84De6518C939CB9Dbe2d6Fa7079"
};

// ABIs
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)"
];

const PAIR_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function getReserves() view returns (uint112, uint112, uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function burn(address to) returns (uint amount0, uint amount1)"
];

const WMON_ABI = [
  "function withdraw(uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
];

const TRACKER_ABI = [
  "function owner() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function emergencyWithdrawETH(uint256 amount) external",
  "function earned(address) view returns (uint256)",
  "function claim() external",
  "function withdrawable(address) view returns (uint256)"
];

async function main() {
  console.log("🔓 Remove Liquidity & Withdraw MON");
  console.log("==================================\n");

  const [signer] = await ethers.getSigners();
  console.log(`👤 Using account: ${signer.address}`);
  console.log(`📊 Network: ${hre.network.name}\n`);

  // Setup contracts
  const pair = new ethers.Contract(CONFIG.pool, PAIR_ABI, signer);
  const mmm = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, signer);
  const wmon = new ethers.Contract(CONFIG.wmon, WMON_ABI, signer);
  const tracker = new ethers.Contract(CONFIG.tracker, TRACKER_ABI, signer);

  // ============================================
  // STEP 1: Check LP Token Balance
  // ============================================
  console.log("📊 Checking LP token balance...");
  const lpBalance = await pair.balanceOf(signer.address);
  console.log(`   LP Balance: ${ethers.formatEther(lpBalance)} LP tokens`);

  if (lpBalance === 0n) {
    console.log("❌ No LP tokens found. Cannot remove liquidity.");
    return;
  }

  // Get pool reserves to calculate expected output
  const [reserve0, reserve1, blockTimestampLast] = await pair.getReserves();
  const totalSupply = await pair.totalSupply();
  const token0 = await pair.token0();
  const token1 = await pair.token1();
  
  const isMMMFirst = token0.toLowerCase() === CONFIG.mmmToken.toLowerCase();
  const mmmReserve = isMMMFirst ? reserve0 : reserve1;
  const monReserve = isMMMFirst ? reserve1 : reserve0;

  // Calculate expected amounts (proportional to LP share)
  const mmmExpected = (mmmReserve * lpBalance) / totalSupply;
  const monExpected = (monReserve * lpBalance) / totalSupply;

  console.log(`\n📈 Pool Reserves:`);
  console.log(`   MMM: ${ethers.formatUnits(mmmReserve, 18)}`);
  console.log(`   MON: ${ethers.formatEther(monReserve)}`);
  console.log(`   Total LP Supply: ${ethers.formatEther(totalSupply)}`);
  
  console.log(`\n💰 Expected output (for your LP share):`);
  console.log(`   MMM: ~${ethers.formatUnits(mmmExpected, 18)}`);
  console.log(`   MON: ~${ethers.formatEther(monExpected)}`);

  // ============================================
  // STEP 2: Remove Liquidity
  // ============================================
  console.log("\n🔄 Removing liquidity from pool...");
  console.log(`   Removing ${ethers.formatEther(lpBalance)} LP tokens...`);

  // Get current balances before removal
  const mmmBalanceBefore = await mmm.balanceOf(signer.address);
  const wmonBalanceBefore = await wmon.balanceOf(signer.address);
  const monBalanceBefore = await ethers.provider.getBalance(signer.address);

  // Calculate amounts to receive (proportional to LP share)
  const mmmAmount = (mmmReserve * lpBalance) / totalSupply;
  const wmonAmount = (monReserve * lpBalance) / totalSupply;

  console.log(`   Expected to receive:`);
  console.log(`   MMM: ${ethers.formatUnits(mmmAmount, 18)}`);
  console.log(`   WMON: ${ethers.formatEther(wmonAmount)}`);

  try {
    // Try direct removal using pair.burn()
    // First, transfer LP tokens to the pair contract
    console.log("   Transferring LP tokens to pair contract...");
    const transferTx = await pair.transfer(CONFIG.pool, lpBalance, { gasLimit: 150000 });
    console.log(`   Transfer tx: ${transferTx.hash}`);
    await transferTx.wait();
    console.log("   ✅ LP tokens transferred to pair");

    // Now try to burn them - this should return the underlying tokens
    console.log("   Burning LP tokens to remove liquidity...");
    try {
      const burnTx = await pair.burn(signer.address, { gasLimit: 500000 });
      console.log(`   Burn tx: ${burnTx.hash}`);
      console.log("   ⏳ Waiting for confirmation...");
      const receipt = await burnTx.wait();
      console.log("   ✅ Liquidity removed successfully!");
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

      // Check balances after removal
      const mmmBalanceAfter = await mmm.balanceOf(signer.address);
      const wmonBalanceAfter = await wmon.balanceOf(signer.address);
      
      console.log(`\n   Tokens received:`);
      console.log(`   MMM: ${ethers.formatUnits(mmmBalanceAfter - mmmBalanceBefore, 18)}`);
      console.log(`   WMON: ${ethers.formatEther(wmonBalanceAfter - wmonBalanceBefore)}`);

      // Unwrap WMON to MON if we received any
      if (wmonBalanceAfter > wmonBalanceBefore) {
        const wmonReceived = wmonBalanceAfter - wmonBalanceBefore;
        console.log("\n   Unwrapping WMON to MON...");
        const unwrapTx = await wmon.withdraw(wmonReceived, { gasLimit: 150000 });
        console.log(`   Unwrap tx: ${unwrapTx.hash}`);
        await unwrapTx.wait();
        console.log("   ✅ WMON unwrapped to MON");
      }
    } catch (burnError) {
      // If burn fails, the pair might not expose it publicly
      console.log("   ⚠️  Direct burn failed (pair may not expose burn function)");
      console.log("   Error:", burnError.message);
      console.log("\n   💡 SOLUTION: You need to deploy a helper contract or use a standard router");
      console.log("   A helper contract 'LiquidityRemover.sol' has been created in contracts/");
      console.log("   Deploy it and use it to remove liquidity, or use a standard Uniswap V2 router");
      throw new Error("Cannot remove liquidity - pair doesn't expose burn function. Deploy helper contract.");
    }
  } catch (error) {
    console.error("   ❌ Failed to remove liquidity:", error.message);
    throw error;
  }

  // ============================================
  // STEP 3: Withdraw MON from Tracker
  // ============================================
  console.log("\n💰 Withdrawing MON from tracker...");

  // Check tracker balance
  const trackerBalance = await ethers.provider.getBalance(CONFIG.tracker);
  console.log(`   Tracker balance: ${ethers.formatEther(trackerBalance)} MON`);

  if (trackerBalance === 0n) {
    console.log("   ⚠️  Tracker has no MON balance");
  } else {
    // Check if signer is owner
    const trackerOwner = await tracker.owner();
    const isOwner = trackerOwner.toLowerCase() === signer.address.toLowerCase();

    if (isOwner) {
      console.log("   ✅ You are the tracker owner");
      console.log(`   Withdrawing ${ethers.formatEther(trackerBalance)} MON...`);

      try {
        const withdrawTx = await tracker.emergencyWithdrawETH(trackerBalance, {
          gasLimit: 100000
        });
        console.log(`   Transaction: ${withdrawTx.hash}`);
        console.log("   ⏳ Waiting for confirmation...");
        const receipt = await withdrawTx.wait();
        console.log("   ✅ MON withdrawn successfully!");
        console.log(`   Block: ${receipt.blockNumber}`);
      } catch (error) {
        console.error("   ❌ Failed to withdraw from tracker:", error.message);
        throw error;
      }
    } else {
      console.log("   ⚠️  You are not the tracker owner");
      console.log(`   Owner: ${trackerOwner}`);
      
      // Check if user has claimable rewards
      const earned = await tracker.earned(signer.address);
      const withdrawable = await tracker.withdrawable(signer.address);
      
      console.log(`   Your earned rewards: ${ethers.formatEther(earned)} MON`);
      console.log(`   Your withdrawable: ${ethers.formatEther(withdrawable)} MON`);

      if (withdrawable > 0n) {
        console.log("   Attempting to claim rewards...");
        try {
          const claimTx = await tracker.claim({ gasLimit: 200000 });
          console.log(`   Transaction: ${claimTx.hash}`);
          console.log("   ⏳ Waiting for confirmation...");
          const receipt = await claimTx.wait();
          console.log("   ✅ Rewards claimed successfully!");
          console.log(`   Block: ${receipt.blockNumber}`);
        } catch (error) {
          console.error("   ❌ Failed to claim rewards:", error.message);
        }
      } else {
        console.log("   No claimable rewards found");
      }
    }
  }

  // ============================================
  // STEP 4: Final Balances
  // ============================================
  console.log("\n📊 Final Balances:");
  const finalMonBalance = await ethers.provider.getBalance(signer.address);
  const finalMmmBalance = await mmm.balanceOf(signer.address);
  const finalLpBalance = await pair.balanceOf(signer.address);

  console.log(`   MON: ${ethers.formatEther(finalMonBalance)}`);
  console.log(`   MMM: ${ethers.formatUnits(finalMmmBalance, 18)}`);
  console.log(`   LP: ${ethers.formatEther(finalLpBalance)}`);

  console.log("\n🎉 Complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

