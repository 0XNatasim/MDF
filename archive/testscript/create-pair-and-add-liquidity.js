// scripts/create-pair-and-add-liquidity.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  const [user] = await ethers.getSigners();
  
  console.log("Creating MMM/wMON pair and adding liquidity...");
  console.log("Wallet:", user.address);
  
  // Configuration
  const MMM_ADDRESS = "0x08e3e7677DdBf2B4C7b45407e665E7726d4823dc";
  const WMON_ADDRESS = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
  const ROUTER_ADDR = "0xfb8e1c3b833f9e67a71c859a132cf783b645e436";
  const FACTORY_ADDR = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
  
  const provider = ethers.provider;
  
  // ABIs
  const FACTORY_ABI = [
    "function getPair(address tokenA, address tokenB) view returns (address)",
    "function createPair(address tokenA, address tokenB) returns (address)"
  ];
  
  const ROUTER_ABI = [
    "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)"
  ];
  
  const MMM_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function decimals() view returns (uint8)"
  ];
  
  try {
    const factory = new ethers.Contract(FACTORY_ADDR, FACTORY_ABI, user); // Use signer
    const router = new ethers.Contract(ROUTER_ADDR, ROUTER_ABI, user);
    const mmm = new ethers.Contract(MMM_ADDRESS, MMM_ABI, user);
    
    // Check if pair exists
    const existingPair = await factory.getPair(MMM_ADDRESS, WMON_ADDRESS);
    console.log("Existing pair:", existingPair);
    
    if (existingPair === "0x0000000000000000000000000000000000000000") {
      console.log("Pair doesn't exist. Creating pair...");
      
      // Create pair
      const tx = await factory.createPair(MMM_ADDRESS, WMON_ADDRESS, {
        gasLimit: 1000000
      });
      
      console.log("Create pair tx:", tx.hash);
      await tx.wait();
      console.log("✅ Pair created!");
      
      // Get new pair address
      const newPair = await factory.getPair(MMM_ADDRESS, WMON_ADDRESS);
      console.log("New pair address:", newPair);
    } else {
      console.log("✅ Pair already exists at:", existingPair);
    }
    
    // Now add liquidity
    console.log("\n=== Adding Liquidity ===");
    
    // Check MMM balance
    const mmmBalance = await mmm.balanceOf(user.address);
    const decimals = await mmm.decimals();
    console.log(`Your MMM balance: ${ethers.formatUnits(mmmBalance, decimals)} MMM`);
    
    // Check MON balance
    const monBalance = await provider.getBalance(user.address);
    console.log(`Your MON balance: ${ethers.formatEther(monBalance)} MON`);
    
    // Amounts to add (adjust as needed)
    const mmmAmount = ethers.parseUnits("1000", decimals); // 1000 MMM
    const monAmount = ethers.parseEther("0.1"); // 0.1 MON
    
    if (mmmBalance < mmmAmount) {
      console.log(`❌ Insufficient MMM. Need ${ethers.formatUnits(mmmAmount, decimals)} MMM`);
      return;
    }
    
    if (monBalance < monAmount) {
      console.log(`❌ Insufficient MON. Need ${ethers.formatEther(monAmount)} MON`);
      return;
    }
    
    console.log(`\nAdding liquidity:`);
    console.log(`- MMM: ${ethers.formatUnits(mmmAmount, decimals)}`);
    console.log(`- MON: ${ethers.formatEther(monAmount)}`);
    
    // Approve router to spend MMM
    console.log("\nApproving router to spend MMM...");
    const approveTx = await mmm.approve(ROUTER_ADDR, mmmAmount, {
      gasLimit: 100000
    });
    await approveTx.wait();
    console.log("✅ MMM approved");
    
    // Check allowance
    const allowance = await mmm.allowance(user.address, ROUTER_ADDR);
    console.log(`Allowance: ${ethers.formatUnits(allowance, decimals)} MMM`);
    
    // Add liquidity
    console.log("\nAdding liquidity...");
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
    
    const liquidityTx = await router.addLiquidityETH(
      MMM_ADDRESS,           // token
      mmmAmount,             // amountTokenDesired
      mmmAmount * 95n / 100n, // amountTokenMin (5% slippage)
      monAmount * 95n / 100n, // amountETHMin (5% slippage)
      user.address,          // to
      deadline,              // deadline
      {
        value: monAmount,
        gasLimit: 500000
      }
    );
    
    console.log("Add liquidity tx:", liquidityTx.hash);
    await liquidityTx.wait();
    console.log("✅ Liquidity added!");
    
    // Check new balances
    const newMmmBalance = await mmm.balanceOf(user.address);
    const newMonBalance = await provider.getBalance(user.address);
    
    console.log(`\nNew balances:`);
    console.log(`MMM: ${ethers.formatUnits(newMmmBalance, decimals)}`);
    console.log(`MON: ${ethers.formatEther(newMonBalance)}`);
    
    console.log("\n✅ Pool is now ready for swapping!");
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error("Full error:", error);
  }
}

main().catch(console.error);