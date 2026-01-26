// scripts/create-pool-new.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;

  // === UPDATE WITH NEW ADDRESSES ===
const MMM_ADDRESS   = "0xE4bAA11CAb36579165b983da4cd42D01220D4786";
const ROUTER_ADDR   = process.env.UNISWAP_ROUTER || "0xfb8e1c3b833f9e67a71c859a132cf783b645e436";
const WMON_ADDRESS  = process.env.WMON || "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541";
const FACTORY_ADDR  = process.env.UNISWAP_FACTORY || "0x733e88f248b742db6c14c0b1713af5ad7fdd59d0";



  const [user] = await ethers.getSigners();
  console.log("Using wallet:", user.address);
  console.log("Network:", hre.network.name);

  // ---- ABIs ----
  const MMM_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
  ];

  const WMON_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function deposit() payable",
    "function symbol() view returns (string)"
  ];

  const ROUTER_ABI = [
    "function addLiquidityETH(" +
      "address token," +
      "uint amountTokenDesired," +
      "uint amountTokenMin," +
      "uint amountETHMin," +
      "address to," +
      "uint deadline" +
    ") external payable returns (uint amountToken, uint amountETH, uint liquidity)",
    "function factory() view returns (address)",
    "function WETH() view returns (address)"
  ];

  const FACTORY_ABI = [
    "function getPair(address tokenA, address tokenB) view returns (address pair)"
  ];

  const provider = ethers.provider;
  
  // Create contract instances
  const router = new ethers.Contract(ROUTER_ADDR, ROUTER_ABI, user);
  const mmm = new ethers.Contract(MMM_ADDRESS, MMM_ABI, user);
  const wmon = new ethers.Contract(WMON_ADDRESS, WMON_ABI, user);

  console.log("🏗️  Creating MMM-WMON Liquidity Pool");
  console.log("=".repeat(50));

  // 1. Check current balances
  console.log("\n💰 Checking balances...");
  const [mmmBalance, monBalance] = await Promise.all([
    mmm.balanceOf(user.address),
    provider.getBalance(user.address)
  ]);

  const mmmDecimals = await mmm.decimals();
  const mmmSymbol = await mmm.symbol();
  const wmonSymbol = await wmon.symbol();

  console.log(`Your ${mmmSymbol} balance: ${ethers.formatUnits(mmmBalance, mmmDecimals)}`);
  console.log(`Your MON balance: ${ethers.formatEther(monBalance)}`);

  // 2. Decide on liquidity amounts
  const wmonAmount = ethers.parseEther("0.05"); // 0.1 wMON = 0.1 MON
  const mmmAmount = ethers.parseUnits("50000", mmmDecimals); // 100,000 MMM
  
  // Initial price: 1 MMM = 0.000001 wMON (0.000001 MON)
  // 0.1 wMON / 100,000 MMM = 0.000001 wMON per MMM

  console.log("\n📊 Planned Liquidity:");
  console.log(`- ${ethers.formatEther(wmonAmount)} ${wmonSymbol} (${ethers.formatEther(wmonAmount)} MON)`);
  console.log(`- ${ethers.formatUnits(mmmAmount, mmmDecimals)} ${mmmSymbol}`);
  console.log(`- Initial price: 1 ${mmmSymbol} = ${(0.1 / 100000).toFixed(8)} ${wmonSymbol}`);

  // Check if we have enough balance
  if (monBalance < wmonAmount) {
    console.log(`❌ Insufficient MON balance. Need at least ${ethers.formatEther(wmonAmount)} MON`);
    return;
  }

  if (mmmBalance < mmmAmount) {
    console.log(`❌ Insufficient ${mmmSymbol} balance. Need at least ${ethers.formatUnits(mmmAmount, mmmDecimals)} ${mmmSymbol}`);
    return;
  }

  // 3. Check if pool already exists
  console.log("\n🔍 Checking if pool exists...");
  const factoryAddr = await router.factory();
  const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider);
  const existingPair = await factory.getPair(MMM_ADDRESS, WMON_ADDRESS);
  
  if (existingPair !== ethers.ZeroAddress) {
    console.log(`⚠️  Pool already exists at: ${existingPair}`);
    console.log("You can add more liquidity instead.");
    return;
  }

  console.log("✅ No pool exists yet - ready to create!");

  // 4. Wrap MON to wMON
  console.log("\n💱 Wrapping MON to wMON...");
  try {
    const wrapTx = await wmon.deposit({ value: wmonAmount });
    console.log(`Wrap tx hash: ${wrapTx.hash}`);
    await wrapTx.wait();
    console.log("✅ MON wrapped to wMON");
  } catch (error) {
    console.log("❌ Error wrapping MON:", error.message);
    return;
  }

  // Check wMON balance
  const wmonBalance = await wmon.balanceOf(user.address);
  console.log(`wMON balance: ${ethers.formatEther(wmonBalance)}`);

  // 5. Approve tokens for router
  console.log("\n✅ Approving tokens for router...");
  
  try {
    // Approve MMM
    console.log(`Approving ${mmmSymbol}...`);
    const approveMmmTx = await mmm.approve(ROUTER_ADDR, mmmAmount);
    await approveMmmTx.wait();
    console.log(`✅ ${mmmSymbol} approved`);

    // Approve wMON
    console.log(`Approving ${wmonSymbol}...`);
    const approveWmonTx = await wmon.approve(ROUTER_ADDR, wmonAmount);
    await approveWmonTx.wait();
    console.log(`✅ ${wmonSymbol} approved`);
  } catch (error) {
    console.log("❌ Error approving tokens:", error.message);
    return;
  }

  // 6. Add liquidity (using addLiquidityETH for simplicity)
  console.log("\n➕ Adding liquidity to pool...");
  
  // Note: Since router expects ETH not wMON, we need to use addLiquidityETH
  // which automatically wraps ETH to WETH
  
  const amountTokenMin = 0; // Minimum MMM to add
  const amountETHMin = 0;   // Minimum ETH/MON to add
  
  // Deadline 20 minutes from now
  const deadline = Math.floor(Date.now() / 1000) + (20 * 60);
  
  try {
    console.log("Calling router.addLiquidityETH()...");
    console.log(`Token: ${MMM_ADDRESS} (${mmmSymbol})`);
    console.log(`Amount Token Desired: ${ethers.formatUnits(mmmAmount, mmmDecimals)} ${mmmSymbol}`);
    console.log(`Amount ETH Desired: ${ethers.formatEther(wmonAmount)} MON (will be wrapped to ${wmonSymbol})`);
    console.log(`To: ${user.address}`);
    console.log(`Deadline: ${deadline}`);

    const addLiquidityTx = await router.addLiquidityETH(
      MMM_ADDRESS,     // token
      mmmAmount,       // amountTokenDesired
      amountTokenMin,  // amountTokenMin
      amountETHMin,    // amountETHMin
      user.address,    // to (receive LP tokens)
      deadline,        // deadline
      { value: wmonAmount } // send MON (will be wrapped)
    );

    console.log(`\n⏳ Liquidity tx submitted: ${addLiquidityTx.hash}`);
    console.log("Waiting for confirmation...");
    
    const receipt = await addLiquidityTx.wait();
    console.log("✅ Liquidity added successfully!");
    
    // Get the created pair address
    const newPair = await factory.getPair(MMM_ADDRESS, await router.WETH());
    console.log(`🎉 New pool created at: ${newPair}`);
    
  } catch (error) {
    console.log("❌ Error adding liquidity:", error.message);
    
    if (error.transaction) {
      console.log("Transaction:", error.transaction);
    }
    
    // Try alternative: Use addLiquidity with wMON directly
    console.log("\n🔄 Trying alternative method with wMON directly...");
    await addLiquidityAlternative();
    return;
  }

  // 7. Verify pool creation
  console.log("\n🔍 Verifying pool creation...");
  
  try {
    const newPair = await factory.getPair(MMM_ADDRESS, await router.WETH());
    
    if (newPair === ethers.ZeroAddress) {
      console.log("⚠️  Pair address is still zero");
    } else {
      console.log(`✅ Pool verified at: ${newPair}`);
      
      // IMPORTANT: Set this pool as AMM pair in MMM contract!
      console.log("\n⚠️  IMPORTANT: You must set this pool as AMM pair!");
      console.log("Run: npx hardhat run scripts/set-pair.js --network monadTestnet");
      console.log("Or use this command:");
      console.log(`await mmm.setPair("${newPair}", true);`);
    }
  } catch (error) {
    console.log("Error verifying pool:", error.message);
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ Pool creation script complete!");
}

// Alternative method if addLiquidityETH fails
async function addLiquidityAlternative() {
  console.log("This would use addLiquidity(tokenA, tokenB, ...) with wMON");
  console.log("But addLiquidityETH should work for Monad's router");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});