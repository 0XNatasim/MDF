const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const net = hre.network.name;

  const mmmPath = path.join("deployments", `mmm.${net}.json`);
  const routerPath = path.join("deployments", `router_patched.${net}.json`);

  if (!fs.existsSync(mmmPath)) throw new Error(`Missing ${mmmPath}`);
  if (!fs.existsSync(routerPath)) throw new Error(`Missing ${routerPath}`);

  const { mmm } = readJson(mmmPath);
  const { router } = readJson(routerPath);

  console.log("MMM:", mmm);
  console.log("New router:", router);

  const mmmC = await hre.ethers.getContractAt("MMM", mmm);
  const tx = await mmmC.setRouter(router);
  console.log("setRouter tx:", tx.hash);
  await tx.wait();

  console.log("MMM router is now:", await mmmC.router());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
