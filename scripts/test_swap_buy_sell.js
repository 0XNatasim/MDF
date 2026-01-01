// scripts/test_swap_buy_sell.js
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function mustAddress(label, v) {
  try { return hre.ethers.getAddress(v); } catch { throw new Error(`${label} invalid: ${v}`); }
}

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const ROUTER_ABI = [
  "function WETH() view returns (address)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin,address[] calldata path,address to,uint deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn,uint amountOutMin,address[] calldata path,address to,uint deadline)",
];

async function main() {
  const net = hre.network.name;

  const mmmPath    = path.join("deployments", `mmm.${net}.json`);
  const routerPath = path.join("deployments", `router.${net}.json`);

  const { mmm, wmon } = readJson(mmmPath);
  const { router } = readJson(routerPath);

  const MMM  = mustAddress("MMM", mmm);
  const WMON = mustAddress("WMON", wmon);
  const ROUTER = mustAddress("ROUTER", router);

  const [signer] = await hre.ethers.getSigners();
  const me = signer.address;

  console.log("Network:", net);
  console.log("Signer :", me);
  console.log("Router :", ROUTER);
  console.log("MMM    :", MMM);

  const r = new hre.ethers.Contract(ROUTER, ROUTER_ABI, signer);
  const t = new hre.ethers.Contract(MMM, ERC20_ABI, signer);

  console.log("router.WETH():", await r.WETH(), "(expected WMON:", WMON, ")");

  // BUY: 0.01 MON -> MMM
  const buyIn = hre.ethers.parseEther("0.01");
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const pathBuy = [WMON, MMM];

  const beforeMMM = await t.balanceOf(me);
  console.log("MMM before buy:", hre.ethers.formatUnits(beforeMMM, await t.decimals()));

  // populate tx to prove calldata != ""
  const populatedBuy = await r.swapExactETHForTokensSupportingFeeOnTransferTokens.populateTransaction(
    0, pathBuy, me, deadline, { value: buyIn }
  );
  console.log("BUY calldata length:", (populatedBuy.data || "").length);

  const buyTx = await r.swapExactETHForTokensSupportingFeeOnTransferTokens(
    0, pathBuy, me, deadline, { value: buyIn, gasLimit: 3_000_000n }
  );
  console.log("buy tx:", buyTx.hash);
  await buyTx.wait();

  const afterMMM = await t.balanceOf(me);
  console.log("MMM after buy :", hre.ethers.formatUnits(afterMMM, await t.decimals()));

  // SELL: sell a small amount of MMM back to MON
  const sellAmountMMM = hre.ethers.parseUnits("1000", await t.decimals());
  const allowance = await t.allowance(me, ROUTER);
  if (allowance < sellAmountMMM) {
    const ap = await t.approve(ROUTER, hre.ethers.MaxUint256);
    console.log("approve tx:", ap.hash);
    await ap.wait();
  }

  const pathSell = [MMM, WMON];

  const populatedSell = await r.swapExactTokensForETHSupportingFeeOnTransferTokens.populateTransaction(
    sellAmountMMM, 0, pathSell, me, deadline
  );
  console.log("SELL calldata length:", (populatedSell.data || "").length);

  const sellTx = await r.swapExactTokensForETHSupportingFeeOnTransferTokens(
    sellAmountMMM, 0, pathSell, me, deadline, { gasLimit: 3_000_000n }
  );
  console.log("sell tx:", sellTx.hash);
  await sellTx.wait();

  console.log("✅ BUY+SELL test completed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
