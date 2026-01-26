// scripts/fixLiquidity.js - Professional liquidity fix
const { ethers } = require("hardhat");

const CONFIG = {
    mmmToken: "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16",
    router: "0x53FE6D2499742779BF2Bd12a23e3c102fAe9fEcA",
    factory: "0x8e8a713Be23d9be017d7A5f4D649982B5dD24615",
    wmon: "0x51C0bb68b65bd84De6518C939CB9dbe2d6Fa7079"
};

async function main() {
    console.log("🔧 MMM Liquidity Emergency Fix");
    console.log("===============================\n");
    
    const [deployer] = await ethers.getSigners();
    console.log(`👤 Using account: ${deployer.address}`);
    
    // Get balances
    const mmmBalance = await ethers.provider.getBalance(CONFIG.mmmToken);
    const deployerMonBalance = await ethers.provider.getBalance(deployer.address);
    
    console.log(`💰 Deployer MON Balance: ${ethers.formatEther(deployerMonBalance)} MON`);
    
    // Setup contracts
    const ERC20_ABI = [
        "function balanceOf(address) view returns (uint256)",
        "function approve(address, uint256) returns (bool)",
        "function allowance(address, address) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function transfer(address, uint256) returns (bool)"
    ];
    
    const ROUTER_ABI = [
        "function addLiquidityETH(address, uint, uint, uint, address, uint) payable returns (uint, uint, uint)",
        "function factory() view returns (address)"
    ];
    
    const FACTORY_ABI = ["function getPair(address, address) view returns (address)"];
    const PAIR_ABI = ["function getReserves() view returns (uint112, uint112, uint32)"];
    
    const mmm = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, deployer);
    const router = new ethers.Contract(CONFIG.router, ROUTER_ABI, deployer);
    const factory = new ethers.Contract(CONFIG.factory, FACTORY_ABI, deployer);
    
    // Check current pool
    console.log("\n📊 Checking pool status...");
    const pairAddress = await factory.getPair(CONFIG.mmmToken, CONFIG.wmon);
    
    if (pairAddress === ethers.ZeroAddress) {
        console.log("⚠️ Pool doesn't exist!");
    } else {
        const pair = new ethers.Contract(pairAddress, PAIR_ABI, deployer);
        const [reserve0, reserve1] = await pair.getReserves();
        
        const mmmReserve = reserve0;
        const wmonReserve = reserve1;
        
        console.log(`📈 Current reserves:`);
        console.log(`   MMM: ${ethers.formatUnits(mmmReserve, 18)}`);
        console.log(`   WMON: ${ethers.formatEther(wmonReserve)}`);
        console.log(`   Ratio: 1 MON = ${(ethers.formatUnits(mmmReserve, 18) / ethers.formatEther(wmonReserve)).toFixed(2)} MMM`);
        
        if (wmonReserve < ethers.parseEther("0.1")) {
            console.log("\n🚨 CRITICAL: Pool has almost no WMON!");
            console.log("   You need to add WMON liquidity immediately.");
        }
    }
    
    // Ask for amounts
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    const question = (query) => new Promise(resolve => readline.question(query, resolve));
    
    console.log("\n💧 Liquidity Addition");
    console.log("=====================");
    
    const mmmAmount = await question("Enter MMM amount to add (e.g., 10000): ");
    const monAmount = await question("Enter MON amount to add (e.g., 4): ");
    
    if (!mmmAmount || !monAmount) {
        console.log("❌ Amounts required.");
        readline.close();
        return;
    }
    
    const mmmWei = ethers.parseUnits(mmmAmount, 18);
    const monWei = ethers.parseEther(monAmount);
    
    console.log(`\n📋 Transaction Summary:`);
    console.log(`   Add: ${mmmAmount} MMM + ${monAmount} MON`);
    console.log(`   Value: ${ethers.formatEther(monWei)} MON`);
    
    const proceed = await question("\nProceed? (yes/no): ");
    
    if (proceed.toLowerCase() !== 'yes') {
        console.log("❌ Cancelled.");
        readline.close();
        return;
    }
    
    readline.close();
    
    // Execute
    console.log("\n⚡ Executing...");
    
    try {
        // Check MMM balance
        const deployerMmmBalance = await mmm.balanceOf(deployer.address);
        if (mmmWei > deployerMmmBalance) {
            console.log(`❌ Insufficient MMM. You have ${ethers.formatUnits(deployerMmmBalance, 18)} MMM`);
            return;
        }
        
        // Approve MMM
        console.log("🔄 Approving MMM...");
        const allowance = await mmm.allowance(deployer.address, CONFIG.router);
        
        if (allowance < mmmWei) {
            const approveTx = await mmm.approve(CONFIG.router, mmmWei);
            console.log(`   Approval tx: ${approveTx.hash}`);
            await approveTx.wait();
            console.log("✅ MMM approved");
        }
        
        // Add liquidity
        console.log("🔄 Adding liquidity...");
        const deadline = Math.floor(Date.now() / 1000) + 600;
        const minMmm = mmmWei * 95n / 100n;  // 5% slippage
        const minMon = monWei * 95n / 100n;  // 5% slippage
        
        const tx = await router.addLiquidityETH(
            CONFIG.mmmToken,
            mmmWei,
            minMmm,
            minMon,
            deployer.address,
            deadline,
            { value: monWei }
        );
        
        console.log(`✅ Transaction sent: ${tx.hash}`);
        console.log("⏳ Waiting for confirmation...");
        
        const receipt = await tx.wait();
        
        console.log("\n🎉 SUCCESS!");
        console.log(`   Block: ${receipt.blockNumber}`);
        console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
        console.log(`   Status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);
        
        // Verify
        console.log("\n🔍 Verifying new reserves...");
        const [newReserve0, newReserve1] = await pair.getReserves();
        console.log(`   New MMM reserve: ${ethers.formatUnits(newReserve0, 18)}`);
        console.log(`   New WMON reserve: ${ethers.formatEther(newReserve1)}`);
        
    } catch (error) {
        console.error(`\n❌ ERROR: ${error.message}`);
        if (error.transactionHash) {
            console.log(`   Failed tx: ${error.transactionHash}`);
        }
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });