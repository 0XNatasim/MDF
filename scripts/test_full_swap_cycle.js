const hre = require("hardhat");
const { ethers } = hre;

async function main() {

  const provider = new ethers.JsonRpcProvider(hre.network.config.url);
  const wallet = new ethers.Wallet(process.env.FRESH3_PRIVATE_KEY, provider);

  const MMM = await ethers.getContractAt("MMMToken", process.env.TESTNET_MMM, wallet);
  const ROUTER = new ethers.Contract(
    process.env.TESTNET_ROUTER,
    ["function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256) payable",
     "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)"],
    wallet
  );

  const WETH = await ethers.getContractAt("WETH9", process.env.TESTNET_WMON, wallet);
  const PAIR = await ethers.getContractAt("UniswapV2Pair", process.env.TESTNET_Pair, wallet);

  const taxVault = await MMM.taxVault();

  console.log("\n=== FULL SWAP CYCLE TEST ===\n");

  const buyAmount = ethers.parseEther("0.01");
  const pathBuy = [process.env.TESTNET_WMON, process.env.TESTNET_MMM];
  const deadline = Math.floor(Date.now() / 1000) + 1200;

  console.log("---- BUY ----");

  const mmmBefore = await MMM.balanceOf(wallet.address);
  const taxBefore = await MMM.balanceOf(taxVault);

  const txBuy = await ROUTER.swapExactETHForTokensSupportingFeeOnTransferTokens(
    0,
    pathBuy,
    wallet.address,
    deadline,
    { value: buyAmount }
  );

  await txBuy.wait();

  const mmmAfter = await MMM.balanceOf(wallet.address);
  const taxAfter = await MMM.balanceOf(taxVault);

  const received = mmmAfter - mmmBefore;
  const taxCollected = taxAfter - taxBefore;

  console.log("MMM received:", ethers.formatUnits(received, 18));
  console.log("Tax collected:", ethers.formatUnits(taxCollected, 18));

  const sellAmount = received;

  console.log("\n---- SELL ----");

  await MMM.approve(process.env.TESTNET_ROUTER, sellAmount);

  const pathSell = [process.env.TESTNET_MMM, process.env.TESTNET_WMON];

  const txSell = await ROUTER.swapExactTokensForETHSupportingFeeOnTransferTokens(
    sellAmount,
    0,
    pathSell,
    wallet.address,
    deadline
  );

  await txSell.wait();

  const mmmFinal = await MMM.balanceOf(wallet.address);
  const taxFinal = await MMM.balanceOf(taxVault);

  console.log("Final MMM balance:", ethers.formatUnits(mmmFinal, 18));
  console.log("Final TaxVault balance:", ethers.formatUnits(taxFinal, 18));

  console.log("\n✅ FULL CYCLE COMPLETE\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
