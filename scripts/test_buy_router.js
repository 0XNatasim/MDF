const hre = require("hardhat");
const fs = require("fs");

function readJson(p){ return JSON.parse(fs.readFileSync(p,"utf8")); }

async function main() {
  const net = hre.network.name;
  const { mmm } = readJson(`deployments/mmm.${net}.json`);
  const { wmon } = readJson(`deployments/wmon.${net}.json`);
  const { router } = readJson(`deployments/router_patched.${net}.json`);
  const { pair } = readJson(`deployments/pair.${net}.json`);

  const [signer] = await hre.ethers.getSigners();

  console.log("Network:", net);
  console.log("Signer:", signer.address);
  console.log("MMM:", mmm);
  console.log("WMON:", wmon);
  console.log("Router:", router);
  console.log("Pair:", pair);

  const Router = await hre.ethers.getContractAt("PatchedV2Router02", router);
  const Pair = await hre.ethers.getContractAt("@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol:IUniswapV2Pair", pair);
  const MMM = await hre.ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", mmm);

  // Confirm pair tokens
  const token0 = await Pair.token0();
  const token1 = await Pair.token1();
  console.log("pair.token0:", token0);
  console.log("pair.token1:", token1);

  // Quote expected output for 0.001 MON
  const monIn = hre.ethers.parseEther("0.001");
  const path = [wmon, mmm];

  let amounts;
  try {
    amounts = await Router.getAmountsOut(monIn, path);
    console.log("Quote getAmountsOut(0.001 MON):", amounts.map(a => a.toString()));
  } catch (e) {
    console.log("getAmountsOut failed:", e.message);
  }

  // Use VERY lenient minOut for debugging (1 wei)
  const amountOutMin = 1;
  const deadline = Math.floor(Date.now()/1000) + 600;

  const balBefore = await MMM.balanceOf(signer.address);

  console.log("Sending swapExactETHForTokensSupportingFeeOnTransferTokens...");
  const tx = await Router.swapExactETHForTokensSupportingFeeOnTransferTokens(
    amountOutMin,
    path,
    signer.address,
    deadline,
    { value: monIn }
  );

  console.log("tx:", tx.hash);
  const rc = await tx.wait();
  console.log("status:", rc.status, "gasUsed:", rc.gasUsed.toString());

  const balAfter = await MMM.balanceOf(signer.address);
  console.log("MMM before:", balBefore.toString());
  console.log("MMM after :", balAfter.toString());
  console.log("delta     :", (balAfter - balBefore).toString());
}

main().catch((e)=>{ console.error(e); process.exit(1); });
