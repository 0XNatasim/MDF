const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function printEthersError(e) {
  console.log("---- ERROR (raw) ----");
  console.log(e);

  // Common ethers v6 fields
  if (e?.shortMessage) console.log("shortMessage:", e.shortMessage);
  if (e?.reason) console.log("reason:", e.reason);
  if (e?.code) console.log("code:", e.code);

  // Hardhat/JSON-RPC nested error
  const msg =
    e?.info?.error?.message ||
    e?.error?.message ||
    e?.message;

  if (msg) console.log("rpc message:", msg);
  console.log("---------------------");
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployer.address);

  const nativeBal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Native balance:", hre.ethers.formatEther(nativeBal), "MON");

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

  // ======== CONFIG (reduce if you’re low on MON) ========
  const MMM_LIQ = hre.ethers.parseUnits("1000000", 18); // 1,000,000 MMM
  const MON_LIQ = hre.ethers.parseEther("0.05");        // 0.05 MON (was 0.10)

  const MMM_MIN = (MMM_LIQ * 95n) / 100n;
  const MON_MIN = (MON_LIQ * 95n) / 100n;
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  const routerC = await hre.ethers.getContractAt("UniswapV2Router02", router);
  const mmmC    = await hre.ethers.getContractAt("MMM", mmm);

  // Sanity: confirm router points to your WMON
  console.log("router.factory():", await routerC.factory());
  console.log("router.WETH():   ", await routerC.WETH());

  // Approve router to spend MMM
  const allowance = await mmmC.allowance(deployer.address, router);
  console.log("Allowance:", allowance.toString());

  if (allowance < MMM_LIQ) {
    console.log("Approving router...");
    const txA = await mmmC.approve(router, MMM_LIQ);
    console.log("Approve tx:", txA.hash);
    await txA.wait();
  } else {
    console.log("Router already approved.");
  }

  // Confirm pair exists (you already created it)
  const factoryAbi = ["function getPair(address, address) view returns (address)"];
  const factoryC = new hre.ethers.Contract(factory, factoryAbi, deployer);
  const pair = await factoryC.getPair(mmm, wmon);
  console.log("Pair (MMM/WMON):", pair);

  // 1) STATIC CALL to capture revert reason
  console.log("Static calling addLiquidityETH to capture revert reason...");
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
    console.log("staticCall: OK (would succeed)");
  } catch (e) {
    console.log("staticCall reverted:");
    printEthersError(e);
    return;
  }

  // 2) SEND with manual gasLimit (bypass estimateGas flakiness)
  console.log("Sending addLiquidityETH with manual gasLimit...");
  try {
    const txL = await routerC.addLiquidityETH(
      mmm,
      MMM_LIQ,
      MMM_MIN,
      MON_MIN,
      deployer.address,
      deadline,
      { value: MON_LIQ, gasLimit: 4_500_000 }
    );
    console.log("addLiquidityETH tx:", txL.hash);
    const receipt = await txL.wait();
    console.log("Receipt status:", receipt.status);
  } catch (e) {
    console.log("Send reverted:");
    printEthersError(e);
    return;
  }

  // Set pair in MMM so buy/sell taxes work
  console.log("Setting pair in MMM...");
  const txP = await mmmC.setPair(pair, true);
  console.log("setPair tx:", txP.hash);
  await txP.wait();

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
