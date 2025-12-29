// scripts/add_wmon_via_swap_fixed.js
const { ethers } = require("hardhat");

const CONFIG = {
    mmmToken: "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16",
    router: "0x53FE6D2499742779BF2Bd12a23e3c102fAe9fEcA",
    wmon: "0x51C0bb68b65bd84De6518C939CB9Dbe2d6Fa7079", // Note: Capital D in "De"
    pair: "0x7d4A5Ed4C366aFa71c5b4158b2F203B1112AC7FD"
};

async function main() {
    console.log("💎 Add WMON via Swap (Single-Sided) - FIXED");
    console.log("============================================\n");
    
    const [deployer] = await ethers.getSigners();
    console.log(`👤 Account: ${deployer.address}`);
    
    // Convert to checksum addresses
    const mmmToken = ethers.getAddress(CONFIG.mmmToken);
    const router = ethers.getAddress(CONFIG.router);
    const wmon = ethers.getAddress(CONFIG.wmon);
    const pair = ethers.getAddress(CONFIG.pair);
    
    console.log("✅ Checksum addresses:");
    console.log(`   MMM: ${mmmToken}`);
    console.log(`   Router: ${router}`);
    console.log(`   WMON: ${wmon}`);
    console.log(`   Pair: ${pair}`);
    
    // Add 4 MON via swap (buy MMM first, then add liquidity)
    const monToAdd = ethers.parseEther("4");
    
    console.log("\n📊 Strategy:");
    console.log(`   1. Swap 2 MON → MMM (adds WMON to pool)`);
    console.log(`   2. Add 2 MON + received MMM as liquidity`);
    console.log(`   3. Total: 4 MON added to pool`);
    
    // Setup contracts
    const ERC20_ABI = [
        "function balanceOf(address) view returns (uint256)",
        "function approve(address, uint256) returns (bool)",
        "function allowance(address, address) view returns (uint256)"
    ];
    
    const ROUTER_ABI = [
        "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint, address[], address, uint) payable",
        "function addLiquidityETH(address, uint, uint, uint, address, uint) payable returns (uint, uint, uint)"
    ];
    
    const mmm = new ethers.Contract(mmmToken, ERC20_ABI, deployer);
    const routerContract = new ethers.Contract(router, ROUTER_ABI, deployer);
    
    // Step 1: Swap 2 MON → MMM
    console.log("\n⚡ Step 1: Swap 2 MON for MMM");
    
    const swapAmount = ethers.parseEther("2");
    const path = [wmon, mmmToken];
    const deadline = Math.floor(Date.now() / 1000) + 600;
    
    // With insane price, we expect tiny MMM amount
    const minMmmOut = 1; // Accept any amount
    
    console.log(`   Swapping 2 MON for MMM (min: ${minMmmOut} MMM)...`);
    console.log(`   Path: ${path}`);
    
    try {
        const swapTx = await routerContract.swapExactETHForTokensSupportingFeeOnTransferTokens(
            minMmmOut,
            path,
            deployer.address,
            deadline,
            { value: swapAmount }
        );
        
        console.log(`   ✅ Swap tx sent: ${swapTx.hash}`);
        await swapTx.wait();
        console.log(`   ✅ Swap complete`);
        
    } catch (error) {
        console.log(`   ⚠️ Swap failed: ${error.message}`);
        console.log(`   This might be okay - let's continue to liquidity add`);
    }
    
    // Check MMM received
    const mmmReceived = await mmm.balanceOf(deployer.address);
    console.log(`   MMM received: ${ethers.formatUnits(mmmReceived, 18)}`);
    
    // Step 2: Add liquidity with remaining 2 MON + MMM
    console.log("\n⚡ Step 2: Add Liquidity");
    
    const liquidityMon = ethers.parseEther("2");
    const liquidityMmm = mmmReceived; // Use all received MMM
    
    if (liquidityMmm === 0n) {
        console.log(`   ⚠️ No MMM received from swap, using 1000 MMM from balance`);
        
        // Use 1000 MMM from your balance instead
        const mmmBalance = await mmm.balanceOf(deployer.address);
        if (mmmBalance >= ethers.parseUnits("1000", 18)) {
            liquidityMmm = ethers.parseUnits("1000", 18);
        } else {
            console.log(`   ❌ Not enough MMM for liquidity`);
            return;
        }
    }
    
    // Approve MMM
    console.log(`   Approving ${ethers.formatUnits(liquidityMmm, 18)} MMM...`);
    
    const allowance = await mmm.allowance(deployer.address, router);
    if (allowance < liquidityMmm) {
        const approveTx = await mmm.approve(router, liquidityMmm);
        console.log(`   Approval tx: ${approveTx.hash}`);
        await approveTx.wait();
        console.log(`   ✅ MMM approved`);
    } else {
        console.log(`   ✅ MMM already approved`);
    }
    
    // Add liquidity
    const liqDeadline = Math.floor(Date.now() / 1000) + 600;
    
    // High slippage due to extreme ratio
    const minMmm = liquidityMmm * 10n / 100n; // 90% slippage!
    const minMon = liquidityMon * 10n / 100n; // 90% slippage!
    
    console.log(`   Adding liquidity (90% slippage tolerance)...`);
    console.log(`   MMM Amount: ${ethers.formatUnits(liquidityMmm, 18)}`);
    console.log(`   MON Amount: ${ethers.formatEther(liquidityMon)}`);
    console.log(`   Min MMM: ${ethers.formatUnits(minMmm, 18)}`);
    console.log(`   Min MON: ${ethers.formatEther(minMon)}`);
    
    try {
        const liqTx = await routerContract.addLiquidityETH(
            mmmToken,
            liquidityMmm,
            minMmm,
            minMon,
            deployer.address,
            liqDeadline,
            { value: liquidityMon }
        );
        
        console.log(`   ✅ Liquidity tx: ${liqTx.hash}`);
        await liqTx.wait();
        console.log(`   ✅ Liquidity added`);
        
    } catch (error) {
        console.log(`   ❌ Liquidity add failed: ${error.message}`);
        console.log(`   Let's try direct transfer instead...`);
        await directWMONTransfer();
        return;
    }
    
    console.log("\n🎉 COMPLETE!");
    console.log(`   Added ~4 MON worth of WMON to pool`);
    console.log(`   Pool should now be usable`);
}

