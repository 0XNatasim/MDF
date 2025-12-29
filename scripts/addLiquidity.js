// scripts/add_liquidity_eth.js
const hre = require("hardhat");
const { ethers } = hre;

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)"
];

const ROUTER_ABI = [
  "function addLiquidityETH(address token,uint amountTokenDesired,uint amountTokenMin,uint amountETHMin,address to,uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)",
  "function factory() view returns (address)",
  "function WETH() view returns (address)"
];

async function main() {
  const CONFIG = {
    mmmToken: "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16",
    router:   "0x53FE6D2499742779BF2Bd12a23e3c102fAe9fEcA",
    wmon:     "0x51C0bb68b65bd84De6518C939CB9Dbe2d6Fa7079"
  };

  // Amounts to add
  const MMM_AMOUNT = "1000"; // MMM
  const MON_AMOUNT = "1";    // MON

  const [signer] = await ethers.getSigners();
  console.log("Network:", hre.network.name);
  console.log("Using account:", signer.address);

  const MMM = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, signer);
  const Router = new ethers.Contract(CONFIG.router, ROUTER_ABI, signer);

  // Sanity: router WETH matches your WMON
  const routerWeth = await Router.WETH();
  console.log("Router.WETH():", routerWeth);
  if (routerWeth.toLowerCase() !== CONFIG.wmon.toLowerCase()) {
    throw new Error(`Router WETH mismatch. Expected ${CONFIG.wmon}, got ${routerWeth}`);
  }

  const decimals = await MMM.decimals();
  const mmmAmount = ethers.parseUnits(MMM_AMOUNT, decimals);
  const monAmount = ethers.parseEther(MON_AMOUNT);

  // Balances
  const mmmBalance = await MMM.balanceOf(signer.address);
  const monBalance = await ethers.provider.getBalance(signer.address);

  console.log("Balances:");
  console.log("  MMM:", ethers.formatUnits(mmmBalance, decimals));
  console.log("  MON:", ethers.formatEther(monBalance));

  // Keep some MON for gas
  const gasBuffer = ethers.parseEther("0.05");
  if (monBalance < monAmount + gasBuffer) {
    throw new Error(
      `Insufficient MON (need ${MON_AMOUNT} + gas buffer). Have ${ethers.formatEther(monBalance)}`
    );
  }
  if (mmmBalance < mmmAmount) {
    throw new Error(
      `Insufficient MMM. Need ${MMM_AMOUNT}, have ${ethers.formatUnits(mmmBalance, decimals)}`
    );
  }

  // Approve
  console.log("Approving MMM if needed...");
  const allowance = await MMM.allowance(signer.address, CONFIG.router);
  if (allowance < mmmAmount) {
    const approveTx = await MMM.approve(CONFIG.router, mmmAmount);
    console.log("approve tx:", approveTx.hash);
    await approveTx.wait();
  } else {
    console.log("Allowance already sufficient.");
  }

  // Add liquidity
  console.log(`Adding liquidity: ${MMM_AMOUNT} MMM + ${MON_AMOUNT} MON...`);

  const deadline = Math.floor(Date.now() / 1000) + 600;

  // For first liquidity add, mins = 0 is safest.
  // Once pool exists and price is stable, set mins to manage slippage.
  const amountTokenMin = 0;
  const amountETHMin = 0;

  const tx = await Router.addLiquidityETH(
    CONFIG.mmmToken,
    mmmAmount,
    amountTokenMin,
    amountETHMin,
    signer.address,
    deadline,
    { value: monAmount }
  );

  console.log("addLiquidityETH tx:", tx.hash);
  const receipt = await tx.wait();

  console.log("✅ Liquidity added successfully!");
  console.log("Block:", receipt.blockNumber);
  console.log("Gas used:", receipt.gasUsed.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
