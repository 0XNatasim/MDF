const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = hre.network.name;

  console.log("Network:", net);
  console.log("Deployer:", deployer.address);

  const nativeBal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Native balance:", hre.ethers.formatEther(nativeBal), "MON");

  const factoryPath = path.join("deployments", `factory.${net}.json`);
  const wmonPath = path.join("deployments", `wmon.${net}.json`);
  const mmmPath = path.join("deployments", `mmm.${net}.json`);
  const routerPath = path.join("deployments", `router_patched.${net}.json`);

  if (!fs.existsSync(factoryPath)) throw new Error(`Missing ${factoryPath}`);
  if (!fs.existsSync(wmonPath)) throw new Error(`Missing ${wmonPath}`);
  if (!fs.existsSync(mmmPath)) throw new Error(`Missing ${mmmPath}`);
  if (!fs.existsSync(routerPath)) throw new Error(`Missing ${routerPath}`);

  const { factory } = readJson(factoryPath);
  const { wmon } = readJson(wmonPath);
  const { mmm } = readJson(mmmPath);
  const { router } = readJson(routerPath);

  console.log("Factory:", factory);
  console.log("WMON   :", wmon);
  console.log("MMM    :", mmm);
  console.log("Router :", router);

  // ===== CONFIG: Liquidity amounts =====
  const MMM_LIQ = hre.ethers.parseUnits("1000000", 18); // 1,000,000 MMM
  const MON_LIQ = hre.ethers.parseEther("0.05");        // 0.05 MON

  const MMM_MIN = (MMM_LIQ * 95n) / 100n;
  const MON_MIN = (MON_LIQ * 95n) / 100n;
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  const mmmC = await hre.ethers.getContractAt("MMM", mmm);
  const routerC = await hre.ethers.getContractAt("PatchedV2Router02", router);

  // Approve router
  const allowance = await mmmC.allowance(deployer.address, router);
  if (allowance < MMM_LIQ) {
    console.log("Approving patched router...");
    const txA = await mmmC.approve(router, MMM_LIQ);
    console.log("Approve tx:", txA.hash);
    await txA.wait();
  } else {
    console.log("Patched router already approved.");
  }

  console.log("Adding liquidity...");
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
  await txL.wait();

  // Get pair from factory
  const factoryAbi = ["function getPair(address,address) view returns (address)"];
  const factoryC = new hre.ethers.Contract(factory, factoryAbi, deployer);
  const pair = await factoryC.getPair(mmm, wmon);

  console.log("Pair (MMM/WMON):", pair);
  if (pair === hre.ethers.ZeroAddress) throw new Error("Pair not found after liquidity (unexpected).");

  console.log("Setting pair in MMM...");
  const txP = await mmmC.setPair(pair, true);
  console.log("setPair tx:", txP.hash);
  await txP.wait();

  // Save
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    path.join("deployments", `pair.${net}.json`),
    JSON.stringify(
      {
        network: net,
        mmm,
        wmon,
        factory,
        routerPatched: router,
        pair,
        mmmLiquidity: MMM_LIQ.toString(),
        monLiquidityWei: MON_LIQ.toString(),
        addLiquidityTx: txL.hash,
        setPairTx: txP.hash,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log("Saved deployments/pair.<network>.json");
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