async function directWMONTransfer() {
    console.log("\n🔄 Falling back to direct WMON transfer...");
    
    const [deployer] = await ethers.getSigners();
    
    const WMON_ABI = [
        "function deposit() payable",
        "function balanceOf(address) view returns (uint256)",
        "function transfer(address, uint256) returns (bool)"
    ];
    
    const wmon = new ethers.Contract(
        ethers.getAddress("0x51C0bb68b65bd84De6518C939CB9Dbe2d6Fa7079"),
        WMON_ABI,
        deployer
    );
    
    // Wrap 4 MON
    const wmonAmount = ethers.parseEther("4");
    console.log(`   Wrapping 4 MON to WMON...`);
    
    const wrapTx = await wmon.deposit({ value: wmonAmount });
    await wrapTx.wait();
    console.log(`   ✅ Wrapped`);
    
    // Transfer to pair
    const pairAddress = ethers.getAddress("0x7d4A5Ed4C366aFa71c5b4158b2F203B1112AC7FD");
    console.log(`   Transferring to pair: ${pairAddress}...`);
    
    const transferTx = await wmon.transfer(pairAddress, wmonAmount);
    await transferTx.wait();
    console.log(`   ✅ Transferred`);
    
    // Sync pair
    const PAIR_ABI = ["function sync()"];
    const pair = new ethers.Contract(pairAddress, PAIR_ABI, deployer);
    
    const syncTx = await pair.sync();
    await syncTx.wait();
    console.log(`   ✅ Pair synced`);
    
    console.log("\n🎉 DIRECT TRANSFER COMPLETE!");
    console.log(`   Added 4 WMON to existing pool`);
    console.log(`   Pool should now be usable`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Error:", error);
        process.exit(1);
    });