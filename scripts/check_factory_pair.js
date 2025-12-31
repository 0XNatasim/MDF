// scripts/check_factory_pair.js
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadDeploymentAddress(net, name) {
  const p = path.join(__dirname, "..", "deployments", `${name}.${net}.json`);
  if (!fs.existsSync(p)) return null;
  const j = readJson(p);

  const key =
    name === "router" ? "router" :
    name === "factory" ? "factory" :
    name === "wmon" ? "wmon" :
    name === "mmm" ? "mmm" :
    name;

  if (typeof j[key] === "string" && j[key].startsWith("0x")) return j[key];

  for (const v of Object.values(j)) {
    if (typeof v === "string" && v.startsWith("0x")) return v;
  }
  return null;
}

async function main() {
  const net = hre.network.name;

  const FALLBACK = {
    router:  "0xC3B66EE616286c5e4A0aE6D33238e86104Ec8051", // NEW router
    factory: "0x8e8a713Be23d9be017d7A5f4D649982B5dD24615",
    wmon:    "0x51C0bb68b65bd84De6518C939CB9Dbe2d6Fa7079",
    mmm:     "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16",
  };

  const ROUTER  = loadDeploymentAddress(net, "router")  || FALLBACK.router;
  const FACTORY = loadDeploymentAddress(net, "factory") || FALLBACK.factory;
  const WMON    = loadDeploymentAddress(net, "wmon")    || FALLBACK.wmon;
  const MMM     = loadDeploymentAddress(net, "mmm")     || FALLBACK.mmm;

  const ROUTER_ABI = [
    "function factory() view returns (address)",
    "function WETH() view returns (address)",
  ];
  const FACTORY_ABI = [
    "function getPair(address tokenA, address tokenB) view returns (address)",
  ];
  const PAIR_ABI = [
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)",
  ];

  console.log("Network:", net);
  console.log("router:", ROUTER);

  const provider = ethers.provider;

  const router = new ethers.Contract(ROUTER, ROUTER_ABI, provider);
  const routerFactory = await router.factory();
  const routerWeth = await router.WETH();

  console.log("router.factory():", routerFactory);
  console.log("router.WETH():   ", routerWeth);

  console.log("expected factory:", FACTORY);
  console.log("expected WMON:   ", WMON);
  console.log("MMM:            ", MMM);

  const factory = new ethers.Contract(routerFactory, FACTORY_ABI, provider);
  const pairAddr = await factory.getPair(routerWeth, MMM);

  console.log("factory.getPair(WMON, MMM):", pairAddr);

  if (!pairAddr || pairAddr === ethers.ZeroAddress) {
    console.log("❌ Pair not found (no liquidity or wrong router/factory/WETH/MMM).");
    return;
  }

  const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
  const [t0, t1, r] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);

  console.log("pair.token0:", t0);
  console.log("pair.token1:", t1);
  console.log("reserve0:", r[0].toString());
  console.log("reserve1:", r[1].toString());
  console.log("✅ OK.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
