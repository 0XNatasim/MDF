// scripts/set_mmm_router.js
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

  // Try common keys: {router:"0x.."} {mmm:"0x.."} etc.
  const commonKeys = ["router", "mmm", "pair", "factory", "wmon", "rewardTracker"];
  for (const k of commonKeys) {
    if (typeof j[k] === "string" && j[k].startsWith("0x")) return j[k];
  }

  // fallback: find first 0x string anywhere
  for (const v of Object.values(j)) {
    if (typeof v === "string" && v.startsWith("0x")) return v;
  }

  return null;
}

async function main() {
  const net = hre.network.name;

  // Fallbacks (update router fallback to your NEW router)
  const FALLBACK = {
    mmm: "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16",
    router: "0xC3B66EE616286c5e4A0aE6D33238e86104Ec8051",
  };

  const MMM_ADDR = loadDeploymentAddress(net, "mmm") || FALLBACK.mmm;
  const ROUTER_ADDR = loadDeploymentAddress(net, "router") || FALLBACK.router;

  const [signer] = await ethers.getSigners();
  console.log("Network:", net);
  console.log("Signer:", signer.address);
  console.log("MMM:", MMM_ADDR);
  console.log("New router:", ROUTER_ADDR);

  const MMM_ABI = [
    "function setRouter(address) external",
    "function router() view returns (address)",
    "function owner() view returns (address)",
  ];

  const mmm = new ethers.Contract(MMM_ADDR, MMM_ABI, signer);

  const owner = await mmm.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer is not owner. MMM.owner()=${owner}`);
  }

  const before = await mmm.router();
  console.log("MMM.router() before:", before);

  const tx = await mmm.setRouter(ROUTER_ADDR);
  console.log("setRouter tx:", tx.hash);
  await tx.wait();

  const after = await mmm.router();
  console.log("MMM.router() after:", after);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
