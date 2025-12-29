const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployer.address);

  const factoryPath = path.join("deployments", `factory.${hre.network.name}.json`);
  const routerPath  = path.join("deployments", `router.${hre.network.name}.json`);
  const wmonPath    = path.join("deployments", `wmon.${hre.network.name}.json`);
  const mmmPath     = path.join("deployments", `mmm.${hre.network.name}.json`);

  const { factory } = readJson(factoryPath);
  const { router }  = readJson(routerPath);
  const { wmon }    = readJson(wmonPath);
  const { mmm }     = readJson(mmmPath);

  console.log("Factory:", factory);
  console.log("Router :", router);
  console.log("WMON   :", wmon);
  console.log("MMM    :", mmm);

  // amounts (same as your script)
  const MMM_LIQ = hre.ethers.parseUnits("1000000", 18);
  const MON_LIQ = hre.ethers.parseEther("0.10");
  const MMM_MIN = (MMM_LIQ * 95n) / 100n;
  const MON_MIN = (MON_LIQ * 95n) / 100n;
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  // contracts
  const routerC = await hre.ethers.getContractAt("UniswapV2Router02", router);
  const mmmC = await hre.ethers.getContractAt("MMM", mmm);

  // quick checks
  console.log("router.factory():", await routerC.factory());
  console.log("router.WETH():   ", await routerC.WETH());

  console.log("Deployer MMM balance:", (await mmmC.balanceOf(deployer.address)).toString());
  console.log("Allowance to router :", (await mmmC.allowance(deployer.address, router)).toString());

  // show existing pair
  const factoryAbi = [
    "function getPair(address, address) view returns (address)",
    "function createPair(address, address) returns (address)",
  ];
  const factoryC = new hre.ethers.Contract(factory, factoryAbi, deployer);

  const existingPair = await factoryC.getPair(mmm, wmon);
  console.log("Existing pair:", existingPair);

  // Try createPair directly if missing
  if (existingPair === hre.ethers.ZeroAddress) {
    console.log("Pair missing -> attempting factory.createPair(MMM, WMON)...");
    try {
      const tx = await factoryC.createPair(mmm, wmon);
      console.log("createPair tx:", tx.hash);
      await tx.wait();
      const newPair = await factoryC.getPair(mmm, wmon);
      console.log("New pair:", newPair);
    } catch (e) {
      console.log("createPair reverted. Raw error:");
      console.log(e);
      return;
    }
  }

  // Try callStatic addLiquidityETH to get revert reason
  console.log("Testing callStatic.addLiquidityETH (to capture revert reason)...");
  try {
    await routerC.addLiquidityETH.staticCall(
      mmm,
      MMM_LIQ,
      MMM_MIN,
      MON_MIN,
      deployer.address,
      deadline,
      { value: MON_LIQ }
    );
    console.log("callStatic.addLiquidityETH: OK (would succeed)");
  } catch (e) {
    console.log("callStatic.addLiquidityETH reverted. Raw error:");
    console.log(e);
    return;
  }

  // If static OK, send with a manual gasLimit (sometimes estimateGas is flaky)
  console.log("Sending addLiquidityETH with manual gasLimit...");
  const tx2 = await routerC.addLiquidityETH(
    mmm,
    MMM_LIQ,
    MMM_MIN,
    MON_MIN,
    deployer.address,
    deadline,
    { value: MON_LIQ, gasLimit: 3_500_000 }
  );

  console.log("addLiquidityETH tx:", tx2.hash);
  const receipt = await tx2.wait();
  console.log("Receipt status:", receipt.status);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
