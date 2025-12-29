const hre = require("hardhat");
const fs = require("fs");

function readJson(p){ return JSON.parse(fs.readFileSync(p,"utf8")); }

async function main() {
  const net = hre.network.name;
  const { mmm } = readJson(`deployments/mmm.${net}.json`);
  const { wmon } = readJson(`deployments/wmon.${net}.json`);
  const { router } = readJson(`deployments/router_patched.${net}.json`); // or router.${net}.json

  const Router = await hre.ethers.getContractAt("PatchedV2Router02", router);
  const factoryAddr = await Router.factory();

  const Factory = await hre.ethers.getContractAt("UniswapV2Factory", factoryAddr);
  const pairFromFactory = await Factory.getPair(wmon, mmm);

  console.log("router:", router);
  console.log("router.factory():", factoryAddr);
  console.log("wmon:", wmon);
  console.log("mmm:", mmm);
  console.log("factory.getPair(wmon, mmm):", pairFromFactory);
}

main().catch((e)=>{ console.error(e); process.exit(1); });
